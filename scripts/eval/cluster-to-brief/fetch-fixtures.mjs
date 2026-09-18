/**
 * 取 fixture 簇的全量文章正文,落盘成原型与 verifier 都能直读的形状。
 *
 * 为什么不用 `brief_stories.article_ids`:那是 `pickSpreadArticles` 等距取样到 30 篇之后的结果
 * (`china` 因此丢了 86/116 篇 = 74%)。这里用的是 R2 里冻结的聚类结果
 * `fixtures/clusters-<workflowId>.json`,即聚类真实交给下游的全量成员。
 *
 * 为什么走 /events 而不是逐篇 `wrangler r2 object get`:后者一次一个对象,296 篇要十几分钟;
 * /events 按天返回 `{id,title,url,publishDate,content,...}`,三天分页几次就取完。
 * 该路由挂在 app.ts 里两道 auth 守卫(/admin/*、/observability/*)之外,无需 token。
 *
 * 产出:
 *   fixtures/content/<id>.txt       文章正文,逐篇一个文件(rubric 的 contentOf() 同构)
 *   fixtures/meta.json              { [id]: {title,url,publishDate,sourceId,cluster} }
 *   fixtures/clusters.json          { [clusterId]: number[] }  只含本 fixture 的 7 个簇
 *
 * 用法:
 *   node fetch-fixtures.mjs
 *   BACKEND=https://... node fetch-fixtures.mjs     # 换后端(默认生产)
 *
 * 退出码:0 全部取到;1 有缺失(缺几篇、哪几篇会打出来)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const FIX = `${HERE}fixtures/`;
const SNAPSHOT = `${FIX}clusters-1789477249362.json`;
const BACKEND = process.env.BACKEND ?? 'https://meridian-backend.swj299792458.workers.dev';
/** 本 fixture 的 7 个簇。选取理由与每簇期望行为见 FIXTURES.md,别在这里改名单。 */
const CLUSTERS = [7, 1, 28, 36, 37, 43, 51];
/** 文章发表日覆盖的窗口。TIME_RANGE_DAYS=2 决定了一期只跨 2-3 天。 */
const DAYS = ['2026-09-13', '2026-09-14', '2026-09-15'];
/** 单页条数。675 篇/天,取 500 是为了把单次响应压在几 MB 内——网络间歇时大响应更容易断。 */
const PAGE_SIZE = 500;

mkdirSync(`${FIX}content`, { recursive: true });

// ── 需要哪些文章 ────────────────────────────────────────────────────────
const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const clusters = {};
const idToCluster = new Map();
for (const cid of CLUSTERS) {
  const c = snap.clusters.find(x => x.clusterId === cid);
  if (!c) throw new Error(`聚类快照里没有 cluster ${cid}`);
  clusters[cid] = c.articleIds;
  for (const id of c.articleIds) idToCluster.set(id, cid);
}
const wanted = new Set(idToCluster.keys());
console.log(`需要 ${wanted.size} 篇(${CLUSTERS.map(c => `c${c}:${clusters[c].length}`).join(' ')})`);

// ── 取数 ────────────────────────────────────────────────────────────────
/** 传输层失败退避重试。*.workers.dev 在国内会被间歇 RST,单次失败不代表端点坏。 */
async function getJSON(url, tries = 4) {
  let last = '';
  for (let k = 0; k < tries; k++) {
    if (k) await new Promise(r => setTimeout(r, [3000, 8000, 15000][k - 1] ?? 15000));
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!r.ok) { last = `HTTP ${r.status}`; continue; }
      return await r.json();
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      console.warn(`  重试(${k + 1}/${tries}): ${last}`);
    }
  }
  throw new Error(`取数失败 ${url} — ${last}`);
}

const meta = {};
let written = 0, skipped = 0;
for (const day of DAYS) {
  let page = 1, pages = 1;
  do {
    const url = `${BACKEND}/events?date=${day}&limit=${PAGE_SIZE}&pagination=true&page=${page}`;
    const res = await getJSON(url);
    pages = res.pagination?.pages ?? 1;
    const items = res.events ?? [];
    let hitThisPage = 0;
    for (const a of items) {
      if (!wanted.has(a.id)) continue;
      hitThisPage++;
      // 已落盘的跳过:断点续跑,被网络打断不用从头来
      const f = `${FIX}content/${a.id}.txt`;
      if (existsSync(f)) skipped++;
      else { writeFileSync(f, String(a.content ?? '')); written++; }
      meta[a.id] = {
        title: a.title ?? '',
        url: a.url ?? '',
        publishDate: a.publishDate ?? '',
        sourceId: a.sourceId ?? null,
        cluster: idToCluster.get(a.id),
        chars: String(a.content ?? '').length,
      };
    }
    console.log(`${day} page ${page}/${pages}: ${items.length} 篇,命中 ${hitThisPage}`);
    page++;
  } while (page <= pages);
}

// ── 卫生断言:缺一篇都要报出来,不许静默少取 ────────────────────────────
const missing = [...wanted].filter(id => !(id in meta));
const empty = Object.entries(meta).filter(([, m]) => m.chars === 0).map(([id]) => +id);

writeFileSync(`${FIX}meta.json`, `${JSON.stringify(meta, null, 1)}\n`);
writeFileSync(`${FIX}clusters.json`, `${JSON.stringify(clusters, null, 1)}\n`);

console.log(`\n落盘 ${written} 篇(跳过已有 ${skipped})· meta ${Object.keys(meta).length} 条`);
for (const cid of CLUSTERS) {
  const got = clusters[cid].filter(id => id in meta).length;
  const chars = clusters[cid].reduce((s, id) => s + (meta[id]?.chars ?? 0), 0);
  console.log(`  c${String(cid).padEnd(3)} ${String(got).padStart(3)}/${String(clusters[cid].length).padEnd(4)} 篇  ${(chars / 1000).toFixed(0)}k 字符`);
}
if (empty.length) console.warn(`\n⚠️ 正文为空 ${empty.length} 篇: ${empty.slice(0, 10).join(',')}`);
if (missing.length) {
  console.error(`\n❌ 缺 ${missing.length} 篇: ${missing.slice(0, 20).join(',')}`);
  process.exit(1);
}
console.log('\n✅ 全部取到');
