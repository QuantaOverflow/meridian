/**
 * 抽取+程序比对通道（extract-compare）—— 治 LLM 判官的数字/日期确定性盲区
 *
 * 分工反转 Lever A（suspectSpecifics = regex 抽取 + LLM 比对，LLM 心算正是盲区所在）：
 * 本通道 = LLM 只抽取（找 claim 与源里"同一事实"的对应值，逐字引用、禁算术）+ 代码全比对
 * （数字带限定词 → 区间相交判冲突，rubric 对齐阈值蕴含；日期解析含 weekday + 文章
 * `> ISO` 时间戳推算 "on Friday" → 具体日期）。
 *
 * 只在代码坐实硬冲突且抽取自报 high confidence 时产出 conflict（单向信号，只用于把
 * 判定推向 contradicted，绝不反向"洗白"）。离线验证（2026-07-11，intel-grounding 金标）：
 * 真金标修 3 弄坏 0（contra 召回 0.25→0.625、supported 精度反升），合成集修 3 弄坏 0、
 * 精度保 1.0。详见 memory: intel-grounding-judge-validated / eval: _extract_compare.ts。
 *
 * 单一真源：eval（scripts/eval/intel-grounding/_extract_compare.ts）与 runtime
 * （faithfulness-check.ts）都 import 这里，与 faithfulness-prompts.ts 同惯例。
 */

// ============================================================================
// Stage A：LLM 抽取 prompt（不判断、不算术、逐字引用）
// ============================================================================

export const ALIGN_PROMPT = (claim: string, source: string) => `
You are a fact-alignment EXTRACTOR. You do NOT judge truth. You do NOT compute.
You only locate and quote, verbatim.

Given a CLAIM and a SOURCE (a set of news articles; each article starts with a
"## [title](url)" heading followed by a "> <ISO timestamp>" publication line):

For EVERY number, quantity, money amount, and date in the CLAIM, find the fact in
the SOURCE that describes the SAME thing (same event, same entity, same aspect).

Rules:
- Copy values VERBATIM. Keep qualifiers attached ("over 130", "at least 11",
  "about 600", "£50 million").
- If the SOURCE expresses the time of the event as a weekday or relative day
  ("on Friday", "yesterday"), quote it AS IS in source_value, and copy the
  publication ISO timestamp of the article that sentence came from into
  article_timestamp.
- If the source describes the same fact with a different value, still pair them
  (that is exactly what we need). Do NOT decide whether they conflict.
- If the source never addresses that fact, source_status="absent".
- confidence: "high" only if you are certain claim value and source value
  describe the SAME fact of the SAME event (not a similar fact of a sub-event,
  a different location, a comparison baseline, or a different time period).

Output ONLY JSON:
{"pairs":[{"aspect":"<what this value measures, e.g. 'civilians killed in the strikes'>",
"kind":"number|date",
"claim_value":"<verbatim from claim>",
"source_status":"same_fact|absent",
"source_value":"<verbatim from source, only when same_fact>",
"source_quote":"<verbatim source sentence fragment containing source_value, <=160 chars>",
"article_timestamp":"<ISO timestamp of that article, if relevant/known>",
"confidence":"high|low"}]}

# CLAIM
${claim}

# SOURCE
${source}
`;

// 定向补抽：首轮标 absent/low 的对，常因事件以间接表述出现（"On Friday, the High Court
// ordered..." vs claim 里点名法官）或长源检索漏配（"30 medical personnel"明文在源却标
// absent）而丢失。对单个事实聚焦追问一次。
export const VALUE_RETRY_PROMPT = (
  claim: string,
  aspect: string,
  claimValue: string,
  kind: string,
  source: string
) => `
You are a fact-alignment EXTRACTOR. You do NOT judge truth. You do NOT compute.

The CLAIM below gives the value "${claimValue}" for this fact:
  fact: ${aspect}
  claim: ${claim}

Search the SOURCE for what value IT gives for this SAME fact.
${
  /date/i.test(kind)
    ? `Look for ANY temporal expression about when this event happened — an explicit
date, a weekday ("on Friday", "last Friday"), or a relative day ("yesterday").`
    : `Look for ANY numeric value for this fact — a count, amount, or quantity, even
