/**
 * dataset 层：CONTRACTS.md §1 的实现，也是其它模块**唯一**该 import 的输入侧入口。
 *
 * 为什么另起一层而不继续用 lib.mjs 的 loadCluster：loadCluster 绑死在
 * 「一个工作目录 = 一套 fixtures/ + expectations.json」上，换一份数据要换 CTB_WORKSPACE，
 * 于是标注（判定用的 target）和期望（通过线）混在同一个文件里。这一轮的教训是
 * 判据不能带架构假设，通过线要能独立改；所以输入侧只保留「成员 + 标注 + 分层元数据」，
 * 通过线不在这里（见 CONTRACTS.md §4 的 policy.json）。
 *
 * 清单 `datasets/<id>.json` 入 git，正文不入：正文落
 * `out/_data/<id>/content/<articleId>.txt`，由 `fetch-dataset.mjs --dataset=<id>` 重建。
 *
 * 相对 CONTRACTS.md §1 示例多了一个顶层 `articles` 映射（{id: {title,url,publishDate,sourceId}}）：
 * §1 的 clusters[].articleIds 只有编号，而 loadClusterArticles 要返回标题与发表日，
 * 且 out/ 整个目录 gitignore —— 元数据只放在 out/ 里等于随时会丢，人工标注就没了依据。
 * 所以元数据跟清单一起入 git，正文才是可重建的那部分。
 *
 * 顶层 `dropped`（可选，2026-09-20 加）承载**被丢弃池**：当天聚类出来、但没进 `selection` 的文章。
 * 没有它这份 dataset 从定义上就算不出漏报率 —— 漏报恰恰发生在被丢的那批里，
 * 只标收录的部分，标多少遍都量不到。语义与来源见 CONTRACTS.md §1。
 *
 * 顶层 `split`（可选，2026-09-20 加）标这**整份**属于 dev / validation / test。
 * 对齐 Inspect 的口径：split 是「载入哪一份数据集」，不是样本的属性。
 * 簇级 `metadata.split` 是它之前的错误形状，已废弃（既有值保留不删）。
 *
 * 顶层 `targetOf`（可选，2026-09-22 加）标这份 dataset 是**考谁的**：`product` 考被测系统，
 * `judge` 考判官本身。同一个 `{input, target}` 形状，solver 槽里坐的是谁决定了读数的含义。
 * 加这个键是因为它分不出来的代价已经付过：一份判官金标的 claim 是旧架构写的句子，
 * 拿它跑出来的分数永远不代表当前产品，而这件事只能靠翻文件、数证据覆盖率才看得出来。
 * 缺失合法（老清单向后兼容），但缺失时谁也拦不住你把判官成绩当产品成绩报。
 *
 * 顶层 `labelBalance`（可选，2026-09-22 加）记 target 各取值的条数。
 * 依据是 Hamel Husain 对 LLM-as-judge 的警告：agreement / κ 是**陷阱指标**——
 * 样本不平衡时，判官把少数类全判错也能拿高一致率，而少数类恰恰是你在乎的失败。
 * 所以光记 κ 无法解释，必须能看出正负比例。应由产出这份 dataset 的脚本数出来写入，不靠人手填；
 * 这里只校验形状，不与 labels 对账——对账要遍历全部标注，属于产出侧的责任。
 *
 * 目录可换（测试用，也方便另置一份数据）：
 *   CTB_DATASET_DIR=<dir>   清单目录，默认 ./datasets/
 *   CTB_DATA_ROOT=<dir>     正文根目录，默认 <CTB_WORKSPACE>out/_data/
 * 环境变量在每次调用时读，不在 import 时定死 —— 否则测试没法先 import 再换目录。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { splitSentences, OUT_ROOT, loadCluster } from './lib.mjs';

const HERE = new URL('.', import.meta.url).pathname;

const slash = p => `${String(p).replace(/\/$/, '')}/`;

/** 清单目录。opts.dir > 环境变量 > 默认。 */
function datasetDir(opts = {}) {
  return slash(opts.dir ?? process.env.CTB_DATASET_DIR ?? `${HERE}datasets`);
}
/** 正文根目录。opts.dataRoot > 环境变量 > 默认。 */
function dataRoot(opts = {}) {
  return slash(opts.dataRoot ?? process.env.CTB_DATA_ROOT ?? `${OUT_ROOT}_data`);
}

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const isIntArray = x => Array.isArray(x) && x.every(v => Number.isInteger(v));

