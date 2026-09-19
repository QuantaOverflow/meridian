/**
 * 按 dataset 清单重建正文。清单（成员 + 元数据 + 标注）入 git，正文不入 —— 这个脚本就是
 * 「不入库」那一半的重建方式，缺了它清单等于废纸。
 *
 * 走 /events 而不是逐篇 `wrangler r2 object get`：后者一次一个对象，818 篇要几十分钟;
 * /events 按天返回 `{id,title,url,publishDate,content,...}`，三天分页几次就取完。
 * 该路由挂在 app.ts 两道 auth 守卫（/admin/*、/observability/*）之外，无需 token。
 *
 * 产出：out/_data/<id>/content/<articleId>.txt（逐篇一个文件，dataset.mjs 直读）
 *
 * 用法：
 *   node fetch-dataset.mjs --dataset=prod-0919
 *   BACKEND=https://... node fetch-dataset.mjs --dataset=prod-0919   # 换后端（默认生产）
 *
 * 退出码：0 全部取到；1 有缺失（缺几篇、哪几篇会打出来）
 */
import { writeFileSync, existsSync, statSync } from 'node:fs';
import { loadDataset, datasetClusters, datasetArticleIds, ensureContentDir } from './dataset.mjs';

const arg = k => process.argv.slice(2).find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const id = arg('dataset');
if (!id) {
  console.error('用法: node fetch-dataset.mjs --dataset=<id>');
  process.exit(1);
}

const BACKEND = process.env.BACKEND ?? 'https://meridian-backend.swj299792458.workers.dev';
/** 单页条数。675 篇/天，取 500 是为了把单次响应压在几 MB 内——网络间歇时大响应更容易断。 */
const PAGE_SIZE = 500;

const ds = loadDataset(id);
const dir = ensureContentDir(ds);
const wanted = new Set(datasetArticleIds(ds));
const cids = datasetClusters(ds);
console.log(`dataset ${id}: ${cids.length} 簇 / ${wanted.size} 篇 · 天数 ${ds.days.join(',')}`);
console.log(`正文落 ${dir}`);

/** 传输层失败退避重试。*.workers.dev 在国内会被间歇 RST，单次失败不代表端点坏。 */
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

// 已落盘的不再取:断点续跑,被网络打断不用从头来
const have = new Set([...wanted].filter(x => existsSync(`${dir}${x}.txt`)));
let written = 0;
if (have.size < wanted.size) {
  for (const day of ds.days) {
    let page = 1, pages = 1;
    do {
      const url = `${BACKEND}/events?date=${day}&limit=${PAGE_SIZE}&pagination=true&page=${page}`;
      const res = await getJSON(url);
      pages = res.pagination?.pages ?? 1;
      const items = res.events ?? [];
      let hit = 0;
      for (const a of items) {
        if (!wanted.has(a.id) || have.has(a.id)) continue;
        hit++;
        writeFileSync(`${dir}${a.id}.txt`, String(a.content ?? ''));
        have.add(a.id);
        written++;
      }
      console.log(`${day} page ${page}/${pages}: ${items.length} 篇,新落盘 ${hit}`);
      page++;
    } while (page <= pages);
  }
} else {
  console.log('全部正文已在本地,不取数');
}

// ── 卫生断言:缺一篇都要报出来,不许静默少取 ────────────────────────────
const missing = [...wanted].filter(x => !existsSync(`${dir}${x}.txt`));
const empty = [...wanted].filter(x => existsSync(`${dir}${x}.txt`) && statSync(`${dir}${x}.txt`).size === 0);

console.log(`\n新落盘 ${written} 篇(已有 ${wanted.size - written - missing.length} 篇)`);
for (const cid of cids) {
  const ids = ds.clusters[String(cid)].articleIds;
  const got = ids.filter(x => existsSync(`${dir}${x}.txt`));
  const chars = got.reduce((s, x) => s + statSync(`${dir}${x}.txt`).size, 0);
  console.log(`  c${String(cid).padEnd(3)} ${String(got.length).padStart(3)}/${String(ids.length).padEnd(4)} 篇  ${(chars / 1000).toFixed(0)}k 字节`);
}
if (empty.length) console.warn(`\n⚠️ 正文为空 ${empty.length} 篇: ${empty.slice(0, 10).join(',')}`);
if (missing.length) {
  console.error(`\n❌ 缺 ${missing.length} 篇: ${missing.slice(0, 20).join(',')}`);
  process.exit(1);
}
console.log('\n✅ 全部取到');
