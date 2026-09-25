import { describe, expect, it } from 'vitest';
import { parseBriefContent } from '../src/server/lib/briefContent';

// 生产第 106 期（2026-09-25）的结构：backend brief-v3 分 top stories 4 / more news 10 / in brief 其余
const V3_BRIEF = [
  '## top stories',
  ...['trump-xi summit', 'netanyahu un speech', 'saudi arabia houthis', 'openai agent hack'].flatMap(t => [
    `<u>**${t}**</u>`,
    'Body sentence.',
  ]),
  '## more news',
  '<u>**white house press access dispute**</u>',
  'Body sentence.',
  '## in brief',
  '<u>**nepal pm un climate warning**</u>',
  'Body sentence.',
].join('\n');

const headlineTitles = (content: string) =>
  parseBriefContent(content)
    .sections.flatMap(s => s.stories)
    .filter(s => s.headline)
    .map(s => s.title);

describe('parseBriefContent 头条', () => {
  it('跟 backend 分层走：top stories 一节全部是头条，其余节不是', () => {
    expect(headlineTitles(V3_BRIEF)).toEqual([
      'trump-xi summit',
      'netanyahu un speech',
      'saudi arabia houthis',
      'openai agent hack',
    ]);
  });
});

describe('parseBriefContent 头条：分层之前的历史期', () => {
  it('没有 top stories 一节时，仍按排在最前的 2 条（历史期显示不变）', () => {
    const legacy = ['## global landscape', ...['a', 'b', 'c'].flatMap(t => [`<u>**${t}**</u>`, 'Body.'])].join('\n');
    expect(headlineTitles(legacy)).toEqual(['a', 'b']);
  });
});
