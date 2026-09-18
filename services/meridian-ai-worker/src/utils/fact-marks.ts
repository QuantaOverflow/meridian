/**
 * 【写作层 v3 · 代码检查器】逐句对齐到报告的事实，只在命中事实的出处窗口里查数字 / 专名 /
 * 引语说话人 / 因果线索，查不到就**标记**——不改稿、不拦发布，标记只进内部观测与管理页。
 *
 * 搬自原型 apps/backend/prototypes/local-grounding/（check.ts + fact-align.ts + fact-check.ts，只在本地）。
 * 参数用那里实测最优的一组 factB：minScore 15 / ratio 0.5 / maxFacts 2 / ctx 1，四个通道全开
 * ——句级召回约 49%、精度约 47%（ADR 0004「检测上限」一节）。**精度天生只有一半左右**，所以：
 *   · 标记数不是门，也不许据此自动删句——RARR 那条路已证伪（过删）
 *   · 对齐弱（top 分数低于 minScore）的句子直接弃权，不进标记也不算「查过」
 * 零 LLM 调用、零网络；检索复用 utils/sentence-search.ts 的 BM25。
 */
import { buildIndex, expand, scoreOne, search, type Hit, type Index, type Sent } from './sentence-search';

export interface MarkFact {
  id: string;
  text: string;
  sources?: Array<{ articleId: number; sentence: number }>;
  variants?: Array<{ text: string; sources?: Array<{ articleId: number; sentence: number }> }>;
}

export type MarkReason =
  | { kind: 'number'; value: string }
  | { kind: 'proper'; value: string }
  | { kind: 'quote-speaker'; quote: string; claimedSpeaker: string }
  | { kind: 'cause-cue'; cue: string };

export interface SentenceMark {
  sentence: string;
  reasons: MarkReason[];
  factIds: string[];
  score: number;
}

export interface MarkStats {
  sentences: number;
  checked: number;
  abstained: number;
  marked: number;
}

/** factB（原型实测最优）：对齐门槛、同分保留比例、每句最多几条事实、出处前后各取几句。 */
const OPTS = { minScore: 15, ratio: 0.5, maxFacts: 2, ctx: 1 };

// ── 抽取器（与检索的词法工具分开：这里要精确到「具体哪个数字 / 哪个专名」逐项比对）──
/** 「50 percent / 50 per cent」→「50%」、千分位逗号、货币符号后的空格，两边都过这层再比字面。 */
export function normalizeNumbersInText(text: string): string {
  return text
    .replace(/per\s*cent/gi, '%')
    .replace(/percent/gi, '%')
    .replace(/(\d)\s+%/g, '$1%')
    .replace(/\$\s+(\d)/g, '$$$1')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .toLowerCase();
}

const NUM_RE = /\$?\d[\d,]*(?:\.\d+)?\s*(?:%|percent|billion|million|thousand|km|mph|crore|lakh)?/gi;
export function numbersOf(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(NUM_RE)) {
    const raw = m[0].trim();
    if (raw.replace(/[^\d.]/g, '').length < 2) continue; // 一位数噪声太大
    out.push(raw.toLowerCase().replace(/,/g, ''));
  }
  return [...new Set(out)];
}

const LEADING_DROP = new Set(
  ('The A An In On At For And Or But With By From As Is Are Was Were It Its Their His Her This That' +
    ' These Those Over Under Into Than Then').split(' ')
);
/** 句首大写但不是专名的常见词。启发式清单，不完整——原型里记着这是已知局限。 */
const SENTENCE_INITIAL_COMMON = new Set(
  ('Initial Initially Rescue Meanwhile However Officials Following According Additionally Despite Amid' +
    ' Overall Currently Elsewhere Separately Earlier Later Recently Police Authorities Local Residents' +
    ' Some Many Both Several Others Another').split(' ')
);
const PROPER_RE = /\b[A-Z][a-zA-Z'’.-]*(?:\s+[A-Z][a-zA-Z'’.-]*){0,5}\b/g;
export function properPhrasesOf(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(PROPER_RE)) {
    let words = m[0].trim().split(/\s+/);
    while (words.length > 1 && LEADING_DROP.has(words[0])) words = words.slice(1);
    if (words.length === 1 && LEADING_DROP.has(words[0])) continue;
    if (words.length === 1 && words[0].length < 4) continue;
    if (words.length === 1 && SENTENCE_INITIAL_COMMON.has(words[0])) continue;
    out.push(words.join(' '));
  }
  return [...new Set(out)];
}

