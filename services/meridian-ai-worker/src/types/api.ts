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

// 请求元数据
export interface RequestMetadata {
  requestId: string
  timestamp: number
  userAgent: string
  ipAddress: string
} 