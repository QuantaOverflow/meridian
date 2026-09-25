/**
 * @meridian/contracts —— 跨 service 的约定只写一份：ai-worker 路由的数据类型、
 * articleAnalysisSchema、R2 key、brief-v3 记录类型、embedding 维度。只放约定，不放实现。
 */
export * from './ai-worker';
export * from './r2-keys';
export * from './brief-v3-record';

/**
 * e5-small（multilingual-e5-small）的向量维度。ml-service 产出、articles.embedding 与
 * brief_stories / story_clusters 的 centroid 列（vector(384)）、backend 的维度校验都用它。
 * 放这里而不是 database 包：ai-worker 也依赖本包，不该为一个常量拖进 drizzle。
 */
export const EMBEDDING_DIM = 384;
