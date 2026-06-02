// Workflow observability JSON 中 story_validation step 的 data 字段形态
export interface Story {
  title: string;
  importance: number;
  articleIds: number[];
  storyType: string; // 通常 'SINGLE_STORY'
}

export interface RejectedCluster {
  clusterId: number;
  rejectionReason: string; // 'PURE_NOISE' | 'NO_STORIES' | 'INSUFFICIENT_ARTICLES'
  originalArticleIds: number[];
}

export interface StoryValidationStepData {
  validStoriesCount: number;
  rejectedClustersCount: number;
  stories: Story[];
  rejectedClusters: RejectedCluster[];
}

// Article 信息（从 backend 数据集拿）
export interface ArticleInfo {
  id: number;
  title: string;
  url: string;
  event_summary_points?: string[];
}

// Heuristic 输出
export type HeuristicFlag =
  | 'padded_title'
  | 'low_support'
  | 'split_overlap'
  | 'geo_stuffing';

export interface HeuristicResult {
  flags: HeuristicFlag[];
  details: Partial<Record<HeuristicFlag, string>>; // 命中时的人类可读说明
}

// LLM judge 输出
export type Verdict = 'REAL' | 'BORDERLINE' | 'FAKE';

export interface JudgeResult {
  verdict: Verdict;
  coherence: number; // 1-5
  title_fit: number; // 1-5
  reason: string;
  passes?: number; // 投票总次数 (multi-pass 时填)
  agreement?: number; // 0-1，多数票占比 (1 表示全部一致)
  votes?: Verdict[]; // 每次 pass 的 verdict (调试用)
}

// 每个 story 的最终评估结果
export interface StoryEvaluation {
  story: Story;
  heuristic: HeuristicResult;
  judge: JudgeResult;
  finalVerdict: Verdict; // 合并规则后的最终判定
}

// 被上游 LLM 拒掉的 cluster，二审判断"拒得对不对"
export type RejectionVerdict =
  | 'CORRECT_REJECTION' // 拒对了，cluster 真是 noise
  | 'DEBATABLE' // 边缘，怎么判都行
  | 'MISSED_STORY'; // 拒错了，cluster 里其实有真实故事

export interface RejectionJudgeResult {
  verdict: RejectionVerdict;
  reason: string;
}

export interface RejectedClusterEvaluation {
  cluster: RejectedCluster;
  articles: ArticleInfo[];
  judge: RejectionJudgeResult;
}

// Calibration set 一条
export interface CalibrationEntry {
  title: string;
  expected: Verdict;
  note?: string;
}

export interface CalibrationFile {
  source: string;
  labels: CalibrationEntry[];
}

// Calibration 指标
export interface CalibrationMetrics {
  matched: number; // 与 calibration 标题对上的 story 数
  total: number; // calibration 集大小
  precision: number;
  recall: number;
  f1: number;
  confusion: Record<Verdict, Record<Verdict, number>>; // [groundTruth][judged]
}

// 最终 eval 产出
export interface EvalReport {
  workflowId: string;
  promptHash: string;
  judgeModel: string;
  timestamp: string;
  candidateCount: number; // valid + rejected from workflow
  passedCount: number; // valid from workflow
  evaluations: StoryEvaluation[];
  rejectedClusters: RejectedCluster[];
  rejectedSample?: RejectedClusterEvaluation[]; // 抽样二审结果（pain 1）
  calibration?: CalibrationMetrics;
}
