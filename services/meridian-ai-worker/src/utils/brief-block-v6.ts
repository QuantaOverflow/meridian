/**
 * 【简报块 v6 · 纯函数】原型 `eval/cluster-to-brief/arms/direct-raw/direct-raw.mjs`
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

import { splitSentences } from './report-v3';

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
const WINDOW_CHARS = 30_000;
/** 相邻窗口按文章重叠几篇（原型 DIRECT_RAW_OVERLAP_ARTICLES 默认值）。 */
const OVERLAP_ARTICLES = 1;
/** 窗口步每条重点的出处上限。REPAIR_FULL=false 这条路径下推导值是 4。 */
export const ANCHOR_SOURCES = 4;
/** 写作步：exec 档 3–5 句、每句出处上限 8。 */
export const WRITE_MAX_SENTENCES = 5;
export const WRITE_MAX_SOURCES = 8;

/**
 * 篇幅档。`lead` / `more` 走现有 exec 档（逐字不变，那是唯一有实测读数的配置），
 * `brief` 走 1–2 句的短档。不传 / 非法值的处理见 `normalizeTier`。
 */
export type V6Tier = 'lead' | 'more' | 'brief';
export const V6_TIERS: V6Tier[] = ['lead', 'more', 'brief'];
/**
 * 不传 / 非法值 → `more`，与 `writeLenOf` 的默认档一致。
 *
 * 两处必须同一个默认值：`writeLenOf` 决定实际写多长，这里决定 `trace.tier` 报什么。
 * 一度是 `lead` / `more` 分叉的——不传 tier 的请求按 `more` 档写、却在 trace 里报
 * `lead`，排查时读到的档位和实际行为对不上。生产的 backend 永远显式传 tier，所以
 * 咬不到，但会说谎的读数不留。
 */
export const normalizeTier = (t: unknown): V6Tier => (V6_TIERS.includes(t as V6Tier) ? (t as V6Tier) : 'more');

/** 句子定位：{articleId, sentence} → 原句文本。越界返回 undefined。 */
function sentenceOf(sentences: SentenceTable, articleId: number, sentence: number): string | undefined {
  const ss = sentences[String(articleId)];
  if (!ss) return undefined;
  if (!Number.isInteger(sentence) || sentence < 1 || sentence > ss.length) return undefined;
  return ss[sentence - 1];
}

