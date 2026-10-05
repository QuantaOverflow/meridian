/**
 * 运维台的「各服务跑的是哪个版本」：GET /observability/ops/services 与 backend 自己的 GET /version。
 * 走真实路由；AI_WORKER / ML_SERVICE 两个 service binding 换成按各自响应契约回包的假对象
 * （ai-worker 的 GET /meridian/version、ml-service 的 GET /health），backend 自己的版本来自
 * version metadata binding 与部署脚本注入的变量。不连数据库。
 */
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { OpsServiceVersion } from '@meridian/contracts';
import app from '../../src/app';

type Binding = { fetch(request: Request): Promise<Response> };

const aiWorkerVersion: OpsServiceVersion = {
  service: 'ai-worker',
  commit: 'a1b2c3d',
  title: 'fix(ai-worker): 核查循环少跑一轮',
  dirty: false,
  deployedAt: '2026-10-04T09:00:00.000Z',
  versionId: 'ai-version-id',
  health: 'healthy',
};

/** ai-worker：只认 GET /meridian/version，回它自己的 `{ success, data }` 外壳 */
const aiWorker: Binding = {
  fetch: async (request) => {
    const { pathname } = new URL(request.url);
    if (request.method !== 'GET' || pathname !== '/meridian/version') return new Response('not found', { status: 404 });
    return Response.json({ success: true, data: aiWorkerVersion });
  },
};

/** ml-service：容器的 /health 回包 + 壳加的版本 id 响应头 */
function mlService(buildIdentity: Record<string, unknown>, headers: Record<string, string> = {}): Binding {
  return {
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      if (request.method !== 'GET' || pathname !== '/health') return new Response('not found', { status: 404 });
      return Response.json({ status: 'healthy', build_identity: buildIdentity }, { headers });
    },
  };
}

const mlDeployed = mlService(
  { build_time: '2026-10-03T08:30:00Z', injected: true, git_commit: 'e4f5a6b', git_title: 'feat(ml): 换聚类阈值', git_dirty: true },
  { 'x-meridian-version-id': 'ml-version-id' },
);

const unreachable: Binding = {
  fetch: async () => {
    throw new Error('Service binding not connected');
  },
};

const backendDeploy = {
  CF_VERSION_METADATA: { id: 'backend-version-id', tag: '13db6c7', timestamp: '2026-10-05T12:00:00.000Z' },
  GIT_COMMIT: '13db6c7',
  GIT_TITLE: 'feat(ops): 运维台的接口约定: a, b',
  GIT_DIRTY: 'false',
};

const backendVersion: OpsServiceVersion = {
  service: 'backend',
  commit: '13db6c7',
  title: 'feat(ops): 运维台的接口约定: a, b',
  dirty: false,
  deployedAt: '2026-10-05T12:00:00.000Z',
  versionId: 'backend-version-id',
  health: 'healthy',
};

function get(path: string, bindings: Record<string, unknown>, token: string | null = env.API_TOKEN) {
  return app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, { ...env, ...bindings });
}

async function services(bindings: Record<string, unknown>): Promise<OpsServiceVersion[]> {
  const res = await get('/observability/ops/services', bindings);
  expect(res.status).toBe(200);
  return res.json();
}

describe('GET /observability/ops/services', () => {
  it('三个服务都在：各自的提交、标题、dirty、部署时刻、版本 id，都是 healthy', async () => {
    expect(await services({ ...backendDeploy, AI_WORKER: aiWorker, ML_SERVICE: mlDeployed })).toEqual([
      backendVersion,
      aiWorkerVersion,
      {
        service: 'ml-service',
        commit: 'e4f5a6b',
        title: 'feat(ml): 换聚类阈值',
        dirty: true,
        // ml-service 的部署时刻是镜像的构建戳
        deployedAt: '2026-10-03T08:30:00Z',
        versionId: 'ml-version-id',
        health: 'healthy',
      },
    ]);
  });

  it('够不着的服务是 unknown、各项为 null，不是报错；其余服务照常', async () => {
    expect(await services({ ...backendDeploy, AI_WORKER: unreachable, ML_SERVICE: unreachable })).toEqual([
      backendVersion,
      { service: 'ai-worker', commit: null, title: null, dirty: null, deployedAt: null, versionId: null, health: 'unknown' },
      { service: 'ml-service', commit: null, title: null, dirty: null, deployedAt: null, versionId: null, health: 'unknown' },
    ]);
  });

  it('答了但不是成功响应的服务是 unhealthy', async () => {
    const failing: Binding = { fetch: async () => new Response('boom', { status: 503 }) };

    const [, ai, ml] = await services({ ...backendDeploy, AI_WORKER: failing, ML_SERVICE: failing });

    expect(ai).toEqual({ service: 'ai-worker', commit: null, title: null, dirty: null, deployedAt: null, versionId: null, health: 'unhealthy' });
    expect(ml).toEqual({ service: 'ml-service', commit: null, title: null, dirty: null, deployedAt: null, versionId: null, health: 'unhealthy' });
  });

  it('没经部署脚本的服务：健康，但提交各项为 null', async () => {
    // backend 没有注入的变量与 version metadata；ml 是加提交字段之前的镜像、本地直起（没有构建戳、没有壳）
    const oldImage = mlService({ build_time: 'not-injected', injected: false });

    const [backend, , ml] = await services({ AI_WORKER: aiWorker, ML_SERVICE: oldImage });

    expect(backend).toEqual({ service: 'backend', commit: null, title: null, dirty: null, deployedAt: null, versionId: null, health: 'healthy' });
    expect(ml).toEqual({ service: 'ml-service', commit: null, title: null, dirty: null, deployedAt: null, versionId: null, health: 'healthy' });
  });
});

describe('GET /version', () => {
  it('回 backend 自己的版本', async () => {
    const res = await get('/version', backendDeploy);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(backendVersion);
  });

  it('不带 token 是 401（提交标题不对公网开放）', async () => {
    expect((await get('/version', backendDeploy, null)).status).toBe(401);
    expect((await get('/observability/ops/services', backendDeploy, null)).status).toBe(401);
  });
});
