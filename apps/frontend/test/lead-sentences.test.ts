import { describe, expect, it } from 'vitest';
import { leadSentences } from '../src/lib/briefMap';

// 首页卡片的导语 = 正文块导语的前两句。原先按「句末标点 + 空白」硬切，「U.S.」「Mr.」处会提前截断。
describe('leadSentences：取前两句', () => {
  it('普通的三句取前两句，去掉标签、还原实体', () => {
    expect(leadSentences('<p>Talks resumed in Cairo. Aid trucks queued at Rafah &amp; Kerem Shalom. A third line.</p>')).toBe(
      'Talks resumed in Cairo. Aid trucks queued at Rafah & Kerem Shalom.'
    );
  });

  it('U.S. / U.K. 这类缩写不是句末', () => {
    expect(leadSentences('<p>U.S. officials met U.K. envoys in Geneva. Talks ended without a deal. More followed.</p>')).toBe(
      'U.S. officials met U.K. envoys in Geneva. Talks ended without a deal.'
    );
  });

  it('缩写后面接大写词（U.S. President）也不断句', () => {
    expect(leadSentences('<p>The U.S. President met E.U. leaders. A deal followed. Markets rose.</p>')).toBe(
      'The U.S. President met E.U. leaders. A deal followed.'
    );
  });

  it('称谓缩写（Mr. / Dr. / Gen.）与姓名首字母不是句末', () => {
    expect(leadSentences('<p>Mr. Smith and Gen. J. Doe arrived. Dr. Lee spoke first. Then lunch.</p>')).toBe(
      'Mr. Smith and Gen. J. Doe arrived. Dr. Lee spoke first.'
    );
  });

  it('句末标点后面跟右引号也是句末', () => {
    expect(leadSentences('<p>He said “we will win.” Then he left. Nobody followed.</p>')).toBe('He said “we will win.” Then he left.');
  });

  it('括号里的感叹号不是句末（109 期真实导语）', () => {
    expect(leadSentences('<p>Trump spoke. He said AI needs a “STRONG AND SMART (High IQ!) PRESIDENT” for control. Xi disagreed.</p>')).toBe(
      'Trump spoke. He said AI needs a “STRONG AND SMART (High IQ!) PRESIDENT” for control.'
    );
  });

  it('下一个词小写开头不是新句（小数、缩写后接普通词）', () => {
    expect(leadSentences('<p>Prices rose 3.5 percent in the U.S. last month. Analysts expected less. Stocks fell.</p>')).toBe(
      'Prices rose 3.5 percent in the U.S. last month. Analysts expected less.'
    );
  });
});
