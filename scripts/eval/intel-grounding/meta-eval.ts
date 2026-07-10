// ============================================================================
// Intel-grounding Judge Meta-Eval —— 验证「情报报告 vs 输入文章」grounding judge 这把尺本身
//
// 与 faithfulness 的 meta-eval.ts 同构：judge 算法、claim/source 形态、指标/gate 完全一致，
// 只是金标里的 (claim, source) 换成 (情报报告 claim, 该 story 的输入 RSS 文章)。
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
import type { Claim, FaithVerdict, AnalyticalVerdict } from './types.js';
// 指标(混淆矩阵/κ/per-class 召回·精确率·FPR·Fβ/balanced acc)统一在共享模块，见 docs/adr/0002。
import { evalChannel, fmt } from '../_shared/metrics.js';

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
// 限并发跑 judge
// ---------------------------------------------------------------------------
async function runJudge(items: GoldItem[]): Promise<Pred[]> {
  const out: Pred[] = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const it = items[i];
      const claim: Claim = { id: i, text: it.claim, type: it.type };
      let pred: string;
      let reason: string;
      if (it.type === 'analytical') {
        const j = await judgeAnalytical(claim, it.source, JUDGE_MODEL);
        pred = j.verdict;
        reason = j.reason;
      } else {
        const j = await judgeFactual(claim, it.source, JUDGE_MODEL);
        pred = j.verdict;
        reason = j.reason;
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

// 指标函数(confusion/cohensKappa/perClass/balancedAccuracy/fmt/printMatrix/evalChannel)
// 已抽到 ../_shared/metrics.ts 复用，见 docs/adr/0002。此处不再各抄一份。

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

  console.log('[judge-meta-eval] 跑 judge...');
  const factualPreds = await runJudge(factualGold);
  const analyticalPreds = analyticalGold.length ? await runJudge(analyticalGold) : [];

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