const CAUSE_CUES = [
  'in response', 'in retaliation', 'retaliation', 'retaliat', 'prompted', 'in the wake of',
  'as a result of', 'following', 'came after', 'after threat', 'escalat',
];
export function causeCuesOf(s: string): string[] {
  const low = s.toLowerCase();
  return CAUSE_CUES.filter(c => low.includes(c));
}

function quotesOf(s: string): string[] {
  const out: string[] = [];
  const re = /[“"]([^”"]{6,})[”"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1].trim());
  return out;
}
/** 说话人候选：引语之外的专名短语。密集提及多人的句子会抓错——已知的假警报来源之一。 */
function speakerCandidatesOf(sentence: string, quote: string): string[] {
  return properPhrasesOf(sentence.replace(quote, ' '));
}

// ── 对齐：输出句 → 事实 ──────────────────────────────────────────────────
interface FlatEntry { factId: string; text: string }
interface FactGroup { allTexts: string[]; sources: Array<{ articleId: number; sentence: number }> }

export interface MarkIndex {
  rawIdx: Index;
  factIdx: Index;
  entries: FlatEntry[];
  groups: Map<string, FactGroup>;
  globalBlob: string;
}

/**
 * 一个簇建一次。事实主文本与每条 variant 各进检索索引当一条「伪句子」，命中后回收到它的 factId。
 * 对齐用原始 BM25 分数（scoreOne）而不是 search() 的 RRF 融合：短的事实文本在 RRF 排名分下
 * 全挤在一小段里，量级信息被抹掉，minScore / ratio 两个阈值就没意义了。
 */
