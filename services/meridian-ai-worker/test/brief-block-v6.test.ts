// @vitest-environment node
/**
 * 判据 A：简报块 v6 的纯函数逐字对金标。不调模型，秒级完成。
 *
 * 金标（`test/fixtures/brief-block-v6-golden.json`）是原型
 * `scripts/eval/cluster-to-brief/arms/direct-raw/direct-raw.mjs` 在
 * `WRITE_AT_END=1 / WRITE_TIER=exec / WRITE_SUPPORT=1 / WRITE_REPAIR=mech` 下冻结的产出。
 * material 的 sha256 前 16 位另行写死在本文件里——金标文件被换掉时它会先炸，
 * 免得「拿一份错金标对自己」这种不报错的错位。
 *
 * ⚠️ 本测试读 `scripts/eval/cluster-to-brief/out/`（gitignored，本地产物）：
 *   · 正文    out/_data/d0916/content/<articleId>.txt   ← fetch-dataset.mjs --dataset=d0916 重建
 *   · 重点    out/direct-raw-d0916-write/c<N>-anchors.json
 * 这两份不在的机器上本文件会 skip（而不是静默通过）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { splitSentences } from '../src/utils/report-v3';
import {
  contextOf,
  makeWindows,
  mustCover,
  supportOf,
  writeMaterial,
  type SentenceTable,
  type V6Anchor,
  type V6Article,
} from '../src/utils/brief-block-v6';

const PKG = new URL('..', import.meta.url).pathname;
const CTB = new URL('../../../scripts/eval/cluster-to-brief/', import.meta.url).pathname;
const ARM = `${CTB}arms/direct-raw/direct-raw.mjs`;
const GOLDEN = JSON.parse(readFileSync(`${PKG}test/fixtures/brief-block-v6-golden.json`, 'utf8')) as Record<
  string,
  { windows: Array<Omit<ReturnType<typeof makeWindows>[number], 'text'>>; material: string }
>;

/** 契约 §6 写死的基准指纹（material 字符串的 sha256 前 16 位）。 */
const MATERIAL_SHA: Record<string, { len: number; sha: string; windows: number }> = {
  '12': { windows: 4, len: 31598, sha: '9546899dc35ef75e' },
  '23': { windows: 2, len: 16740, sha: '66fdaa36a5835b78' },
  '96': { windows: 1, len: 10148, sha: '2dda9997026ee07f' },
};

const CLUSTERS = ['12', '23', '96'];
const dataReady = existsSync(`${CTB}out/_data/d0916/content`) && existsSync(`${CTB}out/direct-raw-d0916-write`);

/** 原型 loadClusterFrom 的序：publishDate 升序，同期按 id 升序。序错了窗口切分必然不同。 */
function loadCluster(cid: string): { articles: V6Article[]; sentences: SentenceTable } {
  const ds = JSON.parse(readFileSync(`${CTB}datasets/d0916.json`, 'utf8'));
  const ids: number[] = ds.clusters[cid].articleIds;
  const articles: V6Article[] = ids
    .map(id => {
      const m = ds.articles[String(id)] ?? {};
      return {
        id,
        title: m.title ?? '',
        publishDate: m.publishDate ?? '',
        sourceId: m.sourceId ?? null,
        sentences: splitSentences(readFileSync(`${CTB}out/_data/d0916/content/${id}.txt`, 'utf8')),
      };
    })
    .sort((a, b) => (a.publishDate < b.publishDate ? -1 : a.publishDate > b.publishDate ? 1 : a.id - b.id));
  const sentences: SentenceTable = {};
  for (const a of articles) sentences[String(a.id)] = a.sentences;
  return { articles, sentences };
}

function loadAnchors(cid: string): V6Anchor[] {
  return JSON.parse(readFileSync(`${CTB}out/direct-raw-d0916-write/c${cid}-anchors.json`, 'utf8')).anchors;
}

const sha16 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

describe.skipIf(!dataReady)('brief-block-v6 纯函数 vs 金标（d0916 c12/c23/c96）', () => {
  it('金标文件本身没被换掉', () => {
    for (const cid of CLUSTERS) {
      expect(GOLDEN[cid].material.length, `c${cid} 金标 material 长度`).toBe(MATERIAL_SHA[cid].len);
      expect(sha16(GOLDEN[cid].material), `c${cid} 金标 material sha`).toBe(MATERIAL_SHA[cid].sha);
      expect(GOLDEN[cid].windows.length, `c${cid} 金标窗口数`).toBe(MATERIAL_SHA[cid].windows);
    }
  });

  for (const cid of CLUSTERS) {
    it(`c${cid}: makeWindows 与金标深度相等`, () => {
      const { articles } = loadCluster(cid);
      const got = makeWindows(articles).map(({ text, ...w }) => w);
      expect(got).toEqual(GOLDEN[cid].windows);
    });

    it(`c${cid}: writeMaterial 与金标逐字相等`, () => {
      const { sentences } = loadCluster(cid);
      const material = writeMaterial(loadAnchors(cid), sentences, true, true);
      expect(material).toBe(GOLDEN[cid].material);
      expect(sha16(material)).toBe(MATERIAL_SHA[cid].sha);
    });
  }
});

/**
 * supportOf / mustCover / contextOf 直接与原型的同名导出对拍——这三个没有冻结基准，
 * 拿我自己算的数当期望等于自证。原型 .mjs 在 git 里，可复现。
 */
describe.skipIf(!dataReady)('brief-block-v6 纯函数 vs 原型导出', () => {
  let proto: any;

  beforeAll(async () => {
    // 原型的模块级常量读这些环境变量，必须在 import 之前设（取契约 §1 的那条路径）
    process.env.DIRECT_RAW_WRITE_AT_END = '1';
    process.env.DIRECT_RAW_WRITE_TIER = 'exec';
    process.env.DIRECT_RAW_WRITE_SUPPORT = '1';
    process.env.DIRECT_RAW_WRITE_REPAIR = 'mech';
    process.env.DIRECT_RAW_SINGLE_BLOCK = '1';
    proto = await import(/* @vite-ignore */ ARM);
  });

  for (const cid of CLUSTERS) {
    it(`c${cid}: supportOf 逐条相同`, () => {
      const anchors = loadAnchors(cid);
      expect(anchors.map(a => supportOf(a))).toEqual(anchors.map(a => proto.supportOf(a)));
    });

    it(`c${cid}: mustCover 结果集合逐个 id 相同`, () => {
      const anchors = loadAnchors(cid);
      const mine = [...mustCover(anchors, 0)].sort();
      const theirs = [...proto.mustCover(anchors, 0)].sort();
      expect(mine).toEqual(theirs);
      expect(mine.length).toBeGreaterThan(0);
    });

    it(`c${cid}: contextOf 在每条出处上相同`, () => {
      const { articles, sentences } = loadCluster(cid);
      const cluster = { clusterId: Number(cid), articles };
      const all = loadAnchors(cid).flatMap(a => a.sources);
      expect(all.length).toBeGreaterThan(0);
      for (const s of all) {
        expect(contextOf(sentences, s), `${s.articleId}:${s.sentence}`).toEqual(proto.contextOf(cluster, s));
      }
      // 至少有一条代词句被带上了前一句，否则这条断言等于没查
      expect(all.some(s => contextOf(sentences, s) !== null)).toBe(true);
    });
  }
});
