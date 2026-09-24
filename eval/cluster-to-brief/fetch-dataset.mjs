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
 * `--include-dropped` 连**丢弃池**一起取：按清单 `clusterSnapshot` 指的 R2 快照算出
 * 当天聚出来却没进 `selection` 的那批（噪声组 + 未选中的簇），取正文、补元数据，
 * 并把编号写进清单的 `dropped`（见 CONTRACTS.md §1）。漏报恰恰发生在这批里，
 * 不收录它们，这份 dataset 从定义上就算不出漏报率。
 *
 * 用法：
 *   node fetch-dataset.mjs --dataset=prod-0919
 *   BACKEND=https://... node fetch-dataset.mjs --dataset=prod-0919   # 换后端（默认生产）；打生产需 API_TOKEN=...
 *   node fetch-dataset.mjs --dataset=prod-0919 --include-dropped
 *   node fetch-dataset.mjs --dataset=prod-0919 --include-dropped --snapshot=<本地快照.json>
 *
 * 不传 --snapshot 时自己去 R2 拉一份并缓存到 out/_data/<id>/clustering-snapshot.json，
 * 拉取走 apps/backend 的 wrangler（`wrangler r2 object get ... --remote`）。
 *
 * 退出码：0 全部取到；1 有缺失（缺几篇、哪几篇会打出来）
 */
import { writeFileSync, readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  loadDataset,
  datasetClusters,
  datasetArticleIds,
  droppedArticleIds,
  ensureContentDir,
  recordDropped,
} from './dataset.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const argv = process.argv.slice(2);
const arg = k => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const flag = k => argv.includes(`--${k}`);
const id = arg('dataset');
const includeDropped = flag('include-dropped');
if (!id) {
  console.error('用法: node fetch-dataset.mjs --dataset=<id> [--include-dropped] [--snapshot=<path>]');
  process.exit(1);
}

const BACKEND = process.env.BACKEND ?? 'https://meridian-backend.swj299792458.workers.dev';
/** 单页条数。675 篇/天，取 500 是为了把单次响应压在几 MB 内——网络间歇时大响应更容易断。 */
const PAGE_SIZE = 500;

let ds = loadDataset(id);
const dir = ensureContentDir(ds);
const cids = datasetClusters(ds);

// ── 丢弃池：先从快照算出编号，落进清单，再跟收录的那批一起取正文 ────────
/** 快照来源：--snapshot > 本地缓存 > R2。缓存跟正文一样落 out/_data/<id>/，不入库。 */
function resolveSnapshot() {
  const given = arg('snapshot');
  if (given) return JSON.parse(readFileSync(given, 'utf8'));

  const key = ds.clusterSnapshot;
  if (typeof key !== 'string' || !key) {
    throw new Error(`清单缺 clusterSnapshot，无法定位聚类快照（或用 --snapshot=<path> 直接给一份）`);
  }
  const cache = `${dir.replace(/content\/$/, '')}clustering-snapshot.json`;
  if (!existsSync(cache)) {
    mkdirSync(cache.replace(/\/[^/]+$/, ''), { recursive: true });
    const backendDir = `${HERE}../../apps/backend`;
    console.log(`从 R2 拉聚类快照 ${key} → ${cache}`);
    execFileSync(
      './node_modules/.bin/wrangler',
      ['r2', 'object', 'get', `meridian-articles-prod/${key}`, `--file=${cache}`, '--remote'],
      { cwd: backendDir, stdio: 'inherit' }
    );
  }
  return JSON.parse(readFileSync(cache, 'utf8'));
}

/** 快照 → {noise, notSelected}。收录的簇整簇跳过；-1 是噪声组。 */
function splitSnapshot(snap) {
  if (!Array.isArray(snap?.clusters)) throw new Error('聚类快照里没有 clusters 数组');
  const noise = [];
  const notSelected = {};
  for (const c of snap.clusters) {
    const cid = Number(c.clusterId);
    const ids = (c.articleIds ?? []).map(Number);
    if (cid === -1) { noise.push(...ids); continue; }
    if (ds.clusters[String(cid)]) continue; // 收录了，不算丢
    if (ids.length) notSelected[String(cid)] = ids;
  }
  return { noise, notSelected };
}

