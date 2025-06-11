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
   * 构建情报分析提示词（基于notebook中的final_process_story逻辑）
   */
  private buildIntelligencePrompt(storyArticleMd: string): string {
    const pre_prompt = `
You are a highly skilled intelligence analyst working for a prestigious agency. Your task is to analyze a cluster of related news articles and extract structured information for an executive intelligence report. The quality, accuracy, precision, and **consistency** of your analysis are crucial, as this report will directly inform a high-level daily brief and potentially decision-making.

First, assess if the articles provided contain sufficient content for analysis:

Here is the cluster of related news articles you need to analyze:

<articles>
`.trim();

    const post_prompt = `
</articles>

BEGIN ARTICLE QUALITY CHECK:
Before proceeding with analysis, verify if the articles contain sufficient information:
1. Check if articles appear empty or contain minimal text (fewer than ~50 words each)
2. Check for paywall indicators ("subscribe to continue", "premium content", etc.)
3. Check if articles only contain headlines/URLs but no actual content
4. Check if articles appear truncated or cut off mid-sentence

If ANY of these conditions are true, return ONLY this JSON structure inside <final_json> tags:
<final_json>
{
    "status": "incomplete",
    "reason": "Brief explanation of why analysis couldn't be completed (empty articles, paywalled content, etc.)",
    "availableInfo": "Brief summary of any information that was available"
}
</final_json>

ONLY IF the articles contain sufficient information for analysis, proceed with the full analysis below:

Your goal is to extract and synthesize information from these articles into a structured format suitable for generating a daily intelligence brief.

Before addressing the main categories, conduct a preliminary analysis:
a) List key themes across all articles
b) Note any recurring names, places, or events
c) Identify potential biases or conflicting information
It's okay for this section to be quite long as it helps structure your thinking.

Then, after your preliminary analysis, present your final analysis in a structured JSON format inside <final_json> tags. This must be valid, parseable JSON that follows this **exact refined structure**:

**Detailed Instructions for JSON Fields:**
*   **\`status\`**: 'complete' or 'incomplete'
*   **\`title\`**: Terse, neutral title of the story
*   **\`executiveSummary\`**: Provide a 2-4 sentence concise summary highlighting the most critical developments, key conflicts, and overall assessment from the articles. This should be suitable for a quick read in a daily brief.
*   **\`storyStatus\`**: Assess the current state of the story's development based *only* on the information in the articles. Use one of: 'Developing', 'Escalating', 'De-escalating', 'Concluding', 'Static'.
*   **\`timeline\`**: List key events in chronological order.
    *   \`description\`: Keep descriptions brief and factual.
    *   \`importance\`: Assess the event's importance to understanding the overall narrative (High/Medium/Low). High importance implies the event is central to the story's development or outcome.
*   **\`signalStrength\`**: Assess the overall reliability of the reporting *in this cluster*.
    *   \`assessment\`: High/Medium/Low/Mixed
    *   \`reasoning\`: 1-2 sentences explaining why you assigned this assessment based on source reliability patterns observed across the articles.
*   **\`significance\`**: Evaluate the global importance and impact of the story.
    *   \`assessment\`: Critical/High/Moderate/Low
    *   \`reasoning\`: Explain why this story matters at this level of significance (2-3 sentences)
    *   \`score\`: Numeric score from 1-10 representing global significance (1=minor local event, 10=major global impact)
*   **\`keyEntities\`**: Identify and categorize the most important actors in this story.
    *   \`list\`: Array of entities with name, type (Person/Organization/Country/etc.), and brief description of their involvement
*   **\`contradictions\`**: Note any conflicting information or differing perspectives presented across the articles.
*   **\`informationGaps\`**: List what critical information seems missing or unclear from the available reporting.

**Final Requirements:**
*   **Thoroughness:** Ensure all fields, especially descriptions, reasoning, context, and summaries, are detailed and specific. Avoid superficial or overly brief entries. Your analysis must reflect deep engagement with the provided texts.
*   **Grounding:** Base your entire analysis **SOLELY** on the content within the provided \`<articles>\` tags. Do not introduce outside information, assumptions, or knowledge.
*   **No Brevity Over Clarity:** Do **NOT** provide one-sentence descriptions or reasoning where detailed analysis is required by the field definition.
*   **Scrutinize Sources:** Pay close attention to the reliability assessment of sources when evaluating claims, especially in the \`contradictions\` section. Note when a claim originates primarily or solely from a low-reliability source.
*   **Validity:** Your JSON inside \`<final_json></final_json>\` tags MUST be 100% fully valid with no trailing commas, properly quoted strings and escaped characters where needed, and follow the exact refined structure provided. Ensure keys are in the specified order. Your entire JSON output should be directly extractable and parseable without human intervention.

Return your complete response, including your preliminary analysis/thinking in any format you prefer, followed by the **full** valid JSON inside \`<final_json></final_json>\` tags.
`.trim();

    return pre_prompt + '\n\n' + storyArticleMd + '\n\n' + post_prompt;
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