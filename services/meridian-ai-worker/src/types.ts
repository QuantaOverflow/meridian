/**
 * 环境变量定义
 */
export interface Env {
  // API 密钥
  OPENAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  API_AUTH_KEY: string;
  
  // 配置项
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  
  // Cloudflare AI 绑定
  AI: any;
}

/**
 * 支持的 AI 提供商
 */
export enum Provider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
  CLOUDFLARE = 'cloudflare'
}

/**
 * 任务类型枚举
 */
export enum TaskType {
  ARTICLE_ANALYSIS = 'article_analysis',
  EMBEDDING = 'embedding',
  SUMMARIZE = 'summarize',
  CHAT = 'chat'
}

/**
 * API 响应格式
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: Record<string, any>;
}

/**
 * 模型配置接口
 */
export interface ModelConfig {
  provider: Provider;
  capabilities: TaskType[];
  contextWindow: number;
  defaultForTask?: TaskType;
  costPerToken?: number;
}

/**
 * 通用任务请求接口
 */
export interface TaskRequest {
  taskType: TaskType;
  model?: string; // 可选，如果未提供则使用默认模型
  options?: Record<string, any>; // 任务特定选项
}

/**
 * 文章分析任务请求
 */
export interface ArticleAnalysisRequest extends TaskRequest {
  taskType: TaskType.ARTICLE_ANALYSIS;
  title: string;
  content: string;
  schema: Record<string, any>;
  promptTemplate?: string; // 可选的自定义提示模板
}

/**
 * 嵌入向量生成请求
 */
export interface EmbeddingRequest extends TaskRequest {
  taskType: TaskType.EMBEDDING;
  text: string;
  dimensions?: number;
}

/**
 * 摘要生成请求
 */
export interface SummaryRequest extends TaskRequest {
  taskType: TaskType.SUMMARIZE;
  content: string;
  maxLength?: number;
  format?: 'bullet' | 'paragraph' | 'json';
}

/**
 * 聊天请求
 */
export interface ChatRequest extends TaskRequest {
  taskType: TaskType.CHAT;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
}

/**
 * 聊天响应格式
 */
export interface ChatResponse {
  message: {
    role: 'assistant';
    content: string;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}