// ── 窗口切分 ────────────────────────────────────────────────────────────
function rawArticle(a: V6Article): string {
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
const MARKER = /\[\s*\d{3,}\s*:\s*\d+/;

/**
 * 模型常把引用标签写进句尾（实测 c28 五句全带 [986133:3, 1006787:2]），标签对读者无意义、出处已在 sources。
 * 确定性剥掉整组标签，剥不干净的残留再由 MARKER 拒收重试。
 */
const stripMarkers = (t: string): string =>
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

export function cleanWrite(x: any): any {
  if (!x || !Array.isArray(x.sentences)) return x;
  return {
    ...x,
    title: stripMarkers(String(x.title ?? '')),
    sentences: x.sentences.map((s: any) => ({ ...s, text: stripMarkers(String(s?.text ?? '')) })),
  };
}

/**
 * 句末标点。2026-09-19 生产那三句坏句全是断在半句上（`assured the incident ` /
 * `abetment of [` / `transferred,`），收尾字符就是它们与其余 105 句的分界。
 */
const TERMINAL_PUNCT = /[.!?"”’)]\s*$/;

/**
 * 写作步的确定性校验。返回**失败原因列表**，空数组 = 通过。
 *
 * 返回原因而不是 boolean，是因为 chatJson 的自救重试要把原因写进下一次的 prompt。
 * 因此每条原因只含**原因码 + 第几句**，绝不含模型写出来的文本——坏文本不回喂
 * （glm-4.7-flash 的退化史见 services/brief-block-v6.ts 的 chatJson 注释）。
 *
 * 除原有的 verdict / marker / 出处三类外多两条（2026-09-19 生产实测：24 块 108 句里
 * 3 句坏、全在 storyIdx=17；这两条在那 108 句上精确命中那 3 句、误伤 0 句）：
 *   · multi_sentence     一个 text 只能是一句（splitSentences 切出来正好 1 条）
 *   · no_terminal_punct  必须以句末标点结尾
 */
export function writeOk(raw: any, cited: Set<string>): string[] {
  const x = cleanWrite(raw);
  const bad: string[] = [];
  if (!['written', 'not_a_single_event'].includes(x?.verdict)) bad.push('bad_verdict');
  if (typeof x?.reason !== 'string') bad.push('missing_reason');
  if (!Array.isArray(x?.sentences)) bad.push('bad_sentences');
  if (bad.length) return bad;

  if (x.verdict === 'not_a_single_event') {
    if (!x.reason.trim()) bad.push('missing_reason');
    if (x.sentences.length) bad.push('unexpected_sentences');
    return bad;
  }

  if (!x.title?.trim()) bad.push('missing_title');
  else if (MARKER.test(x.title)) bad.push('marker_leak_title');
  if (!x.sentences.length) bad.push('no_sentences');

  x.sentences.forEach((s: any, i: number) => {
    const at = `sentence ${i + 1}`;
    if (typeof s?.text !== 'string' || !s.text.trim()) {
      bad.push(`${at}: empty_text`);
    } else {
      if (MARKER.test(s.text)) bad.push(`${at}: marker_leak`);
      if (splitSentences(s.text).length !== 1) bad.push(`${at}: multi_sentence`);
      if (!TERMINAL_PUNCT.test(s.text)) bad.push(`${at}: no_terminal_punct`);
    }
    if (!Array.isArray(s?.sources) || s.sources.length === 0) bad.push(`${at}: no_sources`);
    else if (!s.sources.every((r: any) => cited.has(`${r?.articleId}:${r?.sentence}`))) bad.push(`${at}: bad_source`);
  });
  return bad;
}

/** 原因码 → 给模型看的一句英文说明（与 prompt 其余部分同语言）。 */
const REASON_HINTS: Record<string, string> = {
  bad_verdict: 'verdict must be exactly "written" or "not_a_single_event".',
  missing_reason: 'the reason field was missing or empty.',
  bad_sentences: 'sentences must be an array.',
  unexpected_sentences: 'verdict not_a_single_event must come with an empty sentences array.',
  missing_title: 'title was missing or empty; give the story a short headline.',
  marker_leak_title: 'the title contained an [articleId:sentence] label; labels are for the sources field only.',
  // 具体句数是 tier 相关的（brief 档 schema 只准 1 句），这里不给一个写死的数字——
  // 调用方（写作步）必须按当次 tier 传 hints 覆盖，见 retryInstruction 的 hints 参数。
  no_sentences: 'verdict written must come with at least one sentence.',
  empty_text: 'the text field was missing or empty.',
  marker_leak: 'the text contained an [articleId:sentence] label; never write labels inside text.',
  multi_sentence: 'the text field contained more than one sentence; each text must be exactly one sentence.',
  no_terminal_punct:
    'the text ended without terminal punctuation; every sentence must be complete and end with a full stop.',
  no_sources: 'the sources array was empty; cite the source sentences that support this sentence.',
  bad_source: 'a cited [articleId:sentence] coordinate is not in the material above; cite only sentences shown there.',
};

/**
 * 由失败原因生成追加到 prompt 末尾的自救说明。
 * **只回传诊断，不回传模型上一次的输出**：让 glm-4.7-flash 接着自己的退化文本往下写有
 * 加剧风险（本仓复读事故已四次，memory `repetition-guard-always-on`）。入参是原因码，
 * 所以这个函数在结构上就拿不到坏文本。
 *
 * `hints`：按原因码覆盖 `REASON_HINTS` 里的默认文案，用于 tier 相关的提示（如
 * `no_sentences`——句数因 tier 而异，写作步据当次 tier 传 `prompts/briefBlockV6.ts`
 * 的 `noSentencesHint` 覆盖，见 bug B5）。不传就用 `REASON_HINTS` 的默认文案。
 */
export function retryInstruction(reasons: string[], hints: Partial<Record<string, string>> = {}): string {
  if (!reasons.length) return '';
  const lines = [...new Set(reasons)].map(r => {
    const m = /^(sentence \d+): (.+)$/.exec(r);
    const where = m ? `${m[1]}: ` : '';
    const code = m ? m[2] : r;
    return `- ${where}${hints[code] ?? REASON_HINTS[code] ?? `it failed the ${code} check.`}`;
  });
  return [
    'Your previous answer was rejected by a mechanical check. Fix these and answer again in full:',
    ...lines,
    'Do not repeat the rejected wording; write the item again from the material above.',
  ].join('\n');
}

// ── 写作材料 ────────────────────────────────────────────────────────────
/** 一条重点的报道篇数 = 它引到的不同文章数。窗口步每条最多引 4 句，所以 4 即「4 篇及以上」。 */
const supportOf = (a: { sources: V6Source[] }): number => new Set(a.sources.map(s => s.articleId)).size;

/**
 * 必写档：报道篇数达到本簇最高档的重点（下限 2 篇，单篇报道的不强制）。
 * （原型试过放宽到「最高档与次一档」，已撤回。）
 */
function mustCover(anchors: V6Anchor[]): Set<string> {
  const top = Math.max(0, ...anchors.map(supportOf));
  const floor = Math.max(2, top);
  return top >= 2 ? new Set(anchors.filter(a => supportOf(a) >= floor).map(a => a.id)) : new Set<string>();
}

/** 写作材料：每条重点只给话题标签 + 它指向的**原句**（不给任何上一步写出的转述）。 */
// 说话人藏在前一句的原句：代词开头，或含 "he added / she said" 这类无主名的引述
const PRONOUN_LED = /^\W*(he|she|they|his|her|their|it)\b|\b(he|she|they) (added|said|says|told|wrote|noted|warned|stressed)\b/i;

/** 需要带上下文的原句 → 它的前一句（同篇）。写作材料与补出处都用它。 */
export function contextOf(sentences: SentenceTable, s: V6Source): V6Source | null {
  const t = sentenceOf(sentences, s.articleId, s.sentence) ?? '';
  return s.sentence > 1 && PRONOUN_LED.test(t) ? { articleId: s.articleId, sentence: s.sentence - 1 } : null;
}

export function writeMaterial(
  anchors: V6Anchor[],
  sentences: SentenceTable,
  /**
   * 是否给达到必写档的重点打 ` — MUST COVER`（默认开，金标据此冻结）。
   * brief 档单独关掉：那一档只准写 2 句，而一个簇常有 5–12 条 MUST COVER，
   * 「每条都要写进去」与「最多 2 句」是自相矛盾的指令。排序照旧保留。
   */
  withMustCover = true
): string {
  const must = withMustCover ? mustCover(anchors) : new Set<string>();
  const list = [...anchors].sort((a, b) => supportOf(b) - supportOf(a));
  const line = (s: V6Source) => `[${s.articleId}:${s.sentence}] ${sentenceOf(sentences, s.articleId, s.sentence)}`;
  return list
    .map(a => {
      const head = `### ${a.topic} — reported by ${supportOf(a)} article(s)${must.has(a.id) ? ' — MUST COVER' : ''}`;
      return `${head}\n${a.sources
        .map(s => {
          const ctx = contextOf(sentences, s);
          return ctx ? `(preceding sentence, for who is speaking) ${line(ctx)}\n${line(s)}` : line(s);
        })
        .join('\n')}`;
    })
    .join('\n\n');
}

// ── 数字 / 引语核对（移植自 eval/cluster-to-brief/lib.mjs）────────
/** 句中出现的数字，去掉千分位。日期类（1900-2100 的四位整数）不算，它们常被正确推算出来。 */
function numbersIn(text: unknown): Set<string> {
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
function quotesIn(text: unknown): string[] {
  const t = String(text ?? '');
  const out: string[] = [];
  for (const re of [/"([^"]+)"/g, /“([^”]+)”/g, /‘([^’]+)’/g, /(?:^|[\s(])'([^']+?)'(?=[\s.,;:!?)]|$)/g]) {
    for (const m of t.matchAll(re)) if (m[1].trim().split(/\s+/).length >= 2) out.push(m[1].trim());
  }
  return out;
}

/** 引语比对用的归一：小写、去标点与引号、压空白。模型改大小写或丢逗号不算改原话。 */
function normQuote(s: unknown): string {
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
