import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { Env, TaskType, ApiResponse } from '../types';
import { getLogger } from '../utils/logger';
import { Metrics } from '../utils/metrics';
import { ApiError } from '../utils/errorHandler';
import { modelRegistry } from '../config/modelRegistry';

// 创建路由器实例
export const modelRouter = new Hono<{ Bindings: Env }>();

// 获取可用模型信息端点
modelRouter.get('/models', async (c: any) => {
  const logger = getLogger(c.env);
  logger.info('Retrieving available models');
  
  try {
    // 使用新的模型注册表获取模型信息
    const modelInfo = Array.from(modelRegistry.getModelsForTask(TaskType.ARTICLE_ANALYSIS))
      .map(config => ({
        id: config.name,
        provider: config.provider,
        capabilities: config.supportedTasks,
        contextWindow: config.contextWindow,
        defaultForTask: config.defaultForTask,
      }));
    
    // 返回默认模型信息和所有可用模型
    return c.json({
      success: true,
      data: {
        models: modelInfo,
        defaultModels: {
          [TaskType.ARTICLE_ANALYSIS]: modelRegistry.getDefaultModelForTask(TaskType.ARTICLE_ANALYSIS)?.name,
          [TaskType.EMBEDDING]: modelRegistry.getDefaultModelForTask(TaskType.EMBEDDING)?.name,
          [TaskType.SUMMARIZE]: modelRegistry.getDefaultModelForTask(TaskType.SUMMARIZE)?.name,
          [TaskType.CHAT]: modelRegistry.getDefaultModelForTask(TaskType.CHAT)?.name,
        },
      },
    } as ApiResponse<any>);
  } catch (error) {
    logger.error('Failed to retrieve model information', {}, 
                error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});

// 健康检查端点
modelRouter.get('/health', (c: any) => {
  return c.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString()
    }
  } as ApiResponse<any>);
});

// 系统状态端点
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

// 保留验证模式
const articleAnalysisSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  model: z.string().optional(),
  schema: z.record(z.any()).optional(),
  promptTemplate: z.string().optional(),
});

// 其他验证模式保持不变...

// 将API调用重定向到gatewayRouter处理
modelRouter.post('/analyze', async (c: any) => {
  // 转发到 gatewayRouter
  return await c.req.fetch(
    new Request(`${new URL(c.req.url).origin}/api/gateway/analyze-article`, {
      method: 'POST',
      headers: c.req.headers,
      body: c.req.raw.body
    })
  );
});

modelRouter.post('/embedding', async (c: any) => {
  // 转发到 gatewayRouter
  return await c.req.fetch(
    new Request(`${new URL(c.req.url).origin}/api/gateway/embedding`, {
      method: 'POST',
      headers: c.req.headers,
      body: c.req.raw.body
    })
  );
});

modelRouter.post('/summarize', async (c: any) => {
  // 转发到 gatewayRouter
  return await c.req.fetch(
    new Request(`${new URL(c.req.url).origin}/api/gateway/summarize`, {
      method: 'POST',
      headers: c.req.headers,
      body: c.req.raw.body
    })
  );
});

modelRouter.post('/chat', async (c: any) => {
  // 转发到 gatewayRouter
  return await c.req.fetch(
    new Request(`${new URL(c.req.url).origin}/api/gateway/chat`, {
      method: 'POST',
      headers: c.req.headers,
      body: c.req.raw.body
    })
  );
});