/**
 * ARTICLES_BUCKET（生产桶 meridian-articles-prod）里各类对象的 key。backend 与 ai-worker 写、
 * backend 观测路由读，都从这里构造——输出与此前各处手拼的字面量逐字节一致
 * （apps/backend/test/lib/r2-keys.spec.ts 钉住）。
 *
 * 不能 import TS 的调用方仍用字面量拼 key，改格式时要一并改：
 *   - apps/backend/test/replay/fetch-recording.mjs  `observability/brief-v3/${wf}.json`
 *   - apps/backend/test/replay/replay.mjs           `observability/brief-v3/${replayWf}.json`
 *   - eval/cluster-to-brief/dataset.test.mjs        `observability/clustering/cron-brief-1.json`（清单的 clusterSnapshot）
 * 文章正文 key 落库在 articles.content_file_key，读方（backend events 路由、replay 播种）读的是那一列，不重拼。
 */

const pad3 = (n: number) => String(n).padStart(3, '0');

/** 文章正文：`YYYY/M/D/{id}.txt`（UTC 日期，月/日不补零）。 */
export const articleContentKey = (date: Date, articleId: number) =>
  `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}/${articleId}.txt`;

/** 简报 workflow 卸到 R2 的 embeddings（桶上生命周期规则 `expire-datasets` 7 天后删 `datasets/`）。 */
export const datasetEmbeddingsKey = (workflowId: string) => `datasets/${workflowId}/embeddings.json`;

/** workflow 逐步观测快照（WorkflowObservability.logStep 每步覆盖写）。 */
export const workflowObservabilityKey = (workflowId: string) => `observability/${workflowId}.json`;

/** 聚类 cluster_id → article_ids 映射与 configSent/configUsed。 */
export const clusteringSnapshotKey = (workflowId: string) => `observability/clustering/${workflowId}.json`;

/** 文章去向表。 */
export const articleJourneyKey = (workflowId: string) => `observability/article-journey/${workflowId}.json`;

/** 每期一份 brief-v3 记录（形状见 BriefV3Record）。 */
export const briefV3RecordKey = (workflowId: string) => `observability/brief-v3/${workflowId}.json`;

/** LLM 调用日志的根前缀（观测路由用它挡掉非日志 key）。 */
export const LLM_CALLS_ROOT = 'llm-calls/';

/** 某个 trace（= workflow instance id）下全部 LLM 调用日志的列举前缀。 */
export const llmCallsPrefix = (traceId: string) => `${LLM_CALLS_ROOT}${traceId}/`;

/** 单次 LLM 调用日志：`llm-calls/{traceId}/{phase}-{idx 3位}.json`。 */
export const llmCallKey = (traceId: string, phase: string, callIndex: number) =>
  `${llmCallsPrefix(traceId)}${phase}-${pad3(callIndex)}.json`;

/** 传感器读数：`observability/sensors/{traceId}/{kind}-{idx 3位}.json`。 */
export const sensorKey = (traceId: string, kind: string, idx: number) =>
  `observability/sensors/${traceId}/${kind}-${pad3(idx)}.json`;
