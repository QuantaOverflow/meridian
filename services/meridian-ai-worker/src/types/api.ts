// ============================================================================
// API 通用类型定义
// ============================================================================

// 标准化响应格式
export interface APIResponse<T> {
  success: boolean
  data?: T
  error?: string
  metadata?: Record<string, any>
}

// 核心数据类型定义 - 与ML Service兼容
export interface ArticleItem {
  id: number
  title: string
  content: string
  url: string
  embedding: number[]
  publish_date: string
  status: string
}

export interface StoryAnalysis {
  overview: string
  key_developments: string[]
  stakeholders: string[]
  implications: string[]
  outlook: string
}

export interface BriefContent {
  title: string
  content: string
  tldr?: string
}

// 请求元数据
export interface RequestMetadata {
  requestId: string
  timestamp: number
  userAgent: string
  ipAddress: string
} 