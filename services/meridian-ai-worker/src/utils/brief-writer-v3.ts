/**
 * 【写作层 v3 · 纯函数】一个簇的 report-v3 → 简报里的一块正文。这里只放不碰网络、不碰 env 的部分：
 * 残句检测、要点、原话、报告渲染、复读检测、接地与长度的量尺。编排（调模型、守卫）在
 * services/brief-writer-v3.ts。
 *
 * **不许 import 任何只在 Workers 运行时存在的东西**——验收脚本在 node 里直接 import 本文件。
 *
 * 设计依据见 apps/backend/prototypes/brief-writer-v3/GOAL.md（Goal 2）。几条对着已知失效的决定：
 *   · 渲染不给概述、不给当事方 stance——报告层模型写好的句子会被整句抄
 *   · 渲染不带小标题（桩实测模型会把 `Disputes` 这种小标题抄进正文），分段用小写标签
 *   · 渲染不带内部字段（fact id / skeleton / articleId / variants），模型会照抄
 *   · 要点按报道日排（治因果倒置）；报道日不是事件发生日，prompt 里要讲清楚
 */

export type Tier = 'lead' | 'more' | 'brief';

/** 硬上限（用户拍板）：超过才由代码删尾句；目标区间写在 prompt 里（prompts/briefWriterV3.ts TIER_TARGET）。 */
export const TIER_MAX: Record<Tier, number> = { lead: 2400, more: 1100, brief: 200 };

export interface ReportV3Fact {
  id: string;
  text: string;
  articles: number;
  skeleton?: boolean;
  sources: Array<{ articleId: number; sentence: number }>;
  variants?: Array<{ text: string }>;
}
export interface ReportV3 {
  summary: string;
  facts: ReportV3Fact[];
  parties: Array<{ name: string; identity?: string; stance?: string }>;
  conflicts: Array<{ about: string; sides?: string[] }>;
  articles: Array<{ id: number; title: string; publishDate?: string }>;
  /** articleId → 该文章的句子，数组下标 + 1 = facts[].sources[].sentence */
  sentences: Record<string, string[]>;
}

// ───────────────────────── 残句 ─────────────────────────

/** 句中出现「小写实词 + 大写词 + has/have/had/is/was/will」时，前一个词若是这些就不算粘连（关系从句、转述都合法）。 */
const GLUE_PREV_OK = new Set(('a an the and or but as while when because where if after before since although though that which who ' +
  'whom whose what why how than then so to of in on at by for from with about into over under between against said says told tells ' +
  'say according including like whether also not only even just every each any some all many most other such').split(' '));

/**
 * 残句 / 两句粘连（抓取清洗留下的）。判据：
 *   · 没有句末标点（结尾的括号署名如「(FRANCE 24 with AFP)」不算）
 *   · 小写开头
 *   · 句末标点/闭引号/方括号后紧贴大写字母（「…’.”Recommended」「[Reuters]US」）
 *   · 小写实词后直接接「大写词 + has/have/had/is/was/will」（c0：「keeps its factories Trump has also threatened」）
 * 误报上限 5%（verify V1.4）；判错的代价只是少一条原话/少一条出处句，不影响正文。
 */
export function isTruncatedSentence(sentence: string): boolean {
  const s = String(sentence ?? '').trim();
  if (!s) return true;
  if (!/[.!?]["”’)\]]*$/.test(s) && !/[.!?]["”’]?\s*\([^)]*\)$/.test(s)) return true;
  if (/^[a-z]/.test(s)) return true;
  if (/[.!?]["”’]+[A-Z]|\][A-Z]|\d[A-Z][a-z]/.test(s)) return true; // 「…’.”Recommended」「[Reuters]US」「list 1 of 3Australia’s」
  const re = /\b([a-z]+) [A-Z][a-zA-Z]+ (?:has|have|had|is|was|will)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const prev = m[1];
    if (!GLUE_PREV_OK.has(prev) && !/(?:ed|ing)$/.test(prev) && prev.length > 1) return true;
  }
  return false;
}

// ───────────────────────── 要点 ─────────────────────────

const dayOf = (iso?: string) => String(iso ?? '').slice(0, 10);

/**
 * 一条事实的时间 = 出处文章里最早的完整发布时间戳。排序用完整时间戳——同一天也要分出先后
 * （c13：「six」02:20 发、「rose to 7」07:55 发）；对外的 date 只给日（YYYY-MM-DD）。这是报道时间，不是事件发生时间。
 */
function factTime(report: ReportV3, f: ReportV3Fact): string {
  const pub = new Map(report.articles.map(a => [a.id, String(a.publishDate ?? '')]));
  return f.sources.map(s => pub.get(s.articleId) ?? '').filter(t => /^\d{4}-\d{2}-\d{2}/.test(t))
    .sort((a, b) => (Date.parse(a) || 0) - (Date.parse(b) || 0) || a.localeCompare(b))[0] ?? '';
}

/** 出处句全是残句的事实不要（有一句完好就留）；找不到出处句的不当残句。 */
function fromTruncatedOnly(report: ReportV3, f: ReportV3Fact): boolean {
  if (!f.sources.length) return false;
  return f.sources.every(s => {
    const t = report.sentences[String(s.articleId)]?.[s.sentence - 1];
    return t !== undefined && isTruncatedSentence(t);
  });
}

