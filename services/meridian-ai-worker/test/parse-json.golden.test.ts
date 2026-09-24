// @vitest-environment node
/**
 * Golden-master（金标快照）测试：`parseJSONFromResponse`（src/utils/common.ts）。
 *
 * 这是 /meridian/cluster/judge、/meridian/stories/rank、/meridian/brief-title 三个路由
 * 共用的「模型正文 → JSON」解析函数——纯函数、不碰网络。目标不是验证「解析得对不对」
 * （对不对由 prompt/schema 决定），而是**冻住当前解析行为**：同一段模型原文，重构后必须
 * 解出逐字相同的对象，任何有意/无意的解析策略改动都要在这里炸。
 *
 * 输入是生产 run `cron-brief-1790168539876` 的真实 LLM 输出（`response.content` 原文，
 * 通过 GET /observability/llm-calls/<key> 取回），只存模型写的正文，不存请求 prompt
 * （prompt 里带真实文章原文，本仓库是公开的）。取回方式与出处见各 fixture 的
 * `sourceKey` / `sourceRun` 字段。
 *
 * 覆盖 parseJSONFromResponse 的两条主路径：
 *   · 策略2（```json 围栏）——三个路由的正常输出都走这条
 *   · 策略4（直接解析裸 JSON）——cluster_judge 偶发不加围栏（cluster-judge-event-unfenced）
 * 边界样本：cluster-judge-no-event 是判官给出 NO_EVENT 判决的真实产出（不是我编的反例）。
 *
 * 重新生成金标：`UPDATE_GOLDEN=1 npx vitest run test/parse-json.golden.test.ts`
 * ——只应在明知解析行为要变时用，平时跑不带这个变量的 `npx vitest run`。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseJSONFromResponse } from '../src/utils/common';

const DIR = new URL('./golden/parse-json/', import.meta.url).pathname;

interface Case {
  note: string;
  sourceKey: string;
  sourceRun: string;
  input: string;
  expected?: unknown;
}

const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort();

beforeAll(() => {
  if (process.env.UPDATE_GOLDEN !== '1') return;
  for (const f of files) {
    const path = `${DIR}${f}`;
    const c = JSON.parse(readFileSync(path, 'utf8')) as Case;
    c.expected = parseJSONFromResponse(c.input);
    writeFileSync(path, JSON.stringify(c, null, 2) + '\n', 'utf8');
  }
});

describe('parseJSONFromResponse 金标（cron-brief-1790168539876 真实模型输出）', () => {
  it('至少覆盖了围栏与裸 JSON 两条路径，外加一个 NO_EVENT 边界样本', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const f of files) {
    it(`${f}: 解析结果与金标逐字相等`, () => {
      const c = JSON.parse(readFileSync(`${DIR}${f}`, 'utf8')) as Case;
      expect(c.expected, `${f} 缺 expected —— 先跑 UPDATE_GOLDEN=1 生成金标`).not.toBeUndefined();
      const actual = parseJSONFromResponse(c.input);
      expect(actual).toEqual(c.expected);
    });
  }
});
