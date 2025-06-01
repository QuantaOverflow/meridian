import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { AIGatewayService } from './services/ai-gateway'
import { getArticleAnalysisPrompt, articleAnalysisSchema, ArticleAnalysisResult } from './prompts/articleAnalysis'
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

app.use('*', logger())

// =============================================================================
// Health Check
// =============================================================================

app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
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
    
    // 验证请求参数
    if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
      return c.json({ 
        success: false,
        error: 'Invalid request: text is required and cannot be empty'
      }, 400)
    }

    // 创建AI Gateway Service
    const aiGatewayService = new AIGatewayService(c.env)
    
    // 构建嵌入请求
    const embeddingRequest = {
      input: body.text,
      provider: body.options?.provider || 'workers-ai',
      model: body.options?.model || '@cf/baai/bge-small-en-v1.5'
    }

    // 通过AI Gateway处理嵌入请求
    const result = await aiGatewayService.embed(embeddingRequest)
    
    // 确保结果是嵌入响应类型
    if (result.capability !== 'embedding') {
      throw new Error('Unexpected response type from embedding service')
    }
    
    return c.json({
      success: true,
      data: result.data,
      model: result.model,
      dimensions: Array.isArray(result.data) ? result.data.length : 0,
      text_length: body.text.length,
      metadata: {
        provider: result.provider,
        model: result.model,
        processingTime: result.processingTime,
        cached: result.cached
      }
    })
  } catch (error: any) {
    console.error('Embedding generation error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to generate embedding',
      details: error.message
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
    max_tokens: 2000
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
      stream: body.options?.stream || false
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
      stream: true
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
// Data Endpoints
// =============================================================================

app.post('/meridian/articles/get-processed', async (c) => {
  try {
    const body = await c.req.json()
    const { dateFrom, dateTo, limit = 1000, onlyWithEmbeddings = false } = body
    
    // 这里应该从数据库查询已处理的文章
    // 目前返回模拟数据（增加更多文章用于测试）
    const articles = [
      {
        id: 1,
        title: "AI Technology Breakthrough in Machine Learning",
        url: "https://example.com/ai-breakthrough",
        content: "Researchers have announced a significant breakthrough in machine learning algorithms that could revolutionize artificial intelligence applications across various industries.",
        publishDate: "2025-05-30T10:00:00Z",
        embedding: new Array(384).fill(0).map(() => Math.random() * 0.1),
        status: "PROCESSED"
      },
      {
        id: 2,
        title: "Global Economic Trends and Market Analysis",
        url: "https://example.com/economic-trends",
        content: "Economic analysts report shifting trends in global markets with implications for international trade and investment strategies in the coming quarter.",
        publishDate: "2025-05-30T10:30:00Z",
        embedding: new Array(384).fill(0).map(() => Math.random() * 0.1 + 0.5),
        status: "PROCESSED"
      },
      {
        id: 3,
        title: "Climate Change Impact on Agriculture",
        url: "https://example.com/climate-agriculture",
        content: "New research reveals the growing impact of climate change on agricultural productivity and food security worldwide, prompting calls for adaptive strategies.",
        publishDate: "2025-05-30T11:00:00Z",
        embedding: new Array(384).fill(0).map(() => Math.random() * 0.1 + 0.8),
        status: "PROCESSED"
      },
      {
        id: 4,
        title: "Cybersecurity Threats in Digital Infrastructure",
        url: "https://example.com/cybersecurity",
        content: "Security experts warn of increasing cybersecurity threats targeting critical digital infrastructure, emphasizing the need for enhanced protection measures.",
        publishDate: "2025-05-30T11:30:00Z",
        embedding: new Array(384).fill(0).map(() => Math.random() * 0.1 + 0.2),
        status: "PROCESSED"
      },
      {
        id: 5,
        title: "Space Exploration Mission Updates",
        url: "https://example.com/space-exploration",
        content: "Space agencies provide updates on ongoing exploration missions, including new discoveries and planned future expeditions to Mars and beyond.",
        publishDate: "2025-05-30T12:00:00Z",
        embedding: new Array(384).fill(0).map(() => Math.random() * 0.1 + 0.7),
        status: "PROCESSED"
      },
      {
        id: 6,
        title: "Renewable Energy Adoption Accelerates",
        url: "https://example.com/renewable-energy",
        content: "Countries worldwide are accelerating their adoption of renewable energy sources, with solar and wind power leading the transition to sustainable energy systems.",
        publishDate: "2025-05-30T12:30:00Z",
        embedding: new Array(384).fill(0).map(() => Math.random() * 0.1 + 0.3),
        status: "PROCESSED"
      },
      {
        id: 7,
        title: "Healthcare Innovation in Digital Medicine",
        url: "https://example.com/digital-medicine",
        content: "Digital health technologies are transforming patient care through telemedicine, AI diagnostics, and personalized treatment approaches.",
        publishDate: "2025-05-30T12:30:00Z",
        embedding: new Array(384).fill(0).map(() => Math.random() * 0.1 + 0.6),
        status: "PROCESSED"
      },
      {
        id: 8,
        title: "Automotive Industry Electric Vehicle Transition",
        url: "https://example.com/ev-transition",
        content: "Major automotive manufacturers are accelerating their transition to electric vehicles, with new models and charging infrastructure developments.",
        publishDate: "2025-05-30T13:30:00Z",
        embedding: new Array(384).fill(0).map(() => Math.random() * 0.1 + 0.4),
        status: "PROCESSED"
      }
    ]
    
    return c.json({ data: articles })
  } catch (error: any) {
    console.error('Articles retrieval error:', error)
    return c.json({ error: error.message }, 500)
  }
})

app.post('/meridian/briefs/save', async (c) => {
  try {
    const briefDocument = await c.req.json()
    
    // 这里应该保存到数据库或R2存储
    console.log('保存简报文档:', briefDocument.id)
    
    return c.json({ 
      success: true, 
      brief_id: briefDocument.id,
      saved_at: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('Brief save error:', error)
    return c.json({ error: error.message }, 500)
  }
})

// =============================================================================
// Basic Testing
// =============================================================================

app.get('/test', async (c) => {
  try {
    // 创建AI Gateway Service
    const aiGatewayService = new AIGatewayService(c.env)
    
    // 构建测试聊天请求
    const chatRequest = {
      messages: [{ role: 'user' as const, content: 'Hello, how are you?' }],
      provider: 'workers-ai',
      model: '@cf/meta/llama-3.1-8b-instruct',
      temperature: 0.7,
      max_tokens: 100
    }

    // 通过AI Gateway处理测试请求
    const result = await aiGatewayService.chat(chatRequest)
    
    // 确保结果是聊天响应类型
    if (result.capability !== 'chat') {
      throw new Error('Unexpected response type from chat service')
    }
    
    const chatResult = result as ChatResponse
    
    return c.json({
      success: true,
      test: 'AI Worker is working through AI Gateway',
      response: {
        message: chatResult.choices?.[0]?.message?.content || 'No response',
        provider: chatResult.provider,
        model: chatResult.model,
        usage: chatResult.usage
      },
      metadata: {
        provider: chatResult.provider,
        model: chatResult.model,
        processingTime: chatResult.processingTime,
        cached: chatResult.cached
      }
    })
  } catch (error) {
    console.error('Test error:', error)
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

export default app
