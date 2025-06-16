import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { AIGatewayService } from './services/ai-gateway'
import { getArticleAnalysisPrompt } from './prompts/articleAnalysis'
import { getStoryValidationPrompt } from './prompts/storyValidation'
import { getBriefGenerationSystemPrompt, getBriefGenerationPrompt, getBriefTitlePrompt } from './prompts/briefGeneration'
import { getTldrGenerationPrompt } from './prompts/tldrGeneration'
import { IntelligenceService } from './services/intelligence'
import { BriefGenerationService } from './services/brief-generation'
import { CloudflareEnv, ChatResponse } from './types'

// ============================================================================
// 核心数据类型定义 - 与ML Service兼容
// ============================================================================

interface ArticleItem {
  id: number
  title: string
  content: string
  url: string
  embedding: number[]
  publish_date: string
  status: string
}

interface ClusterItem {
  id: number
  size: number
  articles: ArticleItem[]
}

// 移除旧的 ValidatedStory 接口，已在故事验证部分重新定义

interface StoryAnalysis {
  overview: string
  key_developments: string[]
  stakeholders: string[]
  implications: string[]
  outlook: string
}

interface BriefContent {
  title: string
  content: string
  tldr?: string
}

// 标准化响应格式
interface APIResponse<T> {
  success: boolean
  data?: T
  error?: string
  metadata?: Record<string, any>
}

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

function createRequestMetadata(c: any) {
  return {
    requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    timestamp: Date.now(),
    userAgent: c.req.header('user-agent') || 'unknown',
    ipAddress: c.req.header('cf-connecting-ip') || 'unknown'
  }
}

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

function parseJSONFromResponse(response: string): any {
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
  try {
    const body = await c.req.json()
    
    if (!body.title || !body.content) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'title and content are required'
      }, 400)
    }

    const aiGatewayService = new AIGatewayService(c.env)
    const prompt = getArticleAnalysisPrompt(body.title, body.content)
    
    const response = await callAI(aiGatewayService, prompt, undefined, {
      provider: body.options?.provider,
      model: body.options?.model,
      temperature: 0.1,
      maxTokens: 8000
    })
    
    const analysisResult = parseJSONFromResponse(response) || {
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
    
    return c.json<APIResponse<any>>({
      success: true,
      data: analysisResult,
      metadata: {
        provider: 'google-ai-studio',
        model: 'gemini-2.0-flash'
      }
    })
  } catch (error: any) {
    console.error('Analysis error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to analyze article',
      metadata: { details: error.message }
    }, 500)
  }
})

// ============================================================================
// Story Validation - 基于 intelligence-pipeline.test.ts 契约
// ============================================================================

// 定义接口类型以匹配测试契约
interface ClusteringParameters {
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

interface ClusteringStatistics {
  totalClusters: number
  noisePoints: number
  totalArticles: number
}

interface ClusterItem {
  clusterId: number
  articleIds: number[]
  size: number
}

interface ClusteringResult {
  clusters: ClusterItem[]
  parameters: ClusteringParameters
  statistics: ClusteringStatistics
}

interface Story {
  title: string
  importance: number
  articleIds: number[]
  storyType: "SINGLE_STORY" | "COLLECTION_OF_STORIES"
}

interface RejectedCluster {
  clusterId: number
  rejectionReason: "PURE_NOISE" | "NO_STORIES" | "INSUFFICIENT_ARTICLES"
  originalArticleIds: number[]
}

interface ValidatedStories {
  stories: Story[]
  rejectedClusters: RejectedCluster[]
}

// 新增：最小文章信息接口，用于故事验证
interface MinimalArticleInfo {
  id: number
  title: string
  url: string
  event_summary_points?: string[]
}

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

    const clusteringResult: ClusteringResult = body.clusteringResult
    const articlesData: MinimalArticleInfo[] = body.articlesData
    
    console.log(`[Story Validation] 验证 ${clusteringResult.clusters.length} 个聚类，包含 ${articlesData.length} 个文章数据`)

    if (!clusteringResult.clusters.length) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'No clusters to validate'
      }, 400)
    }

    const stories: Story[] = []
    const rejectedClusters: RejectedCluster[] = []

    // 使用AI进行智能故事验证
    const aiGatewayService = new AIGatewayService(c.env)

    for (const cluster of clusteringResult.clusters) {
      try {
        // 基本尺寸过滤
        if (cluster.size < 3) {
          rejectedClusters.push({
            clusterId: cluster.clusterId,
            rejectionReason: "INSUFFICIENT_ARTICLES",
            originalArticleIds: cluster.articleIds
          })
          continue
        }

        // 对于足够大的聚类，使用AI进行深度验证
        if (body.useAI !== false && cluster.size >= 3) {
          // 从 articlesData 中查找文章信息，构建详细的文章列表
          const articleList = cluster.articleIds
            .map(id => {
              const article = articlesData.find(a => a.id === id)
              if (!article) {
                return `- Article ID: ${id} (无文章信息)`
              }
              
              let articleInfo = `- ID: ${article.id}\n  标题: ${article.title}\n  URL: ${article.url}`
              
              // 添加摘要要点（如果存在）
              if (Array.isArray(article.event_summary_points) && article.event_summary_points.length > 0) {
                articleInfo += `\n  摘要要点: ${article.event_summary_points.join('; ')}`
              }
              
              return articleInfo
            })
            .join('\n\n')

          const validationPrompt = getStoryValidationPrompt(articleList)
          
          const response = await callAI(aiGatewayService, validationPrompt, undefined, {
            provider: body.options?.provider,
            model: body.options?.model,
            temperature: 0
          })
          
          const validation = parseJSONFromResponse(response)
          
          if (validation?.answer === 'single_story') {
            // 单一故事
            const validArticleIds = cluster.articleIds.filter(
              (id: number) => !validation.outliers?.includes(id)
            )
            
            if (validArticleIds.length >= 2) {
              stories.push({
                title: validation.title || `Story ${cluster.clusterId}`,
                importance: Math.min(Math.max(validation.importance || 5, 1), 10),
                articleIds: validArticleIds,
                storyType: "SINGLE_STORY"
              })
            } else {
              rejectedClusters.push({
                clusterId: cluster.clusterId,
                rejectionReason: "INSUFFICIENT_ARTICLES",
                originalArticleIds: cluster.articleIds
              })
            }
          } else if (validation?.answer === 'collection_of_stories') {
            // 故事集合：分解为多个独立故事
            validation.stories?.forEach((story: any, index: number) => {
              if (story.articles?.length >= 2) {
                stories.push({
                  title: story.title || `Story ${cluster.clusterId}-${index + 1}`,
                  importance: Math.min(Math.max(story.importance || 5, 1), 10),
                  articleIds: story.articles,
                  storyType: "SINGLE_STORY" // 分解后的每个故事都是单一故事
                })
              }
            })
          } else if (validation?.answer === 'pure_noise') {
            rejectedClusters.push({
              clusterId: cluster.clusterId,
              rejectionReason: "PURE_NOISE",
              originalArticleIds: cluster.articleIds
            })
          } else {
            // no_stories 或其他情况
            rejectedClusters.push({
              clusterId: cluster.clusterId,
              rejectionReason: "NO_STORIES",
              originalArticleIds: cluster.articleIds
            })
          }
        } else {
          // 简单验证：按尺寸分类
          stories.push({
            title: `Story ${cluster.clusterId}`,
            importance: Math.floor(Math.random() * 10) + 1,
            articleIds: cluster.articleIds,
            storyType: "SINGLE_STORY"
          })
        }
      } catch (error) {
        console.warn(`[Story Validation] 聚类 ${cluster.clusterId} 验证失败:`, error)
        // 验证失败的聚类标记为拒绝
        rejectedClusters.push({
          clusterId: cluster.clusterId,
          rejectionReason: "NO_STORIES",
          originalArticleIds: cluster.articleIds
        })
      }
    }
    
    const result: ValidatedStories = {
      stories,
      rejectedClusters
    }
    
    console.log(`[Story Validation] 验证完成: ${stories.length} 个有效故事, ${rejectedClusters.length} 个拒绝聚类`)
    
    return c.json<APIResponse<ValidatedStories>>({
      success: true,
      data: result,
      metadata: {
        totalClusters: clusteringResult.clusters.length,
        totalArticlesProvided: articlesData.length,
        validatedStories: stories.length,
        rejectedClusters: rejectedClusters.length,
        processingStatistics: clusteringResult.statistics
      }
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
          input_formats: {
            story_validation: 'ClusteringResult + articlesData (MinimalArticleInfo[]) → ValidatedStories',
            intelligence_batch_analysis: 'ValidatedStories + ArticleDataset → IntelligenceReports',
            intelligence_single_analysis: 'Story + Article[] → IntelligenceReport',
            intelligence_legacy: 'Legacy format for backward compatibility',
            brief_generation: 'Array of StoryAnalysis objects'
          },
          new_contract_compliance: {
            description: '完全符合 intelligence-pipeline.test.ts 数据契约',
            features: [
              '批量故事分析 (analyzeStories)',
              '单故事深度分析 (analyzeSingleStory)', 
              '标准化IntelligenceReport结构',
              '完整的ProcessingStatus追踪',
              '向后兼容性支持'
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
