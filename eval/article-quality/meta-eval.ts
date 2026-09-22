// ============================================================================
// 文章质量门 Meta-Eval —— 验证 articleAnalysis 这把「质量尺」本身
//
// 在人工金标 (article → {content_quality, completeness}) 上现打分，算 scorer↔人 一致性：
//   通道 1  content_quality：3 类（OK/LOW_QUALITY/JUNK），κ + per-class
//   通道 2  completeness：   3 类，κ + per-class
//   通道 3  gate：           二元（KEEP/REJECT，由两维度按门逻辑折叠），算 cutoff 处 precision/recall
//
// gate 通道是 cutoff 校准的核心读数：
//   - REJECT 召回（recall_reject）= 真该拦的脏文章里拦住了几成 = 漏放率的补。低 → 脏文章混进聚类。
//   - REJECT 精度（precision_reject）= 拦下来的里头真该拦的占比 = 1 − 误杀率。低 → 好文章被误拦。
//   门是「拦脏」优先：召回不足比精度不足更伤下游（garbage in）。但误杀过高会丢真新闻。
//   两者权衡点就是 cutoff 该往松/紧调的依据。
//
// gate（接受闸）：以 gate 通道为准——
//   κ_gate >= KAPPA_MIN 且 REJECT 召回 >= RECALL_MIN。不过 → exit 1。
//   ⚠️ 这只是 harness 默认占位阈值；真正的接受阈值由用户在裁定环里依据业务容忍度定（见 README）。
//
// 用法：
//   pnpm meta [gold.jsonl]        # 默认 gold/quality-gold.example.jsonl
//   env: AI_WORKER_URL, KAPPA_MIN(0.6), RECALL_MIN(0.7), CONCURRENCY(4), SPLIT(dev|heldout|all)
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { scoreArticle } from './scorer.js';
import { deriveGate, CONTENT_QUALITY_CLASSES, COMPLETENESS_CLASSES } from './types.js';
import type { GoldItem, ContentQuality, Completeness, GateDecision } from './types.js';
// 指标统一在共享模块(原本地 metrics.ts 已并入)，见 docs/adr/0002。
import { evalChannel, fmt, type Pred } from '../_shared/metrics.js';

const KAPPA_MIN = Number(process.env.KAPPA_MIN ?? '0.6');
const RECALL_MIN = Number(process.env.RECALL_MIN ?? '0.7');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '4');
// 迭代 prompt 时只对 dev 调；最终 κ/召回只在 heldout 报，防过拟合。
const SPLIT = (process.env.SPLIT ?? 'all').toLowerCase();

const GATE_CLASSES: GateDecision[] = ['KEEP', 'REJECT'];

function loadGold(path: string): GoldItem[] {
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
    if (SPLIT !== 'all' && o.split !== SPLIT) return;
    const id = o.id ?? `item-${i + 1}`;
    if (!o.title || !o.content || !o.gold_content_quality || !o.gold_completeness) {
      throw new Error(
        `金标第 ${i + 1} 行缺字段(需 title/content/gold_content_quality/gold_completeness): ${t.slice(0, 80)}`
      );
    }
    if (!CONTENT_QUALITY_CLASSES.includes(o.gold_content_quality)) {
      throw new Error(`金标第 ${i + 1} 行 gold_content_quality 非法: ${o.gold_content_quality}`);
    }
    if (!COMPLETENESS_CLASSES.includes(o.gold_completeness)) {
      throw new Error(`金标第 ${i + 1} 行 gold_completeness 非法: ${o.gold_completeness}`);
    }
    items.push({ ...o, id });
  });
  return items;
}

interface ScoredGold {
  item: GoldItem;
  pred_content_quality?: ContentQuality;
  pred_completeness?: Completeness;
  pred_gate?: GateDecision;
  error?: string;
}