function datedFacts(report: ReportV3, keep: (f: ReportV3Fact) => boolean) {
  return report.facts
    .map((f, i) => ({ f, i }))
    .filter(x => keep(x.f) && x.f.text.trim() && !fromTruncatedOnly(report, x.f))
    .map(x => {
      const time = factTime(report, x.f);
      return { f: x.f, text: x.f.text, time, date: dayOf(time), articles: x.f.articles, i: x.i };
    })
    // 完整发布时间升序；没时间的排最后；同一时刻按报道篇数降序、再按原顺序
    .sort((a, b) => (a.time && b.time ? (Date.parse(a.time) || 0) - (Date.parse(b.time) || 0) : a.time ? -1 : b.time ? 1 : 0)
      || (b.articles - a.articles) || (a.i - b.i));
}

/** 写前定要点：被 ≥2 篇报道的事实，按日期升序。 */
export function planPoints(report: ReportV3): Array<{ text: string; date: string; articles: number }> {
  return datedFacts(report, f => f.articles >= 2).map(({ text, date, articles }) => ({ text, date, articles }));
}

// ───────────────────────── 关系表 ─────────────────────────

/** 关系表只记这五类原文明说的关系（GOAL3.md）。 */
export type RelationKind = 'order' | 'cause' | 'update' | 'conflict' | 'future';
export interface Relation { kind: RelationKind; statement: string; sources: string[] }
const RELATION_KINDS = new Set<string>(['order', 'cause', 'update', 'conflict', 'future']);
/** 原句明写了「对什么」的回应 / 报复 / 因果：retaliation for、in response to、because、as a result of、led to、prompted、triggered。
 *  「responded with …」「would retaliate」不算——没说回应的是什么，或者是将来的事。 */
const CAUSE_CUE = /\b(retaliat\w*|respon(?:se|ses|ding|ded|d)?|repl(?:y|ied)|reprisals?)\s+(to|for|against)\b|\bin (retaliation|response|reply|reprisal)\b|\bbecause\b|\bas a result of\b|\bresult(?:ed)? (of|from)\b|\b(led|leading) to\b|\bprompt(?:ed|ing)\b|\btrigger(?:ed|ing)\b/i;

const stamp = (t: string) => (t ? `${t.slice(0, 10)} ${t.slice(11, 16)} UTC` : 'undated');

/**
 * 关系表那一步的输入：**全部事实**，不只是要点——「封锁是 7 月宣布的」「预计在联大提」这类决定关系的信息
 * 常只有一篇报道。按最早报道时间排，每条带出处引用 [文章 id:句号]、时间戳、报道篇数；
 * 要点再附一句原句（「rose to」「earlier」「is expected to」这类措辞在原句里）。
 */
export function renderFactsForRelations(report: ReportV3): string {
  const groups = sharedSurnames(report);
  const lines: string[] = [];
  for (const x of datedFacts(report, () => true)) {
    const srcs = intactSources(report, x.f);
    const ref = srcs[0] ?? x.f.sources[0];
    if (!ref) continue;
    const text = resolveSharedSurnames(report, x.f, x.text, groups).trim();
    lines.push(`[${ref.articleId}:${ref.sentence}] ${stamp(x.time)} · ${x.articles} report${x.articles > 1 ? 's' : ''} · ${text}`);
    if (x.articles >= 2 && srcs[0]) lines.push(`    original: ${report.sentences[String(srcs[0].articleId)][srcs[0].sentence - 1]}`);
  }
  return lines.join('\n');
}

function intactSources(report: ReportV3, f: ReportV3Fact) {
  return f.sources.filter(s => {
    const t = report.sentences[String(s.articleId)]?.[s.sentence - 1];
    return t !== undefined && !isTruncatedSentence(t);
  });
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * 事实文本里给了比它最早报道更早的时间：更早的年份、更早的月份、「last week/month/year」「earlier this …」。
 * 这类常是背景，而另一处把同一件事写成新进展或回应（c3：封锁 7 月就宣布了，要点却写「responded with … a blockade」）。
 * 月份按大写原形认（小写 may 是情态动词）；只有月份没有年份时按报道那一年算。
 */
export function givesEarlierTime(report: ReportV3, f: ReportV3Fact): boolean {
  const pub = new Date(factTime(report, f));
  if (isNaN(pub.getTime())) return false;
  const years = [...f.text.matchAll(/\b(?:19|20)\d\d\b/g)].map(m => Number(m[0]));
  if (years.some(y => y < pub.getUTCFullYear())) return true;
  if (/\b(last (week|month|year)|earlier this (week|month|year))\b/i.test(f.text)) return true;
  const month = MONTH_NAMES.findIndex(m => new RegExp(`\\b${m}\\b`).test(f.text));
  return month >= 0 && month < pub.getUTCMonth() && !years.some(y => y > pub.getUTCFullYear());
}

const OVERLAP_STOP = new Set(('that this with from have been were will would their they them than then there which while about after ' +
  'before over into also said says according reported report reports people other some more most such when where what').split(' '));
/** 内容词（≥4 字母、去停用词和月份、粗去词尾）：只用来给「同一件事」找候选，判断交给模型。 */
const contentWords = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? [])
  .filter(w => !OVERLAP_STOP.has(w) && !MONTH_NAMES.some(m => m.toLowerCase() === w))
  .map(w => w.replace(/(ing|ed|es|s)$/, '')));

