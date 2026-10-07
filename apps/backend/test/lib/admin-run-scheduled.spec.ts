/**
 * Staging 运行的触发入口 `POST /admin/briefs/run-scheduled`：走真实路由 + 本机测试库。
 * workflow binding 换成记录「被要求启动」的假实现（真的会开跑 LLM 链路）；ENVIRONMENT 按用例设置。
 */
import { $brief_runs, sql } from '@meridian/database';
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/lib/database';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);
const mutableEnv = env as unknown as { ENVIRONMENT?: string; AUTO_BRIEF: unknown };
const realBinding = mutableEnv.AUTO_BRIEF;
const realEnvironment = mutableEnv.ENVIRONMENT;

let created: { id: string; params: { triggeredBy?: string } }[] = [];

const run = (auth: string | null = `Bearer ${env.API_TOKEN}`) =>
  exports.default.fetch('http://backend/admin/briefs/run-scheduled', {
    method: 'POST',
    headers: auth === null ? {} : { Authorization: auth },
  });

beforeEach(async () => {
  created = [];
  mutableEnv.AUTO_BRIEF = {
    create: async (opts: { id: string; params: { triggeredBy?: string } }) => {
      created.push(opts);
      return { id: opts.id };
    },
  };
  mutableEnv.ENVIRONMENT = 'staging';
  await db.execute(sql`truncate brief_runs restart identity cascade`);
});

afterEach(() => {
  mutableEnv.AUTO_BRIEF = realBinding;
  mutableEnv.ENVIRONMENT = realEnvironment;
});

describe('POST /admin/briefs/run-scheduled', () => {
  it('staging 带 token：202，返回 cron-brief- 前缀的 workflowId，workflow 被要求启动一次', async () => {
    const res = await run();
    expect(res.status).toBe(202);
    const body = (await res.json()) as { success: boolean; data: { workflowId: string } };
    expect(body.success).toBe(true);
    expect(body.data.workflowId).toMatch(/^cron-brief-/);
    expect(created).toHaveLength(1);
    expect(created[0].id).toBe(body.data.workflowId);
    expect(created[0].params.triggeredBy).toBe('cron');
  });

  it('已有运行在飞：409，带 blockingWorkflowId，不启动新的', async () => {
    await db.insert($brief_runs).values({ workflow_id: 'cron-brief-inflight', status: 'RUNNING' });
    const res = await run();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, blockingWorkflowId: 'cron-brief-inflight' });
    expect(created).toHaveLength(0);
  });

  it('触发出错：500', async () => {
    mutableEnv.AUTO_BRIEF = {
      create: async () => {
        throw new Error('boom');
      },
    };
    const res = await run();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false });
  });

  it('ENVIRONMENT 是 production：404，不触发', async () => {
    mutableEnv.ENVIRONMENT = 'production';
    expect((await run()).status).toBe(404);
    expect(created).toHaveLength(0);
  });

  it('ENVIRONMENT 缺省：404，不触发', async () => {
    delete mutableEnv.ENVIRONMENT;
    expect((await run()).status).toBe(404);
    expect(created).toHaveLength(0);
  });

  it('不带 token：401，不触发', async () => {
    expect((await run(null)).status).toBe(401);
    expect(created).toHaveLength(0);
  });
});
