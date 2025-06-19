import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { AIGatewayService } from './services/ai-gateway'
import { StoryValidationService } from './services/story-validation'
import { IntelligenceService } from './services/intelligence'
import { BriefGenerationService } from './services/brief-generation'
import { getArticleAnalysisPrompt } from './prompts/articleAnalysis'
import { CloudflareEnv, ChatResponse } from './types'
import { APIResponse, ArticleItem, StoryAnalysis, BriefContent } from './types/api'
import { ValidatedStories } from './types/story-validation'
import { createRequestMetadata, parseJSONFromResponse } from './utils/common'

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

// ============================================================================
// 通用工具函数
// ============================================================================

async function callAI(
  aiGateway: AIGatewayService, 
  prompt: string, 
  systemPrompt?: string,
  options: { provider?: string; model?: string; temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const messages = systemPrompt 
    ? [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: prompt }
      ]
    : [{ role: 'user' as const, content: prompt }]

  const chatRequest = {
    capability: 'chat' as const,
    messages,
    provider: options.provider || 'google-ai-studio',
    model: options.model || 'gemini-2.0-flash',
    temperature: options.temperature || 0.1,
    max_tokens: options.maxTokens || 8000,
    metadata: createRequestMetadata({ req: { header: () => 'ai-worker' } })
  }

  const result = await aiGateway.chat(chatRequest)
  if (result.capability !== 'chat') {
    throw new Error('Unexpected response type from chat service')
  }

  return (result as ChatResponse).choices?.[0]?.message?.content || ''
}

// ============================================================================
// Health Check
// ============================================================================

app.get('/health', (c) => {
  return c.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'meridian-ai-worker'
  })
})

// ============================================================================  
// Embedding Generation
// ============================================================================

app.post('/meridian/embeddings/generate', async (c) => {
  try {
    const body = await c.req.json()
    
    if (!body.text || (typeof body.text !== 'string' && !Array.isArray(body.text))) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'text field is required (string or array)'
      }, 400)
    }

    const aiGatewayService = new AIGatewayService(c.env)
    
    const embeddingRequest = {
      capability: 'embedding' as const,
      provider: body.options?.provider || 'workers-ai',
      model: body.options?.model || '@cf/baai/bge-small-en-v1.5',
      input: body.text,
      metadata: createRequestMetadata(c)
    }

    const result = await aiGatewayService.embed(embeddingRequest)
    
    if (result.capability !== 'embedding') {
      throw new Error('Unexpected response type from embedding service')
    }
    
    const dimensions = result.data?.[0]?.embedding?.length || 0
    
    return c.json<APIResponse<any>>({
      success: true,
      data: {
        embeddings: result.data,
        dimensions,
        model: result.model
      },
      metadata: {
        provider: result.provider,
        processingTime: result.processingTime,
        cached: result.cached
      }
    })
  } catch (error: any) {
    console.error('Embedding generation error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to generate embedding',
      metadata: { details: error.message }
    }, 500)
  }
})

// ============================================================================
// Article Analysis
// ============================================================================

