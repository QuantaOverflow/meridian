/**
 * 慢档阶段 A:从**原文**抽事件清单,作为覆盖率的基准。按簇缓存,跨臂共用。
 *
 * 为什么基准必须从原文抽、不能拿任何中间产物(情报报告、锚点、骨架)当基准:
 * 拿中间产物当基准只量得到「写作段丢了多少」,量不到「选材段丢了多少」,而且是循环论证
 * ——用被测系统自己的输出当答案。这一条是 block-writer/scratch/rubric.ts 的原始设计,照搬。
 *
 * 移植自那个文件的 buildEvents,两处改动:
 *   · 输入换成本 harness 的 fixture(全量簇,不是截断后的 30 篇)
 *   · 依赖全部抄进本目录,不 import prototypes(那些目录会丢)
 *
 * 唯一花钱的一步。产出按簇缓存在 fixtures/checklists/,已存在就跳过。
 *
 * 前置:本地 ai-worker 跑在 8787
 *   cd services/meridian-ai-worker && \
 *     nohup ../../apps/backend/node_modules/.bin/wrangler dev --port 8787 > /tmp/aiworker.log 2>&1 &
 *   必须用 apps/backend 的 wrangler 4.93(自带 3.x 不支持 remote binding)
 *
 * 用法:
 *   node build-checklist.mjs                 # 全部 7 簇(已缓存的跳过)
 *   node build-checklist.mjs --cluster=7      # 单簇,建议先拿最小的簇冒烟
 *   node build-checklist.mjs --force          # 无视缓存重抽
 *
 * 退出码: 0 成功;1 有簇的批次报废;2 环境问题(服务没起、模型缺失)
 */
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { loadExpectations, loadCluster, FIX } from './lib.mjs';
import { askJSON, pool, embed, mergeEvents, buildArticleMarkdown, chunk, setCallsPath, CONC, MODEL, MERGE_TH } from './slow-lib.mjs';
import { getEventsPrompt, eventsSchema } from './prompts.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = `${HERE}out`;
const CACHE = `${FIX}checklists`;
/** 一批几篇文章。8 是 rubric.ts 的取值,单批 prompt 约几万字符,在 MAX_TOKENS 内。 */
const EVENT_BATCH = Number(process.env.EVENT_BATCH ?? 8);
/** 每篇最多贡献几条事件。上限而非目标:实测 c2 是 93/62 ≈ 1.5,没到顶。 */
const EVENTS_PER_ARTICLE = Number(process.env.EVENTS_PER_ARTICLE ?? 2);

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)=?(.*)$/.exec(a);
  return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
}));

mkdirSync(CACHE, { recursive: true });
setCallsPath(`${OUT}/checklist-calls.jsonl`);

const EXP = loadExpectations();

/**
 * 分层。**核心层 = 支持篇数 ≥ ceil(该簇最大支持数 × coreTierOfMax),下限 2。**
 *
 * 口径只在这里定义一次(score-slow.mjs 读清单里写好的 coreMin,不自己算)。
 * 2026-09-16 定,取代两个都失效的口径:
 *   · 原 rubric 的绝对 ≥6 篇 —— 对 6 篇的簇算不出来、对 116 篇的簇形同虚设
 *   · 按簇篇数取比例 —— 簇越大文章越分散到更多事件,占比必然随规模下降
 *     (c51 116 篇里最热事件只有 14 篇 = 12%),于是大簇核心层恒为空,而
 *     score-slow 遇到空核心层会跳过覆盖那一条 → 覆盖门在四个主判例上消失
 *
 * maxSupport 一并落盘:门槛是从它推出来的,不记下来事后无法复核这个门为什么是这个数。
 */
function computeTiers(events) {
  const ratio = EXP.meta.coreTierOfMax ?? 0.5;
  const maxSupport = events.length ? Math.max(...events.map(e => e.nArticles)) : 0;
  const coreMin = Math.max(2, Math.ceil(maxSupport * ratio));
  return {
    coreMin,
    maxSupport,
    coreTierOfMax: ratio,
    core: events.filter(e => e.nArticles >= coreMin).length,
    mid: events.filter(e => e.nArticles >= 2 && e.nArticles < coreMin).length,
    tail: events.filter(e => e.nArticles < 2).length,
  };
}

let targets = Object.keys(EXP.clusters);
if (args.cluster) targets = targets.filter(c => c === String(args.cluster));
if (!targets.length) { console.error(`没有匹配的簇: ${args.cluster}`); process.exit(2); }

// ── --retier:只重算分层,不重抽事件(零 LLM)──────────────────────────────
// 改了核心层口径之后用它。事件本身不变,所以不该为此再花一次抽取的钱。
if (args.retier) {
  let n = 0;
  for (const cid of targets) {
    const f = `${CACHE}/c${cid}.json`;
    if (!existsSync(f)) { console.log(`c${cid} 无清单,跳过`); continue; }
    const x = JSON.parse(readFileSync(f, 'utf8'));
    const before = x.tiers;
    x.tiers = computeTiers(x.events);
    writeFileSync(f, `${JSON.stringify(x, null, 1)}\n`);
    console.log(
      `c${String(cid).padEnd(3)} ${String(x.name).padEnd(17)} max=${String(x.tiers.maxSupport).padStart(2)} ` +
      `coreMin ${before?.coreMin ?? '-'} → ${x.tiers.coreMin}  ` +
      `核心 ${before?.core ?? '-'} → ${x.tiers.core} / 次层 ${x.tiers.mid} / 尾层 ${x.tiers.tail}`
    );
    n++;
  }
  const empty = targets.filter(cid => {
    const f = `${CACHE}/c${cid}.json`;
    return existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).tiers.core === 0;
  });
  console.log(`\n重算 ${n} 份清单的分层(零 LLM)`);
  if (empty.length) { console.error(`⚠️ 仍有核心层为空的簇: ${empty.map(c => 'c' + c).join(',')} —— 覆盖门在这些簇上会被跳过`); process.exit(1); }
  console.log('✅ 全部簇核心层非空,覆盖门在每个簇上都生效');
  process.exit(0);
}

