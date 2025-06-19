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
 * 从AI响应中解析JSON - 增强版本，支持多种容错策略
 */
export function parseJSONFromResponse(response: string): any {
  if (!response || typeof response !== 'string') {
    console.warn('JSON解析失败: 空响应或非字符串响应')
    return null
  }

  const originalResponse = response
  let text = response.trim()

  console.log(`[JSON Parser] 开始解析，响应长度: ${text.length}`)
  console.log(`[JSON Parser] 响应开头: ${text.substring(0, 100)}`)

  // 策略1: 尝试提取 <final_json> 标签内容（优先处理）
  const finalJsonMatch = text.match(/<final_json>\s*([\s\S]*?)\s*<\/final_json>/)
  if (finalJsonMatch) {
    console.log('[JSON Parser] 发现 <final_json> 标签，尝试解析内容')
    try {
      const jsonContent = finalJsonMatch[1].trim()
      console.log(`[JSON Parser] 提取的JSON内容长度: ${jsonContent.length}`)
      const parsed = JSON.parse(jsonContent)
      console.log('[JSON Parser] 成功解析 <final_json> 标签')
      return parsed
    } catch (error) {
      console.warn('[JSON Parser] <final_json> 标签解析失败:', error)
      console.log('[JSON Parser] 标签内容:', finalJsonMatch[1].substring(0, 200))
    }
  }

  // 策略2: 尝试提取 ```json 代码块
  const jsonCodeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (jsonCodeBlockMatch) {
    console.log('[JSON Parser] 发现 ```json 代码块，尝试解析')
    try {
      const parsed = JSON.parse(jsonCodeBlockMatch[1].trim())
      console.log('[JSON Parser] 成功解析 ```json 代码块')
      return parsed
    } catch (error) {
      console.warn('[JSON Parser] ```json 代码块解析失败:', error)
    }
  }

  // 策略3: 查找第一个完整的JSON对象 { ... }
  const jsonStart = text.indexOf('{')
  const jsonEnd = text.lastIndexOf('}')
  
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    console.log(`[JSON Parser] 尝试提取JSON对象，位置: ${jsonStart}-${jsonEnd}`)
    const potentialJson = text.substring(jsonStart, jsonEnd + 1)
    try {
      const parsed = JSON.parse(potentialJson)
      console.log('[JSON Parser] 成功解析提取的JSON对象')
      return parsed
    } catch (error) {
      console.warn('[JSON Parser] 提取的JSON对象解析失败:', error)
      console.log('[JSON Parser] 尝试解析的内容:', potentialJson.substring(0, 200))
    }
  }

  // 策略4: 尝试直接解析整个响应
  try {
    console.log('[JSON Parser] 尝试直接解析整个响应')
    const parsed = JSON.parse(text)
    console.log('[JSON Parser] 成功直接解析整个响应')
    return parsed
  } catch (error) {
    console.warn('[JSON Parser] 直接解析失败:', error)
  }

  // 策略5: 尝试修复常见的JSON格式问题
  try {
    console.log('[JSON Parser] 尝试清理并解析JSON')
    // 移除前后缀文本，只保留JSON部分
    let cleanedText = text
      .replace(/^[^{]*/, '') // 移除开头的非JSON文本
      .replace(/[^}]*$/, '') // 移除结尾的非JSON文本
    
    if (cleanedText.startsWith('{') && cleanedText.endsWith('}')) {
      const parsed = JSON.parse(cleanedText)
      console.log('[JSON Parser] 成功解析清理后的JSON')
      return parsed
    }
  } catch (error) {
    console.warn('[JSON Parser] 清理后解析失败:', error)
  }

  // 所有策略都失败了，记录详细错误信息
  console.error('JSON解析失败 - 所有策略都失败了')
  console.log('原始响应长度:', originalResponse.length)
  console.log('响应开头 (前200字符):', originalResponse.substring(0, 200))
  console.log('响应结尾 (后200字符):', originalResponse.slice(-200))
  
  return null
} 