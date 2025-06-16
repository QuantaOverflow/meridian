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
  rejectionReason: "PURE_NOISE" | "NO_STORIES" | "INSUFFICIENT_ARTICLES"
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
    processingStatistics: ClusteringStatistics
  }
}

export interface AIValidationResponse {
  answer: 'single_story' | 'collection_of_stories' | 'pure_noise' | 'no_stories'
  title?: string
  importance?: number
  outliers?: number[]
  stories?: Array<{
    title: string
    importance: number
    articles: number[]
  }>
} 