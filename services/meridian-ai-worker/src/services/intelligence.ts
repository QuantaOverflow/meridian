import { z } from 'zod';
import { AIGatewayService } from './ai-gateway';
import { getIntelligenceAnalysisPrompt } from '../prompts/intelligenceAnalysis';
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

// 简化token计算实现，匹配reportV5.md的逻辑
function limitTokens(text: string, maxTokens: number): string {
  // 简化实现：假设平均4个字符=1个token（与reportV5.md保持一致）
  const estimatedTokens = text.length / 4;
  if (estimatedTokens <= maxTokens) {
    return text;
  }
  
  // 截断到大约指定token数
  const maxChars = maxTokens * 4;
  return text.substring(0, maxChars);
}

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
    const prompt = getIntelligenceAnalysisPrompt(storyArticleMd);
    
    // 限制token数，与reportV5.md保持一致（850,000 tokens）
    const limitedPrompt = limitTokens(prompt, 850000);
    
    // 通过AI Gateway Service进行分析
    const chatRequest = {
      messages: [{ role: 'user' as const, content: limitedPrompt }],
      provider: 'google-ai-studio',
      model: 'gemini-2.0-flash',
      temperature: 0.1, // 较低温度确保一致性
      max_tokens: 8192
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
   * 解析情报分析响应 - 支持完整的notebook格式
   */
  private parseIntelligenceResponse(response: string): any {
    let text = response.trim();

    // 首先尝试提取<final_json>标签内的内容（优先级最高）
    if (text.includes('<final_json>')) {
      const jsonStart = text.indexOf('<final_json>') + 12;
      const jsonEnd = text.indexOf('</final_json>');
      if (jsonEnd !== -1) {
        text = text.substring(jsonStart, jsonEnd).trim();
      } else {
        text = text.substring(jsonStart).trim();
      }
    }
    // 然后尝试提取```json代码块
    else if (text.includes('```json')) {
      const jsonStart = text.indexOf('```json') + 7;
      const jsonEnd = text.indexOf('```', jsonStart);
      if (jsonEnd !== -1) {
        text = text.substring(jsonStart, jsonEnd).trim();
      } else {
        text = text.substring(jsonStart).trim();
      }
    }
    // 最后尝试找到JSON对象的开始和结束
    else {
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        text = text.substring(jsonStart, jsonEnd + 1);
      }
    }

    // 清理文本
    text = text
      .replace(/\n+/g, ' ') // 替换换行符
      .replace(/\s+/g, ' ') // 合并多个空格
      .trim();

    // 尝试解析JSON
    try {
      const parsed = JSON.parse(text);
      console.log('[Intelligence] JSON解析成功，状态:', parsed.status);
      
      // 验证必要字段是否存在
      if (parsed.status === 'complete') {
        const requiredFields = ['title', 'executiveSummary', 'storyStatus', 'significance'];
        const missingFields = requiredFields.filter(field => !parsed[field]);
        
        if (missingFields.length > 0) {
          console.warn('[Intelligence] 缺少必要字段:', missingFields);
        }
      }
      
      return parsed;
    } catch (error) {
      console.error('解析情报分析结果失败:', error);
      console.log('原始响应长度:', response.length);
      console.log('处理后文本长度:', text.length);
      console.log('处理后文本预览:', text.substring(0, 300) + '...');
      
      // 返回fallback结构，保持与notebook格式一致
      return {
        status: 'incomplete',
        reason: '响应格式解析失败',
        availableInfo: '技术错误：无法解析AI响应格式',
        executiveSummary: '分析处理中遇到技术问题，请稍后重试',
        storyStatus: 'Static',
        significance: {
          assessment: 'Low',
          reasoning: '由于技术问题无法完成分析',
          score: 1
        },
        signalStrength: {
          assessment: 'Low',
          reasoning: '解析失败，无法评估信号强度'
        }
      };
    }
  }
}