/**
 * 关系表输入的第二块：给了更早时间的那些事实（同样的引用号），每条下面附最多 2 条内容词重合 ≥3 的其他事实当候选，
 * 让「先后」一项逐条判断候选是不是同一件事。
 * 单靠 prompt 里的一句规则，G3 全部 15 块 c3 的关系表只有 1 块抽到了封锁那条 order（INSIGHTS「Round 6」）；
 * 只列更早的行、不给候选，模型多半把两条更早的行互相配（「2015 年介入早于 7 月封锁」）。
 * 词重合本身配错很多（c13 把 2022 年那次坍塌配到这次），所以只当候选，不直接当关系。
 */
export function renderEarlierTimes(report: ReportV3): string {
  const groups = sharedSurnames(report);
  const all = datedFacts(report, () => true);
  const lineOf = (x: (typeof all)[number]) => {
    const ref = intactSources(report, x.f)[0] ?? x.f.sources[0];
    return ref ? `[${ref.articleId}:${ref.sentence}] ${resolveSharedSurnames(report, x.f, x.text, groups).trim()}` : '';
  };
  const early = all.filter(x => givesEarlierTime(report, x.f));
  const rest = all.filter(x => !givesEarlierTime(report, x.f));
  return early.map(x => {
    const own = lineOf(x);
    if (!own) return '';
    const w = contentWords(x.text);
    const cands = rest.map(y => ({ y, n: [...contentWords(y.text)].filter(k => w.has(k)).length }))
      .filter(c => c.n >= 3).sort((a, b) => b.n - a.n).slice(0, 2).map(c => lineOf(c.y)).filter(Boolean);
    return [own, ...cands.map(c => `    compare: ${c}`)].join('\n');
  }).filter(Boolean).join('\n');
}

/**
 * 模型产出的关系表 → 校验过的条目。类别不在五类里、没有能在原句里找到的出处（文章 id:句号）的条目丢掉——
 * 「原文没说的关系不许记」代码只能查到这一层：出处存在。响应里没有 relations 数组就抛，由调用方重试。
 */
export function validateRelations(raw: unknown, report: ReportV3): Relation[] {
  const list = (raw as { relations?: unknown })?.relations;
  if (!Array.isArray(list)) throw new Error('关系表响应里没有 relations 数组');
  const seen = new Set<string>();
  const out: Relation[] = [];
  for (const r of list) {
    const kind = String(r?.kind ?? '').toLowerCase().trim();
    // 引用号混进句子里会被写作抄进正文（实测「[904687:2] Saudi-backed government forces reported …」）
    const statement = String(r?.statement ?? '').replace(/\s*\[\d+:\d+\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const sources = [...new Set((Array.isArray(r?.sources) ? r.sources : [])
      .map((s: unknown) => String(s ?? '').replace(/[[\]\s]/g, ''))
      .filter((s: string) => {
        const m = s.match(/^(\d+):(\d+)$/);
        return !!m && report.sentences[m[1]]?.[Number(m[2]) - 1] !== undefined;
      }))] as string[];
    if (!RELATION_KINDS.has(kind) || !statement || !sources.length) continue;
    // cause 只在引用的原句里明写了「对什么的回应 / 报复 / 结果」时才留（G3 Round 11）。关系表常把「responded with …」（没说回应什么）
    // 或一句毫无回应字眼的背景（「2015 年联军介入」）拼成因果，写作照着写出「In response, … a blockade」（c3 实测）
    if (kind === 'cause' && !sources.some(s => { const [a, n] = s.split(':'); return CAUSE_CUE.test(report.sentences[a][Number(n) - 1]); })) continue;
    const key = statement.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: kind as RelationKind, statement, sources });
  }
  return out;
}

/** 交给写作的关系表：只给类别和那句话，不给出处引用（引用号会被抄进正文）。 */
export function renderRelationsForWriter(rels: Relation[]): string {
  if (!rels.length) return '';
  return `<how_events_relate>\n${rels.map(r => `[${r.kind}] ${r.statement}`).join('\n')}\n</how_events_relate>`;
}

// ───────────────────────── 原话 ─────────────────────────

const SPEECH_VERB = /\b(said|says|say|told|tells|added|adds|wrote|writes|posted|posts|stated|states|warned|warns|insisted|argued|declared|announced|asked|noted|explained|urged|according to|tweeted|claimed|claims|described|called)\b/i;
const QUOTE_SPAN = /“([^“”]+)”|"([^"]+)"/g;
const MIN_QUOTE_WORDS = 5;
/** 原话最多几条：按说话人轮流取，保证各方都有；再多写作 prompt 会被清单淹掉。 */
const MAX_QUOTES = 8;

