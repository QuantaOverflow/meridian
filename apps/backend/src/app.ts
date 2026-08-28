import openGraph from './routers/openGraph.router';
import reportsRouter from './routers/reports.router';
import sourcesRouter from './routers/sources.router';
import durableObjectsRouter from './routers/durableObjects.router';
import eventsRouter from './routers/events.router'; // 导入新的路由
import adminRouter from './routers/admin'; // 导入admin路由
import observabilityRouter from './routers/observability'; // 导入可观测性路由
import debugRouter from './routers/debug'; // 导入debug路由
import { Env } from './index';
import { hasValidAuthToken } from './lib/core/utils';
import { Hono } from 'hono';
import { trimTrailingSlash } from 'hono/trailing-slash';

export type HonoEnv = { Bindings: Env };

const app = new Hono<HonoEnv>()
  .use(trimTrailingSlash())
  .get('/favicon.ico', async c => c.notFound()) // disable favicon
  .route('/reports', reportsRouter)
  .route('/sources', sourcesRouter)
  .route('/openGraph', openGraph)
  .route('/do', durableObjectsRouter)
  .route('/events', eventsRouter) // 添加新的路由
  // /admin/* 是破坏性面：触发简报生成(烧 LLM 额度)、增删改 RSS 源、重跑文章管线。
  // worker 挂在公网 *.workers.dev 上，此前这 12 条路由一条鉴权都没有。挡在挂载处而不是
  // 逐 handler 加(sources/reports/do 是逐 handler 的写法)，是为了让以后新增的 admin 路由
  // 默认就在门后面——漏加一个 handler 的代价是重开一个洞。令牌与其余路由共用 API_TOKEN。
  .use('/admin/*', async (c, next) => {
    if (!hasValidAuthToken(c)) return c.json({ error: 'Unauthorized' }, 401);
    await next();
  })
  .route('/admin', adminRouter) // 添加admin路由
  .route('/observability', observabilityRouter) // 添加可观测性路由
  .get('/ping', async c => c.json({ pong: true }));

// Only mount the debug router in non-production environments
if (process.env.NODE_ENV !== 'production') {
  app.route('/debug', debugRouter);
}

export default app;
