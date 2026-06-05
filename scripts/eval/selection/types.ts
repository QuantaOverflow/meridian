// observability dump 里 story_selection step 的 storyBreakdown 项(来自 auto-brief-generation.ts)
export interface StoryBreakdownItem {
  storyId: number;
  title: string;
  importance: number;
  articleCount: number;
  clusterId: number;
  selected: boolean;
  rejectionReason?: string;
}

// 进入选择层 eval 的候选(来自 $brief_stories：均为被接受的 story，拒绝聚类不在此表)
export interface Candidate {
  clusterId: number;
  title: string;
  importance: number;
  articleCount: number;
  articleIds: number[]; // 留作覆盖度排序(distinct source)重建用
}

// 金标：对某 run 的某候选，人工标的分级相关度。
// rel 语义：0=不该上(噪音/纯本地)  1=可上可不上(边缘)  2=该上(重要)  3=必上(漏了是事故)
export interface GoldLabel {
  workflowId: string;
  clusterId: number;
  rel: number;
}
