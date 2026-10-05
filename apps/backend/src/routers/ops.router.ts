import { Hono } from 'hono';
import type { Env } from '../index';
import { opsHealth } from '../lib/ops/health';
import { opsTrends } from '../lib/ops/trends';
import { opsCost } from '../lib/ops/cost';
import { opsSources } from '../lib/ops/sources';
import { opsRunDetail } from '../lib/ops/run-detail';
import { getServiceVersions } from '../lib/ops/services';

/**
 * 运维台（Ops console）的只读端点，挂在 /observability/ops 下（鉴权在 app.ts 的 /observability/* 挂载处）。
 * 每个端点的实现各在 lib/ops/ 的一个文件里；响应类型在 @meridian/contracts 的 ops-console.ts。
 */
const app = new Hono<{ Bindings: Env }>();

app.get('/health', opsHealth);
app.get('/trends', opsTrends);
app.get('/cost', opsCost);
app.get('/sources', opsSources);
app.get('/runs/:workflowId', opsRunDetail);
app.get('/services', async c => c.json(await getServiceVersions(c.env)));

export default app;