/** 当事方条目 → 人名：多人条目（「A, B, C」「A and his brother」）拆开，去掉 markdown 星号。 */
const peopleOf = (name: string) => name.replace(/\*+/g, '').trim().split(/,\s*|\s+and\s+/).map(x => x.trim()).filter(x => /^[A-ZÀ-Ý]/.test(x));
/** 人名的姓（最后一个词）；单个词的名字没有可单独使用的姓。 */
const surname = (person: string) => {
  const toks = person.split(/\s+/);
  const last = toks[toks.length - 1];
  return toks.length > 1 && /^[A-ZÀ-Ý][\p{L}'-]{2,}$/u.test(last) ? last : '';
};

/**
 * 簇里同姓的不同当事方，按当事方名单算（例：c13 首席部长 Rekha Gupta 与楼主一家 Hariram Gupta 等）。
 * 报道原文常只写姓，写作照抄就分不清是谁——写作 prompt 要求这些人一律写全名。
 */
export function sharedSurnames(report: ReportV3): Array<{
  surname: string; people: string[]; primary: string[]; roles: Record<string, string>; relatives: Array<{ of: string; names: string[] }>;
}> {
  type Entry = { parties: Set<string>; people: Set<string>; primary: Set<string>; relatives: Array<{ of: string; names: string[] }> };
  const by = new Map<string, Entry>();
  const roles: Record<string, string> = {};
  for (const p of report.parties) {
    const first = peopleOf(p.name)[0];
    if (first && p.identity?.trim()) roles[first] = p.identity.trim();
    const same = new Map<string, string[]>();
    for (const person of peopleOf(p.name)) {
      const s = surname(person);
      if (s) same.set(s, [...(same.get(s) ?? []), person]);
    }
    for (const [s, ppl] of same) {
      const e = by.get(s) ?? { parties: new Set<string>(), people: new Set<string>(), primary: new Set<string>(), relatives: [] };
      // 每个当事方条目只取第一个同姓的人当「主名」；同一条目里其余同姓的人是家属（「A Gupta, B Gupta, C Gupta — owner, wife, son」），
      // 报道里称「his wife B」。规则里把家属也点全名，模型就给家属都补上姓（G3 Round 3 实测）
      e.primary.add(ppl[0]);
      if (ppl.length > 1) e.relatives.push({ of: ppl[0], names: ppl.slice(1) });
      e.parties.add(p.name);
      ppl.forEach(x => e.people.add(x));
      by.set(s, e);
    }
  }
  return [...by].filter(([, e]) => e.parties.size > 1).map(([s, e]) => ({
    surname: s, people: [...e.people], primary: [...e.primary],
    roles: Object.fromEntries([...e.primary].filter(x => roles[x]).map(x => [x, roles[x]])), relatives: e.relatives,
  }));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 写前消歧：事实文本里单独出现的同姓（报道原文常只写「Gupta said …」）→ 看这条事实的出处句及其前 4 句，
 * 只点到这一组里的一个人时才换成那个人的全名；点到多人或一个都没有就不动（认不准不猜）。
 * 只用在给写作 / 关系表看的材料里；planPoints 的 text 仍是事实原文（契约）。
 */
export function resolveSharedSurnames(
  report: ReportV3, f: ReportV3Fact, text: string, groups: ReturnType<typeof sharedSurnames>
): string {
  let out = text;
  for (const g of groups) {
    const firsts = g.people.map(p => p.split(/\s+/).slice(0, -1).join(' ')).filter(Boolean).map(escapeRe);
    const bare = `(?<!(?:${firsts.join('|')})\\s)\\b${escapeRe(g.surname)}\\b`;
    if (!new RegExp(bare).test(out)) continue;
    const named = (ctx: string) => g.people.filter(p => ctx.includes(p));
    // 先看出处句及其前 4 句；那里一个人都没点到，再看出处文章全文（c13 有 3 条事实的近邻句里没有全名）
    let hits = named(f.sources
      .map(s => (report.sentences[String(s.articleId)] ?? []).slice(Math.max(0, s.sentence - 5), s.sentence).join(' '))
      .join(' '));
    if (!hits.length) hits = named(f.sources.map(s => (report.sentences[String(s.articleId)] ?? []).join(' ')).join(' '));
    if (hits.length === 1) out = out.replace(new RegExp(bare, 'g'), hits[0]);
  }
  return out;
}

/**
 * 当事方名字 → 可在原句里认的写法：全名、姓。
 * 姓只在全簇唯一时才认——c13 的 Rekha Gupta（首席部长）和 Hariram Gupta（楼主）同姓，「Gupta said」挂不准。
 */
function speakerForms(report: ReportV3): Array<{ party: string; forms: string[] }> {
  const owners = new Map<string, Set<string>>();
  for (const p of report.parties) for (const person of peopleOf(p.name)) {
    const s = surname(person);
    if (s) owners.set(s, (owners.get(s) ?? new Set()).add(p.name));
  }
  return report.parties.map(p => {
    const forms = new Set<string>();
    for (const person of peopleOf(p.name)) {
      forms.add(person);
      const s = surname(person);
      if (s && owners.get(s)?.size === 1) forms.add(s);
    }
    return { party: p.name, forms: [...forms].sort((a, b) => b.length - a.length) };
  });
}

/** 在去掉引号段的原句里找说话人：离言说动词最近的那个名字（取原句里实际出现的写法）。 */
function findSpeaker(rest: string, forms: ReturnType<typeof speakerForms>): { speaker: string; party: string } | null {
  const verb = rest.match(SPEECH_VERB);
  let best: { speaker: string; party: string; dist: number } | null = null;
  for (const f of forms) {
    for (const form of f.forms) {
      const re = new RegExp(`(^|[^\\p{L}])${form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^\\p{L}]|$)`, 'gu');
      let m: RegExpExecArray | null;
      while ((m = re.exec(rest))) {
        const at = m.index + m[1].length;
        const dist = verb?.index !== undefined ? Math.abs(at - verb.index) : 1e9;
        if (!best || dist < best.dist) best = { speaker: form, party: f.party, dist };
      }
      if (best && best.speaker === form) break; // 全名命中了就不再退到姓
    }
  }
  return best ? { speaker: best.speaker, party: best.party } : null;
}

function quotesWithParty(report: ReportV3) {
  const forms = speakerForms(report);
  const seen = new Set<string>();
  const found: Array<{ speaker: string; party: string; text: string; articleId: number; sentence: number }> = [];
  for (const [id, list] of Object.entries(report.sentences)) {
    list.forEach((raw, i) => {
      const s = String(raw ?? '');
      if (isTruncatedSentence(s)) return;
      const spans = [...s.matchAll(QUOTE_SPAN)].map(m => (m[1] ?? m[2] ?? '').trim());
      if (!spans.length) return;
      // 说话人：先看本句（去掉引号段后，得有言说动词）；本句只有代词（he said）→ 看上一句里提到的名字
      const rest = s.replace(QUOTE_SPAN, ' ');
      if (!SPEECH_VERB.test(rest)) return;
      let who = findSpeaker(rest, forms);
      if (!who && /\b(he|she|they)\b/i.test(rest) && i > 0) who = findSpeaker(String(list[i - 1] ?? '').replace(QUOTE_SPAN, ' '), forms);
      if (!who) return;
      for (const text of spans) {
        if (text.split(/\s+/).length < MIN_QUOTE_WORDS) continue; // 短引号多是强调词（'memes'），不是一句话
        const key = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ ...who, text, articleId: Number(id), sentence: i + 1 });
      }
    });
  }
  // 按说话人轮流取
  const bySpeaker = new Map<string, typeof found>();
  for (const q of found) bySpeaker.set(q.party, [...(bySpeaker.get(q.party) ?? []), q]);
  const out: typeof found = [];
  for (let k = 0; out.length < MAX_QUOTES && [...bySpeaker.values()].some(v => v.length > k); k++) {
    for (const v of bySpeaker.values()) if (v[k] && out.length < MAX_QUOTES) out.push(v[k]);
  }
  return out;
}

