import { AIGatewayService } from './ai-gateway';
import { getIntelligenceAnalysisPrompt } from '../prompts/intelligenceAnalysis';
import { CloudflareEnv, ChatResponse } from '../types';
import { 
  ArticleDataset, 
  ValidatedStories, 
  IntelligenceReports, 
  IntelligenceReport, 
  Story, 
  Article,
  LegacyIntelligenceAnalysisRequestSchema
} from '../types/intelligence-types';
import { IntelligenceReportBuilder } from '../utils/intelligence-report-builder';
import { AIResponseParser } from '../utils/ai-response-parser';
import { QuotaHandler } from '../utils/quota-handler';

// 导出类型以保持兼容性
export type { 
  ArticleDataset, 
  ValidatedStories, 
  IntelligenceReports, 
  IntelligenceReport, 
  Story, 
  Article 
};

/**
 * 情报分析服务
 * 提供基于AI的深度情报分析功能，生产环境版本，直接抛出错误
 */
export class IntelligenceService {
  private aiGatewayService: AIGatewayService;

  constructor(private env: CloudflareEnv) {
    this.aiGatewayService = new AIGatewayService(env);
  }

  /**
   * 分析多个故事并生成情报报告 - 主要方法
   * 基于 intelligence-pipeline.test.ts 契约
   */
  async analyzeStories(
    stories: ValidatedStories, 
    dataset: ArticleDataset
  ): Promise<{ success: boolean; data?: IntelligenceReports; error?: string }> {
    console.log(`[Intelligence] 开始分析 ${stories.stories.length} 个故事...`);
    
    try {
      const reports: IntelligenceReport[] = [];
      let completedAnalyses = 0;
      let failedAnalyses = 0;

      for (const story of stories.stories) {
        try {
          const report = await this.processStory(story, dataset);
          reports.push(report);
          completedAnalyses++;
        } catch (error) {
          console.error(`[Intelligence] 故事 "${story.title}" 分析失败:`, error);
          failedAnalyses++;
          
          // 生产环境：真实报告错误，不创建fallback报告
          console.error(`[Intelligence] 故事分析失败: ${story.title}`, {
            error: error instanceof Error ? error.message : String(error),
            storyTitle: story.title,
            articleIds: story.articleIds,
            timestamp: new Date().toISOString()
          });
          // 跳过此故事，不添加任何报告
        }
      }

      const result: IntelligenceReports = {
        reports,
        processingStatus: {
          totalStories: stories.stories.length,
          completedAnalyses,
          failedAnalyses,
        },
      };

      // 如果有失败的分析，明确报告错误
      if (failedAnalyses > 0) {
        console.error(`[Intelligence] 严重错误: ${failedAnalyses}/${stories.stories.length} 故事分析失败`);
        return { 
          success: false, 
          error: `Analysis failed for ${failedAnalyses} out of ${stories.stories.length} stories. Check AI Gateway configuration and model availability.`,
          data: result // 仍然返回部分结果用于诊断
        };
      }

      console.log(`[Intelligence] 分析完成: ${completedAnalyses} 成功, ${failedAnalyses} 失败`);
      return { success: true, data: result };

    } catch (error: any) {
      console.error('[Intelligence] 批量分析失败:', error);
      return { success: false, error: `Failed to analyze stories: ${error.message}` };
    }
  }

  /**
   * 分析单个故事并生成详细情报报告
   * 基于 intelligence-pipeline.test.ts 契约
   */
  async analyzeSingleStory(
    story: Story, 
    articleData: Article[]
  ): Promise<{ success: boolean; data?: IntelligenceReport; error?: string }> {
    try {
      // 基础验证
      if (!story.articleIds.length) {
        return { success: false, error: "No articles in story" };
      }

      const relevantArticles = articleData.filter(article => 
        story.articleIds.includes(article.id)
      );
      
      if (!relevantArticles.length) {
        return { success: false, error: "No matching articles found" };
      }

      console.log(`[Intelligence] 分析故事 "${story.title}"，包含 ${relevantArticles.length} 篇文章`);

      // 执行AI分析（失败时直接抛出错误）
      const analysis = await this.performAIAnalysis(relevantArticles);
      
      // 构造符合契约的情报报告
      const report = IntelligenceReportBuilder.buildFromAnalysis(story, relevantArticles, analysis);
      console.log(`[Intelligence] 故事 "${story.title}" 分析完成，状态: ${report.status}`);

      return { success: true, data: report };

    } catch (error: any) {
      console.error(`[Intelligence] 单故事分析失败:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 兼容性方法 - 支持旧接口格式
   */
  async analyzeStory(request: unknown) {
    const { title, articles_ids, articles_data } = LegacyIntelligenceAnalysisRequestSchema.parse(request);
    
    // 转换为新格式
    const story: Story = {
      title,
      importance: 5, // 默认重要性
      articleIds: articles_ids,
      storyType: "SINGLE_STORY",
    };

    const articles: Article[] = articles_data.map(article => ({
      id: article.id,
      title: article.title,
      content: article.content,
      publishDate: article.publishDate,
      url: article.url,
      summary: article.content.substring(0, 200) + '...', // 生成简要摘要
    }));

    const result = await this.analyzeSingleStory(story, articles);
    
    if (result.success && result.data) {
      // 转换为旧格式响应
      return {
        story_title: title,
        articles_count: articles.length,
        analysis: IntelligenceReportBuilder.convertToLegacyFormat(result.data),
        metadata: {
          provider: 'google-ai-studio',
          model: 'gemini-2.0-flash',
          original_articles: articles_ids
        }
      };
    } else {
      throw new Error(result.error || 'Analysis failed');
    }
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 处理单个故事（内部方法）
   */
  private async processStory(story: Story, dataset: ArticleDataset): Promise<IntelligenceReport> {
    // 获取相关文章数据
    const relevantArticles = dataset.articles.filter(article => 
      story.articleIds.includes(article.id)
    );

    if (!relevantArticles.length) {
      const errorMsg = `故事 "${story.title}" 没有找到相关文章`;
      console.error(`[Intelligence] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // 分析单个故事
    const singleStoryResult = await this.analyzeSingleStory(story, relevantArticles);
    
    if (singleStoryResult.success && singleStoryResult.data) {
      return singleStoryResult.data;
    } else {
      const errorMsg = `故事 "${story.title}" 分析失败: ${singleStoryResult.error}`;
      console.error(`[Intelligence] ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  /**
   * 执行AI分析（内部方法）
   */
  private async performAIAnalysis(articles: Article[]): Promise<any> {
    // 构建分析输入
    const storyArticleMd = AIResponseParser.buildArticleMarkdown(articles);
    const prompt = getIntelligenceAnalysisPrompt(storyArticleMd);
    const limitedPrompt = AIResponseParser.limitTokens(prompt, 850000);
    
    console.log(`[Intelligence] 提示词长度: ${limitedPrompt.length} 字符`);
    console.log(`[Intelligence] 开始调用AI Gateway...`);
    
    // 使用重试策略进行AI分析
    const aiOperation = async () => {
      const chatRequest = {
        capability: 'chat' as const,
        messages: [{ role: 'user' as const, content: limitedPrompt }],
        provider: 'google-ai-studio',
        model: 'gemini-2.0-flash',
        temperature: 0.1,
        max_tokens: 8192,
        metadata: {
          requestId: `intel-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          timestamp: Date.now(),
        }
      };

      const result = await this.aiGatewayService.chat(chatRequest);
      
      if (result.capability !== 'chat') {
        throw new Error('Unexpected response type from chat service');
      }
      
      const chatResult = result as ChatResponse;
      const responseText = chatResult.choices?.[0]?.message?.content || '';
      
      console.log(`[Intelligence] AI响应长度: ${responseText.length} 字符`);
      console.log(`[Intelligence] AI响应预览: ${responseText.substring(0, 200)}...`);
      
      return responseText;
    };

    // 执行带重试的AI调用（失败时直接抛出错误）
    const responseText = await QuotaHandler.retryWithBackoff(aiOperation);
    
    // 解析AI响应为标准情报报告结构
    const analysis = AIResponseParser.parseIntelligenceResponse(responseText);
    console.log(`[Intelligence] 解析结果状态: ${analysis?.status || 'unknown'}`);
    
    return analysis;
  }
}