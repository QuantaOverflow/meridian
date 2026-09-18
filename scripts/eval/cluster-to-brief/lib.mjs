/**
 * 原型与 verifier 共用的地基:切句 + fixture 载入。
 *
 * ⚠️ `splitSentences` 必须与生产逐字一致(`services/meridian-ai-worker/src/utils/report-v3.ts`),
 * 因为 `sources[].sentence` 是按它的编号来的。偏一点就会让基线臂(走生产报告层)的出处
 * **静默指向错误的句子**——不报错、读数照出,但全是错的。改这个函数前先读那边。
 */

// ── 切句(逐字抄自生产 utils/report-v3.ts)────────────────────────────────
const ABBREVIATIONS = [
  'Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Jr', 'Sr', 'Prof', 'Rep', 'Sen', 'Gov', 'Rev', 'Gen', 'Col',
  'Lt', 'Capt', 'vs', 'etc', 'Inc', 'Corp', 'Co', 'Ltd', 'No', 'approx', 'Ave', 'Blvd', 'Fig',
];
const PLACEHOLDER = '';
const SPLIT = '';

/**
 * 抓取时段落换行已被清掉,很多边界处一个空白都没有("…over trade.But while…"),
 * 所以边界规则允许零空白;句号后面必须是大写字母,故小数点、"$3.5bn" 不会被切开。
 */
export function splitSentences(text) {
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

// ── fixture 载入 ────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
export const FIX = `${HERE}fixtures/`;

export function loadExpectations() {
  return JSON.parse(readFileSync(`${HERE}expectations.json`, 'utf8'));
}

/**
 * 一个簇的全部输入。`sentences` 是逐篇切好的句子数组,下标 +1 = `sources[].sentence`。
 * 原型读它当输入,verifier 读它核出处——**同一份数据、同一套编号**,这是两边不脱钩的唯一保证。
 */
export function loadCluster(clusterId) {
  const meta = JSON.parse(readFileSync(`${FIX}meta.json`, 'utf8'));
  const clusters = JSON.parse(readFileSync(`${FIX}clusters.json`, 'utf8'));
  const ids = clusters[String(clusterId)];
  if (!ids) throw new Error(`clusters.json 里没有 cluster ${clusterId}`);

  const articles = [];
  const missing = [];
  for (const id of ids) {
    const p = `${FIX}content/${id}.txt`;
    if (!existsSync(p)) { missing.push(id); continue; }
    const content = readFileSync(p, 'utf8');
    const m = meta[String(id)] ?? {};
    articles.push({
      id,
      title: m.title ?? '',
      url: m.url ?? '',
      publishDate: m.publishDate ?? '',
      sourceId: m.sourceId ?? null,
      content,
      sentences: splitSentences(content),
    });
  }
  if (missing.length) {
    throw new Error(`cluster ${clusterId} 缺 ${missing.length} 篇正文(先跑 fetch-fixtures.mjs): ${missing.slice(0, 10).join(',')}`);
  }
  // 时间升序:下游任何按时间的叙述都依赖这个顺序
  articles.sort((a, b) => (a.publishDate < b.publishDate ? -1 : a.publishDate > b.publishDate ? 1 : a.id - b.id));
  return { clusterId: Number(clusterId), articles };
}

/** 句子定位:{articleId, sentence} → 原句文本。越界返回 undefined(verifier 据此判不可解析)。 */
export function sentenceOf(cluster, articleId, sentence) {
  const a = cluster.articles.find(x => x.id === articleId);
  if (!a) return undefined;
  if (!Number.isInteger(sentence) || sentence < 1 || sentence > a.sentences.length) return undefined;
  return a.sentences[sentence - 1];
}

// ── 数字核对(纯机械)────────────────────────────────────────────────────
/** 句中出现的数字,去掉千分位。日期类(1900-2100 的四位整数)不算,它们常被正确推算出来。 */
export function numbersIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    const x = m.replace(/,/g, '');
    const n = Number(x);
    if (Number.isInteger(n) && n >= 1900 && n <= 2100) continue;
    out.add(x);
  }
  return out;
}

/** 成稿切句。与文章切句同一套规则,便于按句核对。 */
export const proseSentences = splitSentences;
