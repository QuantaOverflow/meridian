import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { AIGatewayService } from './services/ai-gateway'
import { getArticleAnalysisPrompt } from './prompts/articleAnalysis'
import { IntelligenceService } from './services/intelligence'
import { CloudflareEnv, ChatResponse } from './types'

type HonoEnv = {
  Bindings: CloudflareEnv & {
    AI: Ai
  }
}

const app = new Hono<HonoEnv>()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// 暂时注释掉logger中间件，因为它可能干扰JSON响应
// app.use('*', logger())

// =============================================================================
// 通用工具函数
// =============================================================================

/**
 * 生成通用请求元数据，减少重复代码
 */
function createRequestMetadata(c: any) {
  return {
    requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    timestamp: Date.now(),
    userAgent: c.req.header('user-agent') || 'unknown',
    ipAddress: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'
  }
}

// =============================================================================
// Health Check
// =============================================================================

app.get('/health', (c) => {
  return c.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'meridian-ai-worker'
  })
})

// =============================================================================  
// Embedding Generation
// =============================================================================

app.post('/meridian/embeddings/generate', async (c) => {
  try {
    const body = await c.req.json()
    
    // 验证请求参数 - 支持多种输入格式
    const hasTextInput = body.text && (
      (typeof body.text === 'string' && body.text.trim().length > 0) ||
      (Array.isArray(body.text) && body.text.length > 0)
    )
    const hasQueryContextInput = body.query && body.contexts && Array.isArray(body.contexts)
    
    if (!hasTextInput && !hasQueryContextInput) {
      return c.json({ 
        success: false,
        error: 'Invalid request: either text (string or array) or query+contexts is required'
      }, 400)
    }

    // 创建AI Gateway Service
    const aiGatewayService = new AIGatewayService(c.env)
    
    // 构建嵌入请求
    const embeddingRequest: any = {
      capability: 'embedding',
      provider: body.options?.provider || 'workers-ai',
      model: body.options?.model || '@cf/baai/bge-m3',
      // 添加基础metadata来确保性能追踪
      metadata: createRequestMetadata(c)
    }
    
    // 根据输入类型设置请求参数
    if (hasQueryContextInput) {
      // BGE-M3 查询和上下文格式
      embeddingRequest.query = body.query
      embeddingRequest.contexts = body.contexts
      embeddingRequest.truncate_inputs = body.truncate_inputs
    } else {
      // 标准文本嵌入格式
      embeddingRequest.input = body.text
    }

    // 通过AI Gateway处理嵌入请求
    const result = await aiGatewayService.embed(embeddingRequest)
    
    // 确保结果是嵌入响应类型
    if (result.capability !== 'embedding') {
      throw new Error('Unexpected response type from embedding service')
    }
    
    // 计算实际的嵌入维度
    let dimensions = 0
    let dataLength = 0
    
    if (result.data && Array.isArray(result.data) && result.data.length > 0) {
      dataLength = result.data.length
      // 获取第一个嵌入向量的维度
      const firstEmbedding = result.data[0]?.embedding
      if (Array.isArray(firstEmbedding)) {
        dimensions = firstEmbedding.length
      }
    }
    
    return c.json({
      success: true,
      data: result.data,
      model: result.model,
      dimensions: dimensions,
      data_points: dataLength,
      text_length: Array.isArray(body.text) ? body.text.join(' ').length : (body.text?.length || 0),
      metadata: {
        provider: result.provider,
        model: result.model,
        processingTime: result.processingTime || result.metadata?.performance?.latency?.totalLatency,
        cached: result.cached,
        performance: result.metadata?.performance
      }
    })
  } catch (error: any) {
    console.error('Embedding generation error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to generate embedding',
      details: error.message,
      stack: error.stack
    }, 500)
  }
})

// =============================================================================
// Article Analysis
// =============================================================================

