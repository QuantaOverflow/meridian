/**
 * 运行时忠实度门（fail-closed backstop）
 *
 * 把已标定的离线 eval（scripts/eval/faithfulness/）移进 brief 发出路径上的运行时关卡：
 * 逐句把 brief 拆成原子 claim → 比对 source（brief 被允许使用的全部材料）→ 判 supported/
 * unsupported/contradicted → 汇总套「门 F」判据 → 出 block / pass。
 *
 * 判据（门 F，标定见 memory: faithfulness-runtime-gate）：
 *   BLOCK 当  (A) contradicted >= 1                              ← 事实矛盾，单条即灾难
 *         或  (B) unsupported_rate > 0.15 且 genuine_unsupported >= 4  ← 又密又多=崩坏件
 *   warning-only（记录不拦）：analytical contradicts_facts（虚构前提，太吵硬拦会天天空窗）
 *
 * 【红线】analytical verdict 永不可用于 gate/revision。2026-06-16 meta-eval 实测分析通道
 * κ=0.27（contradicts_facts 召回仅 0.30，judge 放过 70% 虚构前提）——这把尺不可信。事实
 * 通道 κ=0.76 可信，门拦截只键在事实。详见 memory: eval-program-direction。
 *
 * judge 模型默认 qwen-max（与标定同模型，换模型会让 0.15/4 阈值失效）。
 * 注：79298c6 修掉「逐字硬降级」后，judge 的 verdict=unsupported 直接就是干净的真·无源添加，
 * 运行时无需再洗 reason（那层 reason 清洗只为让被污染的旧报告能用作标定集）。
 */

import { AIGatewayService } from './ai-gateway';
import { CloudflareEnv, ChatResponse } from '../types';
import { createRequestMetadata } from '../utils/common';
import { loggedChat, type LLMCallPhase, type TraceContext } from './llm-call-logger';
// judge prompt 单一真源（eval 也 import 这里）——见 faithfulness-prompts.ts
import { EXTRACT_PROMPT, FACTUAL_PROMPT, ANALYTICAL_PROMPT, suspectSpecifics, rankSourcesByRelevance } from './faithfulness-prompts';

// ============================================================================
// 类型
// ============================================================================

export type ClaimType = 'factual' | 'analytical';
export interface FaithClaim {
  id: number;
  text: string;
  type: ClaimType;
}

// 每个故事对应一份情报报告；per-story 判断时只喂该故事的 source，躲过 context 超限
export interface StorySource {
  storyId: string;
  content: string;
}

export type FaithVerdict = 'supported' | 'unsupported' | 'contradicted';
export interface FactualJudgement {
  claim: FaithClaim;
  verdict: FaithVerdict;
  reason: string;
}

export type AnalyticalVerdict = 'consistent' | 'contradicts_facts';
export interface AnalyticalJudgement {
  claim: FaithClaim;
  verdict: AnalyticalVerdict;
  reason: string;
}

export interface FaithfulnessVerdict {
  block: boolean;
  block_reasons: string[];
  judge_model: string;
  total_claims: number;
  factual_claims: number;
  analytical_claims: number;
  // 事实通道
  supported: number;
  genuine_unsupported: number;
  contradicted: number;
  unsupported_rate: number;
  // 分析通道（次级信号，warning-only）
  analytical_consistent: number;
  analytical_contradicting: number;
  // 需要人看的明细
  flagged_factual: FactualJudgement[];
  flagged_analytical: AnalyticalJudgement[];
}

// 门 F 阈值（标定结论，改动前请回看 memory: faithfulness-runtime-gate）
export const GATE_UNSUPPORTED_RATE = 0.15;
export const GATE_UNSUPPORTED_MIN_COUNT = 4;

// ============================================================================
// LLM 调用（in-process，复用 AIGatewayService，避免 HTTP 回跳）
// ============================================================================

interface JudgeCallContext {
  ai: AIGatewayService;
  env: CloudflareEnv;
  traceContext: TraceContext;
  phase: LLMCallPhase;
  nextCallIndex: () => number;
}