// 写清单的顺序是「先取元数据、后写 dropped」：validateManifest 要求丢弃池里每篇都有元数据，
// 所以这一步只算出编号，recordDropped 放在取数之后。
let plan = null;
if (includeDropped) {
  plan = splitSnapshot(resolveSnapshot());
  const inClusters = Object.values(plan.notSelected).flat().length;
  console.log(
    `丢弃池 ${plan.noise.length + inClusters} 篇：` +
      `噪声 ${plan.noise.length} 篇 + 未选中 ${Object.keys(plan.notSelected).length} 簇 ${inClusters} 篇`
  );
}

// 清单里已经有丢弃池的话，不带开关也要把它的正文补齐 —— 否则标注的人拿到 818 篇正文、
// 丢弃池那 360 篇却是空的，标到一半才发现。开关只管「从快照算出并写入丢弃池」这一步。
const droppedIds = plan
  ? [...new Set([...plan.noise, ...Object.values(plan.notSelected).flat()])]
  : droppedArticleIds(ds);
const wanted = new Set([...datasetArticleIds(ds), ...droppedIds]);
// 丢弃池里还没有元数据的编号：取正文时顺手把元数据收下来，否则 recordDropped 会拒绝写入
const needMeta = new Set(includeDropped ? droppedIds.filter(x => !ds.articles[String(x)]) : []);
const meta = {};

console.log(`dataset ${id}: ${cids.length} 簇 / ${wanted.size} 篇 · 天数 ${ds.days.join(',')}`);
if (includeDropped) console.log(`  其中丢弃池 ${droppedIds.length} 篇，待补元数据 ${needMeta.size} 篇`);
console.log(`正文落 ${dir}`);

/** 传输层失败退避重试。*.workers.dev 在国内会被间歇 RST，单次失败不代表端点坏。 */
async function getJSON(url, tries = 4) {
  let last = '';
  for (let k = 0; k < tries; k++) {
    if (k) await new Promise(r => setTimeout(r, [3000, 8000, 15000][k - 1] ?? 15000));
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(120_000),
        // /events 已在挂载处加鉴权（与 eval/_shared/backend.ts 同一约定：API_TOKEN 未设则不带头，打生产会 401）
        headers: process.env.API_TOKEN ? { Authorization: `Bearer ${process.env.API_TOKEN}` } : {},
      });
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
// 正文齐了但元数据还缺,照样得扫一遍 /events —— 元数据只有那里有
if (have.size < wanted.size || needMeta.size) {
  for (const day of ds.days) {
    let page = 1, pages = 1;
    do {
      const url = `${BACKEND}/events?date=${day}&limit=${PAGE_SIZE}&pagination=true&page=${page}`;
      const res = await getJSON(url);
      pages = res.pagination?.pages ?? 1;
      const items = res.events ?? [];
      let hit = 0;
      for (const a of items) {
        if (needMeta.has(a.id)) {
          meta[String(a.id)] = {
            title: a.title ?? '',
            url: a.url ?? '',
            publishDate: a.publishDate ?? '',
            sourceId: a.sourceId ?? null,
          };
        }
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

// ── 丢弃池写回清单:只补不覆盖,既有标注一个字不动 ──────────────────────
if (plan) {
  const noMeta = [...needMeta].filter(x => !meta[String(x)]);
  if (noMeta.length) {
    console.error(`\n❌ 丢弃池有 ${noMeta.length} 篇在 /events 里取不到元数据,不写清单: ${noMeta.slice(0, 20).join(',')}`);
    process.exit(1);
  }
  const { added, dropped } = recordDropped(id, { ...plan, articles: meta });
  ds = loadDataset(id); // 重读:后面的统计以落盘结果为准
  console.log(
    `\n丢弃池已写入清单:噪声 ${dropped.noise.length} 篇 + 未选中 ${Object.keys(dropped.notSelected).length} 簇,` +
      `新增元数据 ${added} 篇`
  );
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
if (droppedIds.length) {
  const got = droppedIds.filter(x => existsSync(`${dir}${x}.txt`));
  console.log(`  丢弃池 ${got.length}/${droppedIds.length} 篇`);
}
if (empty.length) console.warn(`\n⚠️ 正文为空 ${empty.length} 篇: ${empty.slice(0, 10).join(',')}`);
if (missing.length) {
  console.error(`\n❌ 缺 ${missing.length} 篇: ${missing.slice(0, 20).join(',')}`);
  process.exit(1);
}
console.log('\n✅ 全部取到');
