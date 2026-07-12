// ============================================================================
// 原型 harness：抽取+程序比对通道（路线一）—— 治 qwen 判官的日期/数字确定性盲区
//
// 通道逻辑（prompt/比对器/编排）单一真源在 ai-worker：
//   services/meridian-ai-worker/src/services/extract-compare.ts
// 本文件只是 eval 跑批壳：金标加载、baseline 复原、融合、指标、审计输出。
//
// 融合策略：仅当代码坐实硬冲突（same_fact + high confidence + 区间/日期不相交）时
// 覆写 baseline 判定为 contradicted（单向覆写，保 supported 精度）；其余保留 baseline。
//
// 用法：
//   AI_WORKER_URL=http://localhost:8787 BASELINE_REPORT=eval-reports/judge-meta/meta-xxx.json \
//     pnpm tsx _extract_compare.ts gold/judge-gold.jsonl
//   SELFTEST=1 pnpm tsx _extract_compare.ts   # 零 LLM 自测比对逻辑
// baseline 从已有 meta 报告复原（mismatches 里的 pred + 其余 pred=gold），省一轮重跑。
// 实测读数（2026-07-11）：真金标修3弄坏0 κ0.407→0.531；合成修3弄坏0 精度保1.0。
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chat, parseJSON } from './llm.js';
import { evalChannel, fmt } from '../_shared/metrics.js';
import {
  extractCompareClaim,
  hasSpecifics,
  numbersConflict,
  datesConflict,
} from '../../../services/meridian-ai-worker/src/services/extract-compare.js';

const EXTRACT_MODEL = process.env.EXTRACT_MODEL || 'qwen-max';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '5');
const BASELINE_REPORT = process.env.BASELINE_REPORT || '';

const FACTUAL_CLASSES = ['supported', 'unsupported', 'contradicted'];

// ---------------------------------------------------------------------------
// 金标与 baseline 加载（与 meta-eval.ts 同构的最小版）
// ---------------------------------------------------------------------------
interface GoldItem {
  id: string;
  type: string;
  claim: string;
  source: string;
  gold: string;
}

function loadSources(path: string): Record<string, string> {
  const map: Record<string, string> = {};
  try {
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .forEach((line) => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return;
        const o = JSON.parse(t);
        if (o.brief_id && o.source) map[o.brief_id] = o.source;
      });
  } catch {
    /* no sidecar */
  }
  return map;
}

function loadGold(path: string, sourcesPath: string): GoldItem[] {
  const sources = loadSources(sourcesPath);
  const items: GoldItem[] = [];
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const o = JSON.parse(t);
      const id = o.id ?? `item-${i + 1}`;
      const briefId = o.brief_id ?? String(id).split('#').slice(0, 2).join('#');
      const source = o.source ?? sources[briefId] ?? sources[String(id).split('#')[0]];
      if (!o.claim || !source) throw new Error(`金标 ${id} 缺 claim/source`);
      items.push({ id, type: o.type, claim: o.claim, gold: o.gold, source });
    });
  return items;
}

// baseline 复原：报告 mismatches 里的条目取其 pred，其余 pred=gold
function loadBaseline(reportPath: string): Record<string, string> {
  const r = JSON.parse(readFileSync(reportPath, 'utf8'));
  const map: Record<string, string> = {};
  for (const m of r.mismatches || []) map[m.id] = m.pred;
  return map;
}

