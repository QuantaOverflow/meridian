/**
 * 【逐句核查】一句成稿 → 没问题，或问题 + 证据原句 + 建议改法，或没有结论（写作–核查循环的一步，ADR 0010）。
 *
 * 一个 qwen3.8 小 agent 按 ReAct 文本协议（Thought / Action / Args）用三个检索工具查整簇原文，最后给 verdict。
 * 逐字搬自原型 `apps/backend/prototypes/writer-faithfulness/`（本地，不入库；冻结副本在
 * `.scratch/writer-checker-loop/port-source/`）：`agent-kit.mts` 的 runAgent（只取文本协议一支）与
 * `checkers.mts` 的 sentenceCheck（verdict 校验在 act 里）。观察文本、步数规则一个字都别改。
 *
 * 与原型的差异（不改语义）：
 *   · 调用走 callLLM（phase `brief_block_v6_check`：qwen3.8、temperature 0.2、每步 max_tokens 3000），
 *     每次调用落 R2 llm-calls/、挂进请求的观测 span；callIndex 由调用方分配（见 services/brief-block-v6.ts）。
 *   · 限流（3021）的等待在调用层（services/workers-ai.ts），不占这里的重试，也不占 agent 的步数。
 *   · 不记 trajectory、不写实时日志：每一步的请求与回复都在 R2 的调用日志里。
 */
import { callLLM, neuronsOf } from './call-llm';
import type { TraceContext } from './llm-call-logger';
import type { ChatMessage, CloudflareEnv } from '../types';
import { sentencePrompts, type SentenceItem } from '../prompts/sentenceCheck';
import { parseAction } from '../utils/react-parse';
import { Lookup, type CheckCluster, type Verdict } from '../utils/sentence-check';

/** agent 发起调用要的东西；callIndex 每次调用（含重试）取一个新的，R2 key 才不撞。 */
export interface CheckCaller {
  ai: Ai;
  env: CloudflareEnv;
  trace: TraceContext;
  nextCallIndex: () => number;
}

/** 一次逐句核查（一个 epoch）的结果。 */
export interface SentenceCheckRun {
  verdict: Verdict | null;
  calls: number;
  neurons: number;
  /** 没有结论时为什么：某一步三次调用都失败（带报错），或动作 / 读不懂的回复用完 */
  end?: string;
}

interface Turn {
  observation: string;
  /** 这个动作结束了这次运行时设上；值就是结果 */
  done?: unknown;
}

/** 最多几个动作（原型 sentenceCheck 的 maxSteps 默认值）。 */
const MAX_STEPS = 20;
/** 读不懂的回复不算动作，单独封顶（原型 runAgent 的 maxUnreadable 默认值）。 */
const MAX_UNREADABLE = 10;
/** 一步的调用失败了再试几次（原型 runAgent：每步 3 次）。 */
const TRIES_PER_STEP = 3;

/**
 * ReAct 循环：模型回 Thought/Action/Args，`act` 执行动作、返回观察。maxSteps 数的是动作；读不懂的回复不算动作
 * （另有上限）。只剩一个动作时观察里会说（`lastCall` 说该做什么）。
 */
