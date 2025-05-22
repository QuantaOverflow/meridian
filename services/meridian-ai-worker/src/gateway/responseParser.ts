import { TaskType } from '../types';
import { ModelFormat } from '../config/modelRegistry';

/**
 * 响应解析器 - 从不同提供商的响应中提取统一格式的结果
 */
export class ResponseParser {
  /**
   * 解析响应
   */
  parseResponse(
    response: any, 
    endpointInfo: { provider: string, endpoint: string, format: string },
    taskType: TaskType
  ): any {
    switch (endpointInfo.format) {
      case ModelFormat.OPENAI_CHAT:
        return this.parseOpenAIChatResponse(response, taskType);
      case ModelFormat.OPENAI_EMBEDDING:
        return this.parseOpenAIEmbeddingResponse(response);
      case ModelFormat.ANTHROPIC:
        return this.parseAnthropicResponse(response, taskType);
      case ModelFormat.GOOGLE:
        return this.parseGoogleResponse(response, taskType);
      default:
        throw new Error(`未知的响应格式: ${endpointInfo.format}`);
    }
  }
  
  /**
   * 解析OpenAI聊天响应
   * @private
   */
  private parseOpenAIChatResponse(response: any, taskType: TaskType) {
    // 检查是否为函数调用响应
    const toolCall = response.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall && toolCall.function) {
      // 解析函数调用结果
      try {
        return JSON.parse(toolCall.function.arguments);
      } catch (e) {
        return toolCall.function.arguments;
      }
    }
    
    // 常规聊天响应
    if (taskType === TaskType.CHAT) {
      return {
        role: 'assistant',
        content: response.choices?.[0]?.message?.content || ''
      };
    }
    
    // 其他任务就返回文本内容
    return response.choices?.[0]?.message?.content || '';
  }
  
  /**
   * 解析OpenAI嵌入响应
   * @private
   */
  private parseOpenAIEmbeddingResponse(response: any) {
    return response.data?.[0]?.embedding || [];
  }
  
  /**
   * 解析Anthropic响应
   * @private
   */
  private parseAnthropicResponse(response: any, taskType: TaskType) {
    if (taskType === TaskType.CHAT) {
      return {
        role: 'assistant',
        content: response.content?.[0]?.text || ''
      };
    }
    
    return response.content?.[0]?.text || '';
  }
  
  /**
   * 解析Google响应
   * @private
   */
  private parseGoogleResponse(response: any, taskType: TaskType) {
    if (taskType === TaskType.CHAT) {
      return {
        role: 'assistant',
        content: response.candidates?.[0]?.content?.parts?.[0]?.text || ''
      };
    }
    
    return response.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
}

export const responseParser = new ResponseParser();