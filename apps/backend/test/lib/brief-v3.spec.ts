/**
 * 简报正文拼装（renderBriefV3）：块标题原样保留大小写。
 *
 * 2026-10-01 取消「标题全小写」的 house style：小写把 US / AI / OpenAI 这类缩写和专名吃坏
 * （读者端 "us troops"、浏览器翻译成「Openai」），而 v6 起的标题本来就是规整的句首大写。
 */
import { describe, expect, it } from 'vitest';
import { renderBriefV3 } from '../../src/lib/core/brief-v3';

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