/** 各方原话：逐字、带具名说话人（出现在该句或上一句）、不取自残句。 */
export function extractQuotes(report: ReportV3): Array<{ speaker: string; text: string; articleId: number; sentence: number }> {
  return quotesWithParty(report).map(({ speaker, text, articleId, sentence }) => ({ speaker, text, articleId, sentence }));
}

// ───────────────────────── 渲染 ─────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}` : 'undated');

/**
 * 给写作看的材料：要点（≥2 篇，按报道日排）、其余细节（1 篇）、人物（名字 + 身份）、原话、分歧。
 * **不给概述、不给 stance**——那是报告层模型写好的句子，给了就被整句抄（Goal 1 实测）。
 * 不带小标题式的词、不带内部字段（fact id / skeleton / articleId / variants）。
 *
 * 给了关系表时，[update] 那条挂在它引用的出处句所属的事实后面（G3 Round 5）：关系表只在材料末尾说「六 → 七」，
 * 写作仍照排在最前的「killing six people」写（c13 简讯、头条实测）；挂在旧值那一行旁边，写作读到旧值时就读到更新。
 * [order] 同理（G3 Round 9）：c3 九块关系表都有「封锁 7 月就宣布了」，写作仍照要点「responded with … a blockade」写成回应。
 */
export function renderReportForWriter(report: ReportV3, relations: Relation[] = []): string {
  const groups = sharedSurnames(report);
  const inline = relations.filter(r => r.kind === 'update' || r.kind === 'order');
  const noteOf = (f: ReportV3Fact) => inline
    .filter(r => f.sources.some(s => r.sources.includes(`${s.articleId}:${s.sentence}`)))
    .map(r => ` [${r.kind}] ${r.statement}`).join('');
  const line = (x: { f: ReportV3Fact; date: string; text: string }) =>
    `${shortDate(x.date)} — ${resolveSharedSurnames(report, x.f, x.text, groups).trim()}${noteOf(x.f)}`;
  const points = datedFacts(report, f => f.articles >= 2);
  const others = datedFacts(report, f => f.articles < 2);
  const people = report.parties.map(p => (p.identity?.trim() ? `${p.name}, ${p.identity.trim()}` : p.name));
  const byParty = new Map(report.parties.map(p => [p.name, p]));
  const quotes = quotesWithParty(report).map(q => {
    const p = byParty.get(q.party);
    const who = p?.identity?.trim() ? `${q.party.replace(/\*+/g, '')} (${p.identity.trim()})` : q.party.replace(/\*+/g, '');
    return `${who}: “${q.text}”`;
  });
  const conflicts = (report.conflicts ?? []).map(c => (c.sides?.length ? `${c.about}: ${c.sides.join(' / ')}` : c.about));
  const parts = [`<key_points>\n${points.map(line).join('\n')}\n</key_points>`];
  if (others.length) parts.push(`<other_details>\n${others.map(line).join('\n')}\n</other_details>`);
  parts.push(`<people>\n${people.join('\n')}\n</people>`);
  if (quotes.length) parts.push(`<quotes>\n${quotes.join('\n')}\n</quotes>`);
  if (conflicts.length) parts.push(`<where_accounts_differ>\n${conflicts.join('\n')}\n</where_accounts_differ>`);
  return parts.join('\n\n');
}

