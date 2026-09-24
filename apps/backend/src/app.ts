import openGraph from './routers/openGraph.router';
import durableObjectsRouter from './routers/durableObjects.router';
import eventsRouter from './routers/events.router'; // 导入新的路由
import adminRouter from './routers/admin'; // 导入admin路由
import observabilityRouter from './routers/observability'; // 导入可观测性路由
import { Env } from './index';
import { hasValidAuthToken } from './lib/core/utils';
import { Hono } from 'hono';
import { trimTrailingSlash } from 'hono/trailing-slash';

export type HonoEnv = { Bindings: Env };

const app = new Hono<HonoEnv>()
  .use(trimTrailingSlash())
  .get('/favicon.ico', async c => c.notFound()) // disable favicon
  .route('/openGraph', openGraph)
  // /do/* 与 /events 同样挡在挂载处（理由见下方 /admin 注释）。此前 /do/source/:id/* 的代理
  // 完全不校验（公网可触发 force-scrape），/events 的中间件挂在 router 文件里一个没导出的 Hono
  // 实例上、从未生效。/do/admin/* 各 handler 里原有的逐个校验随之删除。
  .use('/do/*', async (c, next) => {
    if (!hasValidAuthToken(c)) return c.json({ error: 'Unauthorized' }, 401);
    await next();
  })
  .route('/do', durableObjectsRouter)
  .use('/events', async (c, next) => {
    if (!hasValidAuthToken(c)) return c.json({ error: 'Unauthorized' }, 401);
    await next();
  })
  .use('/events/*', async (c, next) => {
    if (!hasValidAuthToken(c)) return c.json({ error: 'Unauthorized' }, 401);
    await next();
  })
  .route('/events', eventsRouter) // 添加新的路由
  // /admin/* 是破坏性面：触发简报生成(烧 LLM 额度)、增删改 RSS 源、重跑文章管线。
  // worker 挂在公网 *.workers.dev 上，加鉴权前 admin 路由（当时 12 条，现 5 条）一条鉴权都没有。挡在挂载处而不是
  // 逐 handler 加(do 是逐 handler 的写法)，是为了让以后新增的 admin 路由
  // 默认就在门后面——漏加一个 handler 的代价是重开一个洞。令牌与其余路由共用 API_TOKEN。
  .use('/admin/*', async (c, next) => {
    if (!hasValidAuthToken(c)) return c.json({ error: 'Unauthorized' }, 401);
    await next();
  })
  .route('/admin', adminRouter) // 添加admin路由
  // /observability/* 与 /admin 同样挡在挂载处。它虽全是 GET，但参数化读取把 URL 里的 key
  // 直接喂给 ARTICLES_BUCKET.get()：当时的 /workflows/:key(2026-09 已删)无任何前缀校验 →
  // 公网可读同一 bucket 内任意对象(文章正文、情报报告)；/llm-calls/* 仍是这类读取(有 llm-calls/ 前缀校验)。
  // 实测：无 token 打 /observability/workflows/2026%2F9%2F1%2F<id>.txt 命中正文对象(500=已取出，
  // 仅因内容非 JSON 才在 parse 处崩)。列表接口也裸吐生产元数据(简报标题/24h 文章数/run 状态)。
  // 鉴权是上游根治：外部进不来，任意 key 读取与元数据泄露一并消除，胜过逐路由补前缀校验。
  // eval 脚本经 eval/_shared/backend.ts 带 API_TOKEN 访问。
  .use('/observability/*', async (c, next) => {
    if (!hasValidAuthToken(c)) return c.json({ error: 'Unauthorized' }, 401);
    await next();
  })
  .route('/observability', observabilityRouter) // 添加可观测性路由
  .get('/ping', async c => c.json({ pong: true }));

export default app;
