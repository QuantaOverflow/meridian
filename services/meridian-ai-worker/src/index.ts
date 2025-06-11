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
      model: body.options?.model || '@cf/baai/bge-small-en-v1.5',
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
    const body = await c.req.json()
    
    // 检查输入格式：支持新的工作流格式 (story + cluster) 和旧的格式
    if (body.story && body.cluster) {
      // 新的工作流格式：{story: {...}, cluster: {...}}
      const { story, cluster } = body
      
      console.log(`[Intelligence] 分析工作流格式故事: ${story.storyId}, 聚类中文章数: ${cluster.articles?.length || 0}`)
      
      // 验证cluster数据完整性
      if (!cluster.articles || !Array.isArray(cluster.articles) || cluster.articles.length === 0) {
        console.warn(`[Intelligence] 聚类数据无效或为空: ${JSON.stringify(cluster)}`)
        return c.json({
          success: false,
          error: '聚类中没有有效的文章数据'
        }, 400)
      }
      
      // 转换为IntelligenceService期望的格式，并提供fallback内容
      const transformedRequest = {
        title: story.analysis?.summary || `故事 ${story.storyId}`,
        articles_ids: cluster.articles.map((a: any) => a.id),
        articles_data: cluster.articles.map((a: any) => {
          // 提供更丰富的fallback内容
          const content = a.content || 
                         a.title || 
                         `文章内容暂不可用。标题: ${a.title || '无标题'}。URL: ${a.url || '无链接'}`;
          
          return {
            id: a.id,
            title: a.title || '无标题',
            url: a.url || '',
            content: content,
            publishDate: a.publish_date?.toISOString?.() || 
                        (typeof a.publish_date === 'string' ? a.publish_date : new Date().toISOString())
          }
        })
      }
      
             console.log(`[Intelligence] 转换后的请求数据 - 文章数: ${transformedRequest.articles_data.length}`)
       transformedRequest.articles_data.forEach((article: any, index: number) => {
         console.log(`[Intelligence] 文章 ${index + 1}: ID=${article.id}, 标题="${article.title}", 内容长度=${article.content.length}`)
       })
      
      const intelligenceService = new IntelligenceService(c.env)
      const result = await intelligenceService.analyzeStory(transformedRequest)
      
      // 检查分析结果并提供fallback
      let analysisData
      if (result.analysis && typeof result.analysis === 'object') {
        if (result.analysis.status === 'parsing_failed' && result.analysis.fallback_analysis) {
          // 使用fallback分析
          analysisData = result.analysis.fallback_analysis
        } else {
          // 使用正常分析结果
          analysisData = {
            overview: result.analysis.title || result.analysis.executiveSummary || result.story_title,
            key_developments: result.analysis.executiveSummary ? [result.analysis.executiveSummary] : 
                            result.analysis.key_developments || ['分析正在处理中'],
            stakeholders: result.analysis.stakeholders || ['AI分析系统'],
            implications: result.analysis.implications || ['需要进一步深入分析'],
            outlook: result.analysis.storyStatus || result.analysis.outlook || '发展中'
          }
        }
      } else {
        // 完全fallback
        analysisData = {
          overview: story.analysis?.summary || `故事 ${story.storyId}`,
          key_developments: story.analysis?.key_themes || ['分析处理中'],
          stakeholders: ['AI分析系统'],
          implications: ['需要进一步分析'],
          outlook: '处理中'
        }
      }
      
      return c.json({
        success: true,
        data: analysisData,
        metadata: {
          ...result.metadata,
          fallback_used: !result.analysis || result.analysis.status === 'parsing_failed',
          articles_processed: transformedRequest.articles_data.length
        }
      })
    } else {
      // 原有格式：直接传递给IntelligenceService
      const intelligenceService = new IntelligenceService(c.env)
      const result = await intelligenceService.analyzeStory(body)
      return c.json(result)
    }
  } catch (error: any) {
    console.error('Intelligence analysis error:', error)
    return c.json({ 
      success: false,
      error: error.message,
      details: error.stack
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

// =============================================================================
// Story Validation and Analysis
// =============================================================================

app.post('/meridian/story/validate', async (c) => {
  try {
    const body = await c.req.json()
    
    // 验证请求参数
    if (!body.cluster || !body.cluster.articles || !Array.isArray(body.cluster.articles)) {
      return c.json({ 
        success: false,
        error: 'Invalid request: cluster with articles array is required'
      }, 400)
    }

    const { cluster } = body
    console.log(`[Story Validation] 验证聚类，包含 ${cluster.articles.length} 篇文章`)

    // 构建文章列表用于LLM分析 (与notebook中的process_story函数一致)
    const articleList = cluster.articles
      .map((a: any) => `- (#${a.id}) [${a.title}](${a.url})`)
      .join('\n')

    // 🆕 增强的故事验证提示词 - 提供完整的透明度信息
    const validationPrompt = `
# Task
Determine if the following collection of news articles is:
1) A single story - A cohesive narrative where all articles relate to the same central event/situation and its direct consequences
2) A collection of stories - Distinct narratives that should be analyzed separately
3) Pure noise - Random articles with no meaningful pattern
4) No stories - Distinct narratives but none of them have more than 3 articles

# Important clarification
A "single story" can still have multiple aspects or angles. What matters is whether the articles collectively tell one broader narrative where understanding each part enhances understanding of the whole.

# Handling outliers
- For single stories: You can exclude true outliers in an "outliers" array
- For collections: Focus **only** on substantive stories (2+ articles). Ignore one-off articles or noise.

# Title guidelines
- Titles should be purely factual, descriptive and neutral
- Include necessary context (region, countries, institutions involved)
- No editorialization, opinion, or emotional language
- Format: "[Subject] [action/event] in/with [location/context]"

# Transparency Requirements (NEW)
For each story identified, you must provide:
1. **Importance Factors**: Detailed breakdown of why this story got its importance score
2. **Quality Metrics**: Assess coherence, relevance, uniqueness, and timeliness
3. **Reasoning**: Clear explanation of your decision-making process
4. **Confidence**: How confident you are in this assessment (0.0-1.0)
5. **Key Topics**: Main themes and subjects covered in the story

# Input data
Articles (format is (#id) [title](url)):
${articleList}

# Output format
Return your final answer in JSON format with enhanced transparency:
\`\`\`json
{
    "answer": "single_story" | "collection_of_stories" | "pure_noise" | "no_stories",
    "reasoning_process": "Detailed explanation of how you analyzed these articles and reached your conclusion",
    // single_story_start: if answer is "single_story", include the following fields:
    "title": "title of the story",
    "importance": 1-10,
    "importance_factors": {
        "global_significance": 1-10,
        "affected_population": 1-10,
        "economic_impact": 1-10,
        "geopolitical_relevance": 1-10,
        "innovation_factor": 1-10
    },
    "quality_metrics": {
        "coherence": 0.0-1.0,
        "relevance": 0.0-1.0,
        "uniqueness": 0.0-1.0,
        "timeliness": 0.0-1.0
    },
    "reasoning": "Why this story matters and how you determined its importance",
    "confidence": 0.0-1.0,
    "key_topics": ["topic1", "topic2", "topic3"],
    "outliers": []
    // single_story_end
    // collection_of_stories_start: if answer is "collection_of_stories", include the following fields:
    "stories": [
        {
            "title": "title of the story",
            "importance": 1-10,
            "importance_factors": {
                "global_significance": 1-10,
                "affected_population": 1-10,
                "economic_impact": 1-10,
                "geopolitical_relevance": 1-10,
                "innovation_factor": 1-10
            },
            "quality_metrics": {
                "coherence": 0.0-1.0,
                "relevance": 0.0-1.0,
                "uniqueness": 0.0-1.0,
                "timeliness": 0.0-1.0
            },
            "reasoning": "Why this story matters and how you determined its importance",
            "confidence": 0.0-1.0,
            "key_topics": ["topic1", "topic2", "topic3"],
            "articles": []
        }
    ]
    // collection_of_stories_end
}
\`\`\`

Note:
- Always include articles IDs (outliers, articles, etc...) as integers, not strings and never include the # symbol.
- Be thorough in your reasoning - this will help improve the system's transparency.
- Rate importance factors on individual 1-10 scales, then derive overall importance.
- Quality metrics should be precise decimal values reflecting your assessment.
    `.trim()

    // 创建AI Gateway Service
    const aiGatewayService = new AIGatewayService(c.env)
    
    // 构建聊天请求
    const chatRequest = {
      capability: 'chat' as const,
      messages: [{ role: 'user' as const, content: validationPrompt }],
      provider: body.options?.provider || 'google-ai-studio',
      model: body.options?.model || 'gemini-2.0-flash',
      temperature: 0,
      max_tokens: 2000,
      metadata: createRequestMetadata(c)
    }

    // 处理验证请求
    const result = await aiGatewayService.chat(chatRequest)
    
    // 确保结果是ChatResponse类型
    if (result.capability !== 'chat') {
      throw new Error('Unexpected response type from chat service')
    }
    
    const chatResult = result as ChatResponse
    
    // 解析LLM响应
    let responseText = chatResult.choices?.[0]?.message?.content || ''
    
    // 提取JSON部分
    if (responseText.includes('```json')) {
      responseText = responseText.split('```json')[1]
      if (responseText.includes('```')) {
        responseText = responseText.split('```')[0]
      }
    }
    
    try {
      const validation = JSON.parse(responseText.trim())
      
      // 🆕 根据验证结果生成清理后的故事 - 包含完整透明度信息
      const cleanedStories = []
      
             if (validation.answer === 'single_story') {
         // 单一故事：过滤异常点
         const validArticleIds = cluster.articles
           .map((a: any) => a.id)
           .filter((id: any) => !validation.outliers?.includes(id))
        
        if (validArticleIds.length >= 2) { // 至少需要2篇文章
          cleanedStories.push({
            id: cluster.id,
            title: validation.title,
            importance: validation.importance,
            // 🆕 增加透明度字段
            importance_factors: validation.importance_factors || {},
            quality_metrics: validation.quality_metrics || {},
            reasoning: validation.reasoning || '未提供详细推理',
            confidence: validation.confidence || 0,
            key_topics: validation.key_topics || [],
            coherence_score: validation.quality_metrics?.coherence || 0,
            relevance_score: validation.quality_metrics?.relevance || 0,
            uniqueness_score: validation.quality_metrics?.uniqueness || 0,
            timeliness_score: validation.quality_metrics?.timeliness || 0,
            articles: validArticleIds
          })
        }
             } else if (validation.answer === 'collection_of_stories') {
         // 故事集合：分解为多个独立故事
         validation.stories?.forEach((story: any, index: number) => {
           if (story.articles.length >= 2) { // 只保留有足够文章的故事
             cleanedStories.push({
               id: cluster.id * 1000 + index, // 生成唯一ID
               title: story.title,
               importance: story.importance,
               // 🆕 增加透明度字段
               importance_factors: story.importance_factors || {},
               quality_metrics: story.quality_metrics || {},
               reasoning: story.reasoning || '未提供详细推理',
               confidence: story.confidence || 0,
               key_topics: story.key_topics || [],
               coherence_score: story.quality_metrics?.coherence || 0,
               relevance_score: story.quality_metrics?.relevance || 0,
               uniqueness_score: story.quality_metrics?.uniqueness || 0,
               timeliness_score: story.quality_metrics?.timeliness || 0,
               articles: story.articles
             })
           }
         })
       }
      // pure_noise 和 no_stories 情况下不添加任何故事
      
      console.log(`[Story Validation] 聚类 ${cluster.id} 解析成功，生成 ${cleanedStories.length} 个清理后的故事`)
      
      return c.json({
        success: true,
        data: {
          validation_result: validation.answer,
          cleaned_stories: cleanedStories,
          original_cluster_id: cluster.id,
          processed_articles: cluster.articles.length,
          // 🆕 增加AI推理过程透明度
          reasoning_process: validation.reasoning_process || '未提供详细推理过程'
        },
        metadata: {
          provider: chatResult.provider,
          model: chatResult.model,
          processingTime: chatResult.processingTime,
          cached: chatResult.cached
        }
      })
      
         } catch (parseError: any) {
       console.warn(`[Story Validation] JSON解析失败:`, parseError, '原始响应:', responseText)
       
       // Fallback: 如果AI解析失败，提供基本的fallback
       console.log(`[Story Validation] 使用fallback逻辑为聚类 ${cluster.id}`)
       const fallbackStories = []
       
       // 如果聚类有足够的文章，创建一个基本故事
       if (cluster.articles.length >= 2) {
         const articleIds = cluster.articles.map((a: any) => a.id)
         const primaryTitle = cluster.articles[0]?.title || `故事集群 ${cluster.id}`
         
         fallbackStories.push({
           id: cluster.id,
           title: primaryTitle,
           importance: 5, // 默认中等重要性
           articles: articleIds
         })
       }
       
       return c.json({
         success: true,
         data: {
           validation_result: 'fallback_processing',
           cleaned_stories: fallbackStories,
           original_cluster_id: cluster.id,
           processed_articles: cluster.articles.length,
           fallback_used: true,
           parse_error: parseError.message
         },
         metadata: {
           provider: chatResult.provider,
           model: chatResult.model,
           processingTime: chatResult.processingTime,
           cached: chatResult.cached,
           fallback_applied: true
         }
       })
     }
    
  } catch (error: any) {
    console.error('Story validation error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to validate story',
      details: error.message
    }, 500)
  }
})

// =============================================================================
// Final Brief Generation (基于 reportV5.md)
// =============================================================================

app.post('/meridian/generate-final-brief', async (c) => {
  try {
    const body = await c.req.json()
    
    // 验证请求参数
    if (!body.analysisData || !Array.isArray(body.analysisData)) {
      return c.json({ 
        success: false,
        error: 'Invalid request: analysisData array is required'
      }, 400)
    }

    console.log(`[Brief Generation] 开始生成最终简报，输入分析数据: ${body.analysisData.length} 个故事`)

    // 创建AI Gateway Service
    const aiGatewayService = new AIGatewayService(c.env)

    // 构建聚合分析数据为markdown格式（类似reportV5.md中的json_to_markdown_refined函数）
    const convertAnalysisToMarkdown = (analysisData: any[]) => {
      let markdown = ''
      
      analysisData.forEach((data, index) => {
        if (index > 0) markdown += '\n---\n\n'
        
        // 检查数据完整性
        if (!data || data.status === 'incomplete') {
          markdown += `# Analysis Incomplete\n\nReason: ${data?.reason || 'Unknown'}\n`
          return
        }

        // 标题和执行摘要
        const summary = data.executiveSummary || data.overview || 'No summary available.'
        const status = data.storyStatus || 'Status Unknown'
        markdown += `# Key Development Summary: ${summary}\n`
        markdown += `**(Story Status: ${status})**\n\n`

        // 关键时间线事件
        if (data.timeline && Array.isArray(data.timeline)) {
          markdown += "## Key Timeline Events (High Importance)\n"
                     const highImportanceEvents = data.timeline.filter((event: any) => event.importance === 'High').slice(0, 5)
                     if (highImportanceEvents.length > 0) {
             highImportanceEvents.forEach((event: any) => {
               markdown += `*   **${event.date || 'N/A'}:** ${event.description || 'N/A'}\n`
             })
           } else {
            markdown += "*   *No high-importance events identified in timeline.*\n"
          }
          markdown += "\n"
        }

        // 整体重要性
        if (data.significance) {
          markdown += "## Overall Significance\n"
          const assessment = data.significance.assessment || 'N/A'
          const reasoning = data.significance.reasoning || 'No reasoning provided.'
          markdown += `*   **Assessment:** ${assessment}\n`
          markdown += `*   **Reasoning:** ${reasoning}\n\n`
        }

        // 核心事实基础
        if (data.undisputedKeyFacts && Array.isArray(data.undisputedKeyFacts)) {
          markdown += "## Core Factual Basis (Corroborated)\n"
                     data.undisputedKeyFacts.slice(0, 5).forEach((fact: any) => {
             markdown += `*   ${fact}\n`
           })
          if (data.undisputedKeyFacts.length > 5) {
            markdown += `*   *(Additional facts available)*\n`
          }
          markdown += "\n"
        }

        // 关键实体
        if (data.keyEntities?.list && Array.isArray(data.keyEntities.list)) {
          markdown += "## Key Entities Involved\n"
                     data.keyEntities.list.slice(0, 4).forEach((entity: any) => {
             markdown += `*   **${entity.name || 'N/A'} (${entity.type || 'N/A'}):** ${entity.involvement || entity.description || 'N/A'}\n`
           })
          if (data.keyEntities.list.length > 4) {
            markdown += `*   *(Additional entities involved)*\n`
          }
          markdown += "\n"
        }

        // 信息缺口
        if (data.informationGaps && Array.isArray(data.informationGaps)) {
          markdown += "## Critical Information Gaps\n"
                     data.informationGaps.slice(0, 4).forEach((gap: any) => {
             markdown += `*   ${gap}\n`
           })
          if (data.informationGaps.length > 4) {
            markdown += `*   *(Additional gaps identified)*\n`
          }
          markdown += "\n"
        }

        // 评估摘要
        markdown += "## Assessment Summary\n"
        if (data.signalStrength) {
          const assessment = data.signalStrength.assessment || 'N/A'
          markdown += `*   **Signal Strength:** ${assessment}\n`
        } else {
          markdown += "*   Signal Strength: Not Assessed\n"
        }
        markdown += "*   **Note:** Analysis based on sources of varying reliability. Claims from low-reliability sources require caution.\n"
      })
      
      return markdown
    }

    // 转换分析数据为markdown
    const storiesMarkdown = convertAnalysisToMarkdown(body.analysisData)

    // 获取前一天的简报上下文（如果提供）
    let previousContext = ''
    if (body.previousBrief) {
      previousContext = `
## Previous Day's Coverage Context (${body.previousBrief.date || 'Previous Day'})

### ${body.previousBrief.title || 'Previous Brief'}

${body.previousBrief.tldr || 'No previous context available'}
`
    }

    // 构建简报生成提示词（基于reportV5.md的get_brief_prompt函数）
    const briefPrompt = `
hey, i have a bunch of news reports (in random order) derived from detailed analyses of news clusters from the last 30h. could you give me my personalized daily intelligence brief? aim for something comprehensive yet engaging, roughly a 20-30 minute read.

my interests are: significant world news (geopolitics, politics, finance, economics), us news, france news (i'm french/live in france), china news (especially policy, economy, tech - seeking insights often missed in western media), and technology/science (ai/llms, biomed, space, real breakthroughs). also include a section for noteworthy items that don't fit neatly elsewhere.

some context: i built a system that collects/analyzes/compiles news because i was tired of mainstream news that either overwhelms with useless info or misses what actually matters. you're really good at information analysis/writing/etc so i figure by just asking you this i'd get something even better than what presidents get - a focused brief that tells me what's happening, why it matters, and what connections exist that others miss. i value **informed, analytical takes** – even if i don't agree with them, they're intellectually stimulating. i want analysis grounded in the facts provided, free from generic hedging or forced political correctness.

your job: go through all the curated news data i've gathered below. analyze **everything** first to identify what *actually* matters before writing. look for:
- actual significance (not just noise/volume)
- hidden patterns and connections between stories
- important developments flying under the radar
- how separate events might be related
- genuinely interesting or impactful stories

**--- CONTEXT FROM PREVIOUS DAY (IF AVAILABLE) ---**
*   You *may* receive a section at the beginning of the curated data titled \`## Previous Day's Coverage Context (YYYY-MM-DD)\`.
*   This section provides a highly condensed list of major stories covered yesterday, using the format: \`[Story Identifier] | [Last Status] | [Key Entities] | [Core Issue Snippet]\`.
*   **How to Use This Context:** Use this list **only** to understand which topics are ongoing and their last known status/theme. This helps ensure continuity and avoid repeating information already covered.
*   **Focus on Today:** Your primary task is to synthesize and analyze **today's developments** based on the main \`<curated_news_data>\`. When discussing a story listed in the previous context, focus on **what is new or has changed today**. Briefly reference the past context *only if essential* for understanding the update (e.g., "Following yesterday's agreement...", "The situation escalated further today when...").
*   **Do NOT simply rewrite or extensively quote the Previous Day's Coverage Context.** Treat it as background memory.
**--- END CONTEXT INSTRUCTIONS ---**

here's the curated data (each section represents an analyzed news cluster; you might need to synthesize across sections):

${previousContext}

<curated_news_data>

${storiesMarkdown}

</curated_news_data>

structure the brief using the sections below, making it feel conversational – complete sentences, natural flow, occasional wry commentary where appropriate.
<final_brief>
## what matters now
cover the *up to* 7-8 most significant stories with real insight. for each:
<u>**title that captures the essence**</u>
weave together what happened, why it matters (significance, implications), key context, and your analytical take in natural, flowing paragraphs.
separate paragraphs with linebreaks for readability, but ensure smooth transitions.
blend facts and analysis naturally. **if there isn't much significant development or analysis for a story, keep it brief – don't force length.** prioritize depth and insight where warranted.
use **bold** for key specifics (names, places, numbers, orgs), *italics* for important context or secondary details.
offer your **analytical take**: based on the provided facts and context, what are the likely motivations, potential second-order effects, overlooked angles, or inconsistencies? ground this analysis in the data.

## france focus
(i'm french/live in france - ONLY include if there are actual french developments worth reporting)
significant french developments: policy details, key players, economic data, political shifts.

## global landscape
### power & politics
key geopolitical moves, focusing on outcomes and strategic implications, including subtle shifts.

### china monitor
(seeking insights often missed in western media - ONLY include if there are meaningful developments)
meaningful policy shifts, leadership dynamics, economic indicators (with numbers if available), tech developments, social trends.

### economic currents
(ONLY include if there are significant economic developments)
market movements signaling underlying trends, impactful policy decisions, trade/resource developments (with data), potential economic risks or opportunities.

## tech & science developments
(focus on ai/llms, space, biomed, real breakthroughs - ONLY include if there are actual breakthroughs, not minor product updates)
actual breakthroughs, notable ai/llm advancements, significant space news, key scientific progress. separate signal from noise.

## noteworthy & under-reported
(combine under-reported significance and carte blanche - ONLY include if there are genuinely interesting items)
important stories flying under the radar, emerging patterns with specific indicators, slow-burning developments, or other interesting items you think i should see (up to 5 items max).

## positive developments
(ONLY include if there are genuinely positive developments with measurable outcomes - do NOT force content here)
actual progress with measurable outcomes, effective solutions, verifiable improvements.
</final_brief>

use the:
\`\`\`

<u>**title that captures the essence**</u>
paragraph

paragraph

...

\`\`\`
for all sections.

make sure everything inside the <final_brief></final_brief> tags is the actual brief content itself. any/all "hey, here is the brief" or "hope you enjoyed today's brief" should either not be included or be before/after the <final_brief></final_brief> tags.

**final instructions:**
*   always enclose the brief inside <final_brief></final_brief> tags.
*   use lowercase by default like i do. complete sentences please.
*   this is for my eyes only - be direct and analytical.
*   **source reliability:** the input data is derived from analyses that assessed source reliability. use this implicit understanding – give more weight to information from reliable sources and treat claims originating solely from known low-reliability/propaganda sources with appropriate caution in your analysis and 'take'. explicitly mentioning source reliability isn't necessary unless a major contradiction hinges on it.
*   **writing style:** aim for the tone of an extremely well-informed, analytical friend with a dry wit and access to incredible information processing. be insightful, engaging, and respect my time. make complex topics clear without oversimplifying. integrate facts, significance, and your take naturally.
*   **leverage your strengths:** process all the info, spot cross-domain patterns, draw on relevant background knowledge (history, economics, etc.), explain clearly, and provide that grounded-yet-insightful analytical layer.

give me the brief i couldn't get before ai - one that combines human-like insight with superhuman information processing.
    `.trim()

    // 系统提示词（基于reportV5.md）
    const systemPrompt = `
Adopt the persona of an exceptionally well-informed, highly analytical, and slightly irreverent intelligence briefer. Imagine you have near-instant access to and processing power for vast amounts of global information, combined with a sharp, insightful perspective and a dry wit. You're communicating directly and informally with a smart, curious individual who values grounded analysis but dislikes corporate speak, hedging, and forced neutrality.

**Your core stylistic goals are:**

1.  **Tone:** Conversational, direct, and engaging. Use lowercase naturally, as if speaking or writing informally to a trusted peer. Avoid stiff formality, bureaucratic language, or excessive caution. Be chill, but maintain intellectual rigor.
2.  **Analytical Voice:** Prioritize insightful analysis over mere summarization. Go beyond stating facts to explain *why* they matter, connect disparate events, identify underlying patterns, assess motivations, and explore potential implications (second-order effects). Offer a clear, grounded "take" on developments. Don't be afraid to call out inconsistencies or highlight underappreciated angles, always backing it up with the logic derived from the provided information.
3.  **Wit & Personality:** Embrace a dry, clever wit. Humor, sarcasm, or irony should arise *naturally* from the situation or the absurdity of events. Pointing out the obvious when it's funny is fine. **Crucially: Do not force humor, be cringe, or undermine the gravity of serious topics like human suffering.** Wit should enhance insight, not detract from it.
4.  **Language:** Use clear, concise language. Vary sentence structure for natural flow. Occasional relevant slang or shorthand is acceptable if it fits the informal tone naturally, but prioritize clarity. Ensure analysis is sharp and commentary is insightful, not just filler.

**Think of yourself as:** The user's personal "Q" (from James Bond) combined with a sharp geopolitical analyst – someone with unparalleled information access who can cut through the noise, connect the dots, and deliver the essential insights with a bit of personality and zero tolerance for BS.

**Relationship to Main Prompt:** This system prompt defines *how* you should write and analyze. Follow the specific content structure, formatting, and topic instructions provided in the main user prompt separately. Your analysis and 'take' should always be grounded in the information provided in the main prompt's \`<curated_news_data>\` section.

Your ultimate goal is to deliver the kind of insightful, personalized, and engaging intelligence brief that wasn't possible before AI – combining superhuman data processing with a distinct, analytical, and trustworthy (even if slightly cynical) voice.
    `.trim()

    // 构建聊天请求
    const chatRequest = {
      capability: 'chat' as const,
      messages: [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: briefPrompt }
      ],
      provider: body.options?.provider || 'google-ai-studio',
      model: body.options?.model || 'gemini-2.0-flash',
      temperature: 0.7,
      max_tokens: 16000,
      metadata: createRequestMetadata(c)
    }

    console.log(`[Brief Generation] 调用LLM生成简报，使用模型: ${chatRequest.model}`)

    // 通过AI Gateway处理简报生成请求
    const result = await aiGatewayService.chat(chatRequest)
    
    // 确保结果是聊天响应类型
    if (result.capability !== 'chat') {
      throw new Error('Unexpected response type from chat service')
    }
    
    const chatResult = result as ChatResponse
    
    // 提取简报内容
    let briefText = chatResult.choices?.[0]?.message?.content || ''
    
    // 提取 <final_brief> 标签内的内容
    if (briefText.includes('<final_brief>')) {
      briefText = briefText.split('<final_brief>')[1]
      if (briefText.includes('</final_brief>')) {
        briefText = briefText.split('</final_brief>')[0]
      }
    }
    
    briefText = briefText.trim()

    console.log(`[Brief Generation] 简报生成成功，长度: ${briefText.length} 字符`)

    // 同时生成简报标题（基于reportV5.md的brief_title_prompt）
    const titlePrompt = `
<brief>
${briefText}
</brief>

create a title for the brief. construct it using the main topics. it should be short/punchy/not clickbaity etc. make sure to not use "short text: longer text here for some reason" i HATE it, under no circumstance should there be colons in the title. make sure it's not too vague/generic either bc there might be many stories. maybe don't focus on like restituting what happened in the title, just do like the major entities/actors/things that happened. like "[person A], [thing 1], [org B] & [person O]" etc. try not to use verbs. state topics instead of stating topics + adding "shakes world order". always use lowercase.

return exclusively a JSON object with the following format:
\`\`\`json
{
    "title": "string"
}
\`\`\`
    `.trim()

    const titleRequest = {
      capability: 'chat' as const,
      messages: [{ role: 'user' as const, content: titlePrompt }],
      provider: 'google-ai-studio',
      model: 'gemini-2.0-flash',
      temperature: 0.0,
      max_tokens: 1000,
      metadata: createRequestMetadata(c)
    }

    const titleResult = await aiGatewayService.chat(titleRequest)
    let briefTitle = 'daily intelligence brief'
    
    if (titleResult.capability === 'chat') {
      const titleChatResult = titleResult as ChatResponse
      let titleText = titleChatResult.choices?.[0]?.message?.content || ''
      
      // 提取JSON
      if (titleText.includes('```json')) {
        titleText = titleText.split('```json')[1]
        if (titleText.includes('```')) {
          titleText = titleText.split('```')[0]
        }
      }
      
      try {
        const titleData = JSON.parse(titleText.trim())
        briefTitle = titleData.title || briefTitle
      } catch (error) {
        console.warn('[Brief Generation] 标题解析失败，使用默认标题')
      }
    }

    console.log(`[Brief Generation] 生成的标题: "${briefTitle}"`)

    return c.json({
      success: true,
      data: {
        title: briefTitle,
        content: briefText,
        metadata: {
          sections_processed: body.analysisData.length,
          content_length: briefText.length,
          has_previous_context: !!body.previousBrief,
          model_used: chatResult.model,
          provider: chatResult.provider,
          generation_time: chatResult.processingTime,
          total_tokens: chatResult.usage?.total_tokens || 0
        }
      },
      usage: {
        brief_generation: chatResult.usage,
        title_generation: titleResult.capability === 'chat' ? (titleResult as ChatResponse).usage : undefined
      }
    })

  } catch (error: any) {
    console.error('Brief generation error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to generate final brief',
      details: error.message
    }, 500)
  }
})

export default app