// ---------------------------------------------------------------------------
async function main() {
  const goldPath = process.argv[2] || 'gold/judge-gold.jsonl';
  const sourcesPath = process.env.GOLD_SOURCES || goldPath.replace(/[^/]+$/, 'sources.jsonl');
  if (!BASELINE_REPORT) throw new Error('需 BASELINE_REPORT=<已有 meta 报告路径> 复原 qwen baseline');

  const gold = loadGold(goldPath, sourcesPath).filter((g) => g.type === 'factual');
  const baseMismatch = loadBaseline(BASELINE_REPORT);
  const baseline: Record<string, string> = {};
  for (const g of gold) baseline[g.id] = baseMismatch[g.id] ?? g.gold;

  // DEBUG_ID=<id>：只跑该条并打印冲突明细（排查为何未覆写）
  const debugId = process.env.DEBUG_ID;
  const todo = gold.filter((g) => hasSpecifics(g.claim) && (!debugId || g.id === debugId));
  console.log(`[extract-compare] gold=${goldPath} n=${gold.length} 有数字/日期可查=${todo.length} extract_model=${EXTRACT_MODEL}`);
  console.log(`[extract-compare] baseline 复原自 ${BASELINE_REPORT}（错配 ${Object.keys(baseMismatch).length} 条）`);

  const conflicts: Record<string, { why: string; aspect: string; quote: string }[]> = {};
  const extractFails: string[] = [];
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < todo.length) {
      const it = todo[next++];
      try {
        const hard = await extractCompareClaim(
          it.claim,
          it.source,
          (prompt, maxTokens) => chat(prompt, { model: EXTRACT_MODEL, temperature: 0, maxTokens }),
          parseJSON
        );
        if (debugId) console.log(`[DEBUG ${it.id}] conflicts:\n${JSON.stringify(hard, null, 2)}`);
        if (hard.length) {
          conflicts[it.id] = hard.map((h) => ({
            why: h.why,
            aspect: h.pair.aspect,
            quote: (h.pair.source_quote || '').slice(0, 160),
          }));
        }
      } catch (e) {
        extractFails.push(`${it.id} (${e instanceof Error ? e.message.slice(0, 60) : e})`);
      }
      done++;
      if (done % 10 === 0 || done === todo.length) console.log(`  extracted ${done}/${todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

  // 融合：硬冲突 → contradicted 覆写；否则 baseline
  const fusedPreds = gold.map((g) => ({
    id: g.id,
    gold: g.gold,
    pred: conflicts[g.id] ? 'contradicted' : baseline[g.id],
    reason: conflicts[g.id] ? conflicts[g.id].map((c) => c.why).join('; ') : '(baseline)',
  }));
  const basePreds = gold.map((g) => ({ id: g.id, gold: g.gold, pred: baseline[g.id], reason: '' }));

  console.log('\n========== BASELINE (qwen 判官原判) ==========');
  const baseRes = evalChannel(basePreds, FACTUAL_CLASSES, 'factual/baseline');
  console.log('\n========== FUSED (baseline + 抽取比对覆写) ==========');
  const fusedRes = evalChannel(fusedPreds, FACTUAL_CLASSES, 'factual/fused');

  // 变化审计
  const fixed = fusedPreds.filter((f, i) => basePreds[i].pred !== f.gold && f.pred === f.gold);
  const broken = fusedPreds.filter((f, i) => basePreds[i].pred === f.gold && f.pred !== f.gold);
  const overridden = fusedPreds.filter((f, i) => f.pred !== basePreds[i].pred);

  console.log(`\n=== 覆写审计（共 ${overridden.length} 条被覆写为 contradicted）===`);
  for (const o of overridden) {
    const tag = o.pred === o.gold ? '✅fix' : o.gold === 'contradicted' ? '≈' : '❌break';
    console.log(`  ${tag} [${o.id}] gold=${o.gold} :: ${o.reason.slice(0, 140)}`);
    for (const c of conflicts[o.id] || []) console.log(`       quote: ${c.quote.slice(0, 110)}`);
  }
  console.log(`\n修好 ${fixed.length} 条 / 弄坏 ${broken.length} 条 / 抽取失败 ${extractFails.length} 条${extractFails.length ? ' → ' + extractFails.join(', ') : ''}`);
  console.log(`κ: ${fmt(baseRes.kappa)} → ${fmt(fusedRes.kappa)}`);
  const bc = baseRes.perClass['contradicted'];
  const fc = fusedRes.perClass['contradicted'];
  console.log(`contradicted 召回: ${fmt(bc.tpr)} → ${fmt(fc.tpr)}  精度: ${fmt(bc.precision)} → ${fmt(fc.precision)}`);

  mkdirSync('eval-reports/extract-compare', { recursive: true });
  const out = `eval-reports/extract-compare/ec-${Date.now()}.json`;
  writeFileSync(
    out,
    JSON.stringify({ gold_path: goldPath, extract_model: EXTRACT_MODEL, baseline_report: BASELINE_REPORT, baseline: baseRes, fused: fusedRes, conflicts, fixed: fixed.map((f) => f.id), broken: broken.map((f) => f.id), extract_fails: extractFails }, null, 2)
  );
  console.log(`报告 → ${out}`);
}

// SELFTEST=1: 零 LLM 自测比对逻辑（已知盲区案例做测试向量，函数来自共享模块）
function selfTest() {
  const cases: [string, boolean, () => boolean][] = [
    // 1#17: "over 130" vs 源 "127" → 冲突（127 不满足 >130）
    ['over130 vs 127', true, () => numbersConflict('over 130', '127')],
    // 1#17: "at least 11" vs 源 "4" → 冲突
    ['atleast11 vs 4', true, () => numbersConflict('at least 11 civilians', '4')],
    // rubric: "3,526" 满足 "over 3,500" → 不冲突（阈值蕴含）
    ['3526 vs over3500', false, () => numbersConflict('3,526', 'over 3,500')],
    // ctr-intel-06: "£90 million" vs "£50 million" → 冲突
    ['90M vs 50M', true, () => numbersConflict('£90 million', '£50 million')],
    // ctr-intel-01 语义（rubric 对齐即漏检）："over 40" vs "90" 蕴含 → 不冲突
    ['over40 vs 90', false, () => numbersConflict('Over 40 people', '90 people')],
    // "about 600" vs "656" → 不冲突（15% 容差）
    ['about600 vs 656', false, () => numbersConflict('about 600', '656')],
    // 裸数字相同 → 不冲突
    ['127 vs 127', false, () => numbersConflict('127', '127')],
    // ctr-intel-09: "60 medical personnel" vs "30 medical" → 冲突
    ['60 vs 30', true, () => numbersConflict('60 medical personnel', '30 medical')],
    // 6#9: claim "31 May" vs 源 "Friday"@发布2026-06-01(周一) → Friday=5/29 ≠ 5/31 → 冲突
    ['31May vs Friday@0601', true, () => datesConflict('31 May', 'on Friday', '2026-06-01T10:00:00.000Z')],
    // 同一天不同写法："28 February" vs "February 28" → 不冲突
    ['28Feb vs Feb28', false, () => datesConflict('28 February', 'February 28')],
    // "June 2" vs "2 June" → 不冲突
    ['June2 vs 2June', false, () => datesConflict('June 2', '2 June')],
    // weekday 无时间戳 → 无法比对 → 不冲突（保守）
    ['Friday no-ts', false, () => datesConflict('31 May', 'on Friday')],
    // 线上实测修复（2026-07-12 预筛冒烟暴露）：
    // 报警号 "000" 不是数量 → 不冲突
    ['000 not a number', false, () => numbersConflict('over 300 welfare checks', 'failed 000 calls')],
    // 日期区间包含 claim 日 → 不冲突
    ['7Jul in 7-8Jul', false, () => datesConflict('2026-07-07', '7–8 July 2026')],
    // 日期区间不含 claim 日 → 冲突
    ['5Jul vs 7-8Jul', true, () => datesConflict('2026-07-05', '7–8 July 2026')],
    // 首个生产 run 实测（2026-07-12）："$3.8B+" = 3.8 billion 或更多 → 与 "$3.8 billion" 不冲突
    ['3.8B+ vs 3.8billion', false, () => numbersConflict('$3.8 billion', '$3.8B+')],
    // "B" 单字母量级识别 + 真差异仍要抓："$5B" vs "$3.8 billion" → 冲突
    ['5B vs 3.8billion', true, () => numbersConflict('$3.8 billion', '$5B')],
  ];
  let fail = 0;
  for (const [name, want, fn] of cases) {
    const got = fn();
    if (got !== want) {
      fail++;
      console.log(`✗ ${name}: want ${want} got ${got}`);
    } else console.log(`✓ ${name}`);
  }
  console.log(fail ? `\n${fail} FAILED` : '\nall pass');
  process.exit(fail ? 1 : 0);
}

if (process.env.SELFTEST) {
  selfTest();
} else {
  main().catch((e) => {
    console.error('extract-compare 失败:', e);
    process.exit(1);
  });
}
