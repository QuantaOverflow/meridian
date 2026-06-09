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
 * judge 模型默认 qwen-max（与标定同模型，换模型会让 0.15/4 阈值失效）。
 * 注：79298c6 修掉「逐字硬降级」后，judge 的 verdict=unsupported 直接就是干净的真·无源添加，
 * 运行时无需再洗 reason（那层 reason 清洗只为让被污染的旧报告能用作标定集）。
 */

import { AIGatewayService } from './ai-gateway';
import { CloudflareEnv, ChatResponse } from '../types';
import { createRequestMetadata } from '../utils/common';

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

async function callJudge(
  ai: AIGatewayService,
  prompt: string,
  model: string,
  maxTokens: number
): Promise<string> {
  const result = await ai.chat({
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
// ① 拆原子 claim（prompt 移植自 eval claims.ts，已标定）
// ============================================================================

const EXTRACT_PROMPT = (brief: string) => `
You extract atomic statements from a news brief and classify each, so they can
be checked appropriately.

# Two types
- "factual": an assertion about what happened or exists — a checkable event,
  number, date, name, quote, action, or relationship. ("X announced Y on Z",
  "Company A acquired B", "the deal centers on facility C").
- "analytical": the briefer's interpretation, implication, prediction, or
  strategic assessment — signalled by language like "this signals", "suggests",
  "gains leverage", "could reshape", "the strategic read is", "hints at".
  These are meant to extrapolate beyond the literal facts.

# Rules
- Split compound sentences into separate atomic statements.
- A statement that blends fact + interpretation: split it. The checkable part
  is factual, the interpretive part is analytical.
- Skip pure section headers, transitions, and meta sentences.

# Brief
${brief}

# Output
Reply with ONLY a JSON array inside a \`\`\`json fenced block. No prose.
Each element: {"text": "<atomic statement>", "type": "factual" | "analytical"}
`.trim();

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

async function extractClaims(ai: AIGatewayService, brief: string, model: string): Promise<FaithClaim[]> {
  const raw = await callJudge(ai, EXTRACT_PROMPT(brief), model, 8000);
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
// ② 逐条裁决（prompts 移植自 eval judge.ts，已标定）
// ============================================================================

const FACTUAL_PROMPT = (claim: string, source: string) => `
You are a strict faithfulness judge. Decide whether a CLAIM is grounded in the
SOURCE material below. The source is everything the brief was allowed to use.

# Verdicts
- supported: the source directly states or clearly entails the claim. You MUST
  return the exact sentence/phrase from the source that supports it.
- unsupported: the source neither states nor contradicts the claim (an addition
  not grounded in the source — possible hallucination).
- contradicted: the source asserts something incompatible with the claim.

# Hard rule
For "supported", evidence_quote MUST be copied verbatim from the SOURCE (an exact
substring). If you cannot copy a supporting sentence verbatim, the verdict is
"unsupported", not "supported".

# CLAIM
${claim}

# SOURCE
${source}

# Output
Reply with ONLY a JSON object inside a \`\`\`json fenced block. No prose.
{
  "verdict": "supported" | "unsupported" | "contradicted",
  "evidence_quote": "<verbatim substring of SOURCE, or empty string>",
  "reason": "<one short sentence>"
}
`.trim();

const ANALYTICAL_PROMPT = (claim: string, source: string) => `
You are judging an ANALYTICAL statement from a news brief — an interpretation,
implication, or strategic assessment. It is allowed to extrapolate beyond the
literal facts. Do NOT require it to be stated verbatim in the source.

Decide only whether its underlying premise is consistent with the source:
- consistent: a defensible reading of facts that ARE in the source (even if the
  inference itself goes beyond them).
- contradicts_facts: the inference relies on, or asserts, something the source
  contradicts, OR it is about an entity/event that does not appear in the source
  at all (analysis built on a fabricated premise).

# ANALYTICAL STATEMENT
${claim}

# SOURCE
${source}

# Output
Reply with ONLY a JSON object inside a \`\`\`json fenced block. No prose.
{
  "verdict": "consistent" | "contradicts_facts",
  "reason": "<one short sentence>"
}
`.trim();

async function judgeFactual(
  ai: AIGatewayService,
  claim: FaithClaim,
  source: string,
  model: string
): Promise<FactualJudgement> {
  const raw = await callJudge(ai, FACTUAL_PROMPT(claim.text, source), model, 500);
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
  ai: AIGatewayService,
  claim: FaithClaim,
  source: string,
  model: string
): Promise<AnalyticalJudgement> {
  const raw = await callJudge(ai, ANALYTICAL_PROMPT(claim.text, source), model, 300);
  const parsed = parseJSON<{ verdict: string; reason?: string }>(raw);
  const verdict: AnalyticalVerdict = parsed?.verdict === 'contradicts_facts' ? 'contradicts_facts' : 'consistent';
  return { claim, verdict, reason: (parsed?.reason || '').toString().slice(0, 300) };
}

// 对单条 factual claim 逐源试判：碰到 supported/contradicted 立即短路，全部 miss 才算 unsupported。
// 每份故事源 ~7.5K chars，远低于 qwen-max 30720 token 限制（旧合并 source ~141K 会 400）。
async function judgeFactualMultiSource(
  ai: AIGatewayService,
  claim: FaithClaim,
  sources: StorySource[],
  model: string,
): Promise<FactualJudgement> {
  let lastUnsupported: FactualJudgement = { claim, verdict: 'unsupported', reason: 'no source covers this claim' };
  for (const { content } of sources) {
    const result = await judgeFactual(ai, claim, content, model);
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
  ai: AIGatewayService,
  claim: FaithClaim,
  sources: StorySource[],
  model: string,
): Promise<AnalyticalJudgement> {
  let lastContradicting: AnalyticalJudgement = { claim, verdict: 'contradicts_facts', reason: 'no source supports this analytical claim' };
  for (const { content } of sources) {
    const result = await judgeAnalytical(ai, claim, content, model);
    if (result.verdict === 'consistent') return result;
    lastContradicting = result;
  }
  return lastContradicting;
}

// 限并发跑全部 claim，按类型分流
async function judgeAll(
  ai: AIGatewayService,
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
        analytical.push(await judgeAnalyticalMultiSource(ai, claim, sources, model));
      } else {
        factual.push(await judgeFactualMultiSource(ai, claim, sources, model));
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
  model = 'qwen-max'
): Promise<FaithfulnessVerdict> {
  const ai = new AIGatewayService(env);

  const claims = await extractClaims(ai, brief, model);
  const { factual, analytical } = await judgeAll(ai, claims, sources, model);

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
