/**
 * 【简报块 v6 · 纯函数】原型 `scripts/eval/cluster-to-brief/arms/direct-raw/direct-raw.mjs`
 * 在 `WRITE_AT_END=1 / WRITE_TIER=exec / WRITE_SUPPORT=1 / WRITE_REPAIR=mech` 这一条路径下的移植。
 *
 * 这是**移植不是重写**：窗口预算、出处上限、必写档口径、代词句带前一句、补出处的"只补不删"
 * 都有实测来历（见原型 25–64 行的注释）。改任何一处都会挪动已冻结的读数。
 *
 * 与原型的两处形状差异（不改语义）：
 *   · `sentenceOf` 读**切句表**（articleId → 句数组）而不是 cluster 对象；
 *     切句本身用 `utils/report-v3.ts` 的 `splitSentences`（与原型 lib.mjs 逐字相同）。
 *   · 原型走不到的那一套（selection / grounding / route gate / 文件缓存）一律不移植。
 */

/** 切句表：articleId（字符串键）→ 句子数组，下标 +1 = `sources[].sentence`。 */
export type SentenceTable = Record<string, string[]>;

export interface V6Article {
  id: number;
  title: string;
  publishDate: string;
  sourceId: number | null;
  sentences: string[];
}

export interface V6Source {
  articleId: number;
  sentence: number;
}

export interface V6Anchor {
  id: string;
  topic: string;
  sources: V6Source[];
}

export interface V6Window {
  index: number;
  start: number;
  end: number;
  chars: number;
  articleIds: number[];
  text: string;
}

export interface V6Sentence {
  text: string;
  sources: V6Source[];
}

/** 窗口字符预算（原型 DIRECT_RAW_WINDOW_CHARS 默认值）。 */
export const WINDOW_CHARS = 30_000;
/** 相邻窗口按文章重叠几篇（原型 DIRECT_RAW_OVERLAP_ARTICLES 默认值）。 */
export const OVERLAP_ARTICLES = 1;
/** 窗口步每条重点的出处上限。REPAIR_FULL=false 这条路径下推导值是 4。 */
export const ANCHOR_SOURCES = 4;
/** 写作步：exec 档 3–5 句、每句出处上限 8。 */
export const WRITE_MAX_SENTENCES = 5;
export const WRITE_MAX_SOURCES = 8;
/** 必写档的放宽量。MUST_SLACK 在这条路径下的推导值是 0（原型 60–64 行：试过 1，已撤回）。 */
export const MUST_SLACK = 0;

/** 句子定位：{articleId, sentence} → 原句文本。越界返回 undefined。 */
export function sentenceOf(sentences: SentenceTable, articleId: number, sentence: number): string | undefined {
  const ss = sentences[String(articleId)];
  if (!ss) return undefined;
  if (!Number.isInteger(sentence) || sentence < 1 || sentence > ss.length) return undefined;
  return ss[sentence - 1];
}

// ── 窗口切分 ────────────────────────────────────────────────────────────
export function rawArticle(a: V6Article): string {
  const lines = a.sentences.map((s, i) => `[${a.id}:${i + 1}] ${s}`).join('\n');
  return `## ${a.title}\narticleId=${a.id} published=${a.publishDate} source=${a.sourceId ?? '-'}\n${lines}`;
}

/** Greedy character-budget windows. Every article occurs; adjacent windows overlap by article. */
export function makeWindows(articles: V6Article[], budget = WINDOW_CHARS, overlap = OVERLAP_ARTICLES): V6Window[] {
  if (!articles.length) return [];
  if (!Number.isFinite(budget) || budget < 1) throw new Error('window budget must be positive');
  if (!Number.isInteger(overlap) || overlap < 0) throw new Error('overlap must be a non-negative integer');
  const rendered = articles.map(a => ({ article: a, raw: rawArticle(a) }));
  const out: V6Window[] = [];
  let start = 0;
  while (start < rendered.length) {
    let end = start;
    let chars = 0;
    while (end < rendered.length) {
      const n = rendered[end].raw.length + 2;
      if (end > start && chars + n > budget) break;
      chars += n;
      end++;
    }
    out.push({
      index: out.length,
      start,
      end,
      chars,
      articleIds: rendered.slice(start, end).map(x => x.article.id),
      text: rendered.slice(start, end).map(x => x.raw).join('\n\n'),
    });
    if (end >= rendered.length) break;
    const next = Math.max(start + 1, end - Math.min(overlap, end - start - 1));
    start = next;
  }
  const covered = new Set(out.flatMap(w => w.articleIds));
  if (covered.size !== articles.length || articles.some(a => !covered.has(a.id))) {
    throw new Error(`window coverage invariant failed: ${covered.size}/${articles.length}`);
  }
  return out;
}