function createJudgeCallContext(
  env: CloudflareEnv,
  traceContext: TraceContext,
  phase: LLMCallPhase
): JudgeCallContext {
  let next = traceContext.callIndex ?? 0;
  return {
    ai: new AIGatewayService(env),
    env,
    traceContext,
    phase,
    nextCallIndex: () => next++,
  };
}

async function callJudge(
  ctx: JudgeCallContext,
  prompt: string,
  model: string,
  maxTokens: number
): Promise<string> {
  // 观测性：faithfulness 是 in-process LLM 调用，也必须经 loggedChat 才会按 trace 落 R2。
  const result = await loggedChat(ctx.ai, ctx.env, {
    ...ctx.traceContext,
    callIndex: ctx.nextCallIndex(),
  }, ctx.phase, {
    messages: [{ role: 'user' as const, content: prompt }],
    provider: 'dashscope',
    model,
    temperature: 0,
    max_tokens: maxTokens,
    metadata: createRequestMetadata({ req: { header: () => 'faithfulness-check' } }),
  });
  if (result.capability !== 'chat') {
    throw new Error('Unexpected response type from chat service');
  }
  return (result as ChatResponse).choices?.[0]?.message?.content || '';
}

// 从带 ```json fenced / 前后噪声的 LLM 输出里抠 JSON（与 eval llm.ts parseJSON 同策略）
function parseJSON<T = any>(raw: string): T | null {
  const candidates: string[] = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  const f = raw.indexOf('{');
  const lb = raw.lastIndexOf('}');
  if (f >= 0 && lb > f) candidates.push(raw.slice(f, lb + 1));
  const fa = raw.indexOf('[');
  const la = raw.lastIndexOf(']');
  if (fa >= 0 && la > fa) candidates.push(raw.slice(fa, la + 1));
  candidates.push(raw);
  for (const c of candidates) {
    const cleaned = c
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,(\s*[}\]])/g, '$1')
      .trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      /* next */
    }
  }
  return null;
}

// ============================================================================
// ① 拆原子 claim（EXTRACT_PROMPT 见 faithfulness-prompts.ts，单一真源）
// ============================================================================

// 截断容错：完整解析失败时，从残缺数组里抢救出所有完整的 {...} 对象
function salvageObjects(raw: string): Array<{ text?: string; type?: string }> {
  const out: Array<{ text?: string; type?: string }> = [];
  const re = /\{[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    try {
      const o = JSON.parse(m[0]);
      if (o && typeof o.text === 'string') out.push(o);
    } catch {
      /* skip */
    }
  }
  return out;
}

async function extractClaims(ctx: JudgeCallContext, brief: string, model: string): Promise<FaithClaim[]> {
  const raw = await callJudge(ctx, EXTRACT_PROMPT(brief), model, 8000);
  let arr = parseJSON<Array<{ text?: string; type?: string }>>(raw);
  if (!Array.isArray(arr)) arr = salvageObjects(raw);
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error(`claim extraction failed to parse; raw head: ${raw.slice(0, 200)}`);
  }
  return arr
    .filter((c) => c && typeof c.text === 'string' && c.text.trim().length > 0)
    .map((c, i) => ({
      id: i,
      text: (c.text as string).trim(),
      type: (c.type === 'analytical' ? 'analytical' : 'factual') as ClaimType,
    }));
}

// ============================================================================
// ② 逐条裁决（FACTUAL_PROMPT / ANALYTICAL_PROMPT 见 faithfulness-prompts.ts，单一真源）
// ============================================================================