let anyFailed = false;

for (const cid of targets) {
  const cacheF = `${CACHE}/c${cid}.json`;
  if (existsSync(cacheF) && !args.force) {
    const c = JSON.parse(readFileSync(cacheF, 'utf8'));
    console.log(`c${cid} 缓存命中: ${c.events.length} 条事件(报废批 ${c.batchesFailed})`);
    continue;
  }

  const { articles } = loadCluster(cid);
  const batches = chunk(articles, EVENT_BATCH);
  const total = batches.reduce((n, b) => n + b.length, 0);
  if (total !== articles.length) { console.error(`卫生断言失败: 分批丢了文章 ${total} != ${articles.length}`); process.exit(2); }
  console.log(`\n=== c${cid} ${EXP.clusters[cid].name}: ${articles.length} 篇 → ${batches.length} 批 (model=${MODEL} conc=${CONC})`);

  const outs = await pool(batches, CONC, async (b, i) => {
    const md = buildArticleMarkdown(b.map(a => ({ id: a.id, title: a.title, url: a.url, publishDate: a.publishDate, content: a.content })));
    const maxItems = b.length * EVENTS_PER_ARTICLE;
    const p = await askJSON(`ev-c${cid}-b${i}`, getEventsPrompt(md, b.length, maxItems), eventsSchema(maxItems),
      x => Array.isArray(x.events), { kind: 'events', cluster: +cid, batch: i });
    if (!p) return null;

    // 卫生:articleIds 必须落在本批内。越界的剔掉并记数,全越界的整条丢弃——
    // 不静默留着,否则 nArticles 会虚高、覆盖分层跟着错。
    const ids = new Set(b.map(a => a.id));
    let idViol = 0;
    const rows = p.events.map(e => {
      const given = Array.isArray(e.articleIds) ? e.articleIds : [];
      const keep = given.filter(x => ids.has(x));
      if (keep.length !== given.length) idViol++;
      return { event: String(e.event ?? '').trim(), articleIds: keep };
    }).filter(e => e.event && e.articleIds.length);
    if (idViol) console.log(`    ⚠️ c${cid} b${i}: ${idViol} 条含越界 articleId`);
    return rows;
  });

  const batchesFailed = outs.filter(o => o === null).length;
  if (batchesFailed) { anyFailed = true; console.log(`  ⛔ c${cid}: ${batchesFailed}/${batches.length} 批报废`); }

  const flat = outs.filter(Boolean).flat();
  if (!flat.length) { console.error(`  ❌ c${cid}: 一条事件都没抽到,不写缓存`); continue; }

  // 跨批归并:同一事件在不同批里会被各自抽出来,措辞不同。用 embedding 余弦合并,
  // 带数字否决(死 38 人 vs 死 157 人不许合并)。
  const vec = embed(flat.map(f => f.event), `ev-c${cid}`, OUT);
  const { kept, mergedAway } = mergeEvents(flat, vec);

  const srcOf = new Map(articles.map(a => [a.id, a.sourceId]));
  const events = kept.map(f => {
    const uniq = [...new Set(f.articleIds)];
    return {
      event: f.event,
      articleIds: uniq,
      nArticles: uniq.length,
      nSources: new Set(uniq.map(id => srcOf.get(id))).size,
    };
  }).sort((a, b) => (b.nArticles - a.nArticles) || (b.nSources - a.nSources));

  const tiers = computeTiers(events);

  const res = {
    cluster: +cid,
    name: EXP.clusters[cid].name,
    articles: articles.length,
    model: MODEL,
    mergeThreshold: MERGE_TH,
    eventsPerArticle: EVENTS_PER_ARTICLE,
    rawEvents: flat.length,
    mergedAway,
    batchesFailed,
    tiers,
    events,
    caveat: '基准从原文独立抽,未经人工核。glm-flash 的抽取质量没有独立验过 —— 覆盖率的绝对值据此打折读,臂间相对比较不受影响(各臂共用同一份)。',
  };
  writeFileSync(cacheF, `${JSON.stringify(res, null, 1)}\n`);
  console.log(`  c${cid}: 原始 ${flat.length} 条 → 归并掉 ${mergedAway} → ${events.length} 条`);
  console.log(`  分层(最大支持 ${tiers.maxSupport} 篇 → 核心≥${tiers.coreMin} 篇): 核心 ${tiers.core} / 次层 ${tiers.mid} / 尾层 ${tiers.tail}`);
}

console.log(`\n调用记账: ${OUT}/checklist-calls.jsonl`);
if (anyFailed) { console.error('有批次报废 —— 清单不完整,覆盖率会虚高(分母缺了)'); process.exit(1); }
console.log('✅ 清单就绪');
