/**
 * 【逐句核查 agent 的回复解析 · 纯函数】不碰网络、不碰 env。
 *
 * 逐字搬自原型 `apps/backend/prototypes/writer-faithfulness/react-parse.mts`（本地，不入库；
 * 冻结副本在 `.scratch/writer-checker-loop/port-source/`，ADR 0010 的读数就是在它上面测的）。
 * 正则与宽松读法一个字都别改。只去掉了核查用不到的 `figures` / `answer` 形状。
 *
 * prompt 要的是 "Thought: / Action: / Args: {…}" 三行，但原型第一次整轮 holdout（arm hold-react）
 * ~300 步里有 69 步回的是一段 "Thought: …"、漏出来的 </think>、再跟一个 JSON 对象
 * {"thought","action","args"}，其中 30 个键名是大写开头。这些都算动作。
 */

/** 不分大小写取键。 */
function pick(x: any, key: string): any {
  if (!x || typeof x !== 'object') return undefined;
  const k = Object.keys(x).find(q => q.toLowerCase() === key);
  return k === undefined ? undefined : x[k];
}

/** Args 里的文本带了没转义的引号时的宽松读法：按它前后的键名定位。 */
export function salvageArgs(raw: string): any | null {
  const out: any = {};
  const text = raw.match(/"text"\s*:\s*"([\s\S]*?)"\s*,\s*"sources"/i) ?? raw.match(/"text"\s*:\s*"([\s\S]*)"\s*}\s*}?\s*$/i);
  if (text) out.text = text[1].replace(/\\"/g, '"');
  const sources = raw.match(/"sources"\s*:\s*(\[[\s\S]*?\]\s*\])/i);
  if (sources) {
    try {
      out.sources = JSON.parse(sources[1]);
    } catch {
      // eslint-disable-next-line local/no-swallowed-catch -- 解不出就不带 sources，由校验那一步再要
    }
  }
  // 逐句核查 agent 的结论：problem 与 fix 是散文，可能带没转义的引号
  const ok = raw.match(/"ok"\s*:\s*(true|false)/i);
  if (ok) out.ok = ok[1].toLowerCase() === 'true';
  const problem = raw.match(/"problem"\s*:\s*"([\s\S]*?)"\s*,\s*"(?:evidence|fix|type)"/i);
  if (problem) out.problem = problem[1].replace(/\\"/g, '"');
  const evidence = raw.match(/"evidence"\s*:\s*(\[[\s\S]*?\]\s*\])/i);
  if (evidence) {
    try {
      out.evidence = JSON.parse(evidence[1]);
    } catch {
      // eslint-disable-next-line local/no-swallowed-catch -- 解不出就不带 evidence，由校验那一步再要
    }
  }
  const fix = raw.match(/"fix"\s*:\s*"([\s\S]*)"\s*}\s*}?\s*$/i);
  if (fix) out.fix = fix[1].replace(/\\"/g, '"');
  for (const k of ['query', 'term', 'title', 'reason', 'verdict', 'type']) {
    const m = raw.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`, 'i'));
    if (m) out[k] = m[1];
  }
  for (const k of ['articleId', 'sentence', 'index']) {
    const m = raw.match(new RegExp(`"${k}"\\s*:\\s*(\\d+)`, 'i'));
    if (m) out[k] = Number(m[1]);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * v4-pro 有时一步只回一个 Args 对象（一段 Thought、漏出的 </think>、再跟 {"query": …}）：动作按键名推。
 * 只认检索与 verdict 的形状，不再放宽。
 */
function actionOf(x: any): string | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const k = new Set(Object.keys(x).map(q => q.toLowerCase()));
  if (k.has('query')) return 'search';
  if (k.has('term')) return 'timeline';
  if (k.has('articleid') && k.has('sentence')) return 'read';
  if (k.has('ok')) return 'verdict';
  return null;
}

const thoughtBefore = (t: string) => (t.match(/Thought\s*:\s*([\s\S]*?)(?:<\/think>|\{|$)/i)?.[1] ?? '').trim();

function argsOnly(t: string, raw: string): any | null {
  const x = salvageArgs(raw);
  const action = actionOf(x);
  return action ? { thought: thoughtBefore(t), action, args: x, argsNote: 'action inferred from args' } : null;
}

/** → { thought, action, args, argsNote? }；读不出动作时返回 null。 */
export function parseAction(content: string): any | null {
  const t = content.split('</think>').pop()!.replace(/^```\w*\s*|\s*```$/g, '').trim();

  // 1. 文本协议
  const action = t.match(/^\s*Action\s*:\s*([A-Za-z_]+)/im)?.[1]?.toLowerCase();
  if (action) {
    const thought = t.match(/Thought\s*:\s*([\s\S]*?)\n\s*Action\s*:/i)?.[1]?.trim() ?? '';
    const at = t.search(/^\s*Args\s*:/im);
    // 没有 Args 行：deepseek-v4-flash 会把对象写在 Action 那行（"Action: verdict {\"ok\": true}"）
    const rest = at >= 0 ? t.slice(at).replace(/^\s*Args\s*:\s*/i, '') : t.slice(t.search(/^\s*Action\s*:/im)).replace(/^\s*Action\s*:\s*[A-Za-z_]+/i, '');
    if (!rest.includes('{')) return { thought, action, args: {} };
    const raw = rest.slice(rest.indexOf('{'), rest.lastIndexOf('}') + 1);
    try {
      return { thought, action, args: JSON.parse(raw) };
    } catch {
      // eslint-disable-next-line local/no-swallowed-catch -- JSON 解不出（多半是没转义的引号）就按键名宽松读
      return { thought, action, args: salvageArgs(raw) ?? {}, argsNote: 'salvaged' };
    }
  }

  // 2. 标签式：<thought>…</thought> <action>…</action> <args>{…}</args>
  const tagAction = t.match(/<action>\s*([A-Za-z_]+)\s*<\/action>/i)?.[1]?.toLowerCase();
  if (tagAction) {
    const thought = t.match(/<thought>([\s\S]*?)<\/thought>/i)?.[1]?.trim() ?? '';
    const raw = t.match(/<args>([\s\S]*?)<\/args>/i)?.[1]?.trim() ?? '{}';
    try {
      return { thought, action: tagAction, args: JSON.parse(raw) };
    } catch {
      // eslint-disable-next-line local/no-swallowed-catch -- JSON 解不出就按键名宽松读
      return { thought, action: tagAction, args: salvageArgs(raw) ?? {}, argsNote: 'salvaged' };
    }
  }

  // 3. 一个 JSON 对象，键名大小写不限
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const raw = t.slice(start, end + 1);
  try {
    const x = JSON.parse(raw);
    const a = pick(x, 'action');
    if (a) return { thought: String(pick(x, 'thought') ?? ''), action: String(a).toLowerCase(), args: pick(x, 'args') ?? {} };
    const inferred = actionOf(x);
    if (inferred) return { thought: thoughtBefore(t), action: inferred, args: x, argsNote: 'action inferred from args' };
  } catch {
    // eslint-disable-next-line local/no-swallowed-catch -- 没转义的引号：落到下面按键名定位的读法
  }
  const a = raw.match(/"action"\s*:\s*"([A-Za-z_]+)"/i)?.[1];
  if (!a) return argsOnly(t, raw);
  const at = raw.search(/"args"\s*:/i);
  return {
    thought: raw.match(/"thought"\s*:\s*"([\s\S]*?)"\s*,\s*"action"/i)?.[1] ?? '',
    action: a.toLowerCase(),
    args: at >= 0 ? salvageArgs(raw.slice(at)) ?? {} : {},
    argsNote: 'salvaged',
  };
}
