/**
 * 核心工具函数
 * 提供项目中通用的工具函数
 */

import { Context } from 'hono';
import { HonoEnv } from '../../app';
import type { ArticleAnalysis } from '@meridian/contracts';

/**
 * 检查请求是否有有效的认证令牌
 *
 * 恒定时间比较（Cloudflare Workers 最佳实践）：普通 `!==` 在第一个不同的字符处就返回，
 * 响应时间会泄露 token 猜对了几位。两边先各取 SHA-256 定长，再 timingSafeEqual——
 * 定长也避免泄露 token 的长度。
 */
export async function hasValidAuthToken(c: Context<HonoEnv>): Promise<boolean> {
  // API_TOKEN 没配时必须拒绝：否则模板串出来是字面量 "Bearer undefined",
  // 等于把一个可猜到的令牌当成有效凭据放行。
  if (!c.env.API_TOKEN) {
    return false;
  }
  const auth = c.req.header('Authorization');
  if (auth === undefined) {
    return false;
  }
  const encoder = new TextEncoder();
  const [provided, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(auth)),
    crypto.subtle.digest('SHA-256', encoder.encode(`Bearer ${c.env.API_TOKEN}`)),
  ]);
  return crypto.subtle.timingSafeEqual(provided, expected);
}

/** 读第三方响应体（RSS、文章网页）的上限。正常的 feed 与网页远小于它，又远低于 Worker 的 128MB 内存上限。 */
export const MAX_FETCHED_BODY_BYTES = 10 * 1024 * 1024;

/**
 * 按 UTF-8 读响应体，超过 maxBytes 就中止读取并抛错。
 * 取代直接 `response.text()`：那会把任意大小的第三方响应整个读进内存（Workers 最佳实践：
 * 不对大小未知的响应体 await .text()）。
 */
export async function readTextCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response body exceeds ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * 生成文章搜索文本
 * 从文章分析数据中提取关键信息，生成用于搜索的文本
 */
export function generateSearchText(data: ArticleAnalysis & { title: string }): string {
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