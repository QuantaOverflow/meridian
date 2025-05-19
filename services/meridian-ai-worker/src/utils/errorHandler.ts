import { MiddlewareHandler } from 'hono';
import { Env } from '../types';
import { getLogger } from './logger';

/**
 * 自定义 API 错误类
 */
export class ApiError extends Error {
  statusCode: number;
  
  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

// 添加到 utils/errorHandler.ts
export class UnsupportedModelFeatureError extends ApiError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'UnsupportedModelFeatureError';
  }
}

/**
 * 全局错误处理中间件
 * 捕获所有未处理的异常，转换为标准格式的 JSON 响应
 */
export const errorHandler = (): MiddlewareHandler<{
  Bindings: Env;
  Variables: {
    requestId: string;
  };
}> => {
  return async (c, next) => {
    const logger = getLogger(c.env);
    
    try {
      await next();
    } catch (error) {
      const requestId = c.get('requestId') || 'unknown';
      
      // 获取错误信息和状态码
      let message = 'Internal server error';
      let statusCode = 500;
      
      if (error instanceof ApiError) {
        message = error.message;
        statusCode = error.statusCode;
      } else if (error instanceof Error) {
        message = error.message;
      }
      
      // 记录错误日志
      logger.error(`Uncaught error: ${message}`, {
        requestId,
        path: new URL(c.req.url).pathname,
        statusCode,
      }, error instanceof Error ? error : new Error(String(error)));
      
      // 返回标准格式的错误响应
      return c.json({
        success: false,
        error: message,
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        }
      }, statusCode as any);
    }
  };
};