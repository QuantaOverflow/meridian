// ============================================================================
// Judge Meta-Eval —— 验证忠实度 judge 这把尺本身（P0，地基）
//
// 在「人工金标」(claim, source, gold verdict) 上跑 judge，算 judge↔人 一致性：
//   - Cohen's κ（chance-corrected，单一一致性数）
//   - per-class TPR(召回) / TNR（不用 accuracy——数据偏 supported，全判 supported 也高 acc）
//   - balanced accuracy（per-class 召回均值）
// gate：κ >= KAPPA_MIN 且 幻觉类(unsupported/contradicted)召回 >= RECALL_MIN。不过 → exit 1。
//
// 为什么这样：judge 是 LLM，用它的读数前必须证明它跟人一致（见 docs/eval-playbook.md §2）。
// 标注规范见 ./rubric.md。金标格式见 ./gold/judge-gold.example.jsonl。
//
// 用法：
//   pnpm meta [gold.jsonl]        # 默认 gold/judge-gold.example.jsonl
//   env: AI_WORKER_URL, JUDGE_MODEL(qwen-max), KAPPA_MIN(0.6), RECALL_MIN(0.7), CONCURRENCY(5)
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { judgeFactual, judgeAnalytical } from './judge.js';
// retrieve-then-verify：与 runtime 单一真源共用同一排序，eval 才忠实量 routed 行为
import { rankSourcesByRelevance } from '../../../services/meridian-ai-worker/src/services/faithfulness-prompts.js';
import type { Claim, FaithVerdict, AnalyticalVerdict } from './types.js';

const JUDGE_MODEL = process.env.JUDGE_MODEL || 'qwen-max';
const KAPPA_MIN = Number(process.env.KAPPA_MIN ?? '0.6');
const RECALL_MIN = Number(process.env.RECALL_MIN ?? '0.7');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '5');
// 迭代 prompt 时只对 dev 调；最终 κ/召回只在 heldout(从未参与调参)报，防过拟合。
// SPLIT=dev|heldout|all（默认 all）。金标行带 split 字段；无 split 字段的行视为 all。
const SPLIT = (process.env.SPLIT ?? 'all').toLowerCase();

const FACTUAL_CLASSES: FaithVerdict[] = ['supported', 'unsupported', 'contradicted'];
const ANALYTICAL_CLASSES: AnalyticalVerdict[] = ['consistent', 'contradicts_facts'];
// gate 关注的「幻觉类」：抓不住这两类 judge 就没用
const HALLUCINATION_CLASSES: FaithVerdict[] = ['unsupported', 'contradicted'];

interface GoldItem {
  id: string;
  type: 'factual' | 'analytical';
  claim: string;
  source: string;
  gold: FaithVerdict | AnalyticalVerdict;
  strata?: Record<string, string>;
  note?: string;
  split?: 'dev' | 'heldout';
  synthetic?: boolean;
}

interface Pred {
  id: string;
  gold: string;
  pred: string;
  reason: string;
  strata?: Record<string, string>;
}

// source 旁车（brief_id → source），让金标紧凑存储(不按 claim 内联 source，省去重复膨胀)
function loadSources(path: string): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const map: Record<string, string> = {};
  raw.split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const o = JSON.parse(t);
    if (o.brief_id && o.source) map[o.brief_id] = o.source;
  });
  return map;
}

// ---------------------------------------------------------------------------
// 金标加载（JSONL，一行一条；# 开头行与空行跳过）
// source 解析顺序：行内 source > 旁车 sources.jsonl[brief_id]（brief_id 缺省取 id 的 '#' 前缀）
// ---------------------------------------------------------------------------
function loadGold(path: string, sourcesPath: string): GoldItem[] {
  const sources = loadSources(sourcesPath);
  const raw = readFileSync(path, 'utf8');
  const items: GoldItem[] = [];
  raw.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    let o: any;
    try {
      o = JSON.parse(t);
    } catch {
      throw new Error(`金标第 ${i + 1} 行不是合法 JSON: ${t.slice(0, 80)}`);
    }
    // split 过滤：SPLIT=dev|heldout 只取对应切片；无 split 字段的行在非 all 模式下跳过
    if (SPLIT !== 'all' && o.split !== SPLIT) return;
    const id = o.id ?? `item-${i + 1}`;
    const briefId = o.brief_id ?? String(id).split('#')[0];
    const source = o.source ?? sources[briefId];
    if (!o.claim || !source || !o.gold || !o.type) {
      throw new Error(
        `金标第 ${i + 1} 行缺字段(需 type/claim/gold + source[行内或旁车]): ${t.slice(0, 80)}`
      );
    }
    items.push({ ...o, id, source });
  });
  return items;
}

