import { RequestMetadata } from '../types/api'

/**
 * 创建请求元数据
 */
export function createRequestMetadata(c: any): RequestMetadata {
  return {
    requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    timestamp: Date.now(),
    userAgent: c.req.header('user-agent') || 'unknown',
    ipAddress: c.req.header('cf-connecting-ip') || 'unknown'
  }
}

/**
 * 从AI响应中解析JSON
 */
export function parseJSONFromResponse(response: string): any {
  try {
    // 尝试提取 JSON 代码块
    const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1])
    }
    // 尝试直接解析
    return JSON.parse(response)
  } catch (error) {
    console.warn('JSON解析失败:', error)
    return null
  }
} 