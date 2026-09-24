// @vitest-environment node
/**
 * Golden-master 测试：简报块 v6 写作步的两个纯函数——`cleanWrite`（标签剥离）与
 * `writeOk`（确定性校验），均在 src/utils/brief-block-v6.ts。
 *
 * 输入是生产 run `cron-brief-1790168539876` 里 phase=brief_block_v6、写作步
 * （响应体含 `verdict`/`sentences`，区别于窗口步的 `anchors`）的真实 `response.content`。
 * 只存模型正文，不存 request 里的 prompt（含真实文章原文）。
 *
 * `cited`（writeOk 第二个参数）**不从生产还原**：生产的 cited 来自窗口步全部 anchors 的
 * sources ∪ 代词句前一句（contextOf，要判断代词得看原句文本），而这两样都要么是另一次
 * LLM 调用的产物、要么要看文章原文，不属于「这个函数需要的最小非文章上下文」。这里改用
 * **自洽**构造：cited = 这条写作响应自己在 sources 里引用过的坐标。效果是 writeOk 的
 * bad_source 分支在本测试里不会被触发（那条分支已有生产样本 test/brief-block-v6.test.ts
 * 的 bad-block-17 覆盖），本测试冻住的是 marker_leak / multi_sentence / no_terminal_punct
 * 这几条——它们只看 text 本身，不依赖 cited 是否还原真实。
 *
 * 边界样本 `write-retry-attempt1-multi-sentence` / `-attempt2-clean` 是同一簇真实的两次
 * 尝试（brief_block_v6-1001.json 温度 0.1 被拒，brief_block_v6-1002.json 温度 0.3 重试通过）：
 * 第 1 次尝试句 5 里嵌了一句带内部句号的引语（"...it. It's like a movie'."），
 * splitSentences 在引语内部的句号处又切一刀，writeOk 报 `sentence 5: multi_sentence`——
 * 这正是生产触发第二次尝试的真实原因，不是我编的反例。
 *
 * 重新生成金标：`UPDATE_GOLDEN=1 npx vitest run test/brief-block-v6-write.golden.test.ts`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cleanWrite, writeOk, type V6Source } from '../src/utils/brief-block-v6';

const DIR = new URL('./golden/brief-block-v6-write/', import.meta.url).pathname;

interface Case {
  note: string;
  sourceKey: string;
  sourceRun: string;
  input: string;
  expected?: { cleaned: unknown; writeOkReasons: string[] };
}

const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort();

function run(c: Case) {
  const parsed = JSON.parse(c.input);
  const cited = new Set<string>();
  for (const s of parsed.sentences ?? []) {
    for (const r of (s.sources ?? []) as V6Source[]) cited.add(`${r.articleId}:${r.sentence}`);
  }
  const cleaned = cleanWrite(parsed);
  const writeOkReasons = writeOk(parsed, cited);
  return { cleaned, writeOkReasons };
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

describe('brief-block-v6 写作步金标（cleanWrite + writeOk，cron-brief-1790168539876 真实产出）', () => {
  it('覆盖 lead/brief 两档篇幅，外加一对真实重试（拒绝 → 通过）', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const f of files) {
    it(`${f}: cleanWrite + writeOk 与金标逐字相等`, () => {
      const c = JSON.parse(readFileSync(`${DIR}${f}`, 'utf8')) as Case;
      expect(c.expected, `${f} 缺 expected —— 先跑 UPDATE_GOLDEN=1 生成金标`).not.toBeUndefined();
      expect(run(c)).toEqual(c.expected);
    });
  }

  it('反向对照：retry 那对样本此消彼长——attempt1 有 multi_sentence，attempt2 没有', () => {
    const bad = JSON.parse(readFileSync(`${DIR}write-retry-attempt1-multi-sentence.json`, 'utf8')) as Case;
    const good = JSON.parse(readFileSync(`${DIR}write-retry-attempt2-clean.json`, 'utf8')) as Case;
    expect(run(bad).writeOkReasons).toContain('sentence 5: multi_sentence');
    expect(run(good).writeOkReasons).toEqual([]);
  });
});