export function buildMarkIndex(facts: MarkFact[], sentences: Record<string, string[]>): MarkIndex {
  const rawSents: Sent[] = [];
  for (const [articleId, list] of Object.entries(sentences)) {
    list.forEach((text, i) => rawSents.push({ articleId: Number(articleId), si: i + 1, text }));
  }
  const entries: FlatEntry[] = [];
  const groups = new Map<string, FactGroup>();
  for (const f of facts) {
    entries.push({ factId: f.id, text: f.text });
    for (const v of f.variants ?? []) entries.push({ factId: f.id, text: v.text });
    const sources = [...(f.sources ?? []), ...(f.variants ?? []).flatMap(v => v.sources ?? [])];
    const seen = new Set<string>();
    groups.set(f.id, {
      allTexts: [f.text, ...(f.variants ?? []).map(v => v.text)],
      sources: sources.filter(s => {
        const k = `${s.articleId}:${s.sentence}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }),
    });
  }
  return {
    rawIdx: buildIndex(rawSents),
    factIdx: buildIndex(entries.map((e, i) => ({ articleId: i, si: 0, text: e.text }))),
    entries,
    groups,
    globalBlob: normalizeNumbersInText(rawSents.map(s => s.text).join(' ')),
  };
}

function expandByRef(rawIdx: Index, articleId: number, sentenceNo: number, ctx: number): string {
  const same = rawIdx.sents.filter(s => s.articleId === articleId);
  const pos = same.findIndex(s => s.si === sentenceNo);
  if (pos < 0) return '';
  return same.slice(Math.max(0, pos - ctx), pos + ctx + 1).map(s => s.text).join(' ');
}

/** 一句成稿 → 标记（对齐太弱就弃权，返回 null）。 */
export function markSentence(ix: MarkIndex, sentence: string): SentenceMark | null {
  const scores = scoreOne(ix.factIdx, { tag: 'full', text: sentence, phrases: [] });
  const byFact = new Map<string, { factId: string; score: number }>();
  scores.forEach((sc, i) => {
    if (sc <= 0) return;
    const e = ix.entries[i];
    const cur = byFact.get(e.factId);
    if (!cur || sc > cur.score) byFact.set(e.factId, { factId: e.factId, score: sc });
  });
  const sorted = [...byFact.values()].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? 0;
  if (!sorted.length || topScore < OPTS.minScore) return null; // 弃权
  const aligned = sorted.filter(a => a.score >= topScore * OPTS.ratio).slice(0, OPTS.maxFacts);

  const parts: string[] = [];
  for (const a of aligned) {
    const g = ix.groups.get(a.factId);
    if (!g) continue;
    parts.push(...g.allTexts);
    for (const src of g.sources) {
      const t = expandByRef(ix.rawIdx, src.articleId, src.sentence, OPTS.ctx);
      if (t) parts.push(t);
    }
  }
  const quotes = quotesOf(sentence);
  for (const q of quotes) for (const h of search(ix.rawIdx, q, 3).hits) parts.push(expand(ix.rawIdx, h as Hit, OPTS.ctx));
  const blob = parts.join(' ').toLowerCase();
  const normBlob = normalizeNumbersInText(blob);

  const reasons: MarkReason[] = [];
  // 只在「全簇有、这句的证据窗口里没有」时标：全簇也没有的是凭空，那是接地守卫的事
  for (const n of numbersOf(normalizeNumbersInText(sentence))) {
    if (!normBlob.includes(n) && ix.globalBlob.includes(n)) reasons.push({ kind: 'number', value: n });
  }
  for (const p of properPhrasesOf(sentence)) {
    const pl = p.toLowerCase();
    if (!blob.includes(pl) && ix.globalBlob.includes(pl)) reasons.push({ kind: 'proper', value: p });
  }
  for (const q of quotes) {
    const hits = search(ix.rawIdx, q, 3).hits;
    if (!hits.length) continue;
    const speakers = speakerCandidatesOf(sentence, q);
    if (!speakers.length) continue;
    const window = hits.map(h => expand(ix.rawIdx, h as Hit, 2)).join(' ').toLowerCase();
    for (const sp of speakers) {
      const lastWord = sp.split(/\s+/).pop() ?? sp;
      if (lastWord.length < 3) continue;
      if (!window.includes(lastWord.toLowerCase())) reasons.push({ kind: 'quote-speaker', quote: q, claimedSpeaker: sp });
    }
  }
  const cues = causeCuesOf(sentence);
  if (cues.length && !cues.some(c => blob.includes(c))) for (const c of cues) reasons.push({ kind: 'cause-cue', cue: c });

  if (!reasons.length) return null;
  return { sentence, reasons, factIds: aligned.map(a => a.factId), score: Math.round(topScore * 10) / 10 };
}

/** 一块成稿 → 标记 + 读数。弃权的句子单独计数，不混进「查过没问题」。 */
export function markBlock(facts: MarkFact[], sentences: Record<string, string[]>, blockSentences: string[]): { marks: SentenceMark[]; stats: MarkStats } {
  const ix = buildMarkIndex(facts, sentences);
  const marks: SentenceMark[] = [];
  let abstained = 0;
  for (const s of blockSentences) {
    const scores = scoreOne(ix.factIdx, { tag: 'full', text: s, phrases: [] });
    const top = Math.max(0, ...scores);
    if (top < OPTS.minScore) {
      abstained++;
      continue;
    }
    const m = markSentence(ix, s);
    if (m) marks.push(m);
  }
  return {
    marks,
    stats: { sentences: blockSentences.length, checked: blockSentences.length - abstained, abstained, marked: marks.length },
  };
}
