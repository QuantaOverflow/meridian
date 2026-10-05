import type { OpsServiceName, OpsServiceVersion } from '@meridian/contracts';
import type { Env } from '../../index';
import { createAIServices } from '../services/ai-services';
import { createMLService } from '../services/ml-service';
import { Logger } from '../core/logger';

const logger = new Logger({ component: 'ops-services' });

/**
 * 三个服务各自跑的是哪个版本（运维台 Health 视图用）。不和 GitHub 比。
 *
 * - backend：自己的 version metadata binding（版本 id、部署时刻）+ scripts/deploy.sh 部署时注入的 GIT_* 变量
 * - ai-worker：经 AI_WORKER binding 读它的 GET /meridian/version（同样的两个来源，在它那边拼好）
 * - ml-service：经 ML_SERVICE binding 读容器的 GET /health——提交三项与构建戳烤在镜像里，部署时刻取构建戳；
 *   版本 id 是前面那层壳（cf-worker）的，壳用响应头带出来
 *
 * 够不着（binding 抛错、超时）是 unknown，答了但不是成功响应是 unhealthy，两种都不抛错、各项为 null。
 * 不经部署脚本部署的服务照常 healthy，只是提交各项为 null。
 */

/** 探一个服务最多等多久。ml-service 的容器睡着时要先冷启动，等不到就算 unknown，不拖住整个页面 */
const PROBE_TIMEOUT_MS = 10_000;

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function blank(service: OpsServiceName, health: OpsServiceVersion['health']): OpsServiceVersion {
  return { service, commit: null, title: null, dirty: null, deployedAt: null, versionId: null, health };
}

/** backend 自己的版本。能跑到这里就是 healthy */
export function backendVersion(env: Env): OpsServiceVersion {
  const dirty = text(env.GIT_DIRTY);
  return {
    service: 'backend',
    commit: text(env.GIT_COMMIT),
    title: text(env.GIT_TITLE),
    dirty: dirty === 'true' ? true : dirty === 'false' ? false : null,
    deployedAt: text(env.CF_VERSION_METADATA?.timestamp),
    versionId: text(env.CF_VERSION_METADATA?.id),
    health: 'healthy',
  };
}

async function aiWorkerVersion(env: Env): Promise<OpsServiceVersion> {
  try {
    const result = await createAIServices(env).aiWorker.version(PROBE_TIMEOUT_MS);
    if (result.ok) return result.value;
    logger.warn('ai-worker 的版本请求不是成功响应', { status: result.status, error_message: result.error });
    return blank('ai-worker', 'unhealthy');
  } catch (error) {
    logger.warn('够不着 ai-worker', { error_message: error instanceof Error ? error.message : String(error) });
    return blank('ai-worker', 'unknown');
  }
}

async function mlServiceVersion(env: Env): Promise<OpsServiceVersion> {
  try {
    const result = await createMLService(env).health(PROBE_TIMEOUT_MS);
    if (!result.ok || result.value.status !== 'healthy') {
      logger.warn('ml-service 的 /health 不是健康响应', result.ok ? { status_text: result.value.status } : { status: result.status, error_message: result.error });
      return blank('ml-service', 'unhealthy');
    }
    const { buildIdentity, versionId } = result.value;
    return {
      service: 'ml-service',
      commit: text(buildIdentity.git_commit),
      title: text(buildIdentity.git_title),
      dirty: typeof buildIdentity.git_dirty === 'boolean' ? buildIdentity.git_dirty : null,
      // injected=false 时 build_time 是占位值（本地直起的服务，没有构建戳）
      deployedAt: buildIdentity.injected === true ? text(buildIdentity.build_time) : null,
      versionId,
      health: 'healthy',
    };
  } catch (error) {
    logger.warn('够不着 ml-service', { error_message: error instanceof Error ? error.message : String(error) });
    return blank('ml-service', 'unknown');
  }
}

/** 顺序固定：backend、ai-worker、ml-service。现在挂在 GET /observability/ops/services（ops.router.ts），09 号票的 Health 端点也用它 */
export async function getServiceVersions(env: Env): Promise<OpsServiceVersion[]> {
  const [aiWorker, mlService] = await Promise.all([aiWorkerVersion(env), mlServiceVersion(env)]);
  return [backendVersion(env), aiWorker, mlService];
}
