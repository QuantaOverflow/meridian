// @vitest-environment node
/**
 * Golden-master 测试：简报块 v6 窗口步（标重点）的纯函数 `anchorOk`（src/utils/brief-block-v6.ts）。
 *
 * 输入是生产 run `cron-brief-1790168539876` 里 phase=brief_block_v6、窗口步
 * （响应体是 `{anchors:[...]}`，区别于写作步的 `{verdict, sentences}`）的真实
 * `response.content`。只存模型正文，不存 request 里的 prompt（含真实文章原文）。
 *
 * `anchorOk` 第二、三个参数（`sentences: SentenceTable`、`allowed: Set<articleId>`）
 * 生产里来自切句后的原文与窗口的文章集合——都要看文章原文才能还原，不是这个函数需要的
 * 最小非文章上下文。这里改用**自洽**构造：
 *   · allowed = 这条响应自己在 sources 里引用过的 articleId 集合
 *   · sentences[articleId] = 长度等于该 articleId 被引用到的最大句号的占位数组
 *     （只用来让 sentenceOf 的「存在性」判断成立，不含任何真实句子文本）
 * 这让 anchorOk 里「articleId 在窗口内」「句号在文章范围内」两条构造性地恒成立，冻住的是
 * 结构性那几条——`anchors.length<=12`、每条 `topic` 非空、`sources.length` 在 1–4 之间——
 * 这些由 json_schema 在生产端强制，本测试验证 anchorOk 对已知合规的真实产出判 true，
 * 重构改动了判定逻辑会在这里先炸。
 *
 * 重新生成金标：`UPDATE_GOLDEN=1 npx vitest run test/brief-block-v6-anchors.golden.test.ts`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { anchorOk, type SentenceTable, type V6Source } from '../src/utils/brief-block-v6';

const DIR = new URL('./golden/brief-block-v6-anchors/', import.meta.url).pathname;

interface Case {
  note: string;
  sourceKey: string;
  sourceRun: string;
  input: string;
  expected?: { anchorCount: number; ok: boolean };
}

const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort();

function run(c: Case) {
  const parsed = JSON.parse(c.input) as { anchors: Array<{ topic: string; sources: V6Source[] }> };
  const allowed = new Set<number>();
  const maxSentence: Record<number, number> = {};
  for (const a of parsed.anchors) {
    for (const s of a.sources) {
      allowed.add(s.articleId);
      maxSentence[s.articleId] = Math.max(maxSentence[s.articleId] ?? 0, s.sentence);
    }
  }
  const sentences: SentenceTable = {};
  for (const [articleId, n] of Object.entries(maxSentence)) {
    sentences[articleId] = Array.from({ length: n }, () => '');
  }
  return { anchorCount: parsed.anchors.length, ok: anchorOk(parsed, sentences, allowed) };
}

beforeAll(() => {
  if (process.env.UPDATE_GOLDEN !== '1') return;
  for (const f of files) {
    const path = `${DIR}${f}`;
    const c = JSON.parse(readFileSync(path, 'utf8')) as Case;
    c.expected = run(c);
    writeFileSync(path, JSON.stringify(c, null, 2) + '\n', 'utf8');
  }
});

describe('brief-block-v6 窗口步金标（anchorOk，cron-brief-1790168539876 真实产出）', () => {
  it('覆盖单窗口与多窗口簇各一例', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  for (const f of files) {
    it(`${f}: anchorOk 结果与金标相等`, () => {
      const c = JSON.parse(readFileSync(`${DIR}${f}`, 'utf8')) as Case;
      expect(c.expected, `${f} 缺 expected —— 先跑 UPDATE_GOLDEN=1 生成金标`).not.toBeUndefined();
      expect(run(c)).toEqual(c.expected);
      // 真实生产产出理应通过校验；这条断言不是自证——它防的是两个构造步骤互相抵消
      // 一个真 bug（比如 allowed 集合算错）的情况。
      expect(run(c).ok, `${f} 应通过 anchorOk`).toBe(true);
    });
  }
});
