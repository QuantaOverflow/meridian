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
 *   node build-checklist.mjs --depurify       # 把杂质文章从已缓存清单里剔掉(零 LLM)
 *   node build-checklist.mjs --merge-audit    # 列出每簇最相似的几对事件供人工排查(零 LLM,不报总数)
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

// ── --merge-audit:列出每簇最相似的几对事件,**供人工排查**────────────────────
// 这不是指标,是线索。2026-09-19 实测:余弦**分不开**「同一事件的两种措辞」与「同一话题的两件事」——
// c36 的真重复(Oman 推迟会议的两种写法)cos 0.899,而 c51 的非重复
// (Amodei 说该放缓 ↔ Musk 表示支持)cos 0.900,分布完全重叠且假的排在真的前面。
// 所以**不报总数、不写进清单文件、不跨轮比较**:一个分不开类别的信号不该产出计数。
// 留着是因为它排序还有用 —— 肉眼在 c36 找到的三对真重复都落在 top-3 里
// (一个簇三个样本的观察,不是保证:别的簇的真重复可能排在更后面)。
//
// 背景债:归并阈值 MERGE_TH=0.90 偏高会让同一事件劈成两条、支持篇数被分走、双双掉出核心层。
// 调阈值修不了(见上),要换机制。见 decision-hold-checklist-tiering。
if (args.mergeAudit || args['merge-audit']) {
  const TOP = Number(process.env.MERGE_AUDIT_TOP ?? 3);
  for (const cid of targets) {
    const f = `${CACHE}/c${cid}.json`;
    if (!existsSync(f)) continue;
    const x = JSON.parse(readFileSync(f, 'utf8'));
    delete x.mergeAudit;   // 清掉早先那版写进去的计数,那是噪声
    writeFileSync(f, `${JSON.stringify(x, null, 1)}\n`);
    const texts = x.events.map(e => e.event);
    if (texts.length < 2) continue;
    const vec = embed(texts, `mergeaudit-c${cid}`, OUT);
    const pairs = [];
    for (let i = 0; i < texts.length; i++) {
      const vi = vec.get(texts[i]); if (!vi) continue;
      for (let j = i + 1; j < texts.length; j++) {
        const vj = vec.get(texts[j]); if (!vj) continue;
        const c = vi.reduce((s, v, k) => s + v * vj[k], 0);
        if (c < MERGE_TH) pairs.push({ a: i + 1, b: j + 1, cos: +c.toFixed(3) });
      }
    }
    pairs.sort((p, q) => q.cos - p.cos);
    const core = i => x.events[i - 1].nArticles >= x.tiers.coreMin ? '(核心)' : '';
    console.log(`\nc${cid} ${x.name} —— 最相似的 ${TOP} 对(余弦不能判定是否重复,仅供人工排查)`);
    for (const p of pairs.slice(0, TOP)) {
      console.log(`  ${p.cos}  #${p.a}${core(p.a)} ${x.events[p.a - 1].event.slice(0, 70)}`);
      console.log(`      ↔  #${p.b}${core(p.b)} ${x.events[p.b - 1].event.slice(0, 70)}`);
    }
  }
  console.log('\n这些是线索不是读数:不报总数、不跨轮比较、不进任何指标表。');
  process.exit(0);
}

// ── --depurify:把杂质文章从已缓存的清单里剔掉(零 LLM)────────────────────
// 为什么要剔:覆盖率的分母里混进了只有杂质文章报道的事件。c1 的 18 条事件里有 4 条(22%)
// 出处**全部**来自杂质文章(科索沃组阁 x2、韩国、CRA),于是**正确剔掉科索沃的臂反而被扣分**
// —— 次层覆盖 4/6 掉到 2/6。尺在奖励"把杂质写进去"。
//
// 为什么是后置过滤而不是重抽:重抽会同时换掉分批构成与事件措辞(c1 20 篇去 4 篇 → 3 批变 2 批),
// 前后读数不可比,而本轮要的恰恰是"同一批事件,去掉杂质前后"的对照。残余偏差是二阶的
// (同批里的杂质文章可能影响过某条事件的措辞),记为已知边界。
if (args.depurify) {
  let n = 0;
  for (const cid of targets) {
    const f = `${CACHE}/c${cid}.json`;
    if (!existsSync(f)) { console.log(`c${cid} 无清单,跳过`); continue; }
    const x = JSON.parse(readFileSync(f, 'utf8'));
    if (x.impurityFilter && !args.force) { console.log(`c${cid} 已去杂质(${x.impurityFilter.at}),跳过`); continue; }
    const imp = new Set(EXP.clusters[cid]?.impurities ?? []);
    const { articles } = loadCluster(cid);
    const srcOf = new Map(articles.map(a => [a.id, a.sourceId]));

    const dropped = [];
    let stripped = 0;
    const kept = [];
    for (const e of x.events) {
      const clean = e.articleIds.filter(id => !imp.has(id));
      if (!clean.length) { dropped.push(e.event); continue; }
      if (clean.length !== e.articleIds.length) stripped++;
      kept.push({
        event: e.event,
        articleIds: clean,
        nArticles: clean.length,
        nSources: new Set(clean.map(id => srcOf.get(id))).size,
      });
    }
    kept.sort((a, b) => (b.nArticles - a.nArticles) || (b.nSources - a.nSources));

    const before = x.tiers;
    x.rawEventsBeforeDepurify = x.events.length;
    x.events = kept;
    x.tiers = computeTiers(kept);
    x.impurityFilter = {
      at: new Date().toISOString().slice(0, 10),
      impurityArticles: imp.size,
      droppedEvents: dropped.length,
      eventsWithStrippedIds: stripped,
      droppedExamples: dropped.slice(0, 6),
      note: '后置过滤:整条出处都是杂质文章的事件删除,幸存事件里的杂质 articleId 剔除后重算 nArticles/nSources 与分层。事件措辞未重抽。',
    };
    writeFileSync(f, `${JSON.stringify(x, null, 1)}\n`);
    console.log(
      `c${String(cid).padEnd(3)} ${String(x.name).padEnd(17)} 事件 ${x.rawEventsBeforeDepurify} → ${kept.length}` +
      `(删 ${dropped.length} 条全杂质、${stripped} 条剔了部分出处)  coreMin ${before?.coreMin ?? '-'} → ${x.tiers.coreMin}  ` +
      `核心 ${before?.core ?? '-'} → ${x.tiers.core} / 次层 ${x.tiers.mid} / 尾层 ${x.tiers.tail}`
    );
    if (dropped.length) console.log(`     删掉的: ${dropped.slice(0, 3).map(d => d.slice(0, 50)).join(' | ')}`);
    n++;
  }
  // 机械可判的验收:跑完不许再有"出处全为杂质文章"的事件
  let bad = 0;
  for (const cid of targets) {
    const f = `${CACHE}/c${cid}.json`;
    if (!existsSync(f)) continue;
    const x = JSON.parse(readFileSync(f, 'utf8'));
    const imp = new Set(EXP.clusters[cid]?.impurities ?? []);
    const n2 = x.events.filter(e => e.articleIds.length && e.articleIds.every(id => imp.has(id))).length;
    if (n2) { console.error(`❌ c${cid} 仍有 ${n2} 条事件出处全为杂质文章`); bad += n2; }
  }
  console.log(`\n去杂质 ${n} 份清单(零 LLM)`);
  if (bad) process.exit(1);
  console.log('✅ 全部簇:出处全为杂质文章的事件数 = 0');
  process.exit(0);
}

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
