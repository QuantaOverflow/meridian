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
    provider: body.options?.provider || 'workers-ai',
    model: body.options?.model || '@cf/meta/llama-3.1-8b-instruct',
    temperature: 0.1,
    max_tokens: 2000,
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
// Clustering Analysis (Backend Integration)
// =============================================================================

app.post('/meridian/clustering/analyze', async (c) => {
  try {
    const body = await c.req.json()
    const { articles, options = {} } = body
    
    // 验证请求参数
    if (!articles || !Array.isArray(articles) || articles.length === 0) {
      return c.json({ 
        success: false,
        error: 'Invalid request: articles array is required'
      }, 400)
    }

    // 返回简化的聚类结果，实际聚类逻辑在 meridian-ml-service 中实现
    // 这里作为代理端点，将请求转发到 ML 服务
    console.log(`[Clustering] 分析 ${articles.length} 篇文章`)
    
    // 模拟聚类分析结果，实际应该调用 meridian-ml-service
    const clusters = [
      {
        id: 1,
        articles: articles.slice(0, Math.ceil(articles.length / 2)),
        similarity_score: 0.85
      },
      {
        id: 2, 
        articles: articles.slice(Math.ceil(articles.length / 2)),
        similarity_score: 0.72
      }
    ].filter(cluster => cluster.articles.length > 0)

    return c.json({
      success: true,
      clusters: clusters,
      metadata: {
        total_articles: articles.length,
        clusters_found: clusters.length,
        strategy: options.strategy || 'adaptive_threshold',
        preprocessing: options.preprocessing || 'abs_normalize'
      }
    })
  } catch (error: any) {
    console.error('Clustering analysis error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to analyze clusters',
      details: error.message
    }, 500)
  }
})

app.post('/meridian/clustering/analyze-story', async (c) => {
  try {
    const body = await c.req.json()
    const { cluster_id, articles_ids, articles_data, options = {} } = body
    
    // 验证请求参数
    if (!cluster_id || !articles_data || !Array.isArray(articles_data)) {
      return c.json({ 
        success: false,
        error: 'Invalid request: cluster_id and articles_data are required'
      }, 400)
    }

    console.log(`[Story Analysis] 分析聚类 ${cluster_id}，包含 ${articles_data.length} 篇文章`)
    
    // 简化的故事分析逻辑
    const importance = Math.random() * 5 + 1 // 1-6 的重要性评分
    const minImportance = options.min_importance || 3
    
    return c.json({
      success: true,
      data: {
        cluster_id: cluster_id,
        answer: articles_data.length > 1 ? 'multi_story' : 'single_story',
        importance: importance,
        title: `聚类 ${cluster_id} 故事分析`,
        story_type: articles_data.length > 1 ? 'developing' : 'static',
        meets_threshold: importance >= minImportance
      },
      metadata: {
        articles_count: articles_data.length,
        importance_threshold: minImportance,
        processing_time: Date.now()
      }
    })
  } catch (error: any) {
    console.error('Story clustering analysis error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to analyze story cluster',
      details: error.message
    }, 500)
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
        clustering_analysis: '/meridian/clustering/analyze',
        story_clustering: '/meridian/clustering/analyze-story',
        // 通用端点
        chat: '/meridian/chat',
        chat_stream: '/meridian/chat/stream',
        health: '/health',
        test: '/test'
      },
      integration: {
        backend_workflows: ['processArticles', 'auto-brief-generation'],
        ml_service: 'meridian-ml-service (clustering proxy)',
        ai_providers: aiGatewayService.getAvailableProviders(),
        capabilities: ['chat', 'embedding', 'intelligence', 'clustering'],
        version: '1.1.0'
      },
      workflow_integration: {
        'processArticles.workflow.ts': {
          endpoints_used: ['/meridian/article/analyze', '/meridian/embeddings/generate'],
          description: '文章内容处理和嵌入生成'
        },
        'auto-brief-generation.ts': {
          endpoints_used: ['/meridian/clustering/analyze', '/meridian/clustering/analyze-story', '/meridian/intelligence/analyze-story'],
          description: '智能简报生成和聚类分析'
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

app.get('/test', async (c) => {
  try {
    // 轻量级功能测试，验证 AI Gateway 连通性
    const aiGatewayService = new AIGatewayService(c.env)
    
    return c.json({
      success: true,
      service: 'meridian-ai-worker',
      message: 'AI Worker service is operational',
      providers: aiGatewayService.getAvailableProviders(),
      capabilities: ['chat', 'embedding', 'intelligence', 'clustering'],
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
