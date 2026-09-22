/**
 * 【切句与抽取解析 · 纯函数】不碰网络、不碰 env。
 *
 * 报告层 v3（services/report-v3.ts 等）已退役删除，本文件只留下还有调用方的几个函数：
 *   splitSentences            简报块 v6 的切句（services/brief-block-v6.ts、utils/brief-block-v6.ts）
 *   packBatches / parseCite / checkFact   本地原型 apps/backend/prototypes/cost-split/ 在 import
 *
 * 逐条搬自原型 apps/backend/prototypes/srl-extractive/（只在本地）：
 *   splitSentences            srl.mjs
 *   parseCite / checkFact     cite-select.mjs
 * 判据不许按具体簇调（原型是在 4 个簇上定的，改了就不是那套读数）。
 */

// ── 输入 / 输出形状 ──────────────────────────────────────────────────────
export interface ReportArticleInput {
  id: number;
  title: string;
  url?: string;
  publishDate?: string;
  content: string;
}

// ── 切句 ────────────────────────────────────────────────────────────────
const ABBREVIATIONS = [
  'Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Jr', 'Sr', 'Prof', 'Rep', 'Sen', 'Gov', 'Rev', 'Gen', 'Col',
  'Lt', 'Capt', 'vs', 'etc', 'Inc', 'Corp', 'Co', 'Ltd', 'No', 'approx', 'Ave', 'Blvd', 'Fig',
];
const PLACEHOLDER = '\u0001'; // 不算句末的那个点
const SPLIT = '\u0002';

/**
 * 正则切句。抓取时段落换行已被清掉，很多边界处一个空格都没有（"…over trade.But while…"），
 * 所以边界规则允许零空白；句号后面必须是大写字母，故小数点、"$3.5bn" 不会被切开。
 */
export function splitSentences(text: string): string[] {
  if (!text || !text.trim()) return [];
  let t = text;
  t = t.replace(new RegExp(`\\b(${ABBREVIATIONS.join('|')})\\.`, 'g'), (_, w) => `${w}${PLACEHOLDER}`);
  t = t.replace(/\b([A-Z])\./g, (_, c) => `${c}${PLACEHOLDER}`);
  t = t.replace(/([.!?]+)(\s*)(?=["'“‘]?[A-Z])/g, (_, punct, ws) => `${punct}${ws}${SPLIT}`);
  return t
    .split(SPLIT)
    .map(s => s.replace(new RegExp(PLACEHOLDER, 'g'), '.').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export interface BatchPart {
  article: ReportArticleInput;
  localStart: number;
  sentences: string[];
}

/** 每批最多 budget 句，长文章切成多段；一批可以装几篇短文章（原型 BUDGET=20）。 */
export function packBatches(
  articles: Array<{ article: ReportArticleInput; sentences: string[] }>,
  budget: number
): BatchPart[][] {
  const units: BatchPart[] = [];
  for (const a of articles) {
    for (let i = 0; i < a.sentences.length; i += budget) {
      units.push({ article: a.article, localStart: i, sentences: a.sentences.slice(i, i + budget) });
    }
  }
  const batches: BatchPart[][] = [];
  let cur: BatchPart[] = [];
  let n = 0;
  for (const u of units) {
    if (n && n + u.sentences.length > budget) {
      batches.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(u);
    n += u.sentences.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

// ── 抽取结果 ────────────────────────────────────────────────────────────
export interface ParsedCite {
  facts: Array<{ text: string; cites: number[] }>;
  unparsed: string[];
  jsonError: string | null;
}

/** 约束式解码的产出；什么都不静默丢（解不出的进 unparsed）。 */
export function parseCite(content: string): ParsedCite {
  const facts: Array<{ text: string; cites: number[] }> = [];
  const unparsed: string[] = [];
  let obj: unknown;
  try {
    obj = JSON.parse(content);
  } catch (e) {
    return { facts, unparsed, jsonError: e instanceof Error ? e.message : String(e) };
  }
  const arr = (obj as { facts?: unknown })?.facts;
  for (const f of Array.isArray(arr) ? arr : []) {
    const text = String((f as { text?: unknown })?.text ?? '').trim();
    const rawCites = (f as { cite?: unknown })?.cite;
    const cites = (Array.isArray(rawCites) ? rawCites : []).map(Number).filter(Number.isInteger);
    if (text) facts.push({ text, cites });
    else unparsed.push(JSON.stringify(f));
  }
  return { facts, unparsed, jsonError: null };
}

// trim 是 2026-09-13 补的：只压内部空白、不去首尾，会让「首尾多一个空格的同一句」当成两条不同的事实，
// preMergeIdentical 就漏掉它们（纯函数自检抓到）。
const normText = (s: string) =>
  (s ?? '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/'s\b/g, '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
const numbersOf = (s: string) => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(x => x.replace(/,/g, ''));
const NAME_STOP = new Set(['The', 'This', 'That', 'These', 'Those', 'It', 'In', 'On', 'At', 'For', 'After', 'Before', 'When', 'While', 'And', 'But', 'Its', 'Their', 'His', 'Her']);

/**
 * 对着所引原句做确定性检查：编号越界、凭空的数字与名字。
 * 抓不到「名字数字都在、关系接错」那类（那是写作层的关系错，见 ADR 0004）。
 */
export function checkFact(fact: { text: string; cites: number[] }, flat: string[]) {
  const valid = [...new Set(fact.cites)].filter(k => k >= 1 && k <= flat.length);
  const invalid = fact.cites.filter(k => !(k >= 1 && k <= flat.length)).length;
  const src = normText(valid.map(k => flat[k - 1]).join(' '));
  const srcNums = new Set(numbersOf(src));
  const numbersMissing = numbersOf(fact.text).filter(x => !srcNums.has(x));
  // 前缀匹配，免得 demonym / 所有格算成凭空（"Australian" vs "Australia's"）
  const found = (w: string) => {
    const x = w.toLowerCase().replace(/'s$/, '');
    return src.includes(x) || src.includes(x.slice(0, Math.max(5, x.length - 3)));
  };
  const namesMissing = (fact.text.match(/\b[A-Z][a-zA-Z&'.-]{2,}\b/g) ?? []).filter(w => !NAME_STOP.has(w) && !found(w));
  return { valid, invalid, numbersMissing, namesMissing };
}
