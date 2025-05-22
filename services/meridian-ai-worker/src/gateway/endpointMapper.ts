import { TaskType } from '../types';

/**
 * 负责根据任务类型和模型确定正确的端点、提供商和请求格式
 */
export class EndpointMapper {
  /**
   * 获取端点信息
   * @param provider 提供商
   * @param model 模型名称
   * @param taskType 任务类型
   */
  getEndpointInfo(provider: string, model: string, taskType: TaskType): {
    provider: string,
    endpoint: string,
    format: string
  } {
    // 特定任务的模型-端点映射
    const taskSpecificMappings: Record<TaskType, Record<string, any>> = {
      [TaskType.ARTICLE_ANALYSIS]: {
        'gpt-4o': { provider: 'openai', endpoint: 'v1/chat/completions', format: 'openai-chat' },
        'gpt-3.5-turbo': { provider: 'openai', endpoint: 'v1/chat/completions', format: 'openai-chat' },
        'claude-3-haiku': { provider: 'anthropic', endpoint: 'v1/messages', format: 'anthropic' },
        'gemini-1.5-pro': { provider: 'google', endpoint: 'v1/generateContent', format: 'google' }
      },
      [TaskType.EMBEDDING]: {
        'text-embedding-3-large': { provider: 'openai', endpoint: 'v1/embeddings', format: 'openai-embedding' },
        'text-embedding-ada': { provider: 'openai', endpoint: 'v1/embeddings', format: 'openai-embedding' }
      },
      [TaskType.SUMMARIZE]: {
        'gpt-4o': { provider: 'openai', endpoint: 'v1/chat/completions', format: 'openai-chat' },
        'claude-3-haiku': { provider: 'anthropic', endpoint: 'v1/messages', format: 'anthropic' }
      },
      [TaskType.CHAT]: {
        'gpt-4o': { provider: 'openai', endpoint: 'v1/chat/completions', format: 'openai-chat' },
        'gpt-3.5-turbo': { provider: 'openai', endpoint: 'v1/chat/completions', format: 'openai-chat' },
        'claude-3-opus': { provider: 'anthropic', endpoint: 'v1/messages', format: 'anthropic' }
      }
    };
    
    // 1. 先检查特定任务的特定模型映射
    const taskMappings = taskSpecificMappings[taskType] || {};
    if (taskMappings[model]) {
      return taskMappings[model];
    }
    
    // 2. 根据模型名称推断提供商和端点
    if (model.startsWith('gpt-')) {
      return { provider: 'openai', endpoint: 'v1/chat/completions', format: 'openai-chat' };
    } else if (model.startsWith('claude-')) {
      return { provider: 'anthropic', endpoint: 'v1/messages', format: 'anthropic' };
    } else if (model.startsWith('gemini-')) {
      return { provider: 'google', endpoint: 'v1/generateContent', format: 'google' };
    } else if (model.includes('embedding')) {
      return { provider: 'openai', endpoint: 'v1/embeddings', format: 'openai-embedding' };
    }
    
    // 3. 默认返回
    return { provider, endpoint: 'v1/chat/completions', format: 'openai-chat' };
  }
  
  /**
   * 根据端点信息和任务类型格式化请求负载
   */
  formatPayload(endpointInfo: { provider: string, endpoint: string, format: string }, 
                prompt: string | Array<any>, 
                options: Record<string, any> = {}): any {
    
    // 根据不同格式创建不同的请求体
    switch (endpointInfo.format) {
      case 'openai-chat':
        return this.formatOpenAIChatPayload(prompt, options, endpointInfo);
      case 'openai-embedding':
        return this.formatOpenAIEmbeddingPayload(prompt, options, endpointInfo);
      case 'anthropic':
        return this.formatAnthropicPayload(prompt, options, endpointInfo);
      case 'google':
        return this.formatGooglePayload(prompt, options, endpointInfo);
      default:
        return this.formatOpenAIChatPayload(prompt, options, endpointInfo);
    }
  }
  
  /**
   * 格式化OpenAI聊天请求
   * @private
   */
  private formatOpenAIChatPayload(prompt: string | Array<any>, options: Record<string, any>, endpointInfo: any) {
    const messages = Array.isArray(prompt) ? prompt : [{ role: 'user', content: prompt }];
    
    return {
      model: options.model || options.modelName,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens
    };
  }
  
  /**
   * 格式化OpenAI嵌入请求
   * @private
   */
  private formatOpenAIEmbeddingPayload(text: string | Array<any>, options: Record<string, any>, endpointInfo: any) {
    return {
      model: options.model || options.modelName,
      input: typeof text === 'string' ? text : text[0]?.content || text,
      dimensions: options.dimensions
    };
  }
  
  /**
   * 格式化Anthropic请求
   * @private
   */
  private formatAnthropicPayload(prompt: string | Array<any>, options: Record<string, any>, endpointInfo: any) {
    if (Array.isArray(prompt)) {
      const systemMessage = prompt.find(m => m.role === 'system');
      const nonSystemMessages = prompt.filter(m => m.role !== 'system');
      
      return {
        model: options.model || options.modelName,
        messages: nonSystemMessages,
        system: systemMessage?.content,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens || 1000
      };
    } else {
      return {
        model: options.model || options.modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens || 1000
      };
    }
  }
  
  /**
   * 格式化Google请求
   * @private
   */
  private formatGooglePayload(prompt: string | Array<any>, options: Record<string, any>, endpointInfo: any) {
    let contents;
    
    if (Array.isArray(prompt)) {
      contents = prompt.map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));
    } else {
      contents = [{ role: 'user', parts: [{ text: prompt }] }];
    }
    
    return {
      model: options.model || options.modelName,
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens
      }
    };
  }
}

export const endpointMapper = new EndpointMapper();