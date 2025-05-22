import { TaskType } from '../types';

/**
 * 负责根据任务类型和选项选择适当的模型
 */
export class ModelSelector {
  /**
   * 获取特定任务的模型信息
   */
  getModelForTask(taskType: TaskType, options: Record<string, any> = {}): {
    provider: string,
    model: string
  } {
    // 如果用户明确指定了模型，根据模型名称推断提供商
    if (options.model) {
      return this.getProviderFromModel(options.model);
    }
    
    // 根据任务类型选择最佳模型
    switch(taskType) {
      case TaskType.ARTICLE_ANALYSIS:
        return { provider: 'openai', model: 'gpt-4o' };
      case TaskType.SUMMARIZE:
        return { provider: 'anthropic', model: 'claude-3-haiku-20240307' };
      case TaskType.EMBEDDING:
        return { provider: 'openai', model: 'text-embedding-3-large' };
      case TaskType.CHAT:
        return { provider: 'openai', model: 'gpt-4o-mini' };
      default:
        throw new Error(`未支持的任务类型: ${taskType}`);
    }
  }
  
  /**
   * 从模型名称推断提供商
   */
  private getProviderFromModel(modelName: string): { provider: string, model: string } {
    if (modelName.startsWith('gpt-')) {
      return { provider: 'openai', model: modelName };
    } else if (modelName.startsWith('claude-')) {
      return { provider: 'anthropic', model: modelName };
    } else if (modelName.startsWith('gemini-')) {
      return { provider: 'google', model: modelName };
    } else if (modelName.includes('embedding')) {
      return { provider: 'openai', model: modelName };
    }
    
    // 默认使用OpenAI
    return { provider: 'openai', model: modelName };
  }
}

export const modelSelector = new ModelSelector();