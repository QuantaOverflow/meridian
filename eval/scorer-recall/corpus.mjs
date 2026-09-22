/**
 * 把 `brief-v3-prod` 那次 M2 run 的原文语料重建成 `retrieval.mjs` 能吃的形状。
 *
 * 为什么不用 cluster-to-brief 的 fixtures:那 296 篇是 2026-09-13 之后的快照(id 98xxxx–100xxxx),
 * 与 M2 run 用的语料(id 90xxxx–92xxxx)**完全不重叠**,簇号体系也不同。手工金标标在 M2 那批稿上,
 * 所以原文必须取 M2 自己的。
 *
 * 语料在 `out/raw/<c>/{A,B,C}/batch*.json`:每批有 `map`(`[{articleId, sentence}, …]`)与
 * `flat`(对应原句正文)。A/B/C 是同一批文章的三次调用,句子会重复 —— 按 (articleId, sentence) 去重。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const ROOT = '/Users/shiwenjie/Desktop/playground/projects/meridian/apps/backend/prototypes/brief-v3-prod/out';
export const RUN = `${ROOT}/runs/M2-1789179743813`;
export const RAW = `${ROOT}/raw`;

/** 一个簇的原文,形状与 cluster-to-brief 的 loadCluster 一致(retrieval.mjs 直接吃)。 */
export function loadRunCluster(cid) {
  const dir = `${RAW}/${cid}`;
  if (!existsSync(dir)) throw new Error(`缺语料 ${dir} —— brief-v3-prod 原型是本地目录,不在 git 里`);

  // (articleId → Map(sentenceNo → text))。重复出现的以第一次为准并断言一致,
  // 不一致说明三次调用拿到的正文不同,那样按句号定位就不可靠了。
  const byArticle = new Map();
  let conflicts = 0;
  for (const pass of readdirSync(dir)) {
    const pd = `${dir}/${pass}`;
    for (const f of readdirSync(pd).filter(x => x.endsWith('.json'))) {
      const x = JSON.parse(readFileSync(`${pd}/${f}`, 'utf8'));
      const map = Array.isArray(x.map) ? x.map : [];
      const flat = Array.isArray(x.flat) ? x.flat : [];
      if (map.length !== flat.length) throw new Error(`${pd}/${f}: map/flat 长度不等 ${map.length} != ${flat.length}`);
      map.forEach((m, i) => {
        if (!byArticle.has(m.articleId)) byArticle.set(m.articleId, new Map());
        const s = byArticle.get(m.articleId);
        const prev = s.get(m.sentence);
        if (prev === undefined) s.set(m.sentence, flat[i]);
        else if (prev !== flat[i]) conflicts++;
      });
    }
  }
  if (conflicts) console.error(`  ⚠️ c${cid}: ${conflicts} 处同坐标不同文本(取首次),按句号定位不完全可靠`);

  const articles = [...byArticle.entries()].sort((a, b) => a[0] - b[0]).map(([id, sm]) => {
    const maxN = Math.max(...sm.keys());
    // sentences 下标 +1 = 原 sentence 号。缺号补空串,保证下标与坐标对齐。
    const sentences = Array.from({ length: maxN }, (_, i) => sm.get(i + 1) ?? '');
    return { id, title: `article ${id}`, url: '', publishDate: '', sourceId: null, content: sentences.join(' '), sentences };
  });
  return { clusterId: Number(cid), articles };
}

/** 一次 run 的全部 block。`text` 是成稿正文,没有逐句出处(这条流水线不标)。 */
export function loadBlocks() {
  return readdirSync(RUN).filter(f => f.endsWith('.json')).sort().map(f => {
    const x = JSON.parse(readFileSync(`${RUN}/${f}`, 'utf8'));
    return { block: f.replace(/\.json$/, ''), cluster: x.c, kind: x.t, text: x.text ?? '', traceSentences: x.trace?.marks?.sentences ?? null };
  });
}
