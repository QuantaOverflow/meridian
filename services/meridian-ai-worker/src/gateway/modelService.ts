// 创建文件: /Users/shiwenjie/code/github_repo/spider/meridian/services/meridian-ai-worker/src/services/modelService.ts
import { TaskType } from '../types';
import { ModelConfig, ModelFormat } from '../types';
import { modelRegistry } from '../config/modelRegistry'; // 假设你有一个模型注册表

/**
 * 模型服务 - 处理模型选择和请求格式化
 */
export class ModelService {
  // 根据任务和选项选择最佳模型
  selectModel(task: TaskType, options: Record<string, any> = {}): ModelConfig {
    // 如果指定了模型，尝试直接使用
    if (options.model && options.model.trim() !== '') {
      const specifiedModel = modelRegistry.getModel(options.model);
      if (specifiedModel && specifiedModel.supportedTasks.includes(task)) {
        return specifiedModel;
      }
      
      // 如果指定模型不存在或不支持该任务，尝试推断提供商
      const provider = modelRegistry.inferProviderFromModel(options.model);
      
      // 返回该提供商支持此任务的第一个模型
      const fallbackModel = modelRegistry.getModelsForTask(task)
        .find(model => model.provider === provider);
        
      if (fallbackModel) {
        return fallbackModel;
      }
    }
    
    // 返回该任务的默认模型
    const defaultModel = modelRegistry.getDefaultModelForTask(task);
    if (!defaultModel) {
      throw new Error(`无法为任务 ${task} 找到合适的模型`);
    }
    
    return defaultModel;
  }
  
  // 格式化请求负载
  formatPayload(
    model: ModelConfig, 
    prompt: string | Array<any>, 
    options: Record<string, any> = {}
  ): any {
    switch (model.format) {
      case ModelFormat.OPENAI_CHAT:
        return this.formatOpenAIChatPayload(model, prompt, options);
      case ModelFormat.OPENAI_EMBEDDING:
        return this.formatOpenAIEmbeddingPayload(model, prompt, options);
      case ModelFormat.ANTHROPIC:
        return this.formatAnthropicPayload(model, prompt, options);
      case ModelFormat.GOOGLE:
        return this.formatGooglePayload(model, prompt, options);
      case ModelFormat.CLOUDFLARE:
        return this.formatCloudflarePayload(model, prompt, options);
      default:
        throw new Error(`不支持的格式: ${model.format}`);
    }
  }
  
  // 格式化方法实现
  private formatOpenAIChatPayload(model: ModelConfig, prompt: string | Array<any>, options: Record<string, any>): any {
    const messages = Array.isArray(prompt) ? prompt : [{ role: 'user', content: prompt }];
    
    return {
      model: model.name,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens
    };
  }
  
  private formatOpenAIEmbeddingPayload(model: ModelConfig, prompt: string | Array<any>, options: Record<string, any>): any {
    return {
      model: model.name,
      input: typeof prompt === 'string' ? prompt : 
             Array.isArray(prompt) ? prompt[0]?.content || prompt : prompt,
      dimensions: options.dimensions
    };
  }
  
  private formatAnthropicPayload(model: ModelConfig, prompt: string | Array<any>, options: Record<string, any>): any {
    if (Array.isArray(prompt)) {
      const systemMessage = prompt.find(m => m.role === 'system');
      const nonSystemMessages = prompt.filter(m => m.role !== 'system');
      
      return {
        model: model.name,
        messages: nonSystemMessages,
        system: systemMessage?.content,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens || 1000
      };
    } else {
      return {
        model: model.name,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens || 1000
      };
    }
  }
  
  // 修正 Cloudflare 格式化方法
  private formatCloudflarePayload(model: ModelConfig, prompt: string | Array<any>, options: Record<string, any>): any {
    // 根据模型类型判断请求格式
    if (model.name.includes('bge-') || model.name.includes('embed')) {
      // 嵌入向量模型使用 text 格式
      return {
        text: Array.isArray(prompt) ? prompt.join(' ') : prompt,
        ...(options.dimensions && { dimensions: options.dimensions })
      };
    } else if (model.name.includes('viral-news-rank') || model.endpoint?.includes('analytics')) {
      // 分类模型使用 text 格式
      return {
        text: Array.isArray(prompt) ? prompt.join(' ') : prompt
      };
    } else if (model.name.includes('llama') || model.name.includes('mistral') || model.name.includes('gemma')) {
      // 文本生成模型使用 prompt 格式
      if (Array.isArray(prompt)) {
        // 如果是对话格式，转换为单个prompt
        const formattedPrompt = prompt.map(msg => {
          if (msg.role === 'system') return `System: ${msg.content}`;
          if (msg.role === 'user') return `User: ${msg.content}`;
          if (msg.role === 'assistant') return `Assistant: ${msg.content}`;
          return msg.content;
        }).join('\n');
        
        return {
          prompt: formattedPrompt,
          max_tokens: options.maxTokens || 1000,
          temperature: options.temperature ?? 0.7
        };
      } else {
        return {
          prompt: prompt,
          max_tokens: options.maxTokens || 1000,
          temperature: options.temperature ?? 0.7
        };
      }
    } else {
      // 默认格式 - 使用 prompt 格式（符合Cloudflare Workers AI的标准格式）
      return {
        prompt: Array.isArray(prompt) ? prompt.join(' ') : prompt,
        max_tokens: options.maxTokens || 1000,
        temperature: options.temperature ?? 0.7
      };
    }
  }
  
  private formatGooglePayload(model: ModelConfig, prompt: string | Array<any>, options: Record<string, any>): any {
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
      model: model.name,
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens
      }
    };
  }
}



// 导出全局实例
export const modelService = new ModelService();