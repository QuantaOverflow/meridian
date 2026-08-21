// ============================================================================
// 故事验证相关类型定义
// ============================================================================

export interface ClusteringParameters {
  umapParams: {
    n_neighbors: number
    n_components: number
    min_dist: number
    metric: string
  }
  hdbscanParams: {
    min_cluster_size: number
    min_samples: number
    epsilon: number
  }
}

export interface ClusteringStatistics {
  totalClusters: number
  noisePoints: number
  totalArticles: number
}

export interface ClusterItem {
  clusterId: number
  articleIds: number[]
  size: number
}

export interface ClusteringResult {
  clusters: ClusterItem[]
  parameters: ClusteringParameters
  statistics: ClusteringStatistics
}

export interface Story {
  title: string
  importance: number
  articleIds: number[]
  storyType: "SINGLE_STORY" | "COLLECTION_OF_STORIES"
  // 2026-08-21 新增。此前 Story 不带来源簇，而 backend 落 brief_stories 时写的是
  // `s.clusterId ?? i + 1` —— 字段不存在故恒走兜底，落库的 cluster_id 实为**故事序号**。
  // 08-20 生产抽查 7 条全部对不上（标 cluster_id=46 的故事文章实际在簇 22），
  // 任何按 cluster_id 关联 brief_stories 与聚类观测快照的分析都会静默出错。
  clusterId: number
  /** 产出该故事的候选组，便于把故事对回具体几何组 */
  groupId?: string
}

/**
 * 候选组：簇内的几何子集（backend lib/core/candidate-grouping.ts 全链 cos≥0.90 产出），
 * 2026-08-21 起是 story-validation 的判定单位，取代原来的「整簇」。
 */
export interface CandidateGroup {
  clusterId: number
  /** `${clusterId}-${序号}`，用于日志与观测对账 */
  groupId: string
  articleIds: number[]
}

export interface RejectedCluster {
  clusterId: number
  // 记账单位是**文章**（originalArticleIds），不是簇——丢弃发生在文章粒度，用簇计数就平不了账。
  // 2026-08-21 换架构后拒因随判定环节重命名，旧值语义已不存在（旧值来自「整簇送 LLM」形态）：
  //   NOT_GROUPED       几何阶段落单：簇内找不到任何 cos≥阈值 的同组伙伴，不进判官。
  //                     08-20 全量 1254 篇里 592 篇走这条；但在人工核过的 7 个最大簇上，
  //                     落单未丢失任何一个人工确认的真事件（85/85 全捕获）。
  //   JUDGE_NO_EVENT    候选组送了判官，判官认为组内没有任何 ≥2 篇报道同一发生。
  //   JUDGE_LEFT_OUT    判官在组内确认了故事，但部分成员没进任何故事（合法的部分覆盖）。
  //   VERIFY_DROPPED    复核阶段 split/trim 剔除的成员，或复核后不足 2 篇而作废的整个故事。
  //   PARSE_EXHAUSTED   连续 SV_PARSE_MAX_ATTEMPTS 次解析失败后的降级丢弃（非模型判定）。
  //   CALL_FAILED       LLM 调用本身抛错（如 binding 认证失败、网络错误）。与 JUDGE_NO_EVENT
  //                     严格分开：前者是"没问成"，后者是"问了、模型说没有"。混成一个值，
  //                     就是把故障伪装成判定——本仓反复治的「静默降级成安全默认值」同款。
  rejectionReason:
    | "NOT_GROUPED"
    | "JUDGE_NO_EVENT"
    | "JUDGE_LEFT_OUT"
    | "VERIFY_DROPPED"
    | "PARSE_EXHAUSTED"
    | "CALL_FAILED"
  originalArticleIds: number[]
  /** 候选组来源，便于把拒绝记录对回具体的几何组（NOT_GROUPED 无组，留空） */
  groupId?: string
}

export interface ValidatedStories {
  stories: Story[]
  rejectedClusters: RejectedCluster[]
}

export interface MinimalArticleInfo {
  id: number
  title: string
  url: string
  event_summary_points?: string[]
}

export interface StoryValidationRequest {
  clusteringResult: ClusteringResult
  /** 几何候选组。由 backend 在 story-validation 步内算好传入（向量约 3.7MB，跨 step 传会撞 ~1MB 上限）。 */
  candidateGroups: CandidateGroup[]
  articlesData: MinimalArticleInfo[]
  options?: {
    provider?: string
    model?: string
  }
}

export interface StoryValidationResult {
  stories: Story[]
  rejectedClusters: RejectedCluster[]
  metadata: {
    totalClusters: number
    totalArticlesProvided: number
    validatedStories: number
    rejectedClusters: number
    // 因验证响应解析失败而被降级丢弃的聚类数（非模型判定 no_stories）。失败留痕进指标，便于观测静默丢簇。
    validationParseFailures?: number
    /** LLM 调用直接抛错的候选组数（非模型判定）。与 parseFailures 分列，两者根因不同。 */
    validationCallFailures?: number
    /** 候选组数（= 判官调用数）与复核调用数，供成本/时延对账 */
    candidateGroups?: number
    verifyCalls?: number
    // 部分丢弃的文章总数（UNASSIGNED_IN_COLLECTION + OUTLIER_IN_SINGLE_STORY）。
    // 与 rejectedClusters 分开计：后者的单位是簇，这个的单位是文章，混在一起数就又把粒度搅回去了。
    partiallyDroppedArticles?: number
    processingStatistics: ClusteringStatistics
  }
}

export interface AIValidationResponse {
  answer: 'single_story' | 'collection_of_stories' | 'pure_noise' | 'no_stories'
  // 解析失败降级标记：为 true 时 answer='no_stories' 系响应解析失败的兜底、非模型判定。
  // 让调用方/指标区分"解析失败伪装的没故事"与"模型真判没故事"（否则整簇被静默丢弃）。
  parseFailed?: boolean
  title?: string
  importance?: number
  outliers?: number[]
  stories?: Array<{
    title: string
    importance: number
    articles: number[]
  }>
} 