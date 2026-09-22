// 聚类语义评估的数据形态。
// 思路：用 LLM(强模型)产一份"参考划分"作为语义 gold，再用确定性指标(B-cubed)
// 衡量任意聚类输出(HDBSCAN / 新算法)对参考划分的还原度。LLM 只在产参考时用一次，
// 打分全程无 LLM —— 符合 "60% 确定性 / 30% LLM-judge" 的 eval 最佳实践。

// 一篇文章的最小信息（喂给参考划分构建器）
export interface ArticleInfo {
  id: number;
  title: string;
  event_summary_points?: string[];
}

// 一个"划分"：item id -> 组 id。组 id 是任意标签(数字或字符串)，只看分组结构不看标签本身。
// 预测划分里约定：HDBSCAN 噪声点用 -1；metrics 会把每个 -1 拆成独立单例簇。
export type Partition = Map<number, number | string>;

// 聚类快照(来自 /runs/:id/clustering)
export interface ClusteringSnapshot {
  workflowId: string;
  createdAt: string;
  clusters: Array<{ clusterId: number; articleIds: number[] }>;
  statistics?: Record<string, unknown>;
}

// LLM 参考划分：每个故事一组文章 id
export interface ReferencePartition {
  workflowId: string;
  judgeModel: string;
  promptHash: string;
  createdAt: string;
  stories: Array<{
    label: string; // 人类可读的故事标题(诊断用，不参与打分)
    articleIds: number[];
  }>;
  // 参考里没被归入任何故事的文章(LLM 认定为孤立/噪声)
  unassigned?: number[];
}

// B-cubed 指标
export interface BcubedMetrics {
  precision: number; // 低 = conflation(把不同故事揉进一个簇)
  recall: number; // 低 = fragmentation(把一个故事拆到多个簇)
  f1: number;
  nItems: number; // 参与打分的文章数(两个划分的交集)
}

// 一次评估产出
export interface ClusteringEvalReport {
  workflowId: string;
  referenceModel: string;
  referencePromptHash: string;
  timestamp: string;
  // 可同时评多个候选聚类(如 current-hdbscan / entity-leiden)对同一参考
  candidates: Array<{
    name: string;
    bcubed: BcubedMetrics;
    predictedClusters: number;
    referenceStories: number;
  }>;
}