async function scoreGold(items: GoldItem[]): Promise<ScoredGold[]> {
  const out: ScoredGold[] = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const it = items[i];
      const r = await scoreArticle(it.title, it.content, it.url);
      const cq = r.content_quality as ContentQuality | undefined;
      const comp = r.completeness as Completeness | undefined;
      out[i] = {
        item: it,
        pred_content_quality: cq,
        pred_completeness: comp,
        pred_gate: cq && comp ? deriveGate({ content_quality: cq, completeness: comp }) : undefined,
        error: r.error,
      };
      done++;
      if (done % 10 === 0 || done === items.length) console.log(`  scored ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

async function main() {
  const goldPath = process.argv[2] || 'gold/quality-gold.example.jsonl';
  console.log(
    `[quality-meta-eval] gold=${goldPath} split=${SPLIT} κ_min=${KAPPA_MIN} recall_min=${RECALL_MIN}`
  );

  const gold = loadGold(goldPath);
  console.log(`[quality-meta-eval] 金标 ${gold.length} 条`);
  if (gold.length === 0) {
    console.error('✗ 无金标（检查 SPLIT 过滤）');
    process.exit(1);
  }

  console.log('[quality-meta-eval] 现打分（真实计费）...');
  const scored = await scoreGold(gold);

  const errored = scored.filter((s) => s.error);
  if (errored.length) {
    console.warn(`  ⚠ ${errored.length}/${scored.length} 篇打分报错，从指标剔除：`);
    for (const e of errored.slice(0, 10)) console.warn(`    [${e.item.id}] ${e.error}`);
  }
  const usable = scored.filter((s) => !s.error && s.pred_content_quality && s.pred_completeness);

  // 三通道 preds
  const cqPreds: Pred[] = usable.map((s) => ({
    id: s.item.id,
    gold: s.item.gold_content_quality,
    pred: s.pred_content_quality!,
    strata: s.item.strata,
  }));
  const compPreds: Pred[] = usable.map((s) => ({
    id: s.item.id,
    gold: s.item.gold_completeness,
    pred: s.pred_completeness!,
    strata: s.item.strata,
  }));
  const gatePreds: Pred[] = usable.map((s) => ({
    id: s.item.id,
    // 金标门裁决：优先用标注者直接给的 gold_gate，否则由两维度推导（与 runtime 门逻辑一致）
    gold:
      s.item.gold_gate ??
      deriveGate({
        content_quality: s.item.gold_content_quality,
        completeness: s.item.gold_completeness,
      }),
    pred: s.pred_gate!,
    strata: s.item.strata,
  }));

  const cqRes = evalChannel(cqPreds, [...CONTENT_QUALITY_CLASSES], 'content_quality');
  const compRes = evalChannel(compPreds, [...COMPLETENESS_CLASSES], 'completeness');
  const gateRes = evalChannel(gatePreds, [...GATE_CLASSES], 'gate(KEEP/REJECT)');

  // ---- cutoff 校准读数（gate 通道）----
  const rej = gateRes.perClass['REJECT'];
  console.log(`\n=== cutoff 校准读数（gate 通道）===`);
  console.log(`  REJECT 召回(抓脏率) = ${fmt(rej.tpr)}   ← 低 = 脏文章漏放进聚类`);
  console.log(`  REJECT 精度(1−误杀) = ${fmt(rej.precision)}   ← 低 = 好文章被误拦`);
  console.log(`  KEEP   召回         = ${fmt(gateRes.perClass['KEEP'].tpr)}`);

  // ---- gate（占位接受闸，真阈值由用户定）----
  const failReasons: string[] = [];
  if (!(gateRes.kappa >= KAPPA_MIN)) failReasons.push(`gate κ=${fmt(gateRes.kappa)} < ${KAPPA_MIN}`);
  if (rej.support === 0) {
    console.log(`  ⚠ gate: REJECT 金标 0 样本，跳过召回闸（金标需补脏文章样本）`);
  } else if (!((rej.tpr ?? 0) >= RECALL_MIN)) {
    failReasons.push(`REJECT 召回=${fmt(rej.tpr)} < ${RECALL_MIN}`);
  }
  const pass = failReasons.length === 0;

  // ---- 错配明细 ----
  const mismatches = gatePreds.filter((r) => r.gold !== r.pred);
  if (mismatches.length) {
    console.log(`\n=== gate 错配 ${mismatches.length}/${gatePreds.length}（scorer ≠ 人）===`);
    for (const r of mismatches.slice(0, 30)) {
      console.log(`  [${r.id}] gold=${r.gold} pred=${r.pred}`);
    }
  }

  // ---- 落报告 ----
  const report = {
    checked_at: new Date().toISOString(),
    gold_path: goldPath,
    split: SPLIT,
    n_gold: gold.length,
    n_usable: usable.length,
    n_errored: errored.length,
    gate_thresholds: { kappa_min: KAPPA_MIN, recall_min: RECALL_MIN, pass, fail_reasons: failReasons },
    content_quality: cqRes,
    completeness: compRes,
    gate: gateRes,
    gate_mismatches: mismatches,
  };
  mkdirSync('eval-reports', { recursive: true });
  const out = `eval-reports/meta-${Date.now()}.json`;
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n[quality-meta-eval] 报告 → ${out}`);

  console.log(
    `\n${pass ? '✅ PASS' : '❌ FAIL'} —— 质量尺 meta-eval${pass ? '（占位闸通过；真接受由用户依业务容忍度裁定）' : ': ' + failReasons.join('; ')}`
  );
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('quality-meta-eval 失败:', e);
  process.exit(1);
});