// ── 校验 ────────────────────────────────────────────────────────────────
/** 出处标签 [articleId:sentence] 不许出现在成稿里（快档 verify.mjs 同一条判据） */
export const MARKER = /\[\s*\d{3,}\s*:\s*\d+/;

/**
 * 模型常把引用标签写进句尾（实测 c28 五句全带 [986133:3, 1006787:2]），标签对读者无意义、出处已在 sources。
 * 确定性剥掉整组标签，剥不干净的残留再由 MARKER 拒收重试。
 */
export const stripMarkers = (t: string): string =>
  t.replace(/\s*\[\s*\d{3,}\s*:\s*\d+(?:\s*[,;]\s*\d{3,}\s*:\s*\d+)*\s*\]/g, '');

export function anchorOk(obj: any, sentences: SentenceTable, allowed: Set<number>): boolean {
  if (!Array.isArray(obj?.anchors) || obj.anchors.length > 12) return false;
  return obj.anchors.every(
    (c: any) =>
      typeof c?.topic === 'string' &&
      c.topic.trim() &&
      Array.isArray(c.sources) &&
      c.sources.length > 0 &&
      c.sources.length <= ANCHOR_SOURCES &&
      c.sources.every((s: any) => allowed.has(s.articleId) && sentenceOf(sentences, s.articleId, s.sentence) !== undefined)
  );
}

export interface V6Written {
  verdict: 'written' | 'not_a_single_event';
  reason: string;
  title: string;
  sentences: V6Sentence[];
}

export function cleanWrite(x: any): any {
  if (!x || !Array.isArray(x.sentences)) return x;
  return {
    ...x,
    title: stripMarkers(String(x.title ?? '')),
    sentences: x.sentences.map((s: any) => ({ ...s, text: stripMarkers(String(s?.text ?? '')) })),
  };
}

export function writeOk(raw: any, cited: Set<string>): boolean {
  const x = cleanWrite(raw);
  if (!['written', 'not_a_single_event'].includes(x?.verdict) || typeof x?.reason !== 'string' || !Array.isArray(x.sentences)) return false;
  if (x.verdict === 'not_a_single_event') return x.reason.trim().length > 0 && x.sentences.length === 0;
  if (!x.title?.trim() || MARKER.test(x.title) || !x.sentences.length) return false;
  return x.sentences.every(
    (s: any) =>
      typeof s?.text === 'string' &&
      s.text.trim() &&
      !MARKER.test(s.text) &&
      Array.isArray(s.sources) &&
      s.sources.length > 0 &&
      s.sources.every((r: any) => cited.has(`${r.articleId}:${r.sentence}`))
  );
}

// ── 写作材料 ────────────────────────────────────────────────────────────
/** 一条重点的报道篇数 = 它引到的不同文章数。窗口步每条最多引 4 句，所以 4 即「4 篇及以上」。 */
export const supportOf = (a: { sources: V6Source[] }): number => new Set(a.sources.map(s => s.articleId)).size;

/**
 * 必写档：报道篇数达到本簇最高档的重点（下限 2 篇，单篇报道的不强制）。
 * WRITE_REPAIR 下放宽到最高档与次一档（top-1）：窗口步重跑一次，c28 营救线各条重点从 4 篇变 3 篇，
 * 只取最高档时整条线掉出必写、从成稿里消失——一篇之差不该决定一整条线写不写。
 */
export function mustCover(anchors: V6Anchor[], slack = 0): Set<string> {
  const top = Math.max(0, ...anchors.map(supportOf));
  const floor = Math.max(2, top - slack);
  return top >= 2 ? new Set(anchors.filter(a => supportOf(a) >= floor).map(a => a.id)) : new Set<string>();
}

/** 写作材料：每条重点只给话题标签 + 它指向的**原句**（不给任何上一步写出的转述）。 */
// 说话人藏在前一句的原句：代词开头，或含 "he added / she said" 这类无主名的引述
export const PRONOUN_LED = /^\W*(he|she|they|his|her|their|it)\b|\b(he|she|they) (added|said|says|told|wrote|noted|warned|stressed)\b/i;

/** 需要带上下文的原句 → 它的前一句（同篇）。写作材料与补出处都用它。 */
export function contextOf(sentences: SentenceTable, s: V6Source): V6Source | null {
  const t = sentenceOf(sentences, s.articleId, s.sentence) ?? '';
  return s.sentence > 1 && PRONOUN_LED.test(t) ? { articleId: s.articleId, sentence: s.sentence - 1 } : null;
}

export function writeMaterial(
  anchors: V6Anchor[],
  sentences: SentenceTable,
  withSupport = false,
  withContext = false
): string {
  const must = withSupport ? mustCover(anchors, MUST_SLACK) : new Set<string>();
  const list = withSupport ? [...anchors].sort((a, b) => supportOf(b) - supportOf(a)) : anchors;
  const line = (s: V6Source) => `[${s.articleId}:${s.sentence}] ${sentenceOf(sentences, s.articleId, s.sentence)}`;
  return list
    .map(a => {
      const head = withSupport
        ? `### ${a.topic} — reported by ${supportOf(a)} article(s)${must.has(a.id) ? ' — MUST COVER' : ''}`
        : `### ${a.topic}`;
      return `${head}\n${a.sources
        .map(s => {
          const ctx = withContext ? contextOf(sentences, s) : null;
          return ctx ? `(preceding sentence, for who is speaking) ${line(ctx)}\n${line(s)}` : line(s);
        })
        .join('\n')}`;
    })
    .join('\n\n');
}

// ── 数字 / 引语核对（移植自 scripts/eval/cluster-to-brief/lib.mjs）────────
/** 句中出现的数字，去掉千分位。日期类（1900-2100 的四位整数）不算，它们常被正确推算出来。 */
export function numbersIn(text: unknown): Set<string> {
  const out = new Set<string>();
  for (const m of String(text ?? '').match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    const x = m.replace(/,/g, '');
    const n = Number(x);
    if (Number.isInteger(n) && n >= 1900 && n <= 2100) continue;
    out.add(x);
  }
  return out;
}

/**
 * 句中引号内的原话（双引号 "" “” 与弯单引号 ‘’，以及前后是空格/标点的直单引号 'x y'）。
 * 只取 ≥2 个词的片段：单词引语（如 'hoax'）太短，落在任何句子里都可能碰巧对上。
 */
export function quotesIn(text: unknown): string[] {
  const t = String(text ?? '');
  const out: string[] = [];
  for (const re of [/"([^"]+)"/g, /“([^”]+)”/g, /‘([^’]+)’/g, /(?:^|[\s(])'([^']+?)'(?=[\s.,;:!?)]|$)/g]) {
    for (const m of t.matchAll(re)) if (m[1].trim().split(/\s+/).length >= 2) out.push(m[1].trim());
  }
  return out;
}

