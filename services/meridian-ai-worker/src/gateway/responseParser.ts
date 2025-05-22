import { TaskType } from '../types';

/**
 * 负责解析不同提供商的响应格式
 */
export class ResponseParser {
  /**
   * 解析响应内容
   */
  parseResponse(response: any, endpointInfo: any, taskType: TaskType): any {
    switch (endpointInfo.format) {
      case 'openai-chat':
        return this.parseOpenAIChatResponse(response, taskType);
      case 'openai-embedding':
        return this.parseOpenAIEmbeddingResponse(response);
      case 'anthropic':
        return this.parseAnthropicResponse(response, taskType);
      case 'google':
        return this.parseGoogleResponse(response, taskType);
      default:
        return response;
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