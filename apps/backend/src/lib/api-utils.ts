import type { Context } from 'hono';
import { Logger } from './logger';

// 统一的API响应格式
export type ApiResponse<T = any> = {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: string;
  pagination?: {
    page: number;
    limit: number;
    total?: number;
    hasMore?: boolean;
  };
};

// 创建成功响应
export function createSuccessResponse<T>(
  data: T, 
  message?: string, 
  pagination?: ApiResponse['pagination']
): ApiResponse<T> {
  return {
    success: true,
    data,
    message,
    pagination,
    timestamp: new Date().toISOString()
  };
}

// 创建错误响应
export function createErrorResponse(error: string, statusCode?: number): ApiResponse {
  return {
    success: false,
    error,
    timestamp: new Date().toISOString()
  };
}

// 通用错误处理器
export function handleDatabaseError(
  error: unknown, 
  operation: string, 
  logger: Logger,
  context?: Record<string, any>
): { error: string; statusCode: number } {
  const err = error instanceof Error ? error : new Error(String(error));
  
  logger.error(`${operation} failed`, { 
    error_message: err.message,
    ...context 
  }, err);

  // 根据错误类型返回适当的状态码
  if (err.message.includes('unique constraint') || err.message.includes('duplicate')) {
    return { error: 'Resource already exists', statusCode: 409 };
  }
  
  if (err.message.includes('not found') || err.message.includes('no such')) {
    return { error: 'Resource not found', statusCode: 404 };
  }
  
  if (err.message.includes('permission') || err.message.includes('unauthorized')) {
    return { error: 'Unauthorized', statusCode: 401 };
  }

  return { error: 'Internal server error', statusCode: 500 };
}

// 分页参数验证和处理
export function processPaginationParams(c: Context, maxLimit = 100) {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(maxLimit, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
  const offset = (page - 1) * limit;
  
  return { page, limit, offset };
}

// 通用的资源存在性检查
export async function checkResourceExists<T>(
  queryFn: () => Promise<T | undefined>,
  resourceName: string,
  logger: Logger,
  context?: Record<string, any>
): Promise<{ exists: boolean; resource?: T; error?: { message: string; statusCode: number } }> {
  try {
    const resource = await queryFn();
    
    if (resource === undefined) {
      logger.warn(`${resourceName} not found`, context);
      return { 
        exists: false, 
        error: { message: `${resourceName} not found`, statusCode: 404 } 
      };
    }
    
    return { exists: true, resource };
  } catch (error) {
    const { error: errorMsg, statusCode } = handleDatabaseError(
      error, 
      `Check ${resourceName} existence`, 
      logger, 
      context
    );
    return { exists: false, error: { message: errorMsg, statusCode } };
  }
}

// 日期范围验证
export function validateDateRange(dateFrom?: string, dateTo?: string) {
  const from = dateFrom ? new Date(dateFrom) : undefined;
  const to = dateTo ? new Date(dateTo) : undefined;
  
  if (from && isNaN(from.getTime())) {
    throw new Error('Invalid dateFrom format');
  }
  
  if (to && isNaN(to.getTime())) {
    throw new Error('Invalid dateTo format');
  }
  
  if (from && to && from > to) {
    throw new Error('dateFrom cannot be after dateTo');
  }
  
  return { from, to };
}

// 通用的中间件：统一错误处理
export function withErrorHandling(
  handler: (c: Context) => Promise<Response>
) {
  return async (c: Context) => {
    try {
      return await handler(c);
    } catch (error) {
      const logger = new Logger({ route: c.req.path });
      const { error: errorMsg, statusCode } = handleDatabaseError(
        error,
        'Request processing',
        logger,
        { 
          method: c.req.method,
          path: c.req.path,
          query: c.req.query()
        }
      );
      
      return c.json(createErrorResponse(errorMsg), statusCode as any);
    }
  };
} 