// 通用文章分析函数
async function analyzeArticle(c: any, returnFormat: 'detailed' | 'workflow' = 'detailed') {
  const body = await c.req.json()
  
  // 验证请求参数
  if (!body.title || !body.content) {
    return c.json({ 
      success: false,
      error: 'Invalid request: title and content are required'
    }, 400)
  }

  // 创建AI Gateway Service
  const aiGatewayService = new AIGatewayService(c.env)
  
  // 构建分析提示
  const prompt = getArticleAnalysisPrompt(body.title, body.content)
  
  // 构建聊天请求
  const chatRequest = {
    capability: 'chat' as const,
    messages: [{ role: 'user' as const, content: prompt }],
    provider: body.options?.provider || 'google-ai-studio',
    model: body.options?.model || 'gemini-2.0-flash',
    temperature: 0.1,
    max_tokens: 8000,
    // 添加基础metadata来确保性能追踪
    metadata: createRequestMetadata(c)
  }

  // 通过AI Gateway处理分析请求
  const result = await aiGatewayService.chat(chatRequest)
  
  // 确保结果是聊天响应类型
  if (result.capability !== 'chat') {
    throw new Error('Unexpected response type from chat service')
  }
  
  const chatResult = result as ChatResponse
  
  // 尝试解析JSON响应
  let analysisResult
  try {
    const responseText = chatResult.choices?.[0]?.message?.content || ''
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/)
    if (jsonMatch) {
      analysisResult = JSON.parse(jsonMatch[1])
    } else {
      // 尝试直接解析整个响应
      analysisResult = JSON.parse(responseText)
    }
  } catch (parseError) {
    if (returnFormat === 'workflow') {
      // 工作流格式需要默认值
      analysisResult = {
        language: 'unknown',
        primary_location: 'unknown',
        completeness: 'PARTIAL_USEFUL',
        content_quality: 'OK',
        event_summary_points: [],
        thematic_keywords: [],
        topic_tags: [],
        key_entities: [],
        content_focus: []
      }
    } else {
      // 详细格式包含原始响应
      analysisResult = { 
        error: '无法解析AI响应', 
        raw_response: chatResult.choices?.[0]?.message?.content || ''
      }
    }
  }
  
  // 根据返回格式构建响应
  if (returnFormat === 'workflow') {
    return c.json({
      success: true,
      data: analysisResult,
      metadata: {
        model_used: chatResult.model,
        provider: chatResult.provider,
        total_tokens: chatResult.usage?.total_tokens || 0,
        processingTime: chatResult.processingTime,
        cached: chatResult.cached
      }
    })
  } else {
    return c.json({
      success: true,
      result: analysisResult,
      usage: chatResult.usage,
      metadata: {
        provider: chatResult.provider,
        model: chatResult.model,
        processingTime: chatResult.processingTime,
        cached: chatResult.cached
      }
    })
  }
}

// 详细分析端点
app.post('/meridian/analyze', async (c) => {
  try {
    return await analyzeArticle(c, 'detailed')
  } catch (error: any) {
    console.error('Analysis error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to analyze article',
      details: error.message
    }, 500)
  }
})

// ProcessArticles工作流使用的路径
app.post('/meridian/article/analyze', async (c) => {
  try {
    return await analyzeArticle(c, 'workflow')
  } catch (error: any) {
    console.error('Analysis error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to analyze article',
      details: error.message
    }, 500)
  }
})

// =============================================================================
// Chat API
// =============================================================================

