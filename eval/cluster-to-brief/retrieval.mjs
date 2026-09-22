/**
 * 证据检索:给一句成稿,从**整簇原文**里找最相关的原句。零 LLM(本地 e5-small),零远程调用。
 *
 * 为什么证据要由评分方检索、不能用成稿自己给的出处:
 * 旧做法把证据窗口锚在成稿引的那句上,于是**引得越宽的臂拿到越多证据**,判官据此判事实对错
 * —— 尺量的是引用行为,不是写得对不对。2026-09-19 实测各臂每句出处 1.03~1.73 不等,这个
 * 差距会直接搬进正确性读数。事实性评测文献(AlignScore / SummaC / MiniCheck)一致的做法是
 * 证据由评分方在全文里检索,与生成方引了谁无关,本文件照此。
 *
 * 检索结果与成稿引了谁完全无关,所以它对各臂是同一把尺。成稿声称的出处另行呈现,只用来判
 * `citedSentenceSuffices`(被引那句本身够不够),两者在判定包里分开摆。
 *
 * 向量沿用慢档既有的本地 e5-small(`slow-lib.mjs` 的 embed → `embed.py`),不引新依赖:
 * 384 维、已归一化,cos 就是裸点积。簇内句向量按簇缓存在 out/.emb-sent-c<cid>.json,
 * 跨臂共用(同一簇的句子集合是固定的)。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { embed, cos } from './slow-lib.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = `${HERE}out`;

/** 每句成稿检索几条证据。8 沿用 2026-09-19 原型 V4 的取值。 */
export const TOPK = Number(process.env.JUDGE_TOPK ?? 8);

/** 簇内全部句子摊平成可检索的行。顺序由 loadCluster 决定(已按时间升序),故可缓存。 */
export function flattenSentences(cluster) {
  const rows = [];
  for (const a of cluster.articles) {
    a.sentences.forEach((text, i) => {
      rows.push({ articleId: a.id, sentence: i + 1, text, title: a.title, publishDate: a.publishDate });
    });
  }
  return rows;
}

/**
 * 簇内句向量,按簇缓存。缓存键带句子条数与首末句,句子集合一变就失配重算
 * —— 静默用旧向量是这里最危险的失效方式(检索照样出结果,全是错的)。
 */
function clusterVectors(clusterId, rows, outDir, ns) {
  mkdirSync(outDir, { recursive: true });
  const f = `${outDir}/.emb-sent-${ns}c${clusterId}.json`;
  const key = `${rows.length}|${rows[0]?.text ?? ''}|${rows[rows.length - 1]?.text ?? ''}`;
  if (existsSync(f)) {
    const c = JSON.parse(readFileSync(f, 'utf8'));
    if (c.key === key && Array.isArray(c.vecs) && c.vecs.length === rows.length) return c.vecs;
    console.error(`  ⚠️ c${clusterId} 句向量缓存失配,重算`);
  }
  const m = embed(rows.map(r => r.text), `sent-${ns}c${clusterId}`, outDir);
  const vecs = rows.map(r => m.get(r.text));
  if (vecs.some(v => !Array.isArray(v))) throw new Error(`c${clusterId}: 有句子没拿到向量`);
  writeFileSync(f, JSON.stringify({ key, vecs }));
  return vecs;
}

/**
 * 建一个簇的检索索引。`queries` 是本轮要检索的成稿句(一次性一起 embed,省一次进程启动)。
 *
 * `opts.outDir` / `opts.ns` 给别的 harness 用:句向量缓存要落在自己的 out/ 里,
 * 且簇号可能与本 harness 撞号(`scorer-recall` 的簇是 0/3/13/18),所以缓存名要带命名空间。
 */
export function buildIndex(cluster, queries, opts = {}) {
  const outDir = opts.outDir ?? OUT;
  const ns = opts.ns ? `${opts.ns}-` : '';
  const rows = flattenSentences(cluster);
  const vecs = clusterVectors(cluster.clusterId, rows, outDir, ns);
  const uniqQ = [...new Set(queries.filter(q => q && q.trim()))];
  const qm = uniqQ.length ? embed(uniqQ, `q-${ns}c${cluster.clusterId}`, outDir) : new Map();
  return { rows, vecs, qm };
}

/** 某句成稿的 top-k 证据。返回 [{...row, score}],按相似度降序。 */
export function topK(index, queryText, k = TOPK) {
  const q = index.qm.get(queryText);
  if (!q) return [];
  const scored = index.rows.map((r, i) => ({ ...r, score: cos(q, index.vecs[i]) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
