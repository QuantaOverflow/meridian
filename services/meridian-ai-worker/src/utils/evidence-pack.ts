/**
 * 【一次调用核查 · 取证】给一句成稿，代码从整簇里挑出核查要看的原句（ADR 0012；spec 在本地 .scratch/one-call-sentence-check/）。
 *
 * 逐字搬自冻结原型 `.scratch/one-call-sentence-check/port-source/`：`one-call.mts` 的 `clausesOf` / `evidenceFor`
 *（EVIDENCE=clause+sem）、`checkers.mts` 的 `numberPack`（COUNT_WORDS / COUNTED_RE）、`embed.mts` 里 `meaningHits` 的排序。
 * 上限（±1 邻句、整句词搜 6 / 分句词搜 8 / 整句按意思 6 / 分句按意思 5、时间线首 2 + 末 10 当超过 12）与分句规则都是测出来的，一个数都别改。
 *
 * 纯函数：词搜用的就是核查 agent 的 `Lookup.search`（同一份 idf 检索），向量由调用方递进来。
 */
import { Lookup, type CheckCluster, type ClusterSentence } from './sentence-check';
import type { BuildEvidencePack, ClausesOf, EvidenceEmbeddings } from '../types/one-call-check';

const SEARCH_HITS = 6;
const CLAUSE_HITS = 8;
const SEMANTIC_HITS = 6;
const SEMANTIC_CLAUSE_HITS = 5;

/** 句子切成分句：在 ; : — – 处、后面不跟数字的逗号处、连接词处切，留三个词以上的片段；数字里的逗号不切。 */
export const clausesOf: ClausesOf = t =>
  t
    .split(/[;:—–]|,(?!\d)| (?:and|but|while|after|before|as|because|when|which|who|that) /)
    .map(x => x.trim())
    .filter(x => x.split(/\s+/).length >= 3);

const byTime = (a: ClusterSentence, b: ClusterSentence) => a.published.localeCompare(b.published) || a.articleId - b.articleId || a.n - b.n;

// 计数词：数字后四个词以内跟着计数词（与原型 figure_candidates / pipeline 同一条正则）。
const COUNT_WORDS =
  'killed|dead|died|deaths?|injured|wounded|hurt|missing|evacuated|displaced|arrested|detained|released|flights?|cancell?ed|delayed|households|homes|customers|people|percent|mm|millimetres|inches|troops|soldiers|prisoners|casualties|victims|bodies|tonnes|votes|seats|cases|shelters|buildings';
const COUNTED_RE = new RegExp(String.raw`(\d[\d,]*(?:\.\d+)?)((?:\W+\w+){0,4}?)\W+(${COUNT_WORDS})\b`, 'gi');

/** 句中与数字相邻的计数词，各自在整簇里的时间线（带数字的句子；超过 12 条只留最早 2 条和最晚 10 条）。 */
function numberPack(text: string, c: CheckCluster): string[] {
  const words = new Set<string>();
  for (const m of text.matchAll(COUNTED_RE)) if (!/^(19|20)\d\d$/.test(m[1].replace(/,/g, ''))) words.add(m[3].toLowerCase().replace(/s$/, ''));
  const keys: string[] = [];
  for (const w of words) {
    const all = c.sents.filter(s => new RegExp(`\\b${w}`, 'i').test(s.text) && /\d/.test(s.text)).sort(byTime);
    // 过时是后来的报道的事：超过 12 条留最早 2 条和最晚 10 条
    const hits = all.length > 12 ? [...all.slice(0, 2), ...all.slice(-10)] : all;
    keys.push(...hits.map(s => `${s.articleId}:${s.n}`));
  }
  return keys;
}

/** 按意思最近的 n 句：单位向量点积，大的在前。没有这条查询的向量就不搜。 */
function meaningHits(emb: EvidenceEmbeddings, query: string, n: number): string[] {
  const q = emb.queries.get(query);
  if (!q) return [];
  return [...emb.sentences]
    .map(([k, v]) => ({ k, s: v.reduce((a, x, i) => a + x * q[i], 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map(x => x.k);
}

/** 词搜命中：Lookup.search 把返回的句子记作 seen，seen 的顺序就是命中的先后。 */
function wordHits(c: CheckCluster, query: string, n: number): string[] {
  const look = new Lookup(c);
  look.search({ query });
  return [...look.seen].slice(0, n);
}

export const buildEvidencePack: BuildEvidencePack = (c, text, cited, embeddings) => {
  const context = new Set<string>();
  for (const k of cited) {
    const s = c.byKey.get(k);
    if (!s) continue;
    for (const d of [-1, 0, 1]) if (c.byKey.has(`${s.articleId}:${s.n + d}`)) context.add(`${s.articleId}:${s.n + d}`);
  }
  const clauses = clausesOf(text);
  const hits = wordHits(c, text, SEARCH_HITS);
  for (const q of clauses) hits.push(...wordHits(c, q, CLAUSE_HITS));
  if (embeddings) {
    hits.push(...meaningHits(embeddings, text, SEMANTIC_HITS));
    for (const q of clauses) hits.push(...meaningHits(embeddings, q, SEMANTIC_CLAUSE_HITS));
  }
  const figures = [...new Set(numberPack(text, c))].filter(k => c.byKey.has(k)).sort((a, b) => byTime(c.byKey.get(a)!, c.byKey.get(b)!));
  const citedHere = cited.filter(k => c.byKey.has(k));
  const shown = new Set<string>();
  for (const k of [...cited, ...context, ...hits, ...figures]) if (c.byKey.has(k)) shown.add(k);
  return {
    shown: [...shown].sort((a, b) => byTime(c.byKey.get(a)!, c.byKey.get(b)!)),
    cites: citedHere,
    also: [...new Set([...hits, ...figures])].filter(k => c.byKey.has(k) && !citedHere.includes(k)),
    figures,
  };
};
