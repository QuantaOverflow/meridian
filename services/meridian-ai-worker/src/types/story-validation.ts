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
}

export interface RejectedCluster {
  clusterId: number
  // NOISE_BUCKET_SKIPPED: HDBSCAN 的 -1 组，机械跳过、未送模型判定（与前三者的"判过了"语义区分开）
  //
  // 后两个是**部分丢弃**：整簇没被拒，但簇里有成员没进任何故事。此前这类丢弃零记录——
  // cluster_rejections 的记账单位是「簇」，而丢弃的发生单位是「文章」，粒度对不上账就平不了。
  // 2026-08-18 生产实测：1011 篇进簇，528 篇进故事、87 篇有整簇拒因，**352 篇两头都不沾**。
  //   UNASSIGNED_IN_COLLECTION: 走 collection_of_stories 时模型只列了部分成员，其余未被任何
  //     子故事收录。这是最大的一类——实测 100 篇的簇只列 13-30 篇、53 篇的簇只列 2-28 篇。
  //   OUTLIER_IN_SINGLE_STORY: 走 single_story 时被模型放进 outliers 数组显式排除的成员。
  // 注意这两类**不一定是错杀**：实测有整簇是软新闻杂物(熊直播/球星八卦)被正确甄别掉的，
  // 也有真新闻因"每个子故事至少 2 篇"的门槛结构性出局的。留痕的目的正是让这两者第一次可分。
  rejectionReason: "PURE_NOISE" | "NO_STORIES" | "INSUFFICIENT_ARTICLES" | "NOISE_BUCKET_SKIPPED"
    | "UNASSIGNED_IN_COLLECTION" | "OUTLIER_IN_SINGLE_STORY"
  originalArticleIds: number[]
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
  articlesData: MinimalArticleInfo[]
  useAI?: boolean
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