/**
 * 清单写回的缩进，必须与生成方（build-checklist.mjs / fetch-dataset.mjs 一律 `null, 1`）一致。
 * 不一致的代价不是难看：第一次记消耗就把整份清单重排版，`git diff` 炸成几千行，
 * 真正改了的那一行（consumed 追加）淹在里面，review 时看不出来。
 */
const INDENT = 1;

/** 顶层 split 的取值（Inspect 的口径：split 是「载入哪一份数据集」，整份一个值）。 */
const SPLITS = ['dev', 'validation', 'test'];

/** 顶层 targetOf 的取值：这份 dataset 考的是被测系统，还是判官本身。 */
const TARGET_OF = ['product', 'judge'];

// ── 清单校验 ────────────────────────────────────────────────────────────
/**
 * 清单不合法要**当场炸**并说清是哪一处：清单是判定的地基，
 * 一个 labels 指到簇外的编号（比如标注时抄错簇）不会让任何下游报错，只会让读数悄悄错。
 * 所以两个方向都断言：结构对、且 labels 里的文章必须真在该簇内。
 */
export function validateManifest(ds, expectedId, where = 'inline') {
  const fail = msg => { throw new Error(`dataset 清单不合法（${where}）：${msg}`); };

  if (!isObj(ds)) fail('顶层不是对象');
  if (typeof ds.id !== 'string' || !ds.id) fail('缺 id');
  if (expectedId !== undefined && ds.id !== expectedId) fail(`id 与文件名不一致：清单写 ${ds.id}，按 ${expectedId} 载入`);

  if (!isObj(ds.source) || typeof ds.source.workflowId !== 'string' || !ds.source.workflowId) {
    fail('缺 source.workflowId（没有它就无法回溯这份数据出自哪次运行）');
  }
  if (!Array.isArray(ds.days) || !ds.days.length) fail('缺 days');
  for (const d of ds.days) if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) fail(`days 里 ${d} 不是 YYYY-MM-DD`);
  if (typeof ds.selection !== 'string' || !ds.selection) fail('缺 selection');

  // 顶层 split（可选，2026-09-20 加）：整份 dataset 属于哪一层，缺失合法（老清单向后兼容）。
  // 存在就必须是三个值之一——拼错一个字母（"valid" / "Test"）不会让任何下游报错，
  // 只会让「这份是不是 holdout」这个问题永远答错。
  if (ds.split !== undefined && !SPLITS.includes(ds.split)) {
    fail(`split 只能是 ${SPLITS.join(' / ')}（缺这个键也合法），收到 ${JSON.stringify(ds.split)}`);
  }

  // 顶层 targetOf（可选，2026-09-22 加）：这份考产品还是考判官。同 split，拼错不会让任何
  // 下游报错，只会让「这个分数说的是什么」永远答错。
  if (ds.targetOf !== undefined && !TARGET_OF.includes(ds.targetOf)) {
    fail(`targetOf 只能是 ${TARGET_OF.join(' / ')}（缺这个键也合法），收到 ${JSON.stringify(ds.targetOf)}`);
  }

  // 顶层 labelBalance（可选，2026-09-22 加）：target 各取值的条数，用来解释 κ / agreement。
  // 只校验形状（对象、值是非负整数），不校验它与 labels 对不对得上（对账要遍历全部标注，
  // 这里不做）；这里拦的是手填出来的坏形状。
  if (ds.labelBalance !== undefined) {
    if (!isObj(ds.labelBalance)) fail('labelBalance 不是对象');
    for (const [k, v] of Object.entries(ds.labelBalance)) {
      if (!Number.isInteger(v) || v < 0) {
        fail(`labelBalance.${k} 要是非负整数，收到 ${JSON.stringify(v)}`);
      }
    }
  }

  if (!isObj(ds.articles)) fail('缺 articles 映射');
  if (!isObj(ds.clusters) || !Object.keys(ds.clusters).length) fail('clusters 为空');

  for (const [cid, c] of Object.entries(ds.clusters)) {
    const at = `cluster ${cid}`;
    if (!/^\d+$/.test(cid)) fail(`${at}：簇编号必须是整数字符串`);
    if (!isObj(c)) fail(`${at} 不是对象`);
    if (!isIntArray(c.articleIds) || !c.articleIds.length) fail(`${at}：articleIds 必须是非空整数数组`);
    if (new Set(c.articleIds).size !== c.articleIds.length) fail(`${at}：articleIds 有重复`);
    if (!isObj(c.metadata)) fail(`${at}：缺 metadata`);
    if (!isObj(c.labels)) fail(`${at}：缺 labels`);
    if (!isIntArray(c.labels.impurities)) fail(`${at}：labels.impurities 必须是整数数组（无标注写 []）`);
    if (!isObj(c.labels.eventGroups)) fail(`${at}：labels.eventGroups 必须是对象（无标注写 {}）`);

    const member = new Set(c.articleIds);
    for (const id of c.labels.impurities) {
      if (!member.has(id)) fail(`${at}：impurities 里的 ${id} 不在本簇成员内`);
    }
    for (const [name, ids] of Object.entries(c.labels.eventGroups)) {
      if (!isIntArray(ids) || !ids.length) fail(`${at}：eventGroups["${name}"] 必须是非空整数数组`);
      if (ids.length < 2) fail(`${at}：eventGroups["${name}"] 只有 1 篇（口径是只列 ≥2 篇的事件）`);
      for (const id of ids) if (!member.has(id)) fail(`${at}：eventGroups["${name}"] 里的 ${id} 不在本簇成员内`);
    }
    for (const id of c.articleIds) {
      if (!isObj(ds.articles[String(id)])) fail(`${at}：articles 里没有 ${id} 的元数据`);
    }
  }

  // 丢弃池（可选，老清单没有这个键照常合法）。两个方向都断言：
  // 被丢的编号不许跟收录的重叠，也不许没有元数据 —— 否则标注时取不到正文，等于标了个空号。
  if (ds.dropped !== undefined) {
    const d = ds.dropped;
    if (!isObj(d)) fail('dropped 必须是对象');
    if (!isIntArray(d.noise)) fail('dropped.noise 必须是整数数组（没有写 []）');
    if (!isObj(d.notSelected)) fail('dropped.notSelected 必须是对象（没有写 {}）');

    const selected = new Set(Object.values(ds.clusters).flatMap(c => c.articleIds));
    const seen = new Set();
    const take = (ids, at) => {
      for (const id of ids) {
        if (selected.has(id)) fail(`${at}：${id} 已在收录簇里（丢弃池与收录池必须互斥）`);
        if (seen.has(id)) fail(`${at}：${id} 在丢弃池里重复出现`);
        seen.add(id);
        if (!isObj(ds.articles[String(id)])) fail(`${at}：articles 里没有 ${id} 的元数据`);
      }
    };
    if (new Set(d.noise).size !== d.noise.length) fail('dropped.noise 有重复');
    take(d.noise, 'dropped.noise');
    for (const [cid, ids] of Object.entries(d.notSelected)) {
      const at = `dropped.notSelected["${cid}"]`;
      if (!/^\d+$/.test(cid)) fail(`${at}：簇编号必须是整数字符串（噪声组放 dropped.noise）`);
      if (ds.clusters[cid]) fail(`${at}：${cid} 同时出现在 clusters 里`);
      if (!isIntArray(ids) || !ids.length) fail(`${at}：必须是非空整数数组`);
      if (new Set(ids).size !== ids.length) fail(`${at}：有重复`);
      take(ids, at);
    }
  }

  if (!Array.isArray(ds.consumed)) fail('缺 consumed 数组（没消耗过写 []）');
  for (const [i, r] of ds.consumed.entries()) {
    if (!isObj(r) || typeof r.at !== 'string' || typeof r.by !== 'string') fail(`consumed[${i}] 缺 at 或 by`);
  }
  return ds;
}

