// 聚类金标打分的数据形态（metrics.ts）。

// 一个"划分"：item id -> 组 id。组 id 是任意标签(数字或字符串)，只看分组结构不看标签本身。
// 预测划分里约定：噪声点（不足最小篇数的簇）用 -1；metrics 会把每个 -1 拆成独立单例簇。
export type Partition = Map<number, number | string>;

// B-cubed 指标
export interface BcubedMetrics {
  precision: number; // 低 = conflation(把不同故事揉进一个簇)
  recall: number; // 低 = fragmentation(把一个故事拆到多个簇)
  f1: number;
  nItems: number; // 参与打分的文章数(两个划分的交集)
}