// ───────────────────────── one-source 变体（限融合：每句 ≤2 要点，spike，GOAL 未编号）─────────────────────────
// 假设：关系级错误（名字/数字接错事件、引语接错人、编造因果、先后倒置）出在模型把很多事实揉进一句话
// （docs/engineering-notes/relation-level-factual-errors.md 引 Lebanoff 2019：两句融合成一句，38% 含事实错）。
// 限一句最多用 1–2 个编号要点，规划（哪句用哪些要点）与写（照分组写）合成一次调用（JSON 产出），
// 省一次往返；代码再按「这句只许用它分到的要点 + 那些要点的出处句」做局部接地检查，查到材料外的词就整句丢。

export interface PlannedPoint {
  id: number;
  text: string;
  date: string;
  sources: Array<{ articleId: number; sentence: number }>;
}

/** 编号要点：与 planPoints 同一批事实（≥2 篇），带编号和出处句，供 one-source 变体的规划/写作/局部接地用。 */
export function numberedPoints(report: ReportV3, relations: Relation[] = []): PlannedPoint[] {
  const groups = sharedSurnames(report);
  const inline = relations.filter(r => r.kind === 'update' || r.kind === 'order');
  const noteOf = (f: ReportV3Fact) => inline
    .filter(r => f.sources.some(s => r.sources.includes(`${s.articleId}:${s.sentence}`)))
    .map(r => ` [${r.kind}] ${r.statement}`).join('');
  return datedFacts(report, f => f.articles >= 2).map((x, i) => ({
    id: i + 1,
    text: `${resolveSharedSurnames(report, x.f, x.text, groups).trim()}${noteOf(x.f)}`,
    date: x.date,
    sources: x.f.sources,
  }));
}

/** 编号要点清单：`[id] 日期 — 文本`，给规划/写作的 prompt 用。 */
export function renderNumberedPoints(points: PlannedPoint[]): string {
  return points.map(p => `[${p.id}] ${shortDate(p.date)} — ${p.text}`).join('\n');
}

/** one-source 材料：key_points 换成编号清单，其余（细节/人物/原话/分歧）与 renderReportForWriter 相同结构。 */
export function renderReportForWriterOneSource(report: ReportV3, points: PlannedPoint[]): string {
  const groups = sharedSurnames(report);
  const others = datedFacts(report, f => f.articles < 2);
  const line = (x: { f: ReportV3Fact; date: string; text: string }) =>
    `${shortDate(x.date)} — ${resolveSharedSurnames(report, x.f, x.text, groups).trim()}`;
  const people = report.parties.map(p => (p.identity?.trim() ? `${p.name}, ${p.identity.trim()}` : p.name));
  const byParty = new Map(report.parties.map(p => [p.name, p]));
  const quotes = quotesWithParty(report).map(q => {
    const p = byParty.get(q.party);
    const who = p?.identity?.trim() ? `${q.party.replace(/\*+/g, '')} (${p.identity.trim()})` : q.party.replace(/\*+/g, '');
    return `${who}: “${q.text}”`;
  });
  const conflicts = (report.conflicts ?? []).map(c => (c.sides?.length ? `${c.about}: ${c.sides.join(' / ')}` : c.about));
  const parts = [`<key_points>\n${renderNumberedPoints(points)}\n</key_points>`];
  if (others.length) parts.push(`<other_details>\n${others.map(line).join('\n')}\n</other_details>`);
  parts.push(`<people>\n${people.join('\n')}\n</people>`);
  if (quotes.length) parts.push(`<quotes>\n${quotes.join('\n')}\n</quotes>`);
  if (conflicts.length) parts.push(`<where_accounts_differ>\n${conflicts.join('\n')}\n</where_accounts_differ>`);
  return parts.join('\n\n');
}

/** 一个要点的出处文本：要点本身 + 它未截断的出处句，供局部接地检查当语料。 */
function pointSourceText(report: ReportV3, p: PlannedPoint): string {
  const srcs = p.sources
    .map(s => report.sentences[String(s.articleId)]?.[s.sentence - 1])
    .filter((t): t is string => t !== undefined && !isTruncatedSentence(t));
  return [p.text, ...srcs].join(' ');
}

