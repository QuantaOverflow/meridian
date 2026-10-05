import { describe, expect, it } from 'vitest';
import { countBodyLines } from '../../src/lib/core/extraction-quality';

// 没有现成的 seam 能驱动 processArticles workflow（它 import cloudflare:workers，现有测试都不碰），
// 所以直接测 workflow 写入 body_lines 所用的计数函数。
describe('countBodyLines', () => {
  it('多段正文按非空行数计，空行与纯空白行不算', () => {
    const text = '标题段\n\n第一段正文。\n   \n第二段正文。\n\n\n图注一行\n';
    expect(countBodyLines(text)).toBe(4);
  });

  it('糊成一行的正文记 1', () => {
    expect(countBodyLines('Para one. Para two. Para three. Para four.')).toBe(1);
  });
});
