import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { Env, TaskType, ApiResponse, ArticleAnalysisRequest, EmbeddingRequest, SummaryRequest, ChatRequest } from '../types';
import { MODELS, getDefaultModelForTask, validateModelForTask } from '../config/modelConfig';
import { taskFactory } from '../tasks';
import { getLogger } from '../utils/logger';
import { Metrics } from '../utils/metrics';
import { ApiError } from '../utils/errorHandler';

// 创建路由器实例
export const modelRouter = new Hono<{ Bindings: Env }>();

// 获取可用模型信息端点
modelRouter.get('/models', async (c: any) => {
  const logger = getLogger(c.env);
  logger.info('Retrieving available models');
  
  try {
    // 从配置中获取模型信息
    const modelInfo = Object.entries(MODELS).map(([id, config]) => ({
      id,
      provider: config.provider,
      capabilities: config.capabilities,
      contextWindow: config.contextWindow,
      defaultForTask: config.defaultForTask,
    }));
    
    // 返回默认模型信息和所有可用模型
    return c.json({
      success: true,
      data: {
        models: modelInfo,
        defaultModels: {
          [TaskType.ARTICLE_ANALYSIS]: getDefaultModelForTask(TaskType.ARTICLE_ANALYSIS),
          [TaskType.EMBEDDING]: getDefaultModelForTask(TaskType.EMBEDDING),
          [TaskType.SUMMARIZE]: getDefaultModelForTask(TaskType.SUMMARIZE),
          [TaskType.CHAT]: getDefaultModelForTask(TaskType.CHAT),
        },
      },
    } as ApiResponse<any>);
  } catch (error) {
    logger.error('Failed to retrieve model information', {}, 
                error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

// 简单的健康检查端点
modelRouter.get('/health', (c: any) => {
  return c.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString()
    }
  } as ApiResponse<any>);
});

// 系统状态端点，包含更详细的信息
modelRouter.get('/status', async (c: any) => {
  const logger = getLogger(c.env);
  const metrics = new Metrics(c.env);
  logger.info('Checking system status');
  
  // 获取所有收集的指标
  const allMetrics = metrics.getAllMetrics();
  
  return c.json({
    success: true,
    data: {
      status: 'operational',
      environment: c.env.ENVIRONMENT,
      timestamp: new Date().toISOString(),
      metrics: allMetrics,
      providers: {
        openai: Boolean(c.env.OPENAI_API_KEY),
        google: Boolean(c.env.GOOGLE_API_KEY),
        anthropic: Boolean(c.env.ANTHROPIC_API_KEY),
        cloudflare: Boolean(c.env.AI),
      },
    },
  } as ApiResponse<any>);
});

// 文章分析端点验证模式
const articleAnalysisSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  model: z.string().optional(),
  schema: z.record(z.any()).optional(),
  promptTemplate: z.string().optional(),
});

// 嵌入向量生成端点验证模式
const embeddingSchema = z.object({
  text: z.string().min(1, "Text is required"),
  model: z.string().optional(),
  dimensions: z.number().min(1).max(1536).optional(),
});

// 摘要生成端点验证模式
const summarySchema = z.object({
  content: z.string().min(1, "Content is required"),
  model: z.string().optional(),
  maxLength: z.number().positive().optional(),
  format: z.enum(['bullet', 'paragraph', 'json']).optional(),
});

// 聊天端点验证模式
const chatSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string().min(1, "Message content is required")
    })
  ).min(1, "At least one message is required"),
  model: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxTokens: z.number().positive().optional(),
});

// 文章分析端点
modelRouter.post('/analyze', zValidator('json', articleAnalysisSchema), async (c: any) => {
  const logger = getLogger(c.env);
  const metrics = new Metrics(c.env);
  const requestId = c.get('requestId');
  const timer = metrics.startTimer('article_analysis_duration_ms', { requestId });

  try {
    const { title, content, model: requestedModel, schema, promptTemplate } = await c.req.json();
    
    // 确定要使用的模型，使用请求指定的或默认的
    const model = requestedModel || getDefaultModelForTask(TaskType.ARTICLE_ANALYSIS);
    
    // 验证模型是否支持该任务类型
    if (!validateModelForTask(model, TaskType.ARTICLE_ANALYSIS)) {
      throw new ApiError(`Model ${model} does not support article analysis`, 400);
    }
    
    logger.info('Processing article analysis request', { 
      requestId, 
      model,
      title: title.substring(0, 100),
      contentLength: content.length
    });
    
    metrics.incrementCounter('article_analysis_requests', 1, { model });
    
    // 获取适当的任务处理器
    const task = taskFactory(TaskType.ARTICLE_ANALYSIS, c.env);
    
    // 执行分析
    const result = await task.execute({
      taskType: TaskType.ARTICLE_ANALYSIS,
      model,
      title,
      content,
      schema: schema || {}, // 使用默认模式或请求指定的模式
      promptTemplate
    } as ArticleAnalysisRequest);
    
    // 记录处理时间
    const duration = timer();
    logger.info('Article analysis completed', { 
      requestId, 
      model, 
      durationMs: duration 
    });
    
    // 返回结果
    const response: ApiResponse<any> = {
      success: true,
      data: result,
      meta: {
        requestId,
        model,
        processedAt: new Date().toISOString(),
        processingTimeMs: duration
      }
    };
    
    return c.json(response);
    
  } catch (error) {
    // 错误由全局错误处理中间件处理
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Article analysis failed: ${errorMessage}`, { requestId }, 
                error instanceof Error ? error : new Error(String(error)));
    metrics.incrementCounter('article_analysis_errors', 1);
    
    throw error;
  }
});

// 嵌入向量生成端点
modelRouter.post('/embedding', zValidator('json', embeddingSchema), async (c: any) => {
  const logger = getLogger(c.env);
  const metrics = new Metrics(c.env);
  const requestId = c.get('requestId');
  const timer = metrics.startTimer('embedding_duration_ms', { requestId });

  try {
    const { text, model: requestedModel, dimensions } = await c.req.json();
    
    // 确定要使用的模型
    const model = requestedModel || getDefaultModelForTask(TaskType.EMBEDDING);
    
    // 验证模型是否支持该任务类型
    if (!validateModelForTask(model, TaskType.EMBEDDING)) {
      throw new ApiError(`Model ${model} does not support embeddings`, 400);
    }
    
    logger.info('Processing embedding request', { 
      requestId, 
      model,
      textLength: text.length,
      dimensions
    });
    
    metrics.incrementCounter('embedding_requests', 1, { model });
    
    // 获取适当的任务处理器
    const task = taskFactory(TaskType.EMBEDDING, c.env);
    
    // 生成嵌入向量
    const result = await task.execute({
      taskType: TaskType.EMBEDDING,
      model,
      text,
      dimensions
    } as EmbeddingRequest);
    
    // 记录处理时间
    const duration = timer();
    logger.info('Embedding generation completed', { 
      requestId, 
      model, 
      durationMs: duration 
    });
    
    // 返回结果
    const response: ApiResponse<any> = {
      success: true,
      data: result,
      meta: {
        requestId,
        model,
        processedAt: new Date().toISOString(),
        processingTimeMs: duration
      }
    };
    
    return c.json(response);
    
  } catch (error) {
    // 错误由全局错误处理中间件处理
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Embedding generation failed: ${errorMessage}`, { requestId }, 
                error instanceof Error ? error : new Error(String(error)));
    metrics.incrementCounter('embedding_errors', 1);
    
    throw error;
  }
});

