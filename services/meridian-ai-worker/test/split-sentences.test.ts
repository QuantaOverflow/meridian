/**
 * splitSentences 的句界：句末标点后紧跟右引号再接大写开头的下一句，要切开。
 *
 * 2026-09-30 事实核对错误分析：8 期被引文章 24,219 句里有 1,141 句是两句黏成一句
 * （`…period.”Merz, whose…`、`…AfD." Nonetheless, …`）。黏连句当出处时，
 * 一个编号底下是两件事，写作挂错出处、核对也对不上。
 */
import { describe, it, expect } from 'vitest';
import { splitSentences } from '../src/utils/report-v3';

describe('splitSentences 右引号后的句界', () => {
  it('句号 + 右双引号 + 无空格 + 大写，切成两句', () => {
    expect(
      splitSentences('“I want to lead the country out of this difficult period.”Merz cancelled a plan to speak at the UN.')
    ).toEqual(['“I want to lead the country out of this difficult period.”', 'Merz cancelled a plan to speak at the UN.']);
  });

  it('句号 + 直双引号 + 空格 + 大写，切成两句', () => {
    expect(splitSentences('"Voters blame the coalition." Nonetheless, the party held on.')).toEqual([
      '"Voters blame the coalition."',
      'Nonetheless, the party held on.',
    ]);
  });

  it('句号 + 右单引号 + 大写，切成两句', () => {
    expect(splitSentences('He called it ‘a plan.’ It works.')).toEqual(['He called it ‘a plan.’', 'It works.']);
  });

  it('问号 / 叹号 + 右引号也切', () => {
    expect(splitSentences('“Why now?” Officials declined to say.')).toEqual(['“Why now?”', 'Officials declined to say.']);
  });

  it('右引号后接小写，不切（引语在句中）', () => {
    expect(splitSentences('He said “no.” and left the room.')).toEqual(['He said “no.” and left the room.']);
  });

  it('原有行为不变：零空白句界、小数、缩写', () => {
    expect(splitSentences('It rose over trade.But while $3.5bn was pledged, Mr. Smith left.')).toEqual([
      'It rose over trade.',
      'But while $3.5bn was pledged, Mr. Smith left.',
    ]);
  });
});

/**
 * 抓取保留了段落 / 小标题 / 图注之间的换行（apps/backend/src/lib/api/parsers.ts）。
 * 这些行没有句末标点，只靠标点切的话会黏进下一句：2026-10-04 一天 195 篇新闻里 591 句是这样黏的
 * （`Photograph: Antonio Olmos/The ObserverThe author Sheena Patel said: …`、半岛的「Recommended Stories」列表）。
 */
describe('splitSentences 换行是句界', () => {
  it('没有句末标点的图注、小标题各自成句，不黏进下一句', () => {
    expect(
      splitSentences('Photograph: Antonio Olmos/The Observer\nThe author Sheena Patel said it was a mistake.\nWhat happens next\nThe board meets on Monday.')
    ).toEqual([
      'Photograph: Antonio Olmos/The Observer',
      'The author Sheena Patel said it was a mistake.',
      'What happens next',
      'The board meets on Monday.',
    ]);
  });

  it('换行前是缩写、下一段以引号开头，也在换行处切开，引号归下一句', () => {
    expect(splitSentences('Troops returned to the U.S.\n"We are ready," he said.')).toEqual([
      'Troops returned to the U.S.',
      '"We are ready," he said.',
    ]);
  });

  it('连续空行不产生空句', () => {
    expect(splitSentences('First line.\n\n\nSecond line.')).toEqual(['First line.', 'Second line.']);
  });
});
