// 创建文件: /Users/shiwenjie/code/github_repo/spider/meridian/services/meridian-ai-worker/src/config/modelRegistry.ts
import { TaskType } from '../types';

// 提供商枚举 - 保留所有现有提供商
export enum Provider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
  CLOUDFLARE = 'cloudflare',
}

// 请求格式枚举
export enum ModelFormat {
  OPENAI_CHAT = 'openai-chat',
  OPENAI_EMBEDDING = 'openai-embedding',
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
  CLOUDFLARE = 'cloudflare'
}

// 综合模型配置接口 - 合并两种配置的字段
export interface ModelConfig {
  name: string;                    // 模型名称
  provider: Provider;              // 提供商
  endpoint?: string;               // API 端点
  format?: ModelFormat;            // 请求格式
  supportedTasks: TaskType[];      // 支持的任务类型（同原capabilities）
  defaultForTask?: TaskType;       // 默认用于哪个任务
  contextWindow?: number;          // 上下文窗口大小
  costPer1KTokens?: number;        // 每千个令牌的成本
  capabilities?: string[];         // 特殊能力
}

/**
 * 模型注册表 - 集中管理所有模型配置
 */
export class ModelRegistry {
  private models: Map<string, ModelConfig> = new Map();
  private taskDefaultModels: Map<TaskType, string> = new Map();
  
  // 注册模型
  registerModel(config: ModelConfig): void {
    this.models.set(config.name, config);
    
    // 如果是某任务的默认模型，记录映射
    if (config.defaultForTask) {
      this.taskDefaultModels.set(config.defaultForTask, config.name);
    }
  }
  
  // 获取模型配置
  getModel(name: string): ModelConfig | undefined {
    return this.models.get(name);
  }
  
  // 根据任务获取默认模型
  getDefaultModelForTask(task: TaskType): ModelConfig | undefined {
    const modelName = this.taskDefaultModels.get(task);
    if (modelName) {
      return this.getModel(modelName);
    }
    
    // 如果没有显式设置，找到第一个支持该任务的模型
    return Array.from(this.models.values())
      .find(model => model.supportedTasks.includes(task));
  }
  
  // 获取默认模型的名称（兼容旧API）
  getDefaultModelNameForTask(task: TaskType): string {
    const model = this.getDefaultModelForTask(task);
    return model ? model.name : '';
  }
  
  // 获取特定任务的所有模型
  getModelsForTask(task: TaskType): ModelConfig[] {
    return Array.from(this.models.values())
      .filter(model => model.supportedTasks.includes(task));
  }
  
  // 验证模型是否支持指定任务（兼容旧API）
  validateModelForTask(modelName: string, task: TaskType): boolean {
    const model = this.getModel(modelName);
    return !!model && model.supportedTasks.includes(task);
  }
  
  // 从模型名称推断提供商
  inferProviderFromModel(modelName: string): Provider {
    // 先检查是否为已注册模型
    const model = this.getModel(modelName);
    if (model) return model.provider;
    
    // 根据前缀推断
    if (modelName.startsWith('gpt-')) return Provider.OPENAI;
    if (modelName.startsWith('claude-')) return Provider.ANTHROPIC;
    if (modelName.startsWith('gemini-')) return Provider.GOOGLE;
    if (modelName.startsWith('@cf/')) return Provider.CLOUDFLARE;
    if (modelName.startsWith('@cloudflare/')) return Provider.CLOUDFLARE;
    
    // 默认
    return Provider.OPENAI;
  }
  
  // 获取所有注册的模型配置
  getAllModels(): ModelConfig[] {
    return Array.from(this.models.values());
  }
}

