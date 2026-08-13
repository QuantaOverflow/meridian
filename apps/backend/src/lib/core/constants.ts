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

// 简报聚类参数。
// 单一真源:admin 手动触发与 cron 自动触发必须用同一组,否则两条路径产出不可比。
// 注意:auto-brief-generation 里"未传 clusteringOptions"不是走这组值,而是走按数据规模的
// 启发式分支(150 篇时 min_cluster_size 会算到 15),所以调用方必须显式传,不能省略。
export const BRIEF_CLUSTERING_OPTIONS = {
  umapParams: {
    n_neighbors: 15,
    n_components: 5,
    min_dist: 0.1,
    metric: 'cosine',
  },
  hdbscanParams: {
    min_cluster_size: 3,
    min_samples: 1,
    epsilon: 0.5,
  },
} as const;

// 每日定时简报参数。取值来自 2026-08-13 生产实测(report 54/55,端到端 664-897 秒)。
export const CRON_BRIEF_PARAMS = {
  TIME_RANGE_DAYS: 2, // 覆盖前一天全天,与 1 天窗口相比留出抓取延迟的冗余
  ARTICLE_LIMIT: 150,
  MIN_IMPORTANCE: 3,
  MAX_STORIES_TO_GENERATE: 15,
  STORY_MIN_IMPORTANCE: 0.1,
  // 判定"上一次还在跑"的时间窗。单次实测 11-15 分钟,取 2 小时;
  // 超出此窗的 RUNNING 视为崩溃遗留(workflow 挂掉时不会回写终态),否则 cron 会被永久卡死。
  IN_FLIGHT_WINDOW_HOURS: 2,
} as const;