// ---------------------------------------------------------------------------
// per-story 源旁车（保真：运行时门逐 per-story 情报报告判，非 brief 整源）
// 文件每行 {brief_id, sources: [str,...]}；PERSTORY_SOURCES 给路径即启用 per-story 模式。
// ---------------------------------------------------------------------------
function loadPerStory(path: string): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  let raw: string;
  try { raw = readFileSync(path, 'utf8'); } catch { return map; }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const o = JSON.parse(t);
    if (o.brief_id && Array.isArray(o.sources)) map[o.brief_id] = o.sources;
  }
  return map;
}

// 复现运行时 judgeFactualMultiSource：逐源判，contradicted 立即短路 → supported 立即短路
// → 全 miss 才 unsupported（faithfulness-check.ts:236-252）。
async function judgeFactualMulti(claim: Claim, sources: string[]) {
  let last = { verdict: 'unsupported', reason: 'no source covers this claim' };
  for (const i of rankSourcesByRelevance(claim.text, sources)) {
    const j = await judgeFactual(claim, sources[i], JUDGE_MODEL);
    if (j.verdict === 'contradicted') return j;
    if (j.verdict === 'supported') return j;
    last = j;
  }
  return last;
}

// 复现运行时 judgeAnalyticalMultiSource：consistent 立即短路；不在首个 contradicts_facts 短路
// （跨故事不相关源必触发 contradicts_facts），全部非 consistent 才告警（:258-271）。
async function judgeAnalyticalMulti(claim: Claim, sources: string[]) {
  let last = { verdict: 'contradicts_facts', reason: 'no source supports this analytical claim' };
  for (const i of rankSourcesByRelevance(claim.text, sources)) {
    const j = await judgeAnalytical(claim, sources[i], JUDGE_MODEL);
    if (j.verdict === 'consistent') return j;
    last = j;
  }
  return last;
}