// 摘要生成端点
modelRouter.post('/summarize', zValidator('json', summarySchema), async (c: any) => {
  const logger = getLogger(c.env);
  const metrics = new Metrics(c.env);
  const requestId = c.get('requestId');
  const timer = metrics.startTimer('summary_duration_ms', { requestId });

  try {
    const { content, model: requestedModel, maxLength, format } = await c.req.json();
    
    // 确定要使用的模型
    const model = requestedModel || getDefaultModelForTask(TaskType.SUMMARIZE);
    
    // 验证模型是否支持该任务类型
    if (!validateModelForTask(model, TaskType.SUMMARIZE)) {
      throw new ApiError(`Model ${model} does not support summarization`, 400);
    }
    
    logger.info('Processing summary request', { 
      requestId, 
      model,
      contentLength: content.length,
      maxLength,
      format
    });
    
    metrics.incrementCounter('summary_requests', 1, { model });
    
    // 获取适当的任务处理器
    const task = taskFactory(TaskType.SUMMARIZE, c.env);
    
    // 生成摘要
    const result = await task.execute({
      taskType: TaskType.SUMMARIZE,
      model,
      content,
      maxLength,
      format: format || 'paragraph'
    } as SummaryRequest);
    
    // 记录处理时间
    const duration = timer();
    logger.info('Summary generation completed', { 
      requestId, 
      model, 
      durationMs: duration 
    });
    
    // 返回结果
    const response: ApiResponse<any> = {
      success: true,
      data: result,
      meta: {
        requestId,
        model,
        processedAt: new Date().toISOString(),
        processingTimeMs: duration
      }
    };
    
    return c.json(response);
    
  } catch (error) {
    // 错误由全局错误处理中间件处理
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Summary generation failed: ${errorMessage}`, { requestId }, 
                error instanceof Error ? error : new Error(String(error)));
    metrics.incrementCounter('summary_errors', 1);
    
    throw error;
  }
});

// 聊天端点
modelRouter.post('/chat', zValidator('json', chatSchema), async (c: any) => {
  const logger = getLogger(c.env);
  const metrics = new Metrics(c.env);
  const requestId = c.get('requestId');
  const timer = metrics.startTimer('chat_duration_ms', { requestId });

  try {
    const { messages, model: requestedModel, temperature, maxTokens } = await c.req.json();
    
    // 确定要使用的模型
    const model = requestedModel || getDefaultModelForTask(TaskType.CHAT);
    
    // 验证模型是否支持该任务类型
    if (!validateModelForTask(model, TaskType.CHAT)) {
      throw new ApiError(`Model ${model} does not support chat`, 400);
    }
    
    logger.info('Processing chat request', { 
      requestId, 
      model,
      messagesCount: messages.length,
      firstRole: messages[0]?.role
    });
    
    metrics.incrementCounter('chat_requests', 1, { model });
    
    // 获取适当的任务处理器
    const task = taskFactory(TaskType.CHAT, c.env);
    
    // 执行聊天请求
    const result = await task.execute({
      taskType: TaskType.CHAT,
      model,
      messages,
      temperature,
      maxTokens
    } as ChatRequest);
    
    // 记录处理时间
    const duration = timer();
    logger.info('Chat completed', { 
      requestId, 
      model, 
      durationMs: duration 
    });
    
    // 返回结果
    const response: ApiResponse<any> = {
      success: true,
      data: result,
      meta: {
        requestId,
        model,
        processedAt: new Date().toISOString(),
        processingTimeMs: duration
      }
    };
    
    return c.json(response);
    
  } catch (error) {
    // 错误由全局错误处理中间件处理
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Chat failed: ${errorMessage}`, { requestId }, 
                error instanceof Error ? error : new Error(String(error)));
    metrics.incrementCounter('chat_errors', 1);
    
    throw error;
  }
});