import { describe, expect, it } from 'vitest';
import { parseArticle } from '../../src/lib/api/parsers';

// 抓取正文：段落、小标题、图注之间要有换行。
// 2026-10-04 一天抓的 418 篇里 323 篇正文只有一行：网页源码是压缩的（标签之间没有空白），
// Readability 的 textContent 把块级元素首尾直接拼在一起，图注、小标题黏进下一句
// （「…last week.Photograph: Antonio Olmos/The ObserverThe union said…」），下游切句切不开。

const page = (body: string) =>
  `<!doctype html><html><head><title>Strike threat at North Sea platform</title></head><body><nav><a href="/">Home</a></nav><article>${body}</article></body></html>`;

describe('parseArticle 正文换行', () => {
  it('压缩源码：段落、图注、小标题、<br>、表格行各占一行', () => {
    const html = page(
      '<h1>Strike threat at North Sea platform</h1>' +
        '<p>A looming strike by oil workers in the North Sea could severely disrupt UK fuel supplies, the Unite union has said, adding that staff were left with no choice after pay talks with the operator broke down last week.</p>' +
        '<figure><img src="a.jpg"><figcaption>Photograph: Antonio Olmos/The Observer</figcaption></figure>' +
        '<p>The union said workers had emphatically backed strike action after being given what it called an unacceptable offer that amounted to a real-terms pay cut for many employees.</p>' +
        '<h2>What happens next</h2>' +
        '<p>The board meets on Monday to consider a revised offer, and a spokesperson said the company had engaged constructively throughout the discussions so far.</p>' +
        '<p>Talks resume on Monday.<br>Both sides declined to comment further.</p>' +
        '<table><tr><th>Grade</th><th>Offer</th></tr><tr><td>Technician</td><td>4%</td></tr></table>'
    );
    expect(parseArticle({ html }).text).toBe(
      [
        'A looming strike by oil workers in the North Sea could severely disrupt UK fuel supplies, the Unite union has said, adding that staff were left with no choice after pay talks with the operator broke down last week.',
        'Photograph: Antonio Olmos/The Observer',
        'The union said workers had emphatically backed strike action after being given what it called an unacceptable offer that amounted to a real-terms pay cut for many employees.',
        'What happens next',
        'The board meets on Monday to consider a revised offer, and a spokesperson said the company had engaged constructively throughout the discussions so far.',
        'Talks resume on Monday.',
        'Both sides declined to comment further.',
        'Grade Offer',
        'Technician 4%',
      ].join('\n')
    );
  });

  // 排版过的源码（个人博客常见）在段落中间按固定宽度折行：那是源码格式，不是段落，
  // 留着的话下游会把一句话从中间切开
  it('源码排版里段落内部的折行与缩进折成一个空格', () => {
    const html = page(`
      <p>
        The board meets on Monday to consider a revised offer, and a
        spokesperson said the company had engaged constructively throughout
        the discussions so far.
      </p>
      <p>
        Talks resume on Monday, with both sides expected to bring new proposals
        on back pay and the rota for offshore staff working on the platform.
      </p>
    `);
    expect(parseArticle({ html }).text).toBe(
      [
        'The board meets on Monday to consider a revised offer, and a spokesperson said the company had engaged constructively throughout the discussions so far.',
        'Talks resume on Monday, with both sides expected to bring new proposals on back pay and the rota for offshore staff working on the platform.',
      ].join('\n')
    );
  });
});