// ---------------------------------------------------------------------------
// 限并发跑 judge。perStory 非空 → 对有 per-story 源的 brief 用多源短路判（保真运行时）；
// 否则回退单源（it.source）。
// ---------------------------------------------------------------------------
async function runJudge(items: GoldItem[], perStory: Record<string, string[]> = {}): Promise<Pred[]> {
  const out: Pred[] = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const it = items[i];
      const claim: Claim = { id: i, text: it.claim, type: it.type };
      const briefId = (it as any).brief_id ?? String(it.id).split('#')[0];
      const stories = perStory[briefId];
      let pred: string;
      let reason: string;
      if (it.type === 'analytical') {
        const j = stories?.length
          ? await judgeAnalyticalMulti(claim, stories)
          : await judgeAnalytical(claim, it.source, JUDGE_MODEL);
        pred = j.verdict; reason = j.reason;
      } else {
        const j = stories?.length
          ? await judgeFactualMulti(claim, stories)
          : await judgeFactual(claim, it.source, JUDGE_MODEL);
        pred = j.verdict; reason = j.reason;
      }
      out[i] = { id: it.id, gold: it.gold, pred, reason, strata: it.strata };
      done++;
      if (done % 10 === 0 || done === items.length) {
        console.log(`  judged ${done}/${items.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// 指标
// ---------------------------------------------------------------------------
// 混淆矩阵：confusion[gold][pred] = 计数
function confusion(preds: Pred[], classes: string[]): Record<string, Record<string, number>> {
  const m: Record<string, Record<string, number>> = {};
  for (const g of classes) {
    m[g] = {};
    for (const p of classes) m[g][p] = 0;
  }
  for (const r of preds) {
    if (!(r.gold in m)) continue; // 未知 gold 类跳过
    const p = r.pred in m[r.gold] ? r.pred : r.gold; // pred 落到非法类时计为一次错配的兜底
    m[r.gold][p] = (m[r.gold][p] ?? 0) + 1;
  }
  return m;
}

// Cohen's κ（多类）：po=对角/N；pe=Σ (行和/N)·(列和/N)；κ=(po-pe)/(1-pe)
function cohensKappa(m: Record<string, Record<string, number>>, classes: string[]): number {
  let N = 0;
  for (const g of classes) for (const p of classes) N += m[g][p];
  if (N === 0) return NaN;
  let po = 0;
  for (const c of classes) po += m[c][c];
  po /= N;
  let pe = 0;
  for (const c of classes) {
    const rowTotal = classes.reduce((s, p) => s + m[c][p], 0);
    const colTotal = classes.reduce((s, g) => s + m[g][c], 0);
    pe += (rowTotal / N) * (colTotal / N);
  }
  if (pe === 1) return 1; // 完全退化
  return (po - pe) / (1 - pe);
}

// per-class TPR(召回) / TNR / precision
// precision(c) = tp / (tp+fp) = judge 喊 c 的里头真为 c 的占比 = 1 − 该类误报率。
// 量「误拦率」就看 precision：precision 低 = judge 乱喊 c = 误拦多。predicted=tp+fp 是 judge 喊 c 的总数(样本量)。
function perClass(m: Record<string, Record<string, number>>, classes: string[]) {
  const res: Record<
    string,
    { support: number; predicted: number; tpr: number | null; tnr: number | null; precision: number | null }
  > = {};
  let N = 0;
  for (const g of classes) for (const p of classes) N += m[g][p];
  for (const c of classes) {
    const tp = m[c][c];
    const fn = classes.reduce((s, p) => s + (p === c ? 0 : m[c][p]), 0); // gold=c 判成别的
    const fp = classes.reduce((s, g) => s + (g === c ? 0 : m[g][c]), 0); // gold≠c 判成 c
    const support = tp + fn;
    const predicted = tp + fp;
    const negTotal = N - support;
    const tn = negTotal - fp;
    res[c] = {
      support,
      predicted,
      tpr: support > 0 ? tp / support : null, // 该类无样本 → 召回无定义
      tnr: negTotal > 0 ? tn / negTotal : null,
      precision: predicted > 0 ? tp / predicted : null, // judge 没喊过 c → 精度无定义
    };
  }
  return res;
}

function balancedAccuracy(perClassRes: ReturnType<typeof perClass>, classes: string[]): number {
  const recalls = classes.map((c) => perClassRes[c].tpr).filter((x): x is number => x !== null);
  return recalls.length ? recalls.reduce((s, x) => s + x, 0) / recalls.length : NaN;
}

function fmt(x: number | null): string {
  return x === null ? ' n/a ' : x.toFixed(3);
}

function printMatrix(m: Record<string, Record<string, number>>, classes: string[]) {
  const short = (c: string) => c.slice(0, 7).padStart(8);
  console.log(`  gold\\pred ${classes.map(short).join('')}`);
  for (const g of classes) {
    console.log(`  ${g.slice(0, 9).padEnd(9)} ${classes.map((p) => String(m[g][p]).padStart(8)).join('')}`);
  }
}

// 评估单个通道，返回 {kappa, balancedAcc, perClass, n}
function evalChannel(preds: Pred[], classes: string[], label: string) {
  const m = confusion(preds, classes);
  const k = cohensKappa(m, classes);
  const pc = perClass(m, classes);
  const bacc = balancedAccuracy(pc, classes);
  const n = preds.length;

  console.log(`\n=== ${label} 通道 (n=${n}) ===`);
  printMatrix(m, classes);
  console.log(`  Cohen's κ      = ${fmt(k)}`);
  console.log(`  balanced acc   = ${fmt(bacc)}`);
  console.log(`  per-class:`);
  for (const c of classes) {
    console.log(
      `    ${c.padEnd(14)} support=${String(pc[c].support).padStart(3)}  TPR(召回)=${fmt(pc[c].tpr)}  TNR=${fmt(pc[c].tnr)}` +
        `  judge喊=${String(pc[c].predicted).padStart(3)}  precision=${fmt(pc[c].precision)}`
    );
  }
  return { label, n, kappa: k, balancedAcc: bacc, perClass: pc, confusion: m };
}

// ---------------------------------------------------------------------------
async function main() {
  const goldPath = process.argv[2] || 'gold/judge-gold.example.jsonl';
  // source 旁车默认与 gold 同目录的 sources.jsonl；可用 GOLD_SOURCES 覆盖
  const sourcesPath = process.env.GOLD_SOURCES || goldPath.replace(/[^/]+$/, 'sources.jsonl');
  console.log(`[judge-meta-eval] gold=${goldPath} split=${SPLIT} sources=${sourcesPath} judge=${JUDGE_MODEL} κ_min=${KAPPA_MIN} recall_min=${RECALL_MIN}`);

  const gold = loadGold(goldPath, sourcesPath);
  const factualGold = gold.filter((g) => g.type === 'factual');
  const analyticalGold = gold.filter((g) => g.type === 'analytical');
  console.log(`[judge-meta-eval] 金标 ${gold.length} 条 (factual=${factualGold.length}, analytical=${analyticalGold.length})`);
  if (factualGold.length === 0) {
    console.error('✗ 无 factual 金标——gate 以 factual 通道为准，至少需要 factual 样本');
    process.exit(1);
  }

  // per-story 源（保真运行时多源短路判）；PERSTORY_SOURCES 给路径即启用
  const perStoryPath = process.env.PERSTORY_SOURCES || '';
  const perStory = perStoryPath ? loadPerStory(perStoryPath) : {};
  if (perStoryPath) {
    const n = Object.keys(perStory).length;
    console.log(`[judge-meta-eval] per-story 模式：${n} briefs 用多源短路判（保真运行时）；缺源的 brief 回退单源`);
  }

  console.log('[judge-meta-eval] 跑 judge...');
  const factualPreds = await runJudge(factualGold, perStory);
  const analyticalPreds = analyticalGold.length ? await runJudge(analyticalGold, perStory) : [];

  const factualRes = evalChannel(factualPreds, FACTUAL_CLASSES, 'factual');
  const analyticalRes = analyticalPreds.length
    ? evalChannel(analyticalPreds, ANALYTICAL_CLASSES, 'analytical')
    : null;

  // ---- gate（以 factual 通道为准）----
  const failReasons: string[] = [];
  if (!(factualRes.kappa >= KAPPA_MIN)) {
    failReasons.push(`κ=${fmt(factualRes.kappa)} < ${KAPPA_MIN}`);
  }
  for (const c of HALLUCINATION_CLASSES) {
    const r = factualRes.perClass[c];
    if (r.support === 0) {
      console.log(`  ⚠ gate: ${c} 金标 0 样本，跳过其召回闸（金标需补该类）`);
      continue;
    }
    if (!((r.tpr ?? 0) >= RECALL_MIN)) {
      failReasons.push(`${c} 召回=${fmt(r.tpr)} < ${RECALL_MIN}`);
    }
  }
  const pass = failReasons.length === 0;

  // ---- 错配明细（人看）----
  const mismatches = factualPreds.filter((r) => r.gold !== r.pred);
  if (mismatches.length) {
    console.log(`\n=== factual 错配 ${mismatches.length}/${factualPreds.length}（judge ≠ 人）===`);
    for (const r of mismatches.slice(0, 30)) {
      console.log(`  [${r.id}] gold=${r.gold} pred=${r.pred} :: ${r.reason.slice(0, 90)}`);
    }
  }

  // ---- 落报告 ----
  const report = {
    checked_at: new Date().toISOString(),
    gold_path: goldPath,
    judge_model: JUDGE_MODEL,
    gate: { kappa_min: KAPPA_MIN, recall_min: RECALL_MIN, pass, fail_reasons: failReasons },
    factual: factualRes,
    analytical: analyticalRes,
    mismatches,
  };
  mkdirSync('eval-reports/judge-meta', { recursive: true });
  const out = `eval-reports/judge-meta/meta-${Date.now()}.json`;
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n[judge-meta-eval] 报告 → ${out}`);

  console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'} —— judge meta-eval${pass ? '（尺子可信，可据此推进 enforce 复校）' : ': ' + failReasons.join('; ')}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('judge-meta-eval 失败:', e);
  process.exit(1);
});