/**
 * 一句正文里，材料中没出现过的数字/专名——局部版 ungroundedTerms：语料只是这句被指派到的
 * 那 1–2 个要点及其出处句，不是全篇材料。查到即视为「融合进了没分给它的事实」。
 */
export function localUngroundedTerms(report: ReportV3, points: PlannedPoint[], ids: number[], text: string): string[] {
  const byId = new Map(points.map(p => [p.id, p]));
  const corpus = ids.map(id => byId.get(id)).filter((p): p is PlannedPoint => !!p).map(p => pointSourceText(report, p)).join(' ');
  return ungroundedTermsAgainst(materialFromText(corpus), text);
}

// ───────────────────────── 量尺 ─────────────────────────

const ABBR_END = /(\b(?:[A-Z]\.){1,3}|\b(?:Mr|Mrs|Ms|Dr|St|Gen|Lt|Col|Sen|Rep|Gov|No|Jan|Feb|Mar|Apr|Aug|Sept|Sep|Oct|Nov|Dec|vs)\.)$/;

/** 成稿切句：[.!?] 后接空白再接大写/数字/引号开头才算句末；U.S. 这类缩写不断。 */
export function proseSentences(text: string): string[] {
  const parts = text.trim().split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && ABBR_END.test(out[out.length - 1])) out[out.length - 1] += ' ' + p;
    else if (p.trim()) out.push(p.trim());
  }
  return out;
}

/**
 * 复读检测。两条腿：
 *   ① 句级：同一句（>25 字符）出现 ≥3 次，或 ≥10 句里不同句占比 <0.8
 *   ② 词级：任一 12 词片段出现 ≥4 次——治「复读但不断句」，句级切不开的那种
 * 旧 25 块上只判出 12,407 字符那块（同句 78 遍），其余 0 误判（verify V1.3 考）。
 */
export function detectRepetition(text: string): boolean {
  const ss = text.split(/(?<=[.!?])\s+/).map(x => x.trim().toLowerCase()).filter(x => x.length > 25);
  const count = new Map<string, number>();
  for (const s of ss) count.set(s, (count.get(s) ?? 0) + 1);
  const maxRep = Math.max(0, ...count.values());
  if (maxRep >= 3) return true;
  if (ss.length >= 10 && count.size / ss.length < 0.8) return true;
  const w = text.toLowerCase().split(/\s+/).filter(Boolean);
  const N = 12;
  const shingles = new Map<string, number>();
  for (let i = 0; i + N <= w.length; i++) {
    const k = w.slice(i, i + N).join(' ');
    const n = (shingles.get(k) ?? 0) + 1;
    if (n >= 4) return true;
    shingles.set(k, n);
  }
  return false;
}

/** 材料全文（小写）与其中的数字：接地判断的依据。原句、概述、事实、当事方、分歧、文章标题都算。 */
function materialOf(report: ReportV3): { lower: string; nums: Set<string> } {
  const text = [
    ...Object.values(report.sentences).flat(),
    report.summary,
    ...report.facts.flatMap(x => [x.text, ...(x.variants ?? []).map(v => v.text)]),
    ...report.parties.map(p => `${p.name} ${p.identity ?? ''} ${p.stance ?? ''}`),
    ...(report.conflicts ?? []).flatMap(c => [c.about, ...(c.sides ?? [])]),
    ...report.articles.map(a => `${a.title} ${a.publishDate ?? ''}`),
  ].join('\n');
  return { lower: text.toLowerCase(), nums: new Set(text.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []) };
}