if phrased differently ("two tranches of 50 million pounds each").`
}
The fact may be reported in different words: an order by a named judge may appear
as "the High Court ordered/ruled"; an announcement may appear as "officials said".
Bridge such references, but only if you are certain it is the SAME fact of the
SAME event (not a similar fact, a sub-event, or an expected/planned figure).

Output ONLY JSON:
{"found":true|false,
"source_value":"<verbatim value expression from source>",
"source_quote":"<verbatim source sentence fragment containing it, <=160 chars>",
"article_timestamp":"<ISO timestamp line of the article that sentence is in>",
"confidence":"high|low"}

# SOURCE
${source}
`;

export interface AlignPair {
  aspect: string;
  kind: string;
  claim_value: string;
  source_status: string;
  source_value?: string;
  source_quote?: string;
  article_timestamp?: string;
  confidence: string;
}

// ============================================================================
// Stage B：代码比对（纯函数，零 LLM）
// ============================================================================

// 数字 → 区间 [lo,hi]。限定词决定区间形状；冲突 = 区间不相交（rubric 对齐:
// 阈值蕴含 "over 3,500" ∋ 3,526 不算冲突;"about" 给 15% 容差;裸数字给 0.5% 容差吸收四舍五入）
export function parseNumInterval(raw: string): { lo: number; hi: number } | null {
  const s = raw.toLowerCase().replace(/[,，]/g, '');
  const m = s.match(/(\d+(?:\.\d+)?)\s*(million|billion|thousand|bn|m\b|k\b)?/);
  if (!m) return null;
  // 前导零整数（"000" 报警号/编号类）不是数量，解析成 0 会制造假冲突（线上实测：
  // "failed 000 calls" 撞 "over 300 welfare checks"）
  if (/^0\d/.test(m[1])) return null;
  let v = parseFloat(m[1]);
  const mag = m[2];
  if (mag === 'million' || mag === 'm') v *= 1e6;
  else if (mag === 'billion' || mag === 'bn') v *= 1e9;
  else if (mag === 'thousand' || mag === 'k') v *= 1e3;
  if (/\b(over|more than|above|exceed(?:s|ing)?)\b/.test(s)) return { lo: v * (1 + 1e-9), hi: Infinity };
  if (/\b(at least|no fewer than|minimum)\b/.test(s)) return { lo: v, hi: Infinity };
  if (/\b(under|less than|fewer than|below)\b/.test(s)) return { lo: 0, hi: v * (1 - 1e-9) };
  if (/\b(at most|up to|no more than|maximum)\b/.test(s)) return { lo: 0, hi: v };
  if (/\b(about|around|approximately|roughly|some|nearly|almost|~)\b/.test(s)) return { lo: v * 0.85, hi: v * 1.15 };
  return { lo: v * 0.995, hi: v * 1.005 };
}

export function numbersConflict(claimVal: string, sourceVal: string): boolean {
  const c = parseNumInterval(claimVal);
  const s = parseNumInterval(sourceVal);
  if (!c || !s) return false;
  return c.hi < s.lo || s.hi < c.lo; // 区间不相交 = 硬冲突
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export interface ParsedDate {
  y?: number;
  m: number;
  d: number;
}

function yearIn(s: string): number | undefined {
  const y = s.match(/\b(20\d{2})\b/);
  return y ? +y[1] : undefined;
}

export function parseExplicitDate(raw: string): ParsedDate | null {
  const s = raw.toLowerCase();
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3] };
  const dm = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)/);
  if (dm) return { m: MONTHS[dm[2]], d: +dm[1], y: yearIn(s) };
  const md = s.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (md) return { m: MONTHS[md[1]], d: +md[2], y: yearIn(s) };
  return null;
}

// 新闻惯例："on Friday" = 发布日前(含当天)最近的那个 Friday
export function resolveWeekday(weekdayRaw: string, articleISO: string): ParsedDate | null {
  const wd = WEEKDAYS.findIndex((w) => weekdayRaw.toLowerCase().includes(w));
  if (wd < 0 || !articleISO) return null;
  const pub = new Date(articleISO);
  if (isNaN(pub.getTime())) return null;
  const d = new Date(Date.UTC(pub.getUTCFullYear(), pub.getUTCMonth(), pub.getUTCDate()));
  for (let i = 0; i < 7; i++) {
    if (d.getUTCDay() === wd) return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return null;
}

// 日期区间（"7–8 July" / "July 7-8"）：取两端日。线上实测 claim "07-07" 撞源 "7–8 July"
// 被误判冲突——7 在区间内不是冲突。
function parseDayRange(raw: string): { d1: number; d2: number; m: number; y?: number } | null {
  const s = raw.toLowerCase();
  const a = s.match(/(\d{1,2})\s*[–—-]\s*(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)/);
  if (a) return { d1: +a[1], d2: +a[2], m: MONTHS[a[3]], y: yearIn(s) };
  const b = s.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\s*[–—-]\s*(\d{1,2})/);
  if (b) return { d1: +b[2], d2: +b[3], m: MONTHS[b[1]], y: yearIn(s) };
  return null;
}

