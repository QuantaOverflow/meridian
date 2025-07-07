/**
 * 数据库模块
 * 统一管理数据库连接和相关工具函数
 */

import { getDb as getDbFromDatabase } from '@meridian/database';
import { DATABASE_CONFIG } from '../core/constants';

/**
 * 获取数据库连接实例
 * 配置为Cloudflare Workers环境优化
 */
export function getDb(hyperdrive: Hyperdrive) {
  return getDbFromDatabase(hyperdrive.connectionString, {
    // Workers限制并发外部连接数量，因此要确保限制postgres.js可能建立的本地连接池大小
    max: DATABASE_CONFIG.MAX_CONNECTIONS,

    // 如果您的Postgres schema中没有使用数组类型，
    // 禁用此选项将为您节省每次连接时的额外往返行程
    fetch_types: DATABASE_CONFIG.FETCH_TYPES,
  });
} 