const CAP_STOP = new Set(['I', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);

/** materialOf 的精简版：给任意一段语料文本（不是整份 report）算同样的 {lower, nums}，供局部接地检查用。 */
function materialFromText(text: string): { lower: string; nums: Set<string> } {
  return { lower: text.toLowerCase(), nums: new Set(text.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []) };
}

/** ungroundedTerms 的公共部分：给定材料 {lower, nums}，查正文里没出现过的数字/专名。 */
function ungroundedTermsAgainst(m: { lower: string; nums: Set<string> }, text: string): string[] {
  const bad = new Set<string>();
  for (const n of text.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []) if (!m.nums.has(n)) bad.add(n);
  for (const s of proseSentences(text)) {
    s.split(/\s+/).slice(1).forEach(tok => {
      for (const part of tok.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.]+$/g, '').replace(/[’']s$/, '').replace(/\.$/, '').split(/[-–—\/]/)) {
        if (!/^[A-Z][A-Za-z.]*[A-Za-z]$/.test(part) || CAP_STOP.has(part)) continue;
        const lw = part.toLowerCase();
        if (!m.lower.includes(lw) && !m.lower.includes(lw.replace(/s$/, ''))) bad.add(part);
      }
    });
  }
  return [...bad];
}

/**
 * 正文里材料中没出现过的数字与专名（非句首大写词）。治专名写错 / 凭记忆补名字
 * （实测 Rawdhah → Rawhdah、材料里没有的 Muailibi）。
 */
export function ungroundedTerms(report: ReportV3, text: string): string[] {
  return ungroundedTermsAgainst(materialOf(report), text);
}

const canonQuote = (s: string) => s.replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * 正文里引号内的话、逐字不在原句里的（按省略号拆段逐段查；段首尾标点不算——美式标点把逗号句号放进引号）。
 * 实测 c0：原句是 Canada “lives because of the United States”，模型写成 “Canada lives because of the United States.”。
 */
export function unverifiableQuotes(report: ReportV3, text: string): string[] {
  const corpus = canonQuote(Object.values(report.sentences).flat().join(' '));
  const out: string[] = [];
  for (const m of text.matchAll(/“([^”]*)”|"([^"]*)"/g)) {
    const q = (m[1] ?? m[2] ?? '').trim();
    if (!q) continue;
    const parts = q.split(/\.\.\.|…/).map(p => canonQuote(p).replace(/^[\s,.;:!?'"-]+|[\s,.;:!?'"-]+$/g, '')).filter(Boolean);
    if (!parts.every(p => corpus.includes(p))) out.push(q);
  }
  return out;
}

/** 去掉这些引语的引号（变成转述），一个字不改。修正调用后仍不逐字时的兜底。 */
export function unquote(text: string, quotes: string[]): string {
  let out = text;
  for (const q of quotes) out = out.replace(`“${q}”`, () => q).replace(`"${q}"`, () => q);
  return out;
}

/** 删掉含未接地词的整句；一句不剩返回 null。 */
export function dropSentencesWith(text: string, terms: string[]): string | null {
  const hit = (s: string) => terms.some(t => new RegExp(`(^|[^A-Za-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`).test(s));
  const out = text.split(/\n\s*\n/).map(p => proseSentences(p).filter(s => !hit(s)).join(' ')).filter(Boolean).join('\n\n');
  return out || null;
}

/**
 * 模型产出 → 散文。剥掉自作主张的标题行、markdown 强调、列表符号；more / brief 并成一段。
 * 返回空串表示剥完没剩正文（由调用方当失败处理，不许 200 带空正文）。
 */
export function cleanProse(raw: string, tier: Tier): string {
  let lines = raw.replace(/\r/g, '').split('\n').map(l => l.trim());
  lines = lines
    .filter(l => !/^#+\s/.test(l) && !/^<\/?u>/i.test(l) && !/^(-{3,}|\*{3,})$/.test(l))
    .map(l => l.replace(/^([-*•]|\d+[.)])\s+/, '').replace(/\*\*|__/g, '').replace(/<\/?u>/gi, ''));
  // 首行像标题（无句末标点、较短、后面还有正文）→ 丢掉
  const nonEmpty = lines.filter(Boolean);
  if (nonEmpty.length > 1 && nonEmpty[0].length < 120 && !/[.!?]["”’)]?$/.test(nonEmpty[0])) {
    lines.splice(lines.indexOf(nonEmpty[0]), 1);
  }
  const paras = lines.join('\n').split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  return (tier === 'lead' ? paras.join('\n\n') : paras.join(' ')).trim();
}

/** 截断产出去掉最后那个没写完的句子。 */
export function dropUnfinishedTail(text: string): string {
  const t = text.trim();
  if (/[.!?]["”’)]?$/.test(t)) return t;
  const m = t.match(/^[\s\S]*[.!?]["”’)]?(?=\s)/);
  return m ? m[0].trim() : t;
}

/**
 * 超硬上限的兜底：从末尾整句删到 ≤ 上限（删到一句不剩返回 null）。
 * 只删整句，不改写——不会引入材料外的内容。
 */
export function trimToLength(tier: Tier, text: string): string | null {
  const hi = TIER_MAX[tier];
  if (text.length <= hi) return text;
  // brief 只有一句，删整句就没了：在 ≤ 上限的最后一个分句边界（逗号/分号/破折号）截断并补句号。
  // 主句在前是新闻句的常态，截掉的是后置的补充从句（实测 c0/brief 两次压缩重写后仍 229 字符）。
  // 没有标点边界时退到连词/介词前（c18/brief 实测 216 字符的一句找不到逗号边界）。
  if (tier === 'brief' && proseSentences(text).length === 1) {
    const head = text.slice(0, hi - 1);
    const BOUNDARY = /,\s|;\s|\s[—–]\s|\s\(|\s(?:and|but|as|after|while|amid|with|which|who|following|including|despite|before|when|where)\s/g;
    let cut = -1;
    for (const m of head.matchAll(BOUNDARY)) if (m.index! >= 60) cut = m.index!;
    if (cut >= 60) return head.slice(0, cut).replace(/[\s,;:—–(-]+$/, '') + '.';
    return null;
  }
  const paras = text.split(/\n\s*\n/).map(p => proseSentences(p));
  while (paras.length) {
    const last = paras[paras.length - 1];
    last.pop();
    if (!last.length) paras.pop();
    const out = paras.map(p => p.join(' ')).filter(Boolean).join('\n\n');
    if (out.length <= hi) return out || null;
  }
  return null;
}