async function judgeFactual(
  ctx: JudgeCallContext,
  claim: FaithClaim,
  source: string,
  model: string
): Promise<FactualJudgement> {
  // Lever A：确定性挑出 claim 里源中找不到的数字/日期，作为注意力提示喂 judge
  const suspects = suspectSpecifics(claim.text, source);
  // 800(原 500)：新 FACTUAL_PROMPT 先输出 specifics_checked 再 verdict，留窗口防截断
  const raw = await callJudge(ctx, FACTUAL_PROMPT(claim.text, source, suspects), model, 800);
  const parsed = parseJSON<{ verdict: string; reason?: string }>(raw);
  // 解析失败按 unsupported 兜底（fail-closed：宁可多记一条 flag，也不放过潜在脑补）
  const verdict: FaithVerdict =
    parsed && (['supported', 'unsupported', 'contradicted'] as FaithVerdict[]).includes(parsed.verdict as FaithVerdict)
      ? (parsed.verdict as FaithVerdict)
      : 'unsupported';
  return {
    claim,
    verdict,
    reason: (parsed?.reason || (parsed ? '' : `judge parse failed: ${raw.slice(0, 120)}`)).toString().slice(0, 300),
  };
}

async function judgeAnalytical(
  ctx: JudgeCallContext,
  claim: FaithClaim,
  source: string,
  model: string
): Promise<AnalyticalJudgement> {
  const raw = await callJudge(ctx, ANALYTICAL_PROMPT(claim.text, source), model, 300);
  const parsed = parseJSON<{ verdict: string; reason?: string }>(raw);
  const verdict: AnalyticalVerdict = parsed?.verdict === 'contradicts_facts' ? 'contradicts_facts' : 'consistent';
  return { claim, verdict, reason: (parsed?.reason || '').toString().slice(0, 300) };
}

// 对单条 factual claim 逐源试判：碰到 supported/contradicted 立即短路，全部 miss 才算 unsupported。
// 每份故事源 ~7.5K chars，远低于 qwen-max 30720 token 限制（旧合并 source ~141K 会 400）。
async function judgeFactualMultiSource(
  ctx: JudgeCallContext,
  claim: FaithClaim,
  sources: StorySource[],
  model: string,
): Promise<FactualJudgement> {
  let lastUnsupported: FactualJudgement = { claim, verdict: 'unsupported', reason: 'no source covers this claim' };
  // 只对与 claim 最相关的 top-k 源判，躲过跨故事假矛盾（见 rankSourcesByRelevance）
  for (const i of rankSourcesByRelevance(claim.text, sources.map((s) => s.content))) {
    const result = await judgeFactual(ctx, claim, sources[i].content, model);
    if (result.verdict === 'contradicted') return result;
    if (result.verdict === 'supported') return result;
    lastUnsupported = result;
  }
  return lastUnsupported;
}

// 对单条 analytical claim 逐源试判：任一源 consistent 立即短路（找到支撑即过）；
// 全部源都 contradicts_facts 才算真告警。
// 注：analytical prompt 把"source 中无此实体"也判为 contradicts_facts，所以不能在
// 第一个 contradicts_facts 短路——跨故事的不相关 source 必然触发该 verdict。
async function judgeAnalyticalMultiSource(
  ctx: JudgeCallContext,
  claim: FaithClaim,
  sources: StorySource[],
  model: string,
): Promise<AnalyticalJudgement> {
  let lastContradicting: AnalyticalJudgement = { claim, verdict: 'contradicts_facts', reason: 'no source supports this analytical claim' };
  // 同事实通道：只判 top-k 相关源，去跨故事噪声
  for (const i of rankSourcesByRelevance(claim.text, sources.map((s) => s.content))) {
    const result = await judgeAnalytical(ctx, claim, sources[i].content, model);
    if (result.verdict === 'consistent') return result;
    lastContradicting = result;
  }
  return lastContradicting;
}

// 限并发跑全部 claim，按类型分流
async function judgeAll(
  ctx: JudgeCallContext,
  claims: FaithClaim[],
  sources: StorySource[],
  model: string,
  concurrency = 5
): Promise<{ factual: FactualJudgement[]; analytical: AnalyticalJudgement[] }> {
  const factual: FactualJudgement[] = [];
  const analytical: AnalyticalJudgement[] = [];
  let next = 0;
  async function worker() {
    while (next < claims.length) {
      const claim = claims[next++];
      if (claim.type === 'analytical') {
        analytical.push(await judgeAnalyticalMultiSource(ctx, claim, sources, model));
      } else {
        factual.push(await judgeFactualMultiSource(ctx, claim, sources, model));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, claims.length) }, worker));
  return { factual, analytical };
}

