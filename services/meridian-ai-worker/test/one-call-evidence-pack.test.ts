/**
 * 一次调用核查的取证与提示词（ADR 0012）：分句、证据包的五条规则、提示词全文。
 *
 * 夹具是合成的小簇（test/fixtures/one-call-cluster.json，水坝溃坝，向量用夹角合成）。期望值是对着夹具逐条手算的：
 * 简报句的分句 "engineers began repairing in 2015" 在 0°，14:1（2°）是它按意思最近的一句，
 * 而 14:1 与简报句没有一个共同的词，所以只有按意思搜才带得进来。
 */
import { describe, it, expect } from 'vitest';
import fixture from './fixtures/one-call-cluster.json';
import { clusterOf } from '../src/utils/sentence-check';
import { buildEvidencePack, clausesOf } from '../src/utils/evidence-pack';
import { oneCallPrompts } from '../src/prompts/oneCallCheck';
import type { EvidenceEmbeddings } from '../src/types/one-call-check';

const cluster = clusterOf(fixture.articles);

const unit = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0];
const embeddings: EvidenceEmbeddings = {
  sentences: new Map(Object.entries(fixture.embeddings.sentences).map(([k, deg]) => [k, unit(deg)])),
  queries: new Map(Object.entries(fixture.embeddings.queries).map(([q, deg]) => [q, unit(deg)])),
};

const TEXT = 'The dam, which engineers began repairing in 2015, failed on Tuesday night, killing 57 people.';

describe('clausesOf', () => {
  it('在 ; : — – 、后面不跟数字的逗号、连接词处切，留三个词以上的片段', () => {
    expect(clausesOf(TEXT)).toEqual(['engineers began repairing in 2015', 'failed on Tuesday night', 'killing 57 people.']);
    expect(clausesOf('Troops entered the city; residents fled — some stayed behind')).toEqual(['Troops entered the city', 'some stayed behind']); // 两个词的 "residents fled" 丢掉
    expect(clausesOf('Officials said talks stalled because both sides refused to move')).toEqual(['Officials said talks stalled', 'both sides refused to move']);
  });

  it('数字里的逗号不切', () => {
    expect(clausesOf('The plane climbed to 34,000 feet over the coast')).toEqual(['The plane climbed to 34,000 feet over the coast']);
  });
});

