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
  rejectionReason: "PURE_NOISE" | "NO_STORIES" | "INSUFFICIENT_ARTICLES" | "NOISE_BUCKET_SKIPPED"
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