async function runAgent(o: {
  io: CheckCaller;
  system: string;
  user: string;
  actions: string[];
  act: (name: string, args: any) => Turn;
  maxSteps: number;
  lastCall: string;
  maxUnreadable?: number;
}): Promise<{ result: unknown | null; calls: number; neurons: number; end?: string }> {
  const messages: ChatMessage[] = [
    { role: 'system', content: o.system },
    { role: 'user', content: o.user },
  ];
  let calls = 0;
  let neurons = 0;
  let unreadable = 0;
  let failed: string | null = null;
  const done = new Set<string>();
  let result: unknown = undefined;
  const maxUnreadable = o.maxUnreadable ?? MAX_UNREADABLE;
  for (let step = 1; step - unreadable <= o.maxSteps + 1 && unreadable <= maxUnreadable && result === undefined; step++) {
    let content: string | null = null;
    let lastError = '';
    for (let retry = 0; retry < TRIES_PER_STEP && content === null; retry++) {
      calls++;
      try {
        // 传副本：后面还要往 messages 里追加，而请求体会被观测 span 按引用留着
        const res = await callLLM(o.io.ai, o.io.env, o.io.trace, 'brief_block_v6_check', [...messages], { callIndex: o.io.nextCallIndex() });
        neurons += neuronsOf(res);
        content = res.choices?.[0]?.message?.content ?? '';
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    if (content === null) {
      failed = lastError;
      break;
    }
    const parsed = parseAction(content);
    const name: string = parsed?.action ?? '';
    let observation: string;
    if (!parsed || !name) {
      unreadable++;
      observation = 'Your reply did not follow the format. Reply with exactly three parts: Thought: …, Action: <tool>, Args: {…}.';
    } else if (!o.actions.includes(name)) {
      observation = `Unknown action "${name}". Use one of: ${o.actions.join(', ')}.`;
    } else if (done.has(`${name} ${JSON.stringify(parsed.args ?? {})}`)) {
      // glm-4.7-flash 会卡在一个检索上，逐字重复上一步（原型 2026-10-04 探测）
      observation = `You already ran ${name} with these args; the result is above. Use a different lookup or give your result.`;
    } else {
      done.add(`${name} ${JSON.stringify(parsed.args ?? {})}`);
      const t = o.act(name, parsed.args ?? {});
      observation = t.observation;
      if (t.done !== undefined) result = t.done;
    }
    if (result !== undefined) break;
    const left = o.maxSteps - (step - unreadable);
    const tail = left === 1 ? `\n\nYou have one action left: ${o.lastCall}` : left <= 0 ? `\n\nNo actions left: ${o.lastCall}` : '';
    messages.push({ role: 'assistant', content }, { role: 'user', content: `Observation:\n${observation}${tail}` });
  }
  if (result !== undefined) return { result, calls, neurons };
  const end = failed !== null ? `error: ${failed}` : unreadable > maxUnreadable ? 'unreadable replies' : 'out of actions';
  return { result: null, calls, neurons, end };
}

/** 被接受的 `ok: false` 结论 → 记录形状：文字字段照原话，evidence 只留 [articleId, sentence] 形式的那些。 */
function verdictOf(x: any): Verdict {
  if (x.ok) return { ok: true };
  const text = (v: unknown) => (v == null ? undefined : String(v));
  const evidence = (Array.isArray(x.evidence) ? (x.evidence as unknown[]) : [])
    .filter((e): e is unknown[] => Array.isArray(e))
    .map(e => [Number(e[0]), Number(e[1])] as [number, number]);
  return { ok: false, type: text(x.type), problem: text(x.problem), evidence, fix: text(x.fix) };
}

/**
 * 核一句（一个 epoch）。`date`：简报日期，null = 没有带日期的文章。
 * 出错不抛：调用失败、步数用完都是「没有结论」（verdict null），由调用方记成没核到。
 */
export async function sentenceCheck(io: CheckCaller, c: CheckCluster, item: SentenceItem, date: string | null): Promise<SentenceCheckRun> {
  const env = new Lookup(c);
  env.show(item.cited.map(([a, n]) => `${a}:${n}`));
  const { system, user } = sentencePrompts(item, c, date, MAX_STEPS);
  const r = await runAgent({
    io,
    system,
    user,
    actions: ['search', 'timeline', 'read', 'verdict'],
    maxSteps: MAX_STEPS,
    lastCall: 'give your verdict now.',
    act: (name, args) => {
      if (name !== 'verdict') return { observation: (env as any)[name](args) };
      if (typeof args?.ok !== 'boolean') return { observation: 'REJECTED: verdict needs "ok": true or false.' };
      if (args.ok) return { observation: 'Verdict recorded.', done: { ok: true } };
      const { keys, errors } = env.citable(args.evidence);
      if (!keys.length) errors.push('cite the evidence sentence(s) that show the problem');
      return errors.length ? { observation: `REJECTED: ${errors.join('; ')}.` } : { observation: 'Verdict recorded.', done: args };
    },
  });
  return { verdict: r.result === null ? null : verdictOf(r.result), calls: r.calls, neurons: r.neurons, end: r.end };
}
