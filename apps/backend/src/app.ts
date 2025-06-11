import openGraph from './routers/openGraph.router';
import reportsRouter from './routers/reports.router';
import sourcesRouter from './routers/sources.router';
import durableObjectsRouter from './routers/durableObjects.router';
import eventsRouter from './routers/events.router'; // 导入新的路由
import adminRouter from './routers/admin'; // 导入admin路由
import observabilityRouter from './routers/observability'; // 导入可观测性路由
import { Env } from './index';
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
  .route('/admin', adminRouter) // 添加admin路由
  .route('/observability', observabilityRouter) // 添加可观测性路由
  .get('/ping', async c => c.json({ pong: true }));

export default app;
