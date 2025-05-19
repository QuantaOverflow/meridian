import { MiddlewareHandler } from 'hono';
import { Env } from '../types';

/**
 * 身份验证中间件
 * 验证请求头中的 Authorization Bearer 令牌
 */
export const auth = (): MiddlewareHandler<{
  Bindings: Env;
}> => {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization');
    
    if (!authHeader) {
      return c.json({
        success: false,
        error: 'Authorization header missing'
      }, 401);
    }
    
    const token = authHeader.replace(/^Bearer\s+/, '');
    
    if (token !== c.env.API_AUTH_KEY) {
      return c.json({
        success: false,
        error: 'Invalid API key'
      }, 401);
    }
    
    // 通过验证，继续处理请求
    await next();
  };
};