app.post('/meridian/chat', async (c) => {
  try {
    const body = await c.req.json()
    
    // 验证请求参数
    if (!body.messages || !Array.isArray(body.messages)) {
      return c.json({ 
        success: false,
        error: 'Invalid request: messages array is required'
      }, 400)
    }

    // 验证消息格式
    for (const message of body.messages) {
      if (!message.role || !message.content) {
        return c.json({ 
          success: false,
          error: 'Invalid message format: role and content are required'
        }, 400)
      }
      if (!['system', 'user', 'assistant'].includes(message.role)) {
        return c.json({ 
          success: false,
          error: 'Invalid role: must be system, user, or assistant'
        }, 400)
      }
    }

    // 创建AI Gateway Service
    const aiGatewayService = new AIGatewayService(c.env)
    
    // 构建聊天请求
    const chatRequest = {
      capability: 'chat' as const,
      messages: body.messages,
      provider: body.options?.provider,
      model: body.options?.model,
      temperature: body.options?.temperature || 0.7,
      max_tokens: body.options?.max_tokens || 1000,
      stream: body.options?.stream || false,
      metadata: createRequestMetadata(c)
    }

    // 处理聊天请求
    const result = await aiGatewayService.chat(chatRequest)
    
    // 确保结果是ChatResponse类型
    if (result.capability !== 'chat') {
      throw new Error('Unexpected response type from chat service')
    }
    
    const chatResult = result as ChatResponse
    
    return c.json({
      success: true,
      data: {
        id: chatResult.id,
        choices: chatResult.choices,
        usage: chatResult.usage,
        model: chatResult.model,
        provider: chatResult.provider
      },
      metadata: {
        provider: chatResult.provider,
        model: chatResult.model,
        processingTime: chatResult.processingTime,
        cached: chatResult.cached
      }
    })
  } catch (error: any) {
    console.error('Chat error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to process chat request',
      details: error.message
    }, 500)
  }
})

// 支持流式聊天响应的端点
app.post('/meridian/chat/stream', async (c) => {
  try {
    const body = await c.req.json()
    
    // 验证请求参数
    if (!body.messages || !Array.isArray(body.messages)) {
      return c.json({ 
        success: false,
        error: 'Invalid request: messages array is required'
      }, 400)
    }

    // 创建AI Gateway Service
    const aiGatewayService = new AIGatewayService(c.env)
    
    // 构建流式聊天请求
    const chatRequest = {
      capability: 'chat' as const,
      messages: body.messages,
      provider: body.options?.provider,
      model: body.options?.model,
      temperature: body.options?.temperature || 0.7,
      max_tokens: body.options?.max_tokens || 1000,
      stream: true,
      metadata: createRequestMetadata(c)
    }

    // 处理流式聊天请求
    const result = await aiGatewayService.chat(chatRequest)
    
    // 确保结果是ChatResponse类型
    if (result.capability !== 'chat') {
      throw new Error('Unexpected response type from chat service')
    }
    
    const chatResult = result as ChatResponse
    
    // 对于流式响应，返回特殊格式
    return c.json({
      success: true,
      data: {
        id: chatResult.id,
        choices: chatResult.choices,
        usage: chatResult.usage,
        model: chatResult.model,
        provider: chatResult.provider
      },
      metadata: {
        provider: chatResult.provider,
        model: chatResult.model,
        streaming: true,
        processingTime: chatResult.processingTime,
        cached: chatResult.cached
      }
    })
  } catch (error: any) {
    console.error('Stream chat error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to process stream chat request',
      details: error.message
    }, 500)
  }
})

// =============================================================================
// Intelligence Analysis
// =============================================================================

app.post('/meridian/intelligence/analyze-story', async (c) => {
  try {
    const intelligenceService = new IntelligenceService(c.env)
    const result = await intelligenceService.analyzeStory(await c.req.json())
    return c.json(result)
  } catch (error: any) {
    console.error('Intelligence analysis error:', error)
    return c.json({ error: error.message }, 500)
  }
})

// =============================================================================
// Backend Integration Status
// =============================================================================