// ============================================================================
// ③ 门 F 判据：把计数翻成 block / pass
// ============================================================================

function gateDecision(
  factual: FactualJudgement[],
  analytical: AnalyticalJudgement[]
): { block: boolean; block_reasons: string[] } {
  const contradicted = factual.filter((j) => j.verdict === 'contradicted').length;
  const genuineUnsupported = factual.filter((j) => j.verdict === 'unsupported').length;
  const factualClaims = factual.length;
  const rate = factualClaims ? genuineUnsupported / factualClaims : 0;

  const block_reasons: string[] = [];
  // (A) 事实矛盾，单条即灾难
  if (contradicted >= 1) {
    block_reasons.push(`factual_contradiction:count=${contradicted}`);
  }
  // (B) 又密又多的无源脑补（率且量合取，防小样本噪声）
  if (rate > GATE_UNSUPPORTED_RATE && genuineUnsupported >= GATE_UNSUPPORTED_MIN_COUNT) {
    block_reasons.push(
      `hallucination_density:rate=${rate.toFixed(3)}(>${GATE_UNSUPPORTED_RATE}),count=${genuineUnsupported}(>=${GATE_UNSUPPORTED_MIN_COUNT})`
    );
  }
  return { block: block_reasons.length > 0, block_reasons };
}

// ============================================================================
// 对外入口
// ============================================================================

export async function runFaithfulnessCheck(
  env: CloudflareEnv,
  sources: StorySource[],
  brief: string,
  model = 'qwen-max',
  traceContext: TraceContext = {}
): Promise<FaithfulnessVerdict> {
  // 观测性：复用入口 trace_id，把 claim extract / judge 全部串到同一条 R2 LLM 调用链。
  const judgeCtx = createJudgeCallContext(env, traceContext, 'faithfulness_check');

  const claims = await extractClaims(judgeCtx, brief, model);
  const { factual, analytical } = await judgeAll(judgeCtx, claims, sources, model);

  const supported = factual.filter((j) => j.verdict === 'supported').length;
  const genuineUnsupported = factual.filter((j) => j.verdict === 'unsupported').length;
  const contradicted = factual.filter((j) => j.verdict === 'contradicted').length;
  const analyticalContradicting = analytical.filter((j) => j.verdict === 'contradicts_facts').length;
  const factualClaims = factual.length;
  const rate = factualClaims ? genuineUnsupported / factualClaims : 0;

  const { block, block_reasons } = gateDecision(factual, analytical);

  return {
    block,
    block_reasons,
    judge_model: model,
    total_claims: claims.length,
    factual_claims: factualClaims,
    analytical_claims: analytical.length,
    supported,
    genuine_unsupported: genuineUnsupported,
    contradicted,
    unsupported_rate: rate,
    analytical_consistent: analytical.length - analyticalContradicting,
    analytical_contradicting: analyticalContradicting,
    flagged_factual: factual.filter((j) => j.verdict !== 'supported'),
    flagged_analytical: analytical.filter((j) => j.verdict === 'contradicts_facts'),
  };
}

// ============================================================================
// ④ Revision（路径 B）：把 flagged 的 factual claim 从 brief 里删除/剥离
//
// v1 = source-free 外科修订。只处理事实通道的 unsupported/contradicted（真·无源添加
// 或与源矛盾），不碰 analytical（warning-only）。不重喂 source —— judge 的 reason 已说明
// 哪里无源，重喂合并 source 会撞 qwen-max 30720 token 上限（同 per-story 拆源的初衷）。
//
// 让 LLM 只回 edit-list（brief 原文片段 → 替换文本，空串=整段删），由本地程序化 apply：
// 只动 flagged 片段，brief 其余部分逐字不变 —— 可审计、防 LLM 重吐整篇时的漂移。
// 「按源改写成正确版本」需路由 per-story 源，留作后续增强。
// ============================================================================

