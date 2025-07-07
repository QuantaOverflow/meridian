/**
 * 核心工具函数
 * 提供项目中通用的工具函数
 */

import { z } from 'zod';
import { Context } from 'hono';
import { HonoEnv } from '../../app';
import { articleAnalysisSchema } from '../../prompts/articleAnalysis.prompt';
import { userAgents } from './constants';

/**
 * 检查请求是否有有效的认证令牌
 */
export function hasValidAuthToken(c: Context<HonoEnv>) {
  const auth = c.req.header('Authorization');
  if (auth === undefined || auth !== `Bearer ${c.env.API_TOKEN}`) {
    return false;
  }
  return true;
}

/**
 * 生成文章搜索文本
 * 从文章分析数据中提取关键信息，生成用于搜索的文本
 */
export function generateSearchText(data: z.infer<typeof articleAnalysisSchema> & { title: string }): string {
  // 辅助函数：安全地连接字符串数组，过滤空值
  const joinSafely = (arr: string[] | null | undefined): string =>
    (arr ?? [])
      .map(s => s?.trim())
      .filter(Boolean)
      .join(' ');

  // 处理摘要点：修剪、过滤空值、确保句号、连接
  const summary = (data.event_summary_points ?? [])
    .map(p => p?.trim() ?? '') // 先修剪
    .filter(p => p !== '') // 移除空值 *在* 修剪之后
    .map(p => (p.endsWith('.') ? p : `${p}.`)) // 如果需要添加句号
    .join(' '); // 用空格连接

  // 简单处理其他文本数组
  const keywords = joinSafely(data.thematic_keywords);
  const tags = joinSafely(data.topic_tags);
  const entities = joinSafely(data.key_entities);
  const focus = joinSafely(data.content_focus);

  // 处理位置：清理，移除通用占位符
  let location = data.primary_location?.trim() ?? '';
  const nonSpecificLocations = ['GLOBAL', 'WORLD', '', 'NONE', 'N/A'];
  if (nonSpecificLocations.includes(location.toUpperCase())) {
    location = ''; // 如果是通用的则丢弃
  }

  // 安全获取标题
  const title = data.title?.trim() ?? '';

  // --- 构建最终字符串 ---

  // 创建需要连接的部分数组
  const parts = [
    title,
    location, // 只有在特定且非空时才包含
    summary,
    entities,
    keywords,
    tags,
    focus,
  ]
    .filter(Boolean) // filter(Boolean) 移除空字符串、null、undefined
    .map(part => part.trim())
    .filter(part => part !== '');

  // 用句号和空格连接部分，但只有当部分不以句号结尾时
  let combined = '';
  parts.forEach((part, index) => {
    // 第一部分没有前导分隔符
    if (index === 0) {
      combined = part;
    } else {
      // 只有当前面的部分不以句号结尾时，才在下一部分前添加句号
      if (combined.endsWith('.')) {
        combined += ' ' + part;
      } else {
        combined += '. ' + part;
      }
    }
  });

  // 确保最终字符串以句号结尾（如果包含文本）
  if (combined && !combined.endsWith('.')) {
    combined += '.';
  }

  return combined;
}

/**
 * 简单的异步错误包装器，在错误时返回null而不是抛出异常
 * @param asyncFn 要执行的Promise
 * @returns 结果或在错误发生时返回null
 */
export async function safeAsync<T>(asyncFn: Promise<T>): Promise<T | null> {
  try {
    return await asyncFn;
  } catch (error) {
    return null;
  }
}

/**
 * 获取随机用户代理字符串
 */
export function getRandomUserAgent(): string {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

/**
 * 清理字符串：移除多余空格、换行等
 */
export function cleanString(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ') // 折叠空格/制表符
    .replace(/\n\s+/g, '\n') // 清理换行后的空格
    .replace(/\s+\n/g, '\n') // 清理换行前的空格
    .replace(/\n{3,}/g, '\n\n') // 保持最多2个连续换行
    .trim(); // 清理边缘
}

/**
 * 清理URL：移除跟踪参数
 */
export function cleanUrl(url: string): string {
  const u = new URL(url);
  const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
  paramsToRemove.forEach(param => u.searchParams.delete(param));
  return u.toString();
} 