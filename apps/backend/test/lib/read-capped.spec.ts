/**
 * 读第三方响应体（RSS、文章网页）时的大小上限。Worker 内存上限 128MB，
 * 不设上限的 response.text() 遇到超大页面会把整个请求打爆。
 */
import { describe, expect, it } from 'vitest';
import { readTextCapped } from '../../src/lib/core/utils';

describe('readTextCapped', () => {
  it('不超上限：原样返回文本（UTF-8，与 response.text() 相同）', async () => {
    const body = '<rss>新闻 · news</rss>';
    expect(await readTextCapped(new Response(body), 1024)).toBe(body);
  });

  it('恰好等于上限：放行', async () => {
    const body = 'a'.repeat(64);
    expect(await readTextCapped(new Response(body), 64)).toBe(body);
  });

  it('超过上限：抛错并写明上限，不把整个响应读进内存', async () => {
    await expect(readTextCapped(new Response('a'.repeat(65)), 64)).rejects.toThrow(/64 bytes/);
  });

  it('没有响应体：空串', async () => {
    expect(await readTextCapped(new Response(null), 64)).toBe('');
  });
});