app.post('/meridian/article/analyze', async (c) => {
  const aiGateway = new AIGatewayService(c.env)
  const requestMetadata = createRequestMetadata(c)
  
  try {
    const { title, content, url } = await c.req.json()
    
    if (!title || !content) {
      return c.json({ success: false, error: '缺少必需字段：title 和 content' }, 400)
    }

    // 输入长度验证 - 限制内容长度以避免上下文窗口超限
    const maxContentLength = 5000 // 约5000字符，避免超过8192 token限制
    const truncatedContent = content.length > maxContentLength 
      ? content.substring(0, maxContentLength) + '...[内容已截断]'
      : content

    console.log(`[Article Analysis] 原始内容长度: ${content.length}, 处理后长度: ${truncatedContent.length}`)

    const analysisPrompt = getArticleAnalysisPrompt(title, truncatedContent)

    // 分级重试策略，优先使用性能较好的模型
    const analysisStrategies = [
      { provider: 'workers-ai', model: '@cf/meta/llama-2-7b-chat-int8', temperature: 0.1 },
      { provider: 'workers-ai', model: '@cf/meta/llama-2-7b-chat-int8', temperature: 0 },
      { provider: 'google-ai-studio', model: 'gemini-2.0-flash', temperature: 0 },
      { provider: 'google-ai-studio', model: 'gemini-2.0-flash', temperature: 0 }
    ]

    let lastError: Error | null = null
    
    for (let attempt = 1; attempt <= analysisStrategies.length; attempt++) {
      const strategy = analysisStrategies[attempt - 1]
      
      console.log(`[Article Analysis] 尝试分析 (${attempt}/${analysisStrategies.length}): ${title.substring(0, 50)}...`)
      console.log(`[Article Analysis] 使用模型: ${strategy.model} (提供商: ${strategy.provider}), 温度: ${strategy.temperature}`)
      
      try {
        const aiResult = await aiGateway.chat({
          messages: [
            { role: 'user', content: analysisPrompt }
          ],
          provider: strategy.provider,
          model: strategy.model,
          temperature: strategy.temperature,
          max_tokens: Math.min(2000, 2048), // 限制输出token数量
          metadata: requestMetadata
        })

        if (aiResult.capability !== 'chat') {
          throw new Error('Unexpected response type from chat service')
        }

        const aiResponse = (aiResult as ChatResponse).choices?.[0]?.message?.content
        if (!aiResponse) {
          throw new Error('AI 服务返回空响应')
        }

        console.log(`[Article Analysis] AI 响应长度: ${aiResponse.length}`)
        console.log(`[Article Analysis] 响应开头: ${aiResponse.substring(0, 100)}`)

        // 解析AI响应为JSON
        const analysisResult = parseJSONFromResponse(aiResponse)
        
        if (!analysisResult || typeof analysisResult !== 'object') {
          console.log(`[Article Analysis] 第 ${attempt} 次尝试失败: JSON 解析失败或返回非对象`)
          console.log(`[Article Analysis] JSON 解析错误 - AI 响应格式可能不正确`)
          lastError = new Error('JSON 解析失败或返回非对象')
          continue
        }

        console.log(`[Article Analysis] 第 ${attempt} 次尝试成功解析 JSON`)
        console.log(`[Article Analysis] 成功完成分析: ${JSON.stringify(analysisResult).substring(0, 200)}...`)

        return c.json({
          success: true,
          data: analysisResult,
          metadata: {
            provider: strategy.provider,
            model: strategy.model,
            attempts: attempt,
            lastError: null
          }
        })

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.log(`[Article Analysis] 第 ${attempt} 次尝试失败: ${errorMessage}`)
        
        // 检查是否是配额或限制相关错误
        if (errorMessage.includes('quota') || errorMessage.includes('rate limit') || 
            errorMessage.includes('resource exhausted') || errorMessage.includes('429') ||
            errorMessage.includes('exceeded') || errorMessage.includes('context window')) {
          console.log(`[Article Analysis] API 配额或限制错误`)
          lastError = new Error(`API 配额或限制错误: ${errorMessage}`)
        } else {
          lastError = error instanceof Error ? error : new Error(errorMessage)
        }
      }
    }

    console.log(`[Article Analysis] 所有重试都失败了`)
    console.log(`[Article Analysis] 最终错误: ${lastError?.message}`)
    
    return c.json({
      success: false,
      error: `文章分析失败: ${lastError?.message || '未知错误'}`,
      metadata: {
        provider: 'workers-ai',
        model: '@cf/meta/llama-2-7b-chat-int8',
        attempts: analysisStrategies.length,
        lastError: lastError?.message
      }
    }, 500)

  } catch (error) {
    console.error('[Article Analysis] 请求处理失败:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    return c.json({
      success: false,
      error: `文章分析失败: ${errorMessage}`,
      metadata: {
        provider: 'workers-ai',
        model: '@cf/meta/llama-2-7b-chat-int8',
        attempts: 0,
        lastError: errorMessage
      }
    }, 500)
  }
})

// ============================================================================
// Story Validation - 使用重构后的服务
// ============================================================================

app.post('/meridian/story/validate', async (c) => {
  try {
    const body = await c.req.json()
    
    // 验证输入数据结构
    if (!body.clusteringResult?.clusters || !Array.isArray(body.clusteringResult.clusters)) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'clusteringResult.clusters array is required'
      }, 400)
    }

    // 验证文章数据数组
    if (!body.articlesData || !Array.isArray(body.articlesData)) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'articlesData array is required'
      }, 400)
    }

    console.log(`[Story Validation] 验证 ${body.clusteringResult.clusters.length} 个聚类，包含 ${body.articlesData.length} 个文章数据`)

    // 验证空聚类情况 - 保持原有的400错误响应
    if (!body.clusteringResult.clusters.length) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'No clusters to validate'
      }, 400)
    }

    // 使用重构后的故事验证服务
    const storyValidationService = new StoryValidationService(c.env)
    const result = await storyValidationService.validateStories({
      clusteringResult: body.clusteringResult,
      articlesData: body.articlesData,
      useAI: body.useAI,
      options: body.options
    })
    
    return c.json<APIResponse<ValidatedStories>>({
      success: true,
      data: result,
      metadata: result.metadata
    })
    
  } catch (error: any) {
    console.error('Story validation error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to validate stories',
      metadata: { details: error.message }
    }, 500)
  }
})

