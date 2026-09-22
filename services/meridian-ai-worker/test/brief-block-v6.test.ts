// @vitest-environment node
/**
 * 判据 A：简报块 v6 的纯函数逐字对金标。不调模型，秒级完成。
 *
 * 金标（`test/fixtures/brief-block-v6-golden.json`）是原型
 * `eval/cluster-to-brief/arms/direct-raw/direct-raw.mjs` 在
 * `WRITE_AT_END=1 / WRITE_TIER=exec / WRITE_SUPPORT=1 / WRITE_REPAIR=mech` 下冻结的产出。
 * material 的 sha256 前 16 位另行写死在本文件里——金标文件被换掉时它会先炸，
 * 免得「拿一份错金标对自己」这种不报错的错位。
 *
 * ⚠️ 本测试读 `eval/cluster-to-brief/out/`（gitignored，本地产物）：
 *   · 正文    out/_data/d0916/content/<articleId>.txt   ← fetch-dataset.mjs --dataset=d0916 重建
 *   · 重点    out/direct-raw-d0916-write/c<N>-anchors.json
 * 这两份不在的机器上本文件会 skip（而不是静默通过）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { splitSentences } from '../src/utils/report-v3';
import { WRITE_SCHEMA, getWritePrompt, getWriteSchema } from '../src/prompts/briefBlockV6';
import {
  contextOf,
  retryInstruction,
  writeOk,
  makeWindows,
  mustCover,
  supportOf,
  writeMaterial,
  type SentenceTable,
  type V6Anchor,
  type V6Article,
} from '../src/utils/brief-block-v6';

const PKG = new URL('..', import.meta.url).pathname;
const CTB = new URL('../../../eval/cluster-to-brief/', import.meta.url).pathname;
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

/**
 * 判据 B：写作步那两条确定性校验（一个 text 只能一句、必须有句末标点）。
 *
 * 样本是**真实生产数据**，不是我编的：
 *   · bad  —— 2026-09-19 运行 admin-brief-1789945067921 的 storyIdx=17，那一块 3 句全坏
 *             （一个 text 塞 3 句、结尾断在半句上）。全天 24 块 108 句只坏了这 3 句。
 *   · good —— 同样 6 篇输入重跑一次的干净 5 句，作反向对照（防止判据两头都报警）。
 * 两份都不调模型，秒级完成。
 */
describe('brief-block-v6 writeOk 的确定性校验（storyIdx=17 生产样本）', () => {
  const BAD = JSON.parse(readFileSync(`${PKG}test/fixtures/brief-block-v6-bad-block-17.json`, 'utf8')) as {
    sentences: Array<{ text: string; sources: Array<{ articleId: number; sentence: number }> }>;
  };
  const GOOD = JSON.parse(readFileSync(`${PKG}test/fixtures/brief-block-v6-good-block-17.json`, 'utf8')) as {
    title: string;
    sentences: Array<{ text: string; sources: Array<{ articleId: number; sentence: number }> }>;
  };
  // 两份样本引到的坐标都算「材料池里有」，好让 bad_source 不掺进来遮住要测的那两条
  const cited = new Set(
    [...BAD.sentences, ...GOOD.sentences].flatMap(s => s.sources.map(r => `${r.articleId}:${r.sentence}`))
  );
  const asBlock = (sentences: unknown) => ({ verdict: 'written', reason: '', title: GOOD.title, sentences });

  it('坏的那三句逐句报出 multi_sentence 与 no_terminal_punct，且只报这两条', () => {
    expect(BAD.sentences.length).toBe(3);
    const reasons = writeOk(asBlock(BAD.sentences), cited);
    for (let i = 1; i <= 3; i++) {
      expect(reasons, `第 ${i} 句`).toContain(`sentence ${i}: multi_sentence`);
      expect(reasons, `第 ${i} 句`).toContain(`sentence ${i}: no_terminal_punct`);
    }
    // 只有这 6 条：多出来的说明规则误伤了别的地方
    expect(reasons.sort()).toEqual(
      [1, 2, 3].flatMap(i => [`sentence ${i}: multi_sentence`, `sentence ${i}: no_terminal_punct`]).sort()
    );
  });

  it('反向对照：同一块重跑得到的干净五句一条原因都不报', () => {
    expect(GOOD.sentences.length).toBe(5);
    expect(writeOk(asBlock(GOOD.sentences), cited)).toEqual([]);
  });

  it('重试说明只回传诊断，不含模型上一次写出来的任何文本', () => {
    const reasons = writeOk(asBlock(BAD.sentences), cited);
    const instruction = retryInstruction(reasons);
    // 该说的要说到：逐条对应、指明第几句
    expect(instruction).toContain('sentence 1: ');
    expect(instruction).toContain('exactly one sentence');
    expect(instruction).toContain('terminal punctuation');

    // 不该带的一个字都不能带：整句原文，以及原文里任何 ≥5 字母的词
    const lower = instruction.toLowerCase();
    for (const s of BAD.sentences) {
      expect(instruction).not.toContain(s.text);
      const words = new Set((s.text.toLowerCase().match(/[a-z]{5,}/g) ?? []));
      const leaked = [...words].filter(w => lower.includes(w));
      expect(leaked, `重试说明里泄漏了模型上一次的用词: ${leaked.join(', ')}`).toEqual([]);
    }
  });
});

