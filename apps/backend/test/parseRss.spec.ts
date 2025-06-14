import { describe, it, expect } from 'vitest';
import { parseRSSFeed } from '../src/lib/parsers';
import { fixtures } from './fixtures';

describe('parseRssFeed', () => {
  it('handles independant.co.uk feed', async () => {
    const result = await parseRSSFeed(fixtures.independant_co_uk);

    expect(result.length).toBeGreaterThan(0);
    
    // 检查第一个项目的基本结构
    expect(result[0]).toHaveProperty('title');
    expect(result[0]).toHaveProperty('link');
    expect(result[0]).toHaveProperty('pubDate');
    
    // 检查具体内容
    expect(result[0].title).toContain('Trump makes good on promise');
    expect(result[0].link).toContain('independent.co.uk');
    expect(result[0].pubDate).toBeInstanceOf(Date);
  });

  it('handles cn.nytimes.com feed', async () => {
    const result = await parseRSSFeed(fixtures.cn_nytimes_com);

    expect(result.length).toBeGreaterThan(0);

    // 检查第一个项目
    expect(result[0].title).toContain('Facebook');
    expect(result[0].link).toContain('cn.nytimes.com');
    expect(result[0].pubDate).toBeInstanceOf(Date);
  });

  it('handles ft.com feed', async () => {
    const result = await parseRSSFeed(fixtures.ft_com);

    expect(result.length).toBeGreaterThan(0);

    expect(result[0].title).toContain('Trump');
    expect(result[0].link).toContain('ft.com');
    expect(result[0].pubDate).toBeInstanceOf(Date);
  });

  it('handles theverge.com feed (Atom format)', async () => {
    const result = await parseRSSFeed(fixtures.theverge_com);

    expect(result.length).toBeGreaterThan(0);

    expect(result[0].title).toContain('Boeing Starliner');
    expect(result[0].link).toContain('theverge.com');
    expect(result[0].pubDate).toBeInstanceOf(Date);
  });

  it('handles malformed RSS gracefully', async () => {
    const malformedXml = "Not a valid RSS feed";
    
    // parseRSSFeed 可能返回空数组而不是抛出错误
    const result = await parseRSSFeed(malformedXml);
    expect(Array.isArray(result)).toBe(true);
    // 对于恶意输入，应该返回空数组或抛出错误
    expect(result.length).toBe(0);
  });

  it('handles empty RSS feed', async () => {
    const emptyXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty Feed</title>
    <description>An empty RSS feed</description>
    <link>https://example.com</link>
  </channel>
</rss>`;
    
    const result = await parseRSSFeed(emptyXml);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});