export interface ReviseEdit {
  brief_span: string; // brief 里待改的 verbatim 子串
  replacement: string; // 修订后文本；空串 = 删除整段
  reason: string;
}
export interface RevisionResult {
  revised_brief: string;
  applied: ReviseEdit[]; // 成功 apply（span 在 brief 里精确命中）
  skipped: ReviseEdit[]; // span 非 brief 精确子串，未 apply（记录待查）
  changed: boolean;
}

const REVISE_PROMPT = (brief: string, flagged: FactualJudgement[]) => `
You are a careful news editor. A faithfulness check flagged the FACTUAL claims
below as NOT grounded in the source material (either unsupported additions or
contradicted by the source). Your job: surgically remove the ungrounded content
from the BRIEF while keeping everything else intact.

# For each flagged claim, choose:
- If the claim is an unsupported DETAIL grafted onto an otherwise sound sentence
  (e.g. an invented location/number/qualifier), rewrite just that sentence to
  drop the ungrounded detail and keep the supported core.
- If the whole sentence's point IS the ungrounded claim, delete the sentence.

# Hard rules
- "brief_span" MUST be an exact verbatim substring of the BRIEF (copy it letter
  for letter, including punctuation). It is the text you want to change.
- "replacement" is the corrected text, or an empty string "" to delete the span.
- Do NOT touch any text that wasn't flagged. Do NOT rephrase for style.
- Do NOT add any new facts. Removal/trimming only.

# Flagged factual claims
${flagged.map((j, i) => `${i + 1}. [${j.verdict}] "${j.claim.text}" — ${j.reason}`).join('\n')}

# BRIEF
${brief}

# Output
Reply with ONLY a JSON object inside a \`\`\`json fenced block. No prose.
{
  "edits": [
    { "brief_span": "<verbatim substring of BRIEF>", "replacement": "<corrected text or empty>", "reason": "<short>" }
  ]
}
`.trim();

// 删除片段后清理遗留的双空格 / 悬空标点；只做最轻量收尾，不动其它字符。
function tidyAfterDelete(s: string): string {
  return s
    .replace(/ {2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n');
}

export async function reviseBrief(
  env: CloudflareEnv,
  brief: string,
  flaggedFactual: FactualJudgement[],
  model = 'qwen-max',
  traceContext: TraceContext = {}
): Promise<RevisionResult> {
  // 只对真正有问题的事实 claim 动刀；supported 的不该出现在 flagged 里，但稳妥起见再过滤一次。
  const targets = flaggedFactual.filter((j) => j.verdict === 'unsupported' || j.verdict === 'contradicted');
  if (targets.length === 0) {
    return { revised_brief: brief, applied: [], skipped: [], changed: false };
  }

  // 观测性：修订本身也是 LLM 调用，单独 phase 便于和检查阶段区分。
  const judgeCtx = createJudgeCallContext(env, traceContext, 'faithfulness_revise');
  const raw = await callJudge(judgeCtx, REVISE_PROMPT(brief, targets), model, 4000);
  const parsed = parseJSON<{ edits?: ReviseEdit[] }>(raw);
  const edits = Array.isArray(parsed?.edits) ? parsed!.edits! : [];

  const applied: ReviseEdit[] = [];
  const skipped: ReviseEdit[] = [];
  let revised = brief;
  for (const e of edits) {
    if (!e || typeof e.brief_span !== 'string' || e.brief_span.length === 0) continue;
    const replacement = typeof e.replacement === 'string' ? e.replacement : '';
    // 只认精确子串命中：命中才改，没命中宁可不动（避免误伤），记入 skipped 待查。
    if (revised.includes(e.brief_span)) {
      revised = revised.replace(e.brief_span, replacement);
      applied.push({ brief_span: e.brief_span, replacement, reason: (e.reason || '').toString().slice(0, 300) });
    } else {
      skipped.push({ brief_span: e.brief_span, replacement, reason: (e.reason || '').toString().slice(0, 300) });
    }
  }
  if (applied.some((e) => e.replacement === '')) revised = tidyAfterDelete(revised);

  return { revised_brief: revised, applied, skipped, changed: applied.length > 0 };
}
