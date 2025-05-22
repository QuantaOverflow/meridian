import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { Env, TaskType } from '../types';
import { ApiResponse } from '../types';
import { getLogger } from '../utils/logger';
import { getGatewayServices } from '../gateway/serviceFactory';
import { ApiError } from '../utils/errorHandler';
import { Metrics } from '../utils/metrics';

// 请求验证模式
const articleAnalysisSchema = z.object({
  title: z.string().min(1, "标题不能为空"),
  content: z.string().min(1, "内容不能为空"),
  model: z.string().optional(),
  options: z.record(z.any()).optional(),
});

const embeddingSchema = z.object({
  content: z.string().min(1, "内容不能为空"),
  model: z.string().optional(),
  dimensions: z.number().optional(),
});

const summarySchema = z.object({
  content: z.string().min(1, "内容不能为空"),
  model: z.string().optional(),
  maxLength: z.number().optional(),
});

const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.string(),
    content: z.string()
  })).min(1, "至少需要一条消息"),
  model: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
});

// 创建路由器
const gatewayRouter = new Hono<{ Bindings: Env }>();

// 健康检查
gatewayRouter.get('/health', (c) => {
  const logger = getLogger(c.env);
  logger.info('Gateway health check');
  
  return c.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString()
    }
  } as ApiResponse<any>);
});

// 文章分析端点
gatewayRouter.post('/analyze-article', zValidator('json', articleAnalysisSchema), async (c) => {
  const logger = getLogger(c.env);
  const metrics = new Metrics(c.env);
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  const timer = metrics.startTimer('article_analysis_duration_ms', { requestId });
  
  try {
    const { title, content, model, options = {} } = await c.req.json();
    
    logger.info('处理文章分析请求', { 
      requestId, 
      model,
      title_length: title.length, 
      content_length: content.length 
    });
    
    metrics.incrementCounter('article_analysis_requests', 1, { model });
    
    // 使用 Gateway 服务
    const services = getGatewayServices(c.env);
    const result = await services.task.analyzeArticle(title, content, { 
      ...options,
      model
    });
    
    // 记录处理时间
    const duration = timer();
    logger.info('文章分析完成', { 
      requestId, 
      model, 
      durationMs: duration 
    });
    
    // 返回结果
    return c.json({
      success: true,
      data: result,
      meta: {
        requestId,
        model,
        processedAt: new Date().toISOString(),
        processingTimeMs: duration
      }
    } as ApiResponse<any>);
    
  } catch (error) {
    // 错误处理
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`文章分析失败: ${errorMessage}`, { requestId });
    metrics.incrementCounter('article_analysis_errors', 1);
    
    throw error;
  }
});

// 添加其他端点
gatewayRouter.post('/embedding', zValidator('json', embeddingSchema), async (c) => {
  const logger = getLogger(c.env);
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  const timer = new Metrics(c.env).startTimer('embedding_duration_ms', { requestId });
  
  try {
    const { content, model, dimensions } = await c.req.json();
    
    logger.info('处理嵌入向量生成请求', { requestId, model });
    
    // 使用 Gateway 服务
    const services = getGatewayServices(c.env);
    const result = await services.task.generateEmbedding(content, { model, dimensions });
    
    // 记录处理时间
    const duration = timer();
    logger.info('嵌入向量生成完成', { requestId, durationMs: duration });
    
    // 返回结果
    return c.json({
      success: true,
      data: result,
      meta: {
        requestId,
        processedAt: new Date().toISOString(),
        processingTimeMs: duration
      }
    } as ApiResponse<any>);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`嵌入向量生成失败: ${errorMessage}`, { requestId });
    
    // 先设置状态码
    c.status(error instanceof ApiError ? error.statusCode as any : 500);

    // 再返回 JSON
    return c.json({
      success: false,
      error: errorMessage,
      meta: {
        requestId,
        processedAt: new Date().toISOString()
      }
    });
  }
});