app.get('/meridian/status', (c) => {
  try {
    const aiGatewayService = new AIGatewayService(c.env)
    
    return c.json({ 
      status: 'active',
      service: 'meridian-ai-worker',
      timestamp: new Date().toISOString(),
      endpoints: {
        // 核心业务端点 (Backend 工作流使用)
        article_analysis: '/meridian/article/analyze',
        embedding_generation: '/meridian/embeddings/generate', 
        intelligence_analysis: '/meridian/intelligence/analyze-story',
        // 通用端点
        chat: '/meridian/chat',
        chat_stream: '/meridian/chat/stream',
        health: '/health',
        test: '/test'
      },
      integration: {
        backend_workflows: ['processArticles'],
        ai_providers: aiGatewayService.getAvailableProviders(),
        capabilities: ['chat', 'embedding', 'intelligence'],
        version: '1.3.0'
      },
      workflow_integration: {
        'processArticles.workflow.ts': {
          endpoints_used: ['/meridian/article/analyze', '/meridian/embeddings/generate'],
          description: '文章内容处理和嵌入生成'
        }
      }
    })
  } catch (error) {
    return c.json({
      status: 'error',
      service: 'meridian-ai-worker', 
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, 500)
  }
})

// =============================================================================
// Data Endpoints
// =============================================================================

// =============================================================================
// Legacy Data Endpoints (Moved to Backend)
// =============================================================================
// 数据查询和保存功能已迁移到 backend 服务，AI Worker 专注于 AI 能力

// =============================================================================
// Service Testing & Monitoring
// =============================================================================

// AI Worker 核心功能测试端点
app.get('/test-ai-capabilities', async (c) => {
  try {
    console.log('[AI Capabilities Test] 开始测试AI Worker核心功能')
    
    const aiGatewayService = new AIGatewayService(c.env)
    
    // 测试嵌入生成 - 直接调用服务
    let embeddingResult: any = null
    let embeddingError: any = null
    try {
      const embeddingRequest = {
        capability: 'embedding' as const,
        provider: 'workers-ai',
        model: '@cf/baai/bge-small-en-v1.5',
        input: "测试嵌入生成功能",
        metadata: createRequestMetadata(c)
      }
      
      const embeddingResponse = await aiGatewayService.embed(embeddingRequest)
      if (embeddingResponse.capability === 'embedding') {
        embeddingResult = {
          status: 'success',
          dimensions: embeddingResponse.data?.[0]?.embedding?.length || 0,
          provider: embeddingResponse.provider
        }
      } else {
        throw new Error('Unexpected response type from embedding service')
      }
    } catch (error: any) {
      embeddingError = error.message
      embeddingResult = {
        status: 'failed',
        error: error.message,
        dimensions: 0
      }
    }

    // 测试文章分析 - 直接调用AI Gateway
    let analysisResult: any = null
    let analysisError: any = null
    try {
      const analysisRequest = {
        capability: 'chat' as const,
        messages: [{ 
          role: 'user' as const, 
          content: getArticleAnalysisPrompt("AI技术发展趋势", "人工智能技术正在快速发展，在各个领域都有重要应用。")
        }],
        provider: 'workers-ai',
        model: '@cf/meta/llama-2-7b-chat-int8',
        temperature: 0.1,
        max_tokens: 2000,
        metadata: createRequestMetadata(c)
      }
      
      const analysisResponse = await aiGatewayService.chat(analysisRequest)
      if (analysisResponse.capability === 'chat') {
        analysisResult = {
          status: 'success',
          analysis_completed: true,
          provider: analysisResponse.provider,
          response_length: analysisResponse.choices?.[0]?.message?.content?.length || 0
        }
      } else {
        throw new Error('Unexpected response type from chat service')
      }
    } catch (error: any) {
      analysisError = error.message
      analysisResult = {
        status: 'failed',
        error: error.message,
        analysis_completed: false
      }
    }

    return c.json({
      success: true,
      test_name: 'AI Worker Core Capabilities Test',
      results: {
        embedding_generation: embeddingResult,
        article_analysis: analysisResult
      },
      ai_gateway_status: {
        providers_available: aiGatewayService.getAvailableProviders().length,
        capabilities: ['chat', 'embedding', 'intelligence']
      },
      errors: {
        embedding_error: embeddingError,
        analysis_error: analysisError
      },
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('AI capabilities test error:', error)
    return c.json({
      success: false,
      error: 'Failed to test AI capabilities',
      details: error.message,
      timestamp: new Date().toISOString()
    }, 500)
  }
})

app.get('/test', async (c) => {
  try {
    // 轻量级功能测试，验证 AI Gateway 连通性
    const aiGatewayService = new AIGatewayService(c.env)
    
    return c.json({
      success: true,
      service: 'meridian-ai-worker',
      message: 'AI Worker service is operational',
      providers: aiGatewayService.getAvailableProviders(),
      capabilities: ['chat', 'embedding', 'intelligence'],
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Service test error:', error)
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, 500)
  }
})

export default app