// ── 载入 ────────────────────────────────────────────────────────────────
/** 清单路径与正文目录挂在 ds 上（不可枚举，免得被 JSON.stringify 一起写回清单）。 */
function attachPaths(ds, manifest, content) {
  Object.defineProperty(ds, '_paths', { value: { manifest, content }, enumerable: false });
  return ds;
}

export function loadDataset(id, opts = {}) {
  const manifest = `${datasetDir(opts)}${id}.json`;
  if (!existsSync(manifest)) throw new Error(`没有 dataset 清单 ${manifest}`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch (e) {
    throw new Error(`dataset 清单不是合法 JSON（${manifest}）：${e instanceof Error ? e.message : String(e)}`);
  }
  validateManifest(raw, id, manifest);
  return attachPaths(raw, manifest, `${dataRoot(opts)}${id}/content/`);
}

/**
 * 簇编号列表（整数、升序）。
 *
 * 簇级 `metadata.split` 已废弃（2026-09-20）：分层是整份 dataset 的属性（顶层 `split`）。
 * 按它过滤的 `{split}` 参数没有调用方，2026-09-25 删除。
 */
export function datasetClusters(ds) {
  return Object.keys(ds.clusters)
    .map(cid => Number(cid))
    .sort((a, b) => a - b);
}

function clusterOf(ds, clusterId) {
  const c = ds.clusters[String(clusterId)];
  if (!c) throw new Error(`dataset ${ds.id} 里没有 cluster ${clusterId}`);
  return c;
}

/**
 * 一个簇的全量输入。`sentences` 下标 +1 = 输出契约里的 `sources[].sentence`，
 * 切句直接用 lib.mjs 的 splitSentences（与生产 report-v3.ts 同构）——**不许在这里另写一份**，
 * 偏一点就让出处静默指向错误的句子。
 */
export function loadClusterArticles(ds, clusterId) {
  return loadArticlesByIds(ds, clusterOf(ds, clusterId).articleIds, `cluster ${clusterId}`);
}

/**
 * 按编号载入若干篇（丢弃池里的文章也走这条，它们不属于任何收录簇）。
 * `where` 只进报错信息，说清缺的正文是哪一批的。
 */
export function loadArticlesByIds(ds, ids, where = 'articles') {
  const dir = ds._paths.content;
  const articles = [];
  const missing = [];
  for (const id of ids) {
    const p = `${dir}${id}.txt`;
    if (!existsSync(p)) { missing.push(id); continue; }
    const content = readFileSync(p, 'utf8');
    const m = ds.articles[String(id)] ?? {};
    articles.push({
      id,
      title: m.title ?? '',
      publishDate: m.publishDate ?? '',
      sourceId: m.sourceId ?? null,
      content,
      sentences: splitSentences(content),
    });
  }
  if (missing.length) {
    throw new Error(
      `dataset ${ds.id} 的 ${where} 缺 ${missing.length} 篇正文` +
        `（先跑 node fetch-dataset.mjs --dataset=${ds.id}）：${missing.slice(0, 10).join(',')}`
    );
  }
  // 时间升序：下游任何按时间的叙述都依赖这个顺序
  articles.sort((a, b) => (a.publishDate < b.publishDate ? -1 : a.publishDate > b.publishDate ? 1 : a.id - b.id));
  return articles;
}

/**
 * 臂（`arms/*`）的统一簇载入入口：`ds` 是 loadDataset 的返回就走 dataset 层，
 * 传 null/undefined 就回退到 lib.mjs 的 `loadCluster`（老的 fixtures/ 路径）。
 *
 * 放在这里而不是某个臂里：`--dataset` 要接的不止一个臂，抹平逻辑长在哪个臂里，
 * 下一个臂就得再抄一份，两份迟早对不齐。lib.mjs 不能放（它被本文件 import，反过来就成循环）。
 *
 * 两条路返回的形状必须**逐字一致**：
 *   `{ clusterId, articles: [{ id, title, url, publishDate, sourceId, content, sentences }] }`
 * 下游 `sentenceOf` / 窗口切分 / 出处核对全靠 `sentences` 的编号，形状分叉不会报错、只会让读数悄悄错。
 * 唯一要补的是 `url`：loadClusterArticles 不回它（它在清单的 articles 映射里）。
 */
export function loadClusterFrom(ds, clusterId) {
  if (!ds) return loadCluster(clusterId);
  const articles = loadClusterArticles(ds, clusterId).map(a => ({
    id: a.id,
    title: a.title,
    url: ds.articles[String(a.id)]?.url ?? '',
    publishDate: a.publishDate,
    sourceId: a.sourceId,
    content: a.content,
    sentences: a.sentences,
  }));
  return { clusterId: Number(clusterId), articles };
}

/** 判定用的 target。返回副本，免得调用方改了标注还自以为读的是清单。 */
export function labelsOf(ds, clusterId) {
  const { labels } = clusterOf(ds, clusterId);
  return { impurities: [...labels.impurities], eventGroups: { ...labels.eventGroups } };
}

// ── sample 视图 ─────────────────────────────────────────────────────────
/**
 * 把一份 dataset 切成若干 sample。
 *
 * **sample 是视图，不是数据本身**：同一份 dataset 里「一个簇」和「一天的全部文章」都可以是
 * 一个 sample，取决于要判什么。所以切分不落盘、不进清单，按需实例化——
 * 清单里只有成员与标注，换一种判法换一个视图，数据一个字不用改。
 *
 * 与 `datasetClusters` 的关系：`datasetClusters` 只回簇编号，调用方还得自己再去取标注与元数据，
 * 于是「一个 sample 是什么」散在每个臂里各写一遍。`sampleView` 是它的上层，把
 * 编号 + input + target + metadata 一次给全。**后续新臂走 `sampleView`**；
 * `datasetClusters` 留给已有调用方，不动。
 *
 * `input` 只给 articleIds，**不在这里读正文**：视图只管切分，正文由 `loadClusterArticles` /
 * `loadClusterFrom` 按需读。把 665 篇正文塞进视图，只为拿一个簇编号列表也要全读一遍。
 *
 * @param {object} ds       loadDataset 的返回
 * @param {object} [o]
 * @param {'cluster'|'day'} [o.view='cluster']  切分粒度
 * @param {{clusters?: number[]}} [o.scope]  范围；不传 = 全部
 * @returns {Array<{id: string, input: object, target: object, metadata: object}>}
 */
export function sampleView(ds, { view = 'cluster', scope } = {}) {
  if (view === 'day') {
    throw new Error(
      'sampleView: view="day" 还没实现（留桩）。整天一个 sample，它的 target 是**当天的全局事件清单**，' +
        '而这份清单怎么造还没验过精度——照现在的造法做出来的 target 本身就不可信，' +
        '拿它判出来的读数只会把错误算成系统的。见 ADR 0003 已证伪清单第 6 条。'
    );
  }
  if (view !== 'cluster') throw new Error(`sampleView: 不认识的 view "${view}"（现有 cluster，day 留桩）`);

  const ids = scope?.clusters ? scope.clusters.map(Number) : datasetClusters(ds);
  return ids.map(cid => {
    const c = clusterOf(ds, cid); // 点名了不存在的簇就当场炸：抄错簇号不该静默少一个样本
    return {
      id: `c${cid}`,
      input: { clusterId: Number(cid), articleIds: [...c.articleIds] },
      target: labelsOf(ds, cid),
      metadata: { ...c.metadata },
    };
  });
}

/**
 * 记一次消耗。**只增不改**：从磁盘重读清单、把新记录接在原 consumed 后面，
 * 其余键原样写回。用过的 dataset 对该臂就不再是未见过的数据，这条历史一改就没法核了。
 */
export function recordConsumption(id, { by, note = '', at, ...opts } = {}) {
  if (typeof by !== 'string' || !by) throw new Error('recordConsumption 必须写明 by（谁用了这份数据）');
  const manifest = `${datasetDir(opts)}${id}.json`;
  const ds = JSON.parse(readFileSync(manifest, 'utf8'));
  const history = Array.isArray(ds.consumed) ? ds.consumed : [];
  ds.consumed = [...history, { at: at ?? new Date().toISOString().slice(0, 10), by, note }];
  writeFileSync(manifest, `${JSON.stringify(ds, null, INDENT)}\n`);
  return ds.consumed;
}

/**
 * 写入丢弃池。**只补不覆盖**：从磁盘重读清单，只写 `dropped`，
 * `articles` 里只补清单还没有的编号 —— 已在库的元数据（人工标注挂在它上面）一个字都不碰。
 * 写回前跑一遍 validateManifest，坏清单绝不落盘。
 *
 *   noise        聚类噪声组（clusterId = -1）的文章编号
 *   notSelected  { "<clusterId>": [articleId...] }，成簇但没进 selection 的簇
 *   articles     这批文章的元数据 { "<articleId>": {title,url,publishDate,sourceId} }
 */
export function recordDropped(id, { noise = [], notSelected = {}, articles = {}, ...opts } = {}) {
  const manifest = `${datasetDir(opts)}${id}.json`;
  const ds = JSON.parse(readFileSync(manifest, 'utf8'));

  ds.articles = ds.articles ?? {};
  let added = 0;
  for (const [aid, meta] of Object.entries(articles)) {
    if (ds.articles[aid]) continue; // 已有的不动
    ds.articles[aid] = meta;
    added++;
  }
  ds.dropped = {
    noise: [...noise].sort((a, b) => a - b),
    notSelected: Object.fromEntries(
      Object.entries(notSelected)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([cid, ids]) => [cid, [...ids].sort((a, b) => a - b)])
    ),
  };

  validateManifest(ds, id, manifest);
  writeFileSync(manifest, `${JSON.stringify(ds, null, INDENT)}\n`);
  return { added, dropped: ds.dropped };
}

/** 丢弃池里的全部文章编号（噪声 + 未选中的簇，去重后）。没有 dropped 就是空数组。 */
export function droppedArticleIds(ds) {
  const d = ds.dropped;
  if (!d) return [];
  return [...new Set([...d.noise, ...Object.values(d.notSelected).flat()])];
}

/** fetch-dataset.mjs 用：正文该落哪。其它模块不需要知道这个路径。 */
export function contentDirOf(ds) {
  return ds._paths.content;
}

/** fetch-dataset.mjs 用：确保正文目录存在。 */
export function ensureContentDir(ds) {
  const dir = contentDirOf(ds);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 清单里全部文章编号（跨簇去重后）。`includeDropped` 时把丢弃池也算上。 */
export function datasetArticleIds(ds, { includeDropped = false } = {}) {
  const selected = Object.values(ds.clusters).flatMap(c => c.articleIds);
  return [...new Set(includeDropped ? [...selected, ...droppedArticleIds(ds)] : selected)];
}
