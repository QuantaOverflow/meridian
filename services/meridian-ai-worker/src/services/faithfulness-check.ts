/**
 * 忠实度传感器（mark-only）：线上默认 code_only 只标记不拦截不改稿；mode='full' 全量
 * LLM 判官仅供离线预筛批跑。
 *
 * 逐句把 brief 拆成原子 claim → 比对 source（brief 被允许使用的全部材料）→ 判 supported/
 * unsupported/contradicted → 汇总套「门 F」判据 → 出 verdict（block 字段实为 would_block，
 * 只记录不执行，见下）。
 *
 * 【2026-07-11 方向定案】线上只标记、离线审阅、成果回流生成端（memory:
 * intel-grounding-judge-validated）。默认 mode='code_only'：只跑拆 claim + extract-compare
 * 代码通道（确定性、~¥0.3/篇），LLM 判官（~100× qwen-max、判决噪声大）整体撤出线上、
 * 保留 mode='full' 给离线批跑当预筛。backend 路径 B（按 flagged 删句）已同步关闭。
 *
 * 判据（门 F，标定见 memory: faithfulness-runtime-gate）：
 *   BLOCK 当  (A) contradicted >= 2 且 contradicted_rate >= 0.05    ← 占比+绝对量双阈，单条不否决整篇
 *         或  (B) unsupported_rate > 0.15 且 genuine_unsupported >= 4  ← 又密又多=崩坏件
 *         或  (C) code_verified 矛盾 >= 1                            ← 最高危险层：代码坐实的数字/日期
 *                硬冲突（extract-compare 通道），确定性证据允许单票否决——离线实测修 6 弄坏 0、
 *                精度 0.833~1.0，恢复 6-25 双阈牺牲掉的孤条真矛盾灵敏度（见 extract-compare.ts）
 *   warning-only（记录不拦）：analytical contradicts_facts（虚构前提，太吵硬拦会天天空窗）
 *   注：(A)(B) 只在 mode='full' 下有意义——code_only 下 unsupported 恒 0、contradicted
 *   全部来自 code_verified，判据实际由 (C) 主导。
 *
 * 【2026-06-25 改】(A) 从「contradicted >= 1 单条即拦」改为占比+count>=2 双阈（FActScore/RAGAS
 * 占比聚合 + RefChecker 三标签分别算 rate 的业界共识）。动因：12 条 held-out 实测误拦 2/12，两条
 * 都是单条 claim（数字子量消歧 / 转述归属）否决整篇 20K 字简报，且 RUNS=5 确定型。一票否决 = 放大器。
 * 代价：单条真矛盾（如 FIFA 6/3 vs 源 6/11）暂会漏判——由后续 prompt 修（治 A/B 误判源头）恢复
 * count=1 灵敏度。阈值 0.05/2 为初值，待双盲 run 级金标扫 P-R 校准（enforce 取 precision>=0.95）。
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
import { type LLMCallPhase, type TraceContext } from './llm-call-logger';
import { callLLM, PHASE_DEFAULTS } from './call-llm';
// judge prompt 单一真源（eval 也 import 这里）——见 faithfulness-prompts.ts
import {
  EXTRACT_PROMPT,
  FACTUAL_PROMPT,
  ANALYTICAL_PROMPT,
  suspectSpecifics,
  rankSourcesByRelevance,
  CONTRA_VOTES,
  majorityVerdict,
} from './faithfulness-prompts';
// 抽取+程序比对通道（数字/日期硬冲突的确定性证据层），单一真源、eval 同 import
import { extractCompareClaim } from './extract-compare';

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
  // extract-compare 通道代码坐实的硬冲突（确定性证据，门 F 条款 C 的单票否决依据）
  code_verified?: boolean;
}

export type AnalyticalVerdict = 'consistent' | 'contradicts_facts';
export interface AnalyticalJudgement {
  claim: FaithClaim;
  verdict: AnalyticalVerdict;
  reason: string;
}

// code_only=线上传感器形态(拆claim+代码比对,无LLM判官);full=全量判官(离线批跑用)
export type FaithfulnessMode = 'code_only' | 'full';

export interface FaithfulnessVerdict {
  // 语义实为 would_block：线上只标记不拦截，调用方（backend）不据此拒发/删稿。
  block: boolean;
  block_reasons: string[];
  judge_model: string;
  mode: FaithfulnessMode;
  total_claims: number;
  factual_claims: number;
  analytical_claims: number;
  // 事实通道
  supported: number;
  genuine_unsupported: number;
  contradicted: number;
  // contradicted 中由 extract-compare 代码坐实的条数（门 F 条款 C）
  code_verified_conflicts: number;
  unsupported_rate: number;
  // 分析通道（次级信号，warning-only）
  analytical_consistent: number;
  analytical_contradicting: number;
  // 降级放行的次数：extract=ALIGN 解析失败(code_only 主路径)、analytical=判官未给有效 verdict。
  // >0 表示本次判决含【没核成却当作干净】的 claim，读数须按此折价——这两个数存在的唯一理由，
  // 就是让「静默全绿」与「真全绿」可区分。
  extract_failures: number;
  analytical_failures: number;
  // 需要人看的明细
  flagged_factual: FactualJudgement[];
  flagged_analytical: AnalyticalJudgement[];
  // 抽取出的 claim 全集（含未被 flag 的）。离线全量审计的「待判对象」——若只落 flagged，
  // supported 堆不可见、审计就无法逐条复用生产的切分与编号（得重拆、非确定性对不齐）。
  all_claims: FaithClaim[];
  // 仅 mode='full' 返回：全部 factual 判决（含 supported）。离线预筛用——审计抽样
  // 要从 supported 堆里随机抽一把兜预筛器的系统性盲区（极性类会被盖章 supported）。
  all_factual?: FactualJudgement[];
}

// 门 F 阈值（标定结论，改动前请回看 memory: faithfulness-runtime-gate）
const GATE_UNSUPPORTED_RATE = 0.15;
const GATE_UNSUPPORTED_MIN_COUNT = 4;
// 矛盾通道：占比+绝对量双阈（2026-06-25 反「单条一票否决」，见文件头注）
const GATE_CONTRADICTED_RATE = 0.05;
const GATE_CONTRADICTED_MIN_COUNT = 2;
// 代码坐实硬冲突（条款 C）：确定性证据层，单条即拦（见文件头注与 extract-compare.ts）
const GATE_CODE_CONFLICT_MIN_COUNT = 1;
// contradicted 召回：整条 claim 判定跑 K 个 pass 取并集，治裁判非确定性的「首判假阴漏抓真矛盾」
// （2026-06-26：gold Putin 多错 brief 本有 3 矛盾、单跑只抓 1<count2→漏判）。命中即早停，省成本。
const FACTUAL_RECALL_PASSES = 2;

// ============================================================================
// LLM 调用（in-process，复用 AIGatewayService，避免 HTTP 回跳）
// ============================================================================

interface JudgeCallContext {
  ai: AIGatewayService;
  env: CloudflareEnv;
  traceContext: TraceContext;
  phase: LLMCallPhase;
  nextCallIndex: () => number;
  // 判官/抽取的解析失败次数。这些失败仍会降级放行（不拖垮链路），但必须落进 verdict：
  // 否则「传感器没看成」与「传感器看了没发现」读数完全相同 = 静默全绿。
  extractFailures: number;
  analyticalFailures: number;
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
    extractFailures: 0,
    analyticalFailures: 0,
  };
}

// qwen-max 输出上限 ~8192，留余量作为截断重试的天花板
const JUDGE_OUTPUT_CAP = 8000;

async function callJudge(
  ctx: JudgeCallContext,
  prompt: string,
  model: string,
  maxTokens: number
): Promise<string> {
  // 截断即重试：finish_reason==='length' 表示输出撞 max_tokens 被截断 → JSON 残缺 →
  // parseJSON 失败 → judgeFactual 静默回退 unsupported（把裁判"话多"误记成脑补，虚增
  // unsupported）。检测到就放大预算重问，直到自然收尾或触及输出上限。放大而非一律高预算：
  // 常见短输出仍走小预算省 token，只有真被截断的尾部升级。
  let budget = maxTokens;
  for (;;) {
    // 配置走 call-llm（faithfulness phase 默认 dashscope/temp0/skipCache:true——原 callJudge
    // 忘传 skipCache，此处填对）；model 每次由 caller 传（判官模型）、maxTokens=budget 截断重试用。
    const result = await callLLM(ctx.ai, ctx.env, ctx.traceContext, ctx.phase,
      [{ role: 'user' as const, content: prompt }],
      {
        model,
        temperature: 0,
        maxTokens: budget,
        callIndex: ctx.nextCallIndex(),
        metadata: createRequestMetadata({ req: { header: () => 'faithfulness-check' } }),
      }
    );
    if (result.capability !== 'chat') {
      throw new Error('Unexpected response type from chat service');
    }
    const choice = (result as ChatResponse).choices?.[0];
    const content = choice?.message?.content || '';
    const bumped = Math.min(budget * 3, JUDGE_OUTPUT_CAP);
    // 未截断，或已到输出上限无法再放大 → 返回（后者交由上游 salvage/兜底处理）
    if (choice?.finish_reason !== 'length' || bumped <= budget) return content;
    budget = bumped;
  }
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
  // 800 是初始预算(FACTUAL_PROMPT 先输出 specifics_checked 再 verdict)；真被截断的长输出
  // 由 callJudge 检测 finish_reason==='length' 后放大重问，不再静默截断成假 unsupported。
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
  // 解析失败 / 未知枚举 仍降级为 consistent（保持既有容错，不拖垮链路），但必须留痕：
  // 否则「判官没给出有效答案」与「判官说没问题」读数相同 = 静默放行。
  if (!parsed || (parsed.verdict !== 'contradicts_facts' && parsed.verdict !== 'consistent')) {
    ctx.analyticalFailures++;
    console.warn(`[Faithfulness] analytical judge 未给出有效 verdict(${parsed?.verdict ?? 'parse-fail'})，降级为 consistent: ${claim.text.slice(0, 80)}`);
  }
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
  const order = rankSourcesByRelevance(claim.text, sources.map((s) => s.content));
  for (let rank = 0; rank < order.length; rank++) {
    const result = await judgeFactual(ctx, claim, sources[order[rank]].content, model);
    if (result.verdict === 'supported') return result;
    if (result.verdict === 'contradicted') {
      // 只采信「最相关源(rank-0)」的矛盾：低排名源常因共享词汇巧合撞上（伊朗导弹 claim 撞
      // 同主题乌克兰源），其矛盾不可信 → 降级 unsupported，继续找支撑（bug3 修复）。
      if (rank > 0) {
        lastUnsupported = { claim, verdict: 'unsupported', reason: `contradiction from lower-ranked source #${rank} downgraded (likely shared-vocabulary cross-story)` };
        continue;
      }
      // rank-0：self-consistency 复议坐实才信，单个抖动假矛盾不一票否决（见 majorityVerdict）
      const votes = [result];
      for (let v = 1; v < CONTRA_VOTES; v++) votes.push(await judgeFactual(ctx, claim, sources[order[rank]].content, model));
      const maj = majorityVerdict(votes.map((x) => x.verdict));
      const pick = votes.find((x) => x.verdict === maj);
      if (maj === 'contradicted' && pick) return pick; // 坐实矛盾 → 拦
      if (maj === 'supported' && pick) return pick; // 复议翻 supported → 放
      // 未坐实：视 unsupported，继续找其他相关源是否支撑
      lastUnsupported = { claim, verdict: 'unsupported', reason: `contradiction not corroborated (${votes.map((x) => x.verdict).join('/')})` };
      continue;
    }
    lastUnsupported = result;
  }
  return lastUnsupported;
}

// contradicted 召回包装：跑 FACTUAL_RECALL_PASSES 个独立 pass，跨 pass 取并集——
// 任一 pass 坐实矛盾即 contradicted（提召回，治裁判首判假阴漏抓真矛盾）。每 pass 内部仍走
// CONTRA_VOTES 多数坐实（精度不塌）；命中 contradicted 即早停（省成本，union 里矛盾优先）。
// union 优先级：contradicted > supported > unsupported。
async function judgeFactualWithRecall(
  ctx: JudgeCallContext,
  claim: FaithClaim,
  sources: StorySource[],
  model: string,
): Promise<FactualJudgement> {
  const passes: FactualJudgement[] = [];
  for (let p = 0; p < FACTUAL_RECALL_PASSES; p++) {
    const r = await judgeFactualMultiSource(ctx, claim, sources, model);
    passes.push(r);
    if (r.verdict === 'contradicted') break; // 已坐实矛盾，union 必为 contradicted，早停
  }
  return (
    passes.find((x) => x.verdict === 'contradicted') ??
    passes.find((x) => x.verdict === 'supported') ??
    passes[passes.length - 1]
  );
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

// extract-compare 前置通道：LLM 抽取 + 代码比对数字/日期。代码坐实硬冲突 → 直接
// contradicted + code_verified（确定性证据比 LLM 判官精度高，还省掉该 claim 后续
// 2 pass × 3 票的裁决成本）；没坐实 → 返回 null 交给原判官。只打 rank-0 最相关源
// （与 bug3 修复同理：低排名源的"同一事实"配对不可信，misses 无害、误配有害）。
async function codeVerifiedConflict(
  ctx: JudgeCallContext,
  claim: FaithClaim,
  sources: StorySource[],
  model: string
): Promise<FactualJudgement | null> {
  const order = rankSourcesByRelevance(claim.text, sources.map((s) => s.content));
  if (order.length === 0) return null;
  const conflicts = await extractCompareClaim(
    claim.text,
    sources[order[0]].content,
    (prompt, maxTokens) => callJudge(ctx, prompt, model, maxTokens),
    parseJSON,
    // 抽取失败计入 ctx，最终落 verdict.extract_failures。仍然降级放行（不拖垮链路），
    // 但让「传感器没看成」与「传感器看了没发现」在读数上可区分——否则 code_only 模式下
    // 一次 ALIGN 解析失败就等于一句静默"这条干净"。
    (stage, c) => {
      ctx.extractFailures++;
      console.warn(`[Faithfulness] extract-compare ${stage} 解析失败，该 claim 降级为无冲突: ${c.slice(0, 80)}`);
    }
  );
  if (conflicts.length === 0) return null;
  return {
    claim,
    verdict: 'contradicted',
    code_verified: true,
    reason: `code-verified conflict: ${conflicts.map((c) => c.why).join('; ')}`.slice(0, 300),
  };
}

// code_only 形态：只跑代码比对通道。factual 里只留代码坐实的冲突（其余 claim 未经
// LLM 判定，不伪造 supported 标签——诚实起见干脆不进列表，计数字段同理只反映本通道）；
// analytical 整体跳过。
async function judgeCodeOnly(
  ctx: JudgeCallContext,
  claims: FaithClaim[],
  sources: StorySource[],
  model: string,
  concurrency = 5
): Promise<{ factual: FactualJudgement[]; analytical: AnalyticalJudgement[] }> {
  const factual: FactualJudgement[] = [];
  const factualClaims = claims.filter((c) => c.type !== 'analytical');
  let next = 0;
  async function worker() {
    while (next < factualClaims.length) {
      const claim = factualClaims[next++];
      const conflict = await codeVerifiedConflict(ctx, claim, sources, model);
      if (conflict) factual.push(conflict);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, factualClaims.length || 1) }, worker));
  return { factual, analytical: [] };
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
        factual.push(
          (await codeVerifiedConflict(ctx, claim, sources, model)) ??
            (await judgeFactualWithRecall(ctx, claim, sources, model))
        );
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
  // 率的分母 = 抽取出的 factual claim 总数。code_only 模式下 factual 列表只含冲突条目，
  // 用 factual.length 当分母会把占比虚算成 1.0，必须由调用方传真实总数。
  totalFactualClaims: number
): { block: boolean; block_reasons: string[] } {
  const contradicted = factual.filter((j) => j.verdict === 'contradicted').length;
  const genuineUnsupported = factual.filter((j) => j.verdict === 'unsupported').length;
  const rate = totalFactualClaims ? genuineUnsupported / totalFactualClaims : 0;
  const contradictedRate = totalFactualClaims ? contradicted / totalFactualClaims : 0;

  const block_reasons: string[] = [];
  // (A) 事实矛盾：占比+绝对量双阈，单条不否决整篇（防一票否决放大器，见文件头注）
  if (contradicted >= GATE_CONTRADICTED_MIN_COUNT && contradictedRate >= GATE_CONTRADICTED_RATE) {
    block_reasons.push(
      `factual_contradiction:count=${contradicted}(>=${GATE_CONTRADICTED_MIN_COUNT}),rate=${contradictedRate.toFixed(3)}(>=${GATE_CONTRADICTED_RATE})`
    );
  }
  // (B) 又密又多的无源脑补（率且量合取，防小样本噪声）
  if (rate > GATE_UNSUPPORTED_RATE && genuineUnsupported >= GATE_UNSUPPORTED_MIN_COUNT) {
    block_reasons.push(
      `hallucination_density:rate=${rate.toFixed(3)}(>${GATE_UNSUPPORTED_RATE}),count=${genuineUnsupported}(>=${GATE_UNSUPPORTED_MIN_COUNT})`
    );
  }
  // (C) 代码坐实的硬冲突：确定性证据（非 LLM 判定），精度实测 0.833~1.0 → 允许单票否决。
  // (A) 的双阈是给 LLM 判官噪声设计的减震器，不适用于确定性证据层。
  const codeVerified = factual.filter((j) => j.verdict === 'contradicted' && j.code_verified);
  if (codeVerified.length >= GATE_CODE_CONFLICT_MIN_COUNT) {
    block_reasons.push(`code_verified_conflict:count=${codeVerified.length}(>=${GATE_CODE_CONFLICT_MIN_COUNT})`);
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
  // 不再硬编码 'qwen-max'：judge 模型由 phase 默认决定（call-llm 是调 LLM 的单一配置入口），
  // caller 只在真要指定时才传（eval 注入用）。留着旧默认会让 PHASE_DEFAULTS 的 provider 改动
  // 与这里的 model 打架——变成 provider=workers-ai + model=qwen-max 这种不存在的组合。
  model?: string,
  traceContext: TraceContext = {},
  mode: FaithfulnessMode = 'code_only'
): Promise<FaithfulnessVerdict> {
  // 入口解析一次，内部各 judge 函数的签名保持 string 不变
  const judgeModel = model ?? PHASE_DEFAULTS.faithfulness_check.model;

  // 观测性：复用入口 trace_id，把 claim extract / judge 全部串到同一条 R2 LLM 调用链。
  const judgeCtx = createJudgeCallContext(env, traceContext, 'faithfulness_check');

  const claims = await extractClaims(judgeCtx, brief, judgeModel);
  // 率的分母固定用抽取总数（code_only 下 factual 列表只含冲突条目，见 gateDecision 注）
  const factualClaims = claims.filter((c) => c.type !== 'analytical').length;
  const { factual, analytical } =
    mode === 'full'
      ? await judgeAll(judgeCtx, claims, sources, judgeModel)
      : await judgeCodeOnly(judgeCtx, claims, sources, judgeModel);

  const supported = factual.filter((j) => j.verdict === 'supported').length;
  const genuineUnsupported = factual.filter((j) => j.verdict === 'unsupported').length;
  const contradicted = factual.filter((j) => j.verdict === 'contradicted').length;
  const analyticalContradicting = analytical.filter((j) => j.verdict === 'contradicts_facts').length;
  const rate = factualClaims ? genuineUnsupported / factualClaims : 0;

  const { block, block_reasons } = gateDecision(factual, factualClaims);

  return {
    block,
    block_reasons,
    judge_model: judgeModel,
    mode,
    total_claims: claims.length,
    factual_claims: factualClaims,
    analytical_claims: analytical.length,
    supported,
    genuine_unsupported: genuineUnsupported,
    contradicted,
    code_verified_conflicts: factual.filter((j) => j.verdict === 'contradicted' && j.code_verified).length,
    unsupported_rate: rate,
    // 解析失败计数：>0 表示本次判决里有 claim 是被【降级放行】而非【核查通过】的，
    // 读数需按此折价。缺了它，「传感器没看成」与「传感器看了没发现」完全同形（静默全绿）。
    extract_failures: judgeCtx.extractFailures,
    analytical_failures: judgeCtx.analyticalFailures,
    analytical_consistent: analytical.length - analyticalContradicting,
    analytical_contradicting: analyticalContradicting,
    flagged_factual: factual.filter((j) => j.verdict !== 'supported'),
    flagged_analytical: analytical.filter((j) => j.verdict === 'contradicts_facts'),
    all_claims: claims,
    ...(mode === 'full' ? { all_factual: factual } : {}),
  };
}
