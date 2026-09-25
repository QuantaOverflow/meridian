import { Logger } from '../core/logger';

// 统一的API响应格式
export type ApiResponse<T = any> = {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: string;
};

// 创建成功响应
export function createSuccessResponse<T>(
  data: T, 
  message?: string
): ApiResponse<T> {
  return {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString()
  };
}

// 创建错误响应
export function createErrorResponse(error: string): ApiResponse {
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
  logger: Logger
): { error: string; statusCode: number } {
  const err = error instanceof Error ? error : new Error(String(error));
  
  logger.error(`${operation} failed`, { error_message: err.message }, err);

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