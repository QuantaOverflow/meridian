/**
 * AI响应解析器工具类
 */
export class AIResponseParser {
  
  /**
   * 解析AI情报分析响应
   */
  static parseIntelligenceResponse(response: string): any {
    let text = response.trim();

    // 首先尝试提取<final_json>标签内的内容
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
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // 尝试解析JSON
    try {
      const parsed = JSON.parse(text);
      console.log('[Intelligence] JSON解析成功，状态:', parsed.status);
      return parsed;
    } catch (error) {
      console.error('解析情报分析结果失败:', error);
      console.log('处理后文本预览:', text.substring(0, 300) + '...');
      
      // 返回fallback结构
      return {
        status: 'incomplete',
        reason: '响应格式解析失败',
        availableInfo: '技术错误：无法解析AI响应格式',
      };
    }
  }

  /**
   * 限制token数量
   */
  static limitTokens(text: string, maxTokens: number): string {
    const estimatedTokens = text.length / 4;
    if (estimatedTokens <= maxTokens) {
      return text;
    }
    
    const maxChars = maxTokens * 4;
    return text.substring(0, maxChars);
  }

  /**
   * 构建文章Markdown格式
   */
  static buildArticleMarkdown(articles: Array<{ id: number; title: string; url: string; publishDate: string; content: string }>): string {
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
} 