// ============================================================================
// Intelligence Analysis - 符合 intelligence-pipeline.test.ts 契约
// ============================================================================

app.post('/meridian/intelligence/analyze-stories', async (c) => {
  try {
    const body = await c.req.json()
    
    // 验证输入格式：支持新的 ValidatedStories + ArticleDataset 格式
    if (!body.stories || !body.dataset) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'stories (ValidatedStories) and dataset (ArticleDataset) are required'
      }, 400)
    }

    console.log(`[Intelligence] 分析 ${body.stories.stories?.length || 0} 个故事`)

    const intelligenceService = new IntelligenceService(c.env)
    const result = await intelligenceService.analyzeStories(body.stories, body.dataset)
    
    if (result.success) {
      return c.json<APIResponse<any>>({
        success: true,
        data: result.data,
        metadata: {
          total_stories: result.data?.processingStatus.totalStories,
          completed_analyses: result.data?.processingStatus.completedAnalyses,
          failed_analyses: result.data?.processingStatus.failedAnalyses,
          analysis_method: 'intelligence_service_v2'
        }
      })
    } else {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: result.error || 'Intelligence analysis failed'
      }, 500)
    }
    
  } catch (error: any) {
    console.error('Intelligence batch analysis error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to analyze stories',
      metadata: { details: error.message }
    }, 500)
  }
})

app.post('/meridian/intelligence/analyze-single-story', async (c) => {
  try {
    const body = await c.req.json()
    
    // 验证输入格式：支持新的 Story + Article[] 格式
    if (!body.story || !body.articleData) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'story (Story) and articleData (Article[]) are required'
      }, 400)
    }

    console.log(`[Intelligence] 分析单个故事: ${body.story.title}`)

    const intelligenceService = new IntelligenceService(c.env)
    const result = await intelligenceService.analyzeSingleStory(body.story, body.articleData)
    
    if (result.success) {
      return c.json<APIResponse<any>>({
        success: true,
        data: result.data,
        metadata: {
          story_title: body.story.title,
          article_count: body.articleData.length,
          analysis_method: 'single_story_analysis_v2'
        }
      })
    } else {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: result.error || 'Single story analysis failed'
      }, 500)
    }
    
  } catch (error: any) {
    console.error('Single story analysis error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to analyze single story',
      metadata: { details: error.message }
    }, 500)
  }
})

// 保持向后兼容的端点
app.post('/meridian/intelligence/analyze-story', async (c) => {
  try {
    const body = await c.req.json()
    
    // 统一输入格式：支持工作流格式和传统格式
    let storyData, articlesData
    
    if (body.story && body.cluster) {
      // 工作流格式
      storyData = body.story
      articlesData = body.cluster.articles
    } else if (body.articles_data) {
      // 传统格式
      storyData = { storyId: 'traditional', analysis: { summary: body.title } }
      articlesData = body.articles_data
    } else {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'Invalid input format: expected story+cluster or articles_data'
      }, 400)
    }

    if (!articlesData || !Array.isArray(articlesData)) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'articles data is required'
      }, 400)
    }

    console.log(`[Intelligence] 兼容模式分析故事，包含 ${articlesData.length} 篇文章`)

    // 使用 IntelligenceService 进行分析
    const intelligenceService = new IntelligenceService(c.env)
    
    // 转换为 IntelligenceService 期望的格式
    const analysisRequest = {
      title: storyData.analysis?.summary || `故事分析`,
      articles_ids: articlesData.map((a: any) => a.id),
      articles_data: articlesData.map((a: any) => ({
        id: a.id,
        title: a.title || '无标题',
        url: a.url || '',
        content: a.content || a.title || '内容不可用',
        publishDate: a.publish_date || a.publishDate || new Date().toISOString()
      }))
    }
    
    const result = await intelligenceService.analyzeStory(analysisRequest)
    
    // 简化输出格式
    const analysis: StoryAnalysis = {
      overview: result.story_title || result.analysis?.title || storyData.analysis?.summary || '故事概述',
      key_developments: result.analysis?.key_developments || [result.analysis?.executiveSummary || '关键发展待分析'],
      stakeholders: result.analysis?.stakeholders || ['相关方待识别'],
      implications: result.analysis?.implications || ['影响待评估'],
      outlook: result.analysis?.outlook || result.analysis?.storyStatus || '发展中'
    }
    
    return c.json<APIResponse<StoryAnalysis>>({
      success: true,
      data: analysis,
      metadata: {
        articles_analyzed: articlesData.length,
        analysis_method: 'legacy_compatibility',
        provider: result.metadata?.provider,
        model: result.metadata?.model
      }
    })
    
  } catch (error: any) {
    console.error('Legacy intelligence analysis error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to analyze story intelligence',
      metadata: { details: error.message }
    }, 500)
  }
})