describe('buildEvidencePack', () => {
  it('有向量：决定性句 14:1 只经分句的按意思搜进来；shown 按发布时间从早到晚', () => {
    const pack = buildEvidencePack(cluster, TEXT, ['13:3'], embeddings);
    expect(pack).toEqual({
      // 14 篇（9-20）最早，其后 11（10-01 06:00）、12（10-01 14:00）、13（10-02）
      shown: ['14:1', '14:2', '14:3', '11:1', '11:2', '11:3', '11:5', '12:1', '12:2', '12:4', '12:5', '12:6', '13:1', '13:2', '13:3', '13:4', '13:5'],
      cites: ['13:3'],
      also: ['11:1', '12:4', '12:1', '13:1', '11:2', '12:5', '13:2', '12:6', '14:3', '12:2', '13:5', '13:4', '11:5', '14:1', '14:2', '11:3'],
      // 句中 "57 people" 的计数词 people：整簇里带数字又提到 people 的句子，从早到晚
      figures: ['11:2', '12:1', '12:2', '13:3'],
    });
  });

  it('同样的输入、embeddings 为 null：14:1 与 14:2 不再进来，规则 1、2、3、5 照旧', () => {
    const pack = buildEvidencePack(cluster, TEXT, ['13:3'], null);
    expect(pack).toEqual({
      shown: ['14:3', '11:1', '11:2', '12:1', '12:2', '12:4', '12:5', '12:6', '13:1', '13:2', '13:3', '13:4'],
      cites: ['13:3'],
      also: ['11:1', '12:4', '12:1', '13:1', '11:2', '12:5', '13:2', '12:6', '14:3', '12:2'],
      figures: ['11:2', '12:1', '12:2', '13:3'],
    });
    expect(pack.shown).not.toContain('14:1');
  });

  it('某个查询没有向量就跳过那一次按意思搜，其余照搜', () => {
    const queries = new Map(embeddings.queries);
    queries.delete('engineers began repairing in 2015');
    const pack = buildEvidencePack(cluster, TEXT, ['13:3'], { sentences: embeddings.sentences, queries });
    expect(pack.shown).not.toContain('14:1');
    expect(pack.shown).toContain('13:5'); // 整句的按意思搜仍在
  });

  it('引用的句子带前后各一句邻句，且只取同一篇；引用不存在的句子被丢掉', () => {
    const pack = buildEvidencePack(cluster, 'Zzz qqq xxx', ['12:3', '99:1'], null);
    expect(pack.cites).toEqual(['12:3']);
    expect(pack.shown).toEqual(['12:2', '12:3', '12:4']);
    expect(pack.also).toEqual([]);
    expect(pack.figures).toEqual([]);
  });

  it('一句有两个计数词：时间线按计数词分组、组内从早到晚，同一句原文出现两次也照列（原型的顺序）', () => {
    const pack = buildEvidencePack(cluster, 'The dam failed, killing 57 people, with 40 missing.', ['13:3'], null);
    // people 的时间线在前，missing 的在后；12:2 两个词都数到
    expect(pack.figures).toEqual(['11:2', '12:1', '12:2', '13:3', '12:2']);
  });

  it('同一个计数词超过 12 条时留最早 2 条和最晚 10 条', () => {
    const articles = Array.from({ length: 15 }, (_, i) => ({
      id: 100 + i,
      title: `report ${i}`,
      publishDate: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      sourceId: null,
      sentences: [`${i + 1} people were killed in the blast.`],
    }));
    const pack = buildEvidencePack(clusterOf(articles), '40 people were killed overall', [], null);
    expect(pack.figures).toEqual(['100:1', '101:1', ...Array.from({ length: 10 }, (_, i) => `${105 + i}:1`)]);
  });
});

describe('oneCallPrompts', () => {
  const item = {
    title: 'Dam failure in Varnia',
    sentences: ['A dam in northern Varnia failed on Tuesday night.', TEXT, 'Opposition leaders demanded the minister resign.'],
    index: 2,
    text: TEXT,
    cited: [[13, 3]] as [number, number][],
  };
  const pack = buildEvidencePack(cluster, TEXT, ['13:3'], embeddings);

  it('system 与 user 全文（别的句子只当上下文，被核的句子带 cites / also relevant / same thing counted）', async () => {
    const { system, user } = oneCallPrompts(item, cluster, '2026-10-03', pack);
    await expect(system).toMatchFileSnapshot('./golden/one-call-prompt/system.txt');
    await expect(user).toMatchFileSnapshot('./golden/one-call-prompt/user.txt');
  });

  it('没有简报日期时，清单里去掉那一句日期，其余照留', () => {
    const { system } = oneCallPrompts(item, cluster, null, pack);
    expect(system).not.toContain('This brief was published on');
    expect(system).toContain('- Time: when did the event happen? An\n     event from before that must be dated');
  });

  it('没有计数词时不出现 same thing counted', () => {
    const plain = { ...item, text: 'Heavy rain had fallen across the region for a week.', sentences: ['Heavy rain had fallen across the region for a week.'], index: 1, cited: [[11, 4]] as [number, number][] };
    const { user } = oneCallPrompts(plain, cluster, '2026-10-03', buildEvidencePack(cluster, plain.text, ['11:4'], null));
    expect(user).not.toContain('same thing counted');
    expect(user).toContain('S1: Heavy rain had fallen across the region for a week.\n   cites: [11:4]\n   also relevant:');
  });
});
