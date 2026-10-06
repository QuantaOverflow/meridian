/**
 * 【一次调用核查 · 读回复】回复分 CHECKS 与 RESULT 两段，结论是 RESULT 行之后的那个 JSON 对象。
 *
 * 逐字搬自冻结原型 `.scratch/one-call-sentence-check/port-source/`：`one-call.mts` 的 `parseResult`、`agent-kit.mts` 的 `parseJsonReply`。
 * 解不出就补一个右花括号再试一次（qwen3.8-flash 在 135 条回复里有 3 条漏了它，三条都是对的 flag）。
 * 与原型的差异只在最后一步：原型把解出的对象原样当结论，这里要有布尔的 `ok`，且 evidence 只留簇里确有的句子。
 */
import type { CheckCluster, Verdict } from './sentence-check';
import type { ParseOneCallReply } from '../types/one-call-check';

/** 回复里的 JSON 对象：漏出的 </think> 之前不要、围栏不要、否则取最外层花括号；模型把 [id:n, "原文"] 抄进 evidence 时还原成 [id, n]。 */
function parseJsonReply(content: string): any | null {
  const t = content.split('</think>').pop()!.replace(/^```\w*\s*|\s*```$/g, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    // eslint-disable-next-line local/no-swallowed-catch -- 整段不是 JSON：落到下面取最外层花括号
  }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  const raw = t.slice(a, b + 1);
  try {
    return JSON.parse(raw);
  } catch {
    // eslint-disable-next-line local/no-swallowed-catch -- 还不行：落到下面还原 evidence 里抄进来的标签
  }
  const fixed = raw.replace(/\[\s*(\d{3,})\s*:\s*(\d+)\s*(?:,\s*"(?:[^"\\]|\\.)*"\s*)?\]/g, '[$1, $2]');
  try {
    return JSON.parse(fixed);
  } catch {
    // eslint-disable-next-line local/no-swallowed-catch -- 读不出 = null，由核查那一步当作「回复读不出」重试
    return null;
  }
}

/** RESULT 行之后的 JSON；漏了右花括号就补一个再试。 */
function parseResult(content: string): any | null {
  const t = content.split(/^RESULT\b.*$/m).pop()!;
  return parseJsonReply(t) ?? parseJsonReply(`${t.trim()}}`);
}

export const parseOneCallReply: ParseOneCallReply = (content: string, c: CheckCluster): Verdict | null => {
  const r = parseResult(content);
  if (!r || typeof r !== 'object' || typeof r.ok !== 'boolean') return null;
  if (r.ok) return { ok: true };
  const evidence: [number, number][] = [];
  for (const e of Array.isArray(r.evidence) ? r.evidence : []) {
    const a = Number(Array.isArray(e) ? e[0] : e?.articleId);
    const n = Number(Array.isArray(e) ? e[1] : e?.sentence);
    if (c.byKey.has(`${a}:${n}`) && !evidence.some(([x, y]) => x === a && y === n)) evidence.push([a, n]);
  }
  const verdict: Verdict = { ok: false, evidence };
  for (const k of ['type', 'problem', 'fix'] as const) if (typeof r[k] === 'string') verdict[k] = r[k];
  return verdict;
};