// ============================================================================
// Brief Generation - 基于数据契约的完整实现
// ============================================================================

app.post('/meridian/generate-final-brief', async (c) => {
  try {
    const body = await c.req.json()
    
    if (!body.analysisData || !Array.isArray(body.analysisData)) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'analysisData array is required'
      }, 400)
    }

    console.log(`[Brief Generation] 生成简报，输入 ${body.analysisData.length} 个分析`)

    const briefService = new BriefGenerationService(c.env)

    // 将legacy格式转换为IntelligenceReports格式
    const intelligenceReports = {
      reports: body.analysisData.map((analysis: any) => ({
        storyId: analysis.id || `story_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        status: "COMPLETE" as const,
        executiveSummary: analysis.overview || analysis.summary || '发展概述',
        storyStatus: "DEVELOPING" as const,
        timeline: [],
        significance: {
          level: "MODERATE" as const,
          reasoning: analysis.outlook || '需要持续关注的发展',
        },
        entities: (analysis.stakeholders || []).map((name: string) => ({
          name,
          type: 'Organization',
          role: 'Stakeholder',
          positions: [],
        })),
        sources: [{
          sourceName: 'Multiple Sources',
          articleIds: [1, 2, 3], // 占位符
          reliabilityLevel: "HIGH" as const,
          bias: 'Minimal',
        }],
        factualBasis: analysis.key_developments || [],
        informationGaps: analysis.implications || [],
        contradictions: [],
      })),
      processingStatus: {
        totalStories: body.analysisData.length,
        completedAnalyses: body.analysisData.length,
        failedAnalyses: 0,
      },
    }

    const previousContext = body.previousBrief ? {
      date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      title: body.previousBrief.title || 'Previous Brief',
      summary: body.previousBrief.tldr || body.previousBrief.summary || '无上下文',
      coveredTopics: [],
    } : undefined

    // 调用新的简报生成服务
    const result = await briefService.generateBrief(intelligenceReports, previousContext)

    if (!result.success) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'Failed to generate brief',
        metadata: { details: result.error }
      }, 500)
    }

    console.log(`[Brief Generation] 生成完成，标题: "${result.data!.metadata.title}"`)

    // 返回向后兼容的格式
    const briefContent = result.data!.content.sections.map(s => s.content).join('\n\n');
    
    return c.json<APIResponse<BriefContent>>({
      success: true,
      data: {
        title: result.data!.metadata.title,
        content: briefContent,
      },
      metadata: {
        sections_processed: body.analysisData.length,
        content_length: briefContent.length,
        has_previous_context: !!body.previousBrief,
        // 额外的契约数据
        model_used: result.data!.metadata.model,
        total_articles: result.data!.statistics.totalArticlesProcessed,
        sources_used: result.data!.statistics.totalSourcesUsed,
      }
    })

  } catch (error: any) {
    console.error('Brief generation error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to generate brief',
      metadata: { details: error.message }
    }, 500)
  }
})

// ============================================================================
// TLDR Generation - 基于数据契约的完整实现
// ============================================================================

app.post('/meridian/generate-brief-tldr', async (c) => {
  try {
    const body = await c.req.json()
    
    if (!body.briefTitle || !body.briefContent) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'briefTitle and briefContent are required'
      }, 400)
    }

    console.log(`[TLDR Generation] 为简报生成TLDR`)

    const briefService = new BriefGenerationService(c.env)
    
    const result = await briefService.generateTLDR(body.briefTitle, body.briefContent)
    
    if (!result.success) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'Failed to generate TLDR',
        metadata: { details: result.error }
      }, 500)
    }

    console.log(`[TLDR Generation] TLDR生成完成`)

    return c.json<APIResponse<{ tldr: string }>>({
      success: true,
      data: result.data!,
      metadata: {
        brief_title: body.briefTitle,
        brief_length: body.briefContent.length,
        story_count: result.data!.tldr.split('\n').filter(line => line.trim()).length
      }
    })

  } catch (error: any) {
    console.error('TLDR generation error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to generate TLDR',
      metadata: { details: error.message }
    }, 500)
  }
})

// ============================================================================
// Chat API - 简化版
// ============================================================================

app.post('/meridian/chat', async (c) => {
  try {
    const body = await c.req.json()
    
    if (!body.messages || !Array.isArray(body.messages)) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'messages array is required'
      }, 400)
    }

    const aiGatewayService = new AIGatewayService(c.env)
    
    const chatRequest = {
      capability: 'chat' as const,
      messages: body.messages,
      provider: body.options?.provider || 'google-ai-studio',
      model: body.options?.model || 'gemini-2.0-flash',
      temperature: body.options?.temperature || 0.7,
      max_tokens: body.options?.max_tokens || 1000,
      stream: body.options?.stream || false,
      metadata: createRequestMetadata(c)
    }

    const result = await aiGatewayService.chat(chatRequest)
    
    if (result.capability !== 'chat') {
      throw new Error('Unexpected response type from chat service')
    }
    
    const chatResult = result as ChatResponse
    
    return c.json<APIResponse<any>>({
      success: true,
      data: {
        id: chatResult.id,
        choices: chatResult.choices,
        usage: chatResult.usage,
        model: chatResult.model
      },
      metadata: {
        provider: chatResult.provider,
        processingTime: chatResult.processingTime,
        cached: chatResult.cached
      }
    })
  } catch (error: any) {
    console.error('Chat error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to process chat request',
      metadata: { details: error.message }
    }, 500)
  }
})

// ============================================================================
// Status and Monitoring - 简化版
// ============================================================================

app.get('/meridian/status', (c) => {
  try {
    const aiGatewayService = new AIGatewayService(c.env)
    
    return c.json<APIResponse<any>>({ 
      success: true,
      data: {
        service: 'meridian-ai-worker',
        version: '2.0.0-simplified',
        status: 'active',
        endpoints: {
          // 核心工作流端点
          article_analysis: '/meridian/article/analyze',
          embedding_generation: '/meridian/embeddings/generate', 
          story_validation: '/meridian/story/validate',
          // 新情报分析端点 - 符合测试契约
          intelligence_batch_analysis: '/meridian/intelligence/analyze-stories',
          intelligence_single_analysis: '/meridian/intelligence/analyze-single-story',
          // 兼容性端点
          intelligence_legacy: '/meridian/intelligence/analyze-story',
          brief_generation: '/meridian/generate-final-brief',
          brief_tldr: '/meridian/generate-brief-tldr',
          // 通用端点
          chat: '/meridian/chat',
          health: '/health'
        },
        workflow: {
          description: '聚类分析 → 故事验证 → 情报分析 → 简报生成',
          data_flow: 'ClusteringResult → ValidatedStories → IntelligenceReports → FinalBrief',
          architecture: 'Clean Architecture - 服务职责分离，代码简洁易读',
          input_formats: {
            story_validation: 'ClusteringResult + articlesData (MinimalArticleInfo[]) → ValidatedStories',
            intelligence_batch_analysis: 'ValidatedStories + ArticleDataset → IntelligenceReports',
            intelligence_single_analysis: 'Story + Article[] → IntelligenceReport',
            intelligence_legacy: 'Legacy format for backward compatibility',
            brief_generation: 'Array of StoryAnalysis objects'
          },
          refactored_services: {
            description: '重构后的服务架构',
            features: [
              'StoryValidationService - 故事验证服务',
              'IntelligenceService - 情报分析服务',
              'BriefGenerationService - 简报生成服务',
              '统一类型管理 - types/ 目录统一管理',
              '通用工具函数 - utils/ 目录分离',
              '简洁端点实现 - 只保留端点定义'
            ]
          }
        },
        providers: aiGatewayService.getAvailableProviders()
      }
    })
  } catch (error) {
    return c.json<APIResponse<null>>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

app.get('/test', async (c) => {
  try {
    const aiGatewayService = new AIGatewayService(c.env)
    
    return c.json<APIResponse<any>>({
      success: true,
      data: {
        service: 'meridian-ai-worker',
        message: 'Service is operational',
        providers: aiGatewayService.getAvailableProviders(),
        capabilities: ['chat', 'embedding', 'intelligence', 'story_validation', 'brief_generation']
      }
    })
  } catch (error) {
    console.error('Service test error:', error)
    return c.json<APIResponse<null>>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

export default app
