/**
 * 环境变量定义
 */
export interface Env {
  // API 密钥
  OPENAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  API_AUTH_KEY: string;
  CLOUDFLARE_API_KEY?: string;
  
  // 配置项
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  
  // Cloudflare AI 绑定
  AI: any;

  // AI Gateway 配置
  AI_GATEWAY_URL?: string;
  AI_GATEWAY_TOKEN?: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_NAME?: string;
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