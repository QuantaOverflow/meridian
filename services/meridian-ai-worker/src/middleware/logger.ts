import { MiddlewareHandler } from 'hono';
import { Env } from '../types';
import { getLogger } from '../utils/logger';

/**
 * 日志中间件
 * 记录请求和响应信息
 */
export const logger = (): MiddlewareHandler<{
  Bindings: Env;
  Variables: {
    requestId: string;
  };
}> => {
  return async (c, next) => {
    const logger = getLogger(c.env);
    const method = c.req.method;
    const url = c.req.url;
    const startTime = Date.now();
    const requestId = crypto.randomUUID();

    // 在请求对象中添加 requestId，供后续处理使用
    c.set('requestId', requestId);
    
    logger.info(`Request started`, {
      method,
      url,
      requestId,
      path: new URL(url).pathname,
    });

    try {
      await next();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Request failed`, {
        method,
        url,
        requestId,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }

    // 获取响应状态
    const status = c.res.status;
    const durationMs = Date.now() - startTime;

    if (status >= 400) {
      logger.warn(`Request completed with error`, {
        method,
        url,
        requestId,
        status,
        durationMs,
      });
    } else {
      logger.info(`Request completed`, {
        method,
        url,
        requestId,
        status,
        durationMs,
      });
    }
  };
};