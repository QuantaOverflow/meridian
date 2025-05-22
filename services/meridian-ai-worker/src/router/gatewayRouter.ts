import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { Env } from '../types';
import { ApiResponse } from '../types';
import { getLogger } from '../utils/logger';
import { getGatewayServices } from '../gateway/serviceFactory';
import { ApiError } from '../utils/errorHandler';
import { AIGatewayClient } from '../gateway/aiGatewayClient';

// 请求验证模式
const articleAnalysisSchema = z.object({
  title: z.string().min(1, "标题不能为空"),
  content: z.string().min(1, "内容不能为空"),
  options: z.object({
    model: z.string().optional(),
    temperature: z.number().min(0).max(1).optional(),
  }).optional(),
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
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  
  try {
    // 验证 Gateway 配置
    if (!c.env.AI_GATEWAY_TOKEN || !c.env.AI_GATEWAY_URL) {
      throw new ApiError('AI Gateway 未配置', 500);
    }
    
    logger.info('Processing article analysis via Gateway', { requestId });
    
    const { title, content, options = {} } = await c.req.json();
    
    // 使用 Gateway 服务
    const services = getGatewayServices(c.env);
    const startTime = Date.now();
    const result = await services.task.analyzeArticle(title, content, options);
    const duration = Date.now() - startTime;
    
    logger.info('Gateway article analysis completed', { 
      requestId, 
      durationMs: duration,
      modelInfo: options.model || 'default' 
    });
    
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
    // 错误处理
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Gateway article analysis failed: ${errorMessage}`, { requestId }, 
                error instanceof Error ? error : new Error(String(error)));
    
    throw error;
  }
});

// // 摘要端点
// gatewayRouter.post('/summarize', async (c) => {
//   const logger = getLogger(c.env);
//   const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  
//   try {
//     const { content, maxLength, format, options = {} } = await c.req.json();
    
//     if (!content) {
//       throw new ApiError('内容不能为空', 400);
//     }
    
//     // 使用 Gateway 服务
//     const services = getGatewayServices(c.env);
//     const startTime = Date.now();
//     const result = await services.task.summarize(content, {
//       ...options,
//       maxLength,
//       format
//     });
//     const duration = Date.now() - startTime;
    
//     logger.info('Gateway summary completed', { 
//       requestId, 
//       durationMs: duration
//     });
    
//     return c.json({
//       success: true,
//       data: result,
//       meta: {
//         requestId,
//         processedAt: new Date().toISOString(),
//         processingTimeMs: duration
//       }
//     } as ApiResponse<any>);
    
//   } catch (error) {
//     const errorMessage = error instanceof Error ? error.message : 'Unknown error';
//     logger.error(`Gateway summary failed: ${errorMessage}`, { requestId });
//     throw error;
//   }
// });

// 添加简单的Gateway直接测试端点
gatewayRouter.post('/direct-test', async (c) => {
  const logger = getLogger(c.env);
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  
  try {
    // 创建最简单的请求
    const client = new AIGatewayClient(c.env);
    
    // 记录环境变量状态（敏感信息打码）
    logger.info('Gateway 配置信息', {
      url: c.env.AI_GATEWAY_URL ? '已配置' : '未配置',
      token: c.env.AI_GATEWAY_TOKEN ? '已配置' : '未配置',
      account_id: c.env.AI_GATEWAY_ACCOUNT_ID || '未配置',
      name: c.env.AI_GATEWAY_NAME || '未配置'
    });
    
    // 尝试简单的请求
    logger.info('发送简单的 Gateway 测试请求');
    const response = await client.request(
      'openai',
      'v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Say hello in one word' }],
        temperature: 0,
        max_tokens: 10
      },
      {}
    );
    
    logger.info('Direct Gateway test completed', { requestId });
    
    return c.json({
      success: true,
      data: response,
      meta: {
        requestId,
        processedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    // 更详细的错误处理
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Direct Gateway test failed: ${errorMessage}`, { requestId });
    
    // 返回具体错误而不是500
    return c.json({
      success: false,
      error: errorMessage,
      meta: {
        requestId,
        processedAt: new Date().toISOString()
      }
    }, 400);
  }
});

export { gatewayRouter };