/** 引语比对用的归一：小写、去标点与引号、压空白。模型改大小写或丢逗号不算改原话。 */
export function normQuote(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 补出处：句中的数字/引语不在所引原句里，就在材料池里找**字面包含**它的原句补进 sources。
 * 只补不删、只认字面包含，所以不会把出处改错；找不到就原样留着，由快档报读数。
 */
export function repairCitations(
  sentences: V6Sentence[],
  pool: V6Source[],
  table: SentenceTable
): { sentences: V6Sentence[]; added: number } {
  let added = 0;
  const out = sentences.map(s => {
    const sources = [...s.sources];
    const have = () => sources.map(r => sentenceOf(table, r.articleId, r.sentence) ?? '').join(' ');
    const needNums = () => {
      const h = numbersIn(have());
      return [...numbersIn(s.text)].filter(n => !h.has(n));
    };
    const needQuotes = () => {
      const h = normQuote(have());
      return quotesIn(s.text).filter(q => !h.includes(normQuote(q)));
    };
    for (const n of needNums()) {
      if (!needNums().includes(n)) continue;
      const hit = pool.find(r => numbersIn(sentenceOf(table, r.articleId, r.sentence) ?? '').has(n));
      if (hit) {
        sources.push(hit);
        added++;
      }
    }
    for (const q of needQuotes()) {
      const hit = pool.find(r => normQuote(sentenceOf(table, r.articleId, r.sentence) ?? '').includes(normQuote(q)));
      if (hit) {
        sources.push(hit);
        added++;
      }
    }
    return { ...s, sources };
  });
  return { sentences: out, added };
}