/**
 * 判据 C：三档篇幅的纯函数判据（不调模型）。
 *
 * 契约（v6-3tier-contract §修改一）：三档各自一个篇幅——`lead` 7 句、`more` 5 句、
 * `brief` 1 句，不传 = `more`。篇幅只由 schema 的 `sentences.maxItems` 约束；
 * **不加任何字数校验或截断**（实测：句数由 schema 硬约束所以准，字数只是 prompt 里的
 * 一句话，三档全超标）。`brief` 档还必须关掉 MUST COVER 那段——一个簇常有 5–12 条
 * MUST COVER，而 brief 只准写 1 句，「每条都要写进去」与「只写一句」自相矛盾。
 *
 * 期望文字写死在本文件里（不是从 WRITE_LEN 反读），否则等于拿实现对自己。
 */
describe('brief-block-v6 篇幅档（tier）', () => {
  const INPUT = JSON.parse(readFileSync(`${PKG}test/fixtures/brief-block-v6-more-input.json`, 'utf8')) as {
    sentences: SentenceTable;
    anchors: V6Anchor[];
  };
  const SENTENCES: SentenceTable = INPUT.sentences;
  const ANCHORS: V6Anchor[] = INPUT.anchors;
  /** 只比措辞不比换行：源码里为了对齐 `- ${text}` 的缩进，续行带两个空格。 */
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const promptOf = (tier?: string) => getWritePrompt(ANCHORS, SENTENCES, tier);
  const maxItemsOf = (tier?: string) => (getWriteSchema(tier) as any).properties.sentences.maxItems;

  const LEAD_BLURB =
    'An executive brief: 5–7 sentences in a single paragraph, roughly 1,000–1,400 characters. ' +
    'The first sentence is the bottom line — the single most important development, stated so a busy ' +
    'reader who stops there knows what happened.';
  const MORE_BLURB =
    'An executive brief: 3–5 sentences in a single paragraph, at most about 800 characters. ' +
    'The first sentence is the bottom line — the single most important development, stated so a busy ' +
    'reader who stops there knows what happened.';
  const BRIEF_BLURB =
    'A single-sentence brief item, at most about 250 characters. State only the single ' +
    'most important development, at the level a reader who stops here needs. Do not enumerate ' +
    'secondary details, reactions or background. Say why it matters only when a source states ' +
    'it, and attribute it ("the report warned..."). Write no analysis, motivation or prediction ' +
    'of your own.';

  it('C1: 写作 schema 的 sentences.maxItems —— lead 7 / more 5 / 不传 5 / brief 1', () => {
    expect(maxItemsOf('lead')).toBe(7);
    expect(maxItemsOf('more')).toBe(5);
    expect(maxItemsOf(undefined)).toBe(5);
    expect(maxItemsOf('brief')).toBe(1);
    // 非法值按不传处理（= more 档）
    expect(maxItemsOf('nonsense')).toBe(5);
  });

  it('C2: 三档的 prompt 两两不等', () => {
    const [lead, more, brief] = [promptOf('lead'), promptOf('more'), promptOf('brief')];
    expect(lead).not.toBe(more);
    expect(lead).not.toBe(brief);
    expect(more).not.toBe(brief);
  });

  it('C3: 篇幅说明 —— lead 是 5–7 句那段、more 是 3–5 句那段、brief 是一句话那段', () => {
    expect(norm(promptOf('lead'))).toContain(norm(LEAD_BLURB));
    expect(norm(promptOf('lead'))).not.toContain(norm(MORE_BLURB));

    for (const tier of ['more', undefined] as const) {
      expect(norm(promptOf(tier)), `tier=${tier}`).toContain(norm(MORE_BLURB));
      expect(norm(promptOf(tier)), `tier=${tier}`).not.toContain(norm(LEAD_BLURB));
    }

    expect(norm(promptOf('brief'))).toContain(norm(BRIEF_BLURB));
    for (const tier of ['lead', 'more', undefined] as const) {
      expect(norm(promptOf(tier)), `tier=${tier}`).not.toContain(norm(BRIEF_BLURB));
    }
    // 旧的 1–2 句文案必须彻底没了
    expect(promptOf('brief')).not.toContain('A one- or two-sentence brief item');
  });

  it('C4: MUST COVER 段 —— brief 档不含，lead / more / 不传 仍含', () => {
    const brief = promptOf('brief');
    expect(brief).not.toContain('MUST COVER');
    expect(brief).not.toContain('include every one of them');
    // 排序信息要保留（模型仍要知道哪条最多人报）
    expect(brief).toContain('reported by 2 article(s)');
    expect(norm(brief)).toContain('Write about the most widely reported one; leave out the rest.');

    for (const tier of ['lead', 'more', undefined] as const) {
      const p = promptOf(tier);
      expect(p, `tier=${tier}`).toContain('MUST COVER');
      expect(p, `tier=${tier}`).toContain('include every one of them');
    }
  });

  /**
   * C5：本轮的硬性不变量——`more` 档（含不传 tier 时的默认）逐字不变。
   *
   * fixture 是三档拆开**之前**从当前工作区生成的（上一轮的改动没 commit，`git show HEAD:`
   * 取不到旧版），输入取 `brief-block-v6-more-input.json`。这不是跑完就删的临时对照：
   * `more` 是唯一有实测读数的配置，以后每次改 v6 prompt 都要守住这条。
   */
  it('C5: more 档（含不传）的 prompt 与 schema 与改动前 fixture 逐字相等', () => {
    const FIX_PROMPT = readFileSync(`${PKG}test/fixtures/brief-block-v6-more-prompt.txt`, 'utf8');
    const FIX_SCHEMA = readFileSync(`${PKG}test/fixtures/brief-block-v6-more-schema.json`, 'utf8');

    expect(promptOf('more')).toBe(FIX_PROMPT);
    expect(promptOf(undefined)).toBe(FIX_PROMPT);
    expect(JSON.stringify(getWriteSchema('more'), null, 2) + '\n').toBe(FIX_SCHEMA);
    expect(JSON.stringify(getWriteSchema(undefined), null, 2) + '\n').toBe(FIX_SCHEMA);
    expect(JSON.stringify(WRITE_SCHEMA)).toBe(JSON.stringify(getWriteSchema('more')));

    // 反向对照：改动前 lead 与 more 逐字相同，改动后必须分开——否则上面四条等于没查
    expect(promptOf('lead')).not.toBe(FIX_PROMPT);
    expect(JSON.stringify(getWriteSchema('lead'), null, 2) + '\n').not.toBe(FIX_SCHEMA);
  });
});