// 初始化并预填充模型注册表 - 从原modelConfig导入所有模型
function initializeRegistry(): ModelRegistry {
  const registry = new ModelRegistry();
  
  // OpenAI 模型
  registry.registerModel({
    name: 'gpt-4o',
    provider: Provider.OPENAI,
    endpoint: 'v1/chat/completions',
    format: ModelFormat.OPENAI_CHAT,
    supportedTasks: [TaskType.ARTICLE_ANALYSIS, TaskType.SUMMARIZE, TaskType.CHAT],
    defaultForTask: TaskType.CHAT,
    contextWindow: 128000,
    costPer1KTokens: 0.01
  });
  
  registry.registerModel({
    name: 'gpt-3.5-turbo',
    provider: Provider.OPENAI,
    endpoint: 'v1/chat/completions',
    format: ModelFormat.OPENAI_CHAT,
    supportedTasks: [TaskType.ARTICLE_ANALYSIS, TaskType.SUMMARIZE, TaskType.CHAT],
    contextWindow: 16000,
    costPer1KTokens: 0.0015
  });
  
  registry.registerModel({
    name: 'text-embedding-3-large',
    provider: Provider.OPENAI,
    endpoint: 'v1/embeddings',
    format: ModelFormat.OPENAI_EMBEDDING,
    supportedTasks: [TaskType.EMBEDDING],
    defaultForTask: TaskType.EMBEDDING,
    contextWindow: 8192
  });
  
  // Google 模型
  registry.registerModel({
    name: 'gemini-1.5-flash-8b-001',
    provider: Provider.GOOGLE,
    endpoint: 'v1/models/gemini-1.5-flash-8b-001:generateContent', // 修改这里
    format: ModelFormat.GOOGLE,
    supportedTasks: [TaskType.ARTICLE_ANALYSIS, TaskType.SUMMARIZE, TaskType.CHAT],
    contextWindow: 1000000
  });
  
  registry.registerModel({
    name: 'gemini-2.0-flash',
    provider: Provider.GOOGLE,
    endpoint: 'v1/models/gemini-2.0-flash:generateContent', // 修改这里
    format: ModelFormat.GOOGLE,
    supportedTasks: [TaskType.ARTICLE_ANALYSIS, TaskType.SUMMARIZE, TaskType.CHAT],
    defaultForTask: TaskType.ARTICLE_ANALYSIS,
    contextWindow: 1000000
  });
  
  registry.registerModel({
    name: 'embedding-001',
    provider: Provider.GOOGLE,
    endpoint: 'v1/models/embedding-001:embedText', // 修改这里
    format: ModelFormat.GOOGLE,
    supportedTasks: [TaskType.EMBEDDING],
    contextWindow: 8192
  });
  
  // Anthropic 模型
  registry.registerModel({
    name: 'claude-3-opus',
    provider: Provider.ANTHROPIC,
    endpoint: 'v1/messages',
    format: ModelFormat.ANTHROPIC,
    supportedTasks: [TaskType.ARTICLE_ANALYSIS, TaskType.SUMMARIZE, TaskType.CHAT],
    contextWindow: 200000
  });
  
  registry.registerModel({
    name: 'claude-3-5-sonnet',
    provider: Provider.ANTHROPIC,
    endpoint: 'v1/messages',
    format: ModelFormat.ANTHROPIC,
    supportedTasks: [TaskType.ARTICLE_ANALYSIS, TaskType.SUMMARIZE, TaskType.CHAT],
    contextWindow: 200000
  });
  
  registry.registerModel({
    name: 'claude-3-haiku-20240307',
    provider: Provider.ANTHROPIC,
    endpoint: 'v1/messages',
    format: ModelFormat.ANTHROPIC,
    supportedTasks: [TaskType.ARTICLE_ANALYSIS, TaskType.SUMMARIZE, TaskType.CHAT],
    defaultForTask: TaskType.SUMMARIZE,
    contextWindow: 200000
  });
  
  // Cloudflare AI 模型
  registry.registerModel({
    name: '@cf/baai/bge-small-en-v1.5',
    provider: Provider.CLOUDFLARE,
    endpoint: 'embed',
    format: ModelFormat.CLOUDFLARE,
    supportedTasks: [TaskType.EMBEDDING],
    defaultForTask: TaskType.EMBEDDING,
    contextWindow: 8192
  });
  
  registry.registerModel({
    name: '@cloudflare/analytics/viral-news-rank',
    provider: Provider.CLOUDFLARE,
    endpoint: 'classify',
    format: ModelFormat.CLOUDFLARE,
    supportedTasks: [TaskType.ARTICLE_ANALYSIS],
    contextWindow: 8192
  });
  

  return registry;
}

// 导出全局实例
export const modelRegistry = initializeRegistry();