import { Env } from '../types';

/**
 * 日志级别枚举
 */
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * 日志接口
 */
export interface Logger {
  debug(message: string, data?: Record<string, any>): void;
  info(message: string, data?: Record<string, any>): void;
  warn(message: string, data?: Record<string, any>): void;
  error(message: string, data?: Record<string, any>, error?: Error): void;
}

/**
 * 解析日志级别字符串
 */
function parseLogLevel(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case 'debug':
      return LogLevel.DEBUG;
    case 'info':
      return LogLevel.INFO;
    case 'warn':
      return LogLevel.WARN;
    case 'error':
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}

/**
 * 创建日志记录器
 */
export function getLogger(env: Env): Logger {
  const configLevel = parseLogLevel(env.LOG_LEVEL || 'info');

  const formatLog = (level: string, message: string, data?: Record<string, any>, error?: Error) => {
    const timestamp = new Date().toISOString();
    const log = {
      timestamp,
      level,
      message,
      ...data,
      environment: env.ENVIRONMENT || 'unknown',
    };

    if (error) {
      log['error'] = {
        message: error.message,
        stack: error.stack,
        name: error.name,
      };
    }

    return JSON.stringify(log);
  };

  return {
    debug(message: string, data?: Record<string, any>): void {
      if (configLevel <= LogLevel.DEBUG) {
        console.debug(formatLog('debug', message, data));
      }
    },

    info(message: string, data?: Record<string, any>): void {
      if (configLevel <= LogLevel.INFO) {
        console.info(formatLog('info', message, data));
      }
    },

    warn(message: string, data?: Record<string, any>): void {
      if (configLevel <= LogLevel.WARN) {
        console.warn(formatLog('warn', message, data));
      }
    },

    error(message: string, data?: Record<string, any>, error?: Error): void {
      if (configLevel <= LogLevel.ERROR) {
        console.error(formatLog('error', message, data, error));
      }
    },
  };
}