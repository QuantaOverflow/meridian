/**
 * repairCitations 的实词补出处：句子里有 ≥2 个实词不在所引原句里，就从材料池补一条
 * 覆盖其中 ≥3 个的原句；只补不删，一句最多补一条。
 *
 * 2026-09-30 事实核对错误分析：100 块里 29 块「出处挂错」（事实为真、引用指向了别的句），
 * 其中 30/35 条正确原句就在写作材料里，是模型挂出处时指偏了。数字/引语补出处管不到这些。
 */
import { describe, it, expect } from 'vitest';
import { repairCitations, type SentenceTable, type V6Source } from '../src/utils/brief-block-v6';

const TABLE: SentenceTable = {
  '1': [
    'The court ruled on Friday that the database could be used.',
    'Critics warned the ruling could lead to valid voters being removed from rolls.',
  ],
  '2': [
    'FBI special agent Brett Skiles noted multiple arrests in the U.S. and abroad on Sunday.',
    'The weather in Washington was mild.',
  ],
};
const src = (articleId: number, sentence: number): V6Source => ({ articleId, sentence });
const POOL = [src(1, 1), src(1, 2), src(2, 1), src(2, 2)];

describe('repairCitations 实词补出处', () => {
  it('所引原句缺好几个实词：补上覆盖最多的那条池内原句', () => {
    const { sentences, added } = repairCitations(
      [{ text: 'The FBI noted multiple arrests in the U.S. and abroad on Sunday.', sources: [src(1, 1)] }],
      POOL,
      TABLE
    );
    expect(sentences[0].sources).toEqual([src(1, 1), src(2, 1)]);
    expect(added).toBe(1);
  });

  it('所引原句已覆盖句中实词：不补', () => {
    const { sentences, added } = repairCitations(
      [{ text: 'Critics warned valid voters could be removed from rolls.', sources: [src(1, 2)] }],
      POOL,
      TABLE
    );
    expect(sentences[0].sources).toEqual([src(1, 2)]);
    expect(added).toBe(0);
  });

  it('池里没有覆盖 ≥3 个缺失实词的原句：不补', () => {
    const { sentences, added } = repairCitations(
      [{ text: 'Officials in Brussels announced sanctions on steel imports.', sources: [src(1, 1)] }],
      POOL,
      TABLE
    );
    expect(sentences[0].sources).toEqual([src(1, 1)]);
    expect(added).toBe(0);
  });

  it('只补不删、一句最多补一条', () => {
    const { sentences } = repairCitations(
      [
        {
          text: 'FBI agent Skiles noted multiple arrests abroad, and critics warned valid voters could be removed from rolls.',
          sources: [src(2, 2)],
        },
      ],
      POOL,
      TABLE
    );
    expect(sentences[0].sources[0]).toEqual(src(2, 2));
    expect(sentences[0].sources).toHaveLength(2);
  });
});
