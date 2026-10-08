/**
 * 简报正文拼装（renderBriefV3）：块标题原样保留大小写。
 *
 * 2026-10-01 取消「标题全小写」的 house style：小写把 US / AI / OpenAI 这类缩写和专名吃坏
 * （读者端 "us troops"、浏览器翻译成「Openai」），而 v6 起的标题本来就是规整的句首大写。
 */
import { describe, expect, it } from 'vitest';
import { briefBlockDrafts, renderBriefV3 } from '../../src/lib/core/brief-v3';

describe('renderBriefV3 块标题大小写', () => {
  it('缩写与专名原样保留', () => {
    const { content } = renderBriefV3([
      { title: 'Tech CEOs sign AI self-regulation accord with Trump', text: 'Body.', tier: 'lead' },
      { title: 'Man killed by NYC subway train', text: 'Body.', tier: 'brief' },
    ]);
    expect(content).toContain('<u>**Tech CEOs sign AI self-regulation accord with Trump**</u>');
    expect(content).toContain('<u>**Man killed by NYC subway train**</u>');
  });

  it('只去首尾空白', () => {
    const { content } = renderBriefV3([{ title: '  US troops complete Iraq withdrawal  ', text: 'Body.', tier: 'more' }]);
    expect(content).toContain('<u>**US troops complete Iraq withdrawal**</u>');
  });
});

describe('briefBlockDrafts 落库的简报块', () => {
  const written = [
    { storyId: 11, title: '  Ceasefire talks resume ', text: ' Negotiators met in Doha.\nA second round is set for Friday. ', tier: 'lead' as const },
    { storyId: 12, title: 'Rates held', text: 'The central bank kept rates unchanged.', tier: 'more' as const },
    { storyId: 13, title: 'Ferry service back', text: 'Two ferries resumed service.', tier: 'brief' as const },
  ];

  it('每块的标题与正文就是读者页正文里的那一段，顺序即期内顺序', () => {
    const drafts = briefBlockDrafts(written);
    expect(drafts).toEqual([
      { storyId: 11, tier: 'lead', position: 0, title: 'Ceasefire talks resume', body: 'Negotiators met in Doha.\nA second round is set for Friday.' },
      { storyId: 12, tier: 'more', position: 1, title: 'Rates held', body: 'The central bank kept rates unchanged.' },
      { storyId: 13, tier: 'brief', position: 2, title: 'Ferry service back', body: 'Two ferries resumed service.' },
    ]);
    const { content } = renderBriefV3(written);
    for (const d of drafts) expect(content).toContain(`<u>**${d.title}**</u>\n${d.body}`);
  });

  it('对不上故事的块、没有正文的块不落库，但仍占位（position 与地图的 blockIndex 同口径）', () => {
    const drafts = briefBlockDrafts([
      { ...written[0], storyId: null },
      { ...written[1], text: '  ' },
      written[2],
    ]);
    expect(drafts).toEqual([{ storyId: 13, tier: 'brief', position: 2, title: 'Ferry service back', body: 'Two ferries resumed service.' }]);
  });
});
