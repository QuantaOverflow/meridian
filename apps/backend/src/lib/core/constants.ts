/**
 * 核心常量定义
 * 统一管理项目中的常量值
 */

// 用户代理字符串配置
export const userAgents = [
  // iOS (发布商的黄金标准)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', // iPhone Safari (最佳整体表现)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.87 Mobile/15E148 Safari/604.1', // iPhone Chrome

  // Android (良好的替代方案)
  'Mozilla/5.0 (Linux; Android 14; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36', // Samsung 旗舰机
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36', // Pixel
];

// 数据库配置常量
export const DATABASE_CONFIG = {
  MAX_CONNECTIONS: 5,
  FETCH_TYPES: false,
} as const;

// API 响应常量
export const API_CONSTANTS = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  MIN_PAGE_SIZE: 1,
} as const;

// 文章处理常量
export const ARTICLE_PROCESSING = {
  CONTENT_MIN_LENGTH: 100,
  TITLE_MIN_LENGTH: 5,
  DEFAULT_TIMEOUT: 30000,
} as const; 