export function datesConflict(claimVal: string, sourceVal: string, articleISO?: string): boolean {
  const c = parseExplicitDate(claimVal);
  if (!c) return false;
  // 源给的是日期区间：claim 日落在区间内（同月、年不冲突）→ 不是冲突
  const range = parseDayRange(sourceVal || '');
  if (range) {
    const sameYear = !c.y || !range.y || c.y === range.y;
    const inRange = c.m === range.m && c.d >= Math.min(range.d1, range.d2) && c.d <= Math.max(range.d1, range.d2);
    return !(sameYear && inRange);
  }
  let s = parseExplicitDate(sourceVal || '');
  if (!s && sourceVal && articleISO) s = resolveWeekday(sourceVal, articleISO);
  if (!s) return false;
  if (c.m !== s.m || c.d !== s.d) return true;
  if (c.y && s.y && c.y !== s.y) return true;
  return false;
}

export interface HardConflict {
  pair: AlignPair;
  why: string;
}

// 一条 claim 的抽取结果 → 硬冲突列表（只认 same_fact + high confidence）
export function findHardConflicts(pairs: AlignPair[]): HardConflict[] {
  const out: HardConflict[] = [];
  for (const p of pairs || []) {
    if (p.source_status !== 'same_fact' || p.confidence !== 'high' || !p.source_value) continue;
    // kind 归一化：模型会自由发挥（"money amount"/"quantity"等）——含 date 算日期，其余按数字解析
    const kind = /date/i.test(p.kind || '') ? 'date' : 'number';
    if (kind === 'number' && numbersConflict(p.claim_value, p.source_value)) {
      out.push({ pair: p, why: `number: claim "${p.claim_value}" vs source "${p.source_value}"` });
    } else if (kind === 'date' && datesConflict(p.claim_value, p.source_value, p.article_timestamp)) {
      out.push({
        pair: p,
        why: `date: claim "${p.claim_value}" vs source "${p.source_value}"${p.article_timestamp ? ` (article ${p.article_timestamp.slice(0, 10)})` : ''}`,
      });
    }
  }
  return out;
}

// 通道触发门：claim 里得有数字或月份词，否则本通道无事可做
export function hasSpecifics(claim: string): boolean {
  return /\d/.test(claim) || new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\b`, 'i').test(claim);
}

// ============================================================================
// 编排：一条 claim 打一份源 → 硬冲突列表（抽取 + absent/low 定向补抽 + 代码比对）
// chatFn/parseFn 由调用方注入：runtime 用 callJudge/parseJSON（走 loggedChat 落观测），
// eval 用 llm.ts 的 chat/parseJSON——同一编排两处复用。
// ============================================================================

export async function extractCompareClaim(
  claim: string,
  source: string,
  chatFn: (prompt: string, maxTokens: number) => Promise<string>,
  parseFn: <T>(raw: string) => T | null
): Promise<HardConflict[]> {
  if (!hasSpecifics(claim)) return [];
  const raw = await chatFn(ALIGN_PROMPT(claim, source), 1200);
  const parsed = parseFn<{ pairs: AlignPair[] }>(raw);
  if (!parsed?.pairs) return [];
  // 定向补抽：absent/low 的对（数字和日期都补）追问一次
  for (const p of parsed.pairs) {
    if (p.source_status === 'same_fact' && p.confidence === 'high') continue;
    const retryRaw = await chatFn(VALUE_RETRY_PROMPT(claim, p.aspect, p.claim_value, p.kind || '', source), 400);
    const retry = parseFn<{
      found: boolean;
      source_value?: string;
      source_quote?: string;
      article_timestamp?: string;
      confidence?: string;
    }>(retryRaw);
    if (retry?.found && retry.source_value && retry.confidence === 'high') {
      p.source_status = 'same_fact';
      p.source_value = retry.source_value;
      p.source_quote = retry.source_quote;
      p.article_timestamp = retry.article_timestamp || p.article_timestamp;
      p.confidence = 'high';
    }
  }
  return findHardConflicts(parsed.pairs);
}
