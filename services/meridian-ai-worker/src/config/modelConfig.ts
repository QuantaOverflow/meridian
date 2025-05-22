import { ModelConfig, Provider, TaskType } from '../types';

/**
 * 模型配置映射
 * 定义每个模型的提供商、能力和默认用途
 */
export const MODELS: Record<string, ModelConfig> = {
  // 通过AI Gateway调用的OpenAI模型
  'gateway-gpt-4o': {
    provider: Provider.AI_GATEWAY,
    capabilities: [
      TaskType.ARTICLE_ANALYSIS, 
      TaskType.SUMMARIZE,
      TaskType.CHAT
    ],
    contextWindow: 128000,
    defaultForTask: TaskType.CHAT,
    costPerToken: 0.00005,
  },
  // OpenAI 模型
  'gpt-4o': {
    provider: Provider.OPENAI,
    capabilities: [
      TaskType.ARTICLE_ANALYSIS, 
      TaskType.SUMMARIZE,
      TaskType.CHAT
    ],
    contextWindow: 128000,
    defaultForTask: TaskType.CHAT,
    costPerToken: 0.00005, // 估算值，请根据实际调整
  },
  'text-embedding-3-large': {
    provider: Provider.OPENAI,
    capabilities: [TaskType.EMBEDDING],
    contextWindow: 8192,
    defaultForTask: TaskType.EMBEDDING,
    costPerToken: 0.00001,
  },

  // Google Gemini 模型
  'gemini-1.5-flash-8b-001': {
    provider: Provider.GOOGLE,
    capabilities: [
      TaskType.ARTICLE_ANALYSIS,
      TaskType.SUMMARIZE,
      TaskType.CHAT
    ],
    contextWindow: 1000000,
    defaultForTask: TaskType.ARTICLE_ANALYSIS,
    costPerToken: 0.00000375, // 估算值，请根据实际调整
  },
  'gemini-2.0-flash': {
    provider: Provider.GOOGLE,
    capabilities: [
      TaskType.ARTICLE_ANALYSIS,
      TaskType.SUMMARIZE,
      TaskType.CHAT
    ],
    contextWindow: 1000000,
    defaultForTask: TaskType.ARTICLE_ANALYSIS,
    costPerToken: 0.00000375, // 估算值，请根据实际调整
  },
  'embedding-001': {
    provider: Provider.GOOGLE,
    capabilities: [TaskType.EMBEDDING],
    contextWindow: 8192,
    defaultForTask: TaskType.EMBEDDING,
  },

  // Anthropic 模型
  'claude-3-opus': {
    provider: Provider.ANTHROPIC,
    capabilities: [
      TaskType.ARTICLE_ANALYSIS, 
      TaskType.SUMMARIZE,
      TaskType.CHAT
    ],
    contextWindow: 200000,
    costPerToken: 0.00015, // 估算值，请根据实际调整
  },
  'claude-3-5-sonnet': {
    provider: Provider.ANTHROPIC,
    capabilities: [
      TaskType.ARTICLE_ANALYSIS, 
      TaskType.SUMMARIZE,
      TaskType.CHAT
    ],
    contextWindow: 200000,
    costPerToken: 0.00003, // 估算值，请根据实际调整
  },

  // Cloudflare AI 模型
  '@cf/baai/bge-small-en-v1.5': {
    provider: Provider.CLOUDFLARE,
    capabilities: [TaskType.EMBEDDING],
    contextWindow: 8192,
    defaultForTask: TaskType.EMBEDDING,
  },
  '@cloudflare/analytics/viral-news-rank': {
    provider: Provider.CLOUDFLARE,
    capabilities: [TaskType.ARTICLE_ANALYSIS],
    contextWindow: 8192,
  },
};

/**
 * 按任务类型获取默认模型
 */
export const getDefaultModelForTask = (taskType: TaskType): string => {
  const defaultModels: Record<TaskType, string> = {
    [TaskType.ARTICLE_ANALYSIS]: 'gemini-2.0-flash',
    [TaskType.EMBEDDING]: '@cf/baai/bge-small-en-v1.5',
    [TaskType.SUMMARIZE]: 'gemini-1.5-flash-8b-001',
    [TaskType.CHAT]: 'gpt-4o',
  };

  return defaultModels[taskType];
};

/**
 * 验证模型是否存在并支持指定任务
 */
export const validateModelForTask = (model: string, taskType: TaskType): boolean => {
  if (!MODELS[model]) {
    return false;
  }

  return MODELS[model].capabilities.includes(taskType);
};