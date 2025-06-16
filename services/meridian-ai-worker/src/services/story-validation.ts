import { AIGatewayService } from './ai-gateway'
import { getStoryValidationPrompt } from '../prompts/storyValidation'
import {
  StoryValidationRequest,
  StoryValidationResult,
  Story,
  RejectedCluster,
  ClusterItem,
  MinimalArticleInfo,
  AIValidationResponse
} from '../types/story-validation'
import { CloudflareEnv } from '../types'

export class StoryValidationService {
  private aiGateway: AIGatewayService

  constructor(env: CloudflareEnv) {
    this.aiGateway = new AIGatewayService(env)
  }

  /**
   * 验证聚类并生成故事
   */
  async validateStories(request: StoryValidationRequest): Promise<StoryValidationResult> {
    const { clusteringResult, articlesData, useAI = true, options } = request
    
    console.log(`[Story Validation] 验证 ${clusteringResult.clusters.length} 个聚类，包含 ${articlesData.length} 个文章数据`)

    // 空聚类情况：返回空结果而不是抛出异常
    if (!clusteringResult.clusters.length) {
      return {
        stories: [],
        rejectedClusters: [],
        metadata: {
          totalClusters: 0,
          totalArticlesProvided: articlesData.length,
          validatedStories: 0,
          rejectedClusters: 0,
          processingStatistics: clusteringResult.statistics
        }
      }
    }

    const stories: Story[] = []
    const rejectedClusters: RejectedCluster[] = []

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
        if (useAI && cluster.size >= 3) {
          const validation = await this.performAIValidation(cluster, articlesData, options)
          
          if (validation.answer === 'single_story') {
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
          } else if (validation.answer === 'collection_of_stories') {
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
          } else if (validation.answer === 'pure_noise') {
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
    
    console.log(`[Story Validation] 验证完成: ${stories.length} 个有效故事, ${rejectedClusters.length} 个拒绝聚类`)
    
    return {
      stories,
      rejectedClusters,
      metadata: {
        totalClusters: clusteringResult.clusters.length,
        totalArticlesProvided: articlesData.length,
        validatedStories: stories.length,
        rejectedClusters: rejectedClusters.length,
        processingStatistics: clusteringResult.statistics
      }
    }
  }

  /**
   * 使用AI验证单个聚类
   */
  private async performAIValidation(
    cluster: ClusterItem,
    articlesData: MinimalArticleInfo[],
    options?: { provider?: string; model?: string }
  ): Promise<AIValidationResponse> {
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
    
    const response = await this.callAI(validationPrompt, undefined, {
      provider: options?.provider,
      model: options?.model,
      temperature: 0
    })
    
    const validation = this.parseJSONFromResponse(response)
    return validation || { answer: 'no_stories' }
  }

  /**
   * 调用AI接口
   */
  private async callAI(
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
      metadata: this.createRequestMetadata()
    }

    const result = await this.aiGateway.chat(chatRequest)
    if (result.capability !== 'chat') {
      throw new Error('Unexpected response type from chat service')
    }

    return result.choices?.[0]?.message?.content || ''
  }

  /**
   * 解析AI响应中的JSON
   */
  private parseJSONFromResponse(response: string): any {
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

  /**
   * 创建请求元数据
   */
  private createRequestMetadata() {
    return {
      requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      timestamp: Date.now(),
      userAgent: 'story-validation-service',
      ipAddress: 'unknown'
    }
  }
} 