gatewayRouter.post('/summarize', zValidator('json', summarySchema), async (c) => {
  const logger = getLogger(c.env);
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  const timer = new Metrics(c.env).startTimer('summary_duration_ms', { requestId });
  
  try {
    const { content, model, maxLength } = await c.req.json();
    
    logger.info('处理文本摘要请求', { requestId, model });
    
    // 使用 Gateway 服务
    const services = getGatewayServices(c.env);
    const result = await services.task.summarize(content, { model, maxLength });
    
    // 记录处理时间
    const duration = timer();
    logger.info('文本摘要完成', { requestId, durationMs: duration });
    
    // 返回结果
    return c.json({
      success: true,
      data: result,
      meta: {
        requestId,
        processedAt: new Date().toISOString(),
        processingTimeMs: duration
      }
    } as ApiResponse<any>);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`文本摘要失败: ${errorMessage}`, { requestId });
    
    // 先设置状态码
    c.status(error instanceof ApiError ? error.statusCode as any : 500);

    // 再返回 JSON
    return c.json({
      success: false,
      error: errorMessage,
      meta: {
        requestId,
        processedAt: new Date().toISOString()
      }
    });
  }
});

gatewayRouter.post('/chat', zValidator('json', chatSchema), async (c) => {
  const logger = getLogger(c.env);
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  const timer = new Metrics(c.env).startTimer('chat_duration_ms', { requestId });
  
  try {
    const { messages, model, temperature } = await c.req.json();
    
    logger.info('处理聊天请求', { requestId, model });
    
    // 使用 Gateway 服务
    const services = getGatewayServices(c.env);
    const result = await services.task.chatCompletion(messages, { model, temperature });
    
    // 记录处理时间
    const duration = timer();
    logger.info('聊天请求处理完成', { requestId, durationMs: duration });
    
    // 返回结果
    return c.json({
      success: true,
      data: result,
      meta: {
        requestId,
        processedAt: new Date().toISOString(),
        processingTimeMs: duration
      }
    } as ApiResponse<any>);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`聊天请求处理失败: ${errorMessage}`, { requestId });
    
    // 先设置状态码
    c.status(error instanceof ApiError ? error.statusCode as any : 500);

    // 再返回 JSON
    return c.json({
      success: false,
      error: errorMessage,
      meta: {
        requestId,
        processedAt: new Date().toISOString()
      }
    });
  }
});

// 测试框架端点保持不变
gatewayRouter.post('/test-framework', async (c) => {
  const logger = getLogger(c.env);
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  
  try {
    const { task, prompt, model, temperature } = await c.req.json();
    
    if (!task) {
      throw new ApiError('必须指定任务类型', 400);
    }
    
    const services = getGatewayServices(c.env);
    let result;
    
    // 测试不同任务类型
    switch (task) {
      case 'analyze':
        result = await services.task.analyzeArticle(
          "测试标题", 
          prompt || "这是测试内容", 
          { model, temperature }
        );
        break;
      case 'summarize':
        result = await services.task.summarize(
          prompt || "这是需要摘要的长文本",
          { model, temperature }
        );
        break;
      case 'embedding':
        result = await services.task.generateEmbedding(
          prompt || "生成嵌入向量的文本",
          { model }
        );
        break;
      case 'chat':
        result = await services.task.chatCompletion(
          [{ role: "user", content: prompt || "你好" }],
          { model, temperature }
        );
        break;
      default:
        throw new ApiError(`不支持的任务类型: ${task}`, 400);
    }
    
    return c.json({
      success: true,
      data: result,
      taskDetails: {
        task,
        model: model || "默认",
        promptLength: (prompt || "").length
      },
      meta: {
        requestId,
        processedAt: new Date().toISOString(),
        framework: "new"
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`框架测试失败: ${errorMessage}`, { requestId });
    
    // 先设置状态码
    c.status(error instanceof ApiError ? error.statusCode as any : 500);

    // 再返回 JSON
    return c.json({
      success: false,
      error: errorMessage,
      meta: {
        requestId,
        processedAt: new Date().toISOString()
      }
    });
  }
});


export { gatewayRouter };