import { z } from 'zod';
import { AIGatewayService } from './ai-gateway';
import { CloudflareEnv, ChatResponse } from '../types';

// 情报分析请求Schema
const IntelligenceAnalysisRequestSchema = z.object({
  title: z.string(),
  articles_ids: z.array(z.number()),
  articles_data: z.array(z.object({
    id: z.number(),
    title: z.string(),
    url: z.string(),
    content: z.string(),
    publishDate: z.string()
  }))
});

export class IntelligenceService {
  private aiGatewayService: AIGatewayService;

  constructor(private env: CloudflareEnv) {
    this.aiGatewayService = new AIGatewayService(env);
  }

  /**
   * 分析故事并生成详细情报报告
   * 基于notebook中的final_process_story函数逻辑
   */
  async analyzeStory(request: unknown) {
    const { title, articles_ids, articles_data } = IntelligenceAnalysisRequestSchema.parse(request);
    
    if (articles_data.length === 0) {
      throw new Error('没有文章数据可供分析');
    }

    // 构建文章Markdown格式
    const storyArticleMd = this.buildArticleMarkdown(articles_data);
    
    // 构建完整的分析提示词
    const prompt = this.buildIntelligencePrompt(storyArticleMd);
    
    // 使用tiktoken计算token数，限制在850,000 tokens内
    const limitedPrompt = this.limitTokens(prompt, 850000);
    
    // 通过AI Gateway Service进行分析
    const chatRequest = {
      messages: [{ role: 'user' as const, content: limitedPrompt }],
      provider: 'workers-ai',
      model: '@cf/meta/llama-3.1-8b-instruct',
      temperature: 0.1, // 较低温度确保一致性
      max_tokens: 4000
    };

    const result = await this.aiGatewayService.chat(chatRequest);
    
    // 确保结果是聊天响应类型
    if (result.capability !== 'chat') {
      throw new Error('Unexpected response type from chat service');
    }
    
    const chatResult = result as ChatResponse;
    
    // 解析并返回结构化分析结果
    const responseText = chatResult.choices?.[0]?.message?.content || '';
    const analysis = this.parseIntelligenceResponse(responseText);
    
    return {
      story_title: title,
      articles_count: articles_data.length,
      analysis,
      usage: chatResult.usage,
      metadata: {
        provider: chatResult.provider,
        model: chatResult.model,
        processingTime: chatResult.processingTime,
        cached: chatResult.cached,
        prompt_length: limitedPrompt.length,
        original_articles: articles_ids
      }
    };
  }

  /**
   * 构建文章Markdown格式
   */
  private buildArticleMarkdown(articles: Array<{
    id: number;
    title: string;
    url: string;
    content: string;
    publishDate: string;
  }>): string {
    return articles
      .map(article => {
        return `## [${article.title}](${article.url}) (#${article.id})

> ${article.publishDate}

\`\`\`
${article.content}
\`\`\`

`;
      })
      .join('');
  }

  /**
   * 构建情报分析提示词（简化版本）
   */
  private buildIntelligencePrompt(storyArticleMd: string): string {
    return `
You are an intelligence analyst. Analyze the following articles and extract structured information.

Articles:
${storyArticleMd}

Please analyze these articles and return a JSON object with the following structure:
{
  "status": "complete",
  "title": "Brief story title",
  "executiveSummary": "2-4 sentence summary",
  "storyStatus": "Developing|Escalating|De-escalating|Concluding|Static",
  "significance": {
    "assessment": "Critical|High|Moderate|Low",
    "reasoning": "Why this story matters",
    "score": 5
  }
}

Return only valid JSON.
`;
  }

  /**
   * 限制token数量（简化实现）
   */
  private limitTokens(text: string, maxTokens: number): string {
    // 简化实现：假设平均4个字符=1个token
    const estimatedTokens = text.length / 4;
    if (estimatedTokens <= maxTokens) {
      return text;
    }
    
    // 截断到大约指定token数
    const maxChars = maxTokens * 4;
    return text.substring(0, maxChars);
  }

  /**
   * 解析情报分析响应
   */
  private parseIntelligenceResponse(response: string): any {
    let text = response;

    // 提取JSON部分
    if (text.includes('```json')) {
      text = text.split('```json')[1];
      if (text.endsWith('```')) {
        text = text.slice(0, -3);
      }
      text = text.trim();
    }

    // 寻找JSON对象
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      text = jsonMatch[0];
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      console.error('解析情报分析结果失败:', error);
      return {
        status: 'incomplete',
        reason: '解析失败',
        raw_response: response
      };
    }
  }
}