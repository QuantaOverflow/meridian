/**
 * dataset 层的测试。全用**合成数据**跑在临时目录里:不联网、不依赖 out/_data 存在,
 * 所以换机器、清过产物、没跑过 fetch 都照样能跑。
 *
 * 跑法: node dataset.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const TMP = mkdtempSync(`${tmpdir()}/ctb-dataset-`);
const DS_DIR = `${TMP}/datasets/`;
const DATA_ROOT = `${TMP}/data/`;
mkdirSync(DS_DIR, { recursive: true });
// 环境变量要在 import dataset.mjs 之前设:目录是每次调用才读的,但先设更贴近真实用法
process.env.CTB_DATASET_DIR = DS_DIR;
process.env.CTB_DATA_ROOT = DATA_ROOT;

const {
  loadDataset,
  datasetClusters,
  loadClusterArticles,
  loadArticlesByIds,
  labelsOf,
  recordConsumption,
  recordDropped,
  droppedArticleIds,
  datasetArticleIds,
  sampleView,
} = await import('./dataset.mjs');

const write = (id, obj) => writeFileSync(`${DS_DIR}${id}.json`, `${JSON.stringify(obj, null, 2)}\n`);
const good = () => ({
  id: 'synth',
  source: { workflowId: 'cron-brief-1', reportId: 1, runDate: '2026-01-02' },
  days: ['2026-01-01', '2026-01-02'],
  clusterSnapshot: 'observability/clustering/cron-brief-1.json',
  selection: 'selected_for_intel',
  clusters: {
    10: {
      articleIds: [101, 102, 103],
      metadata: { articles: 3, split: 'dev', routerStructure: 'topic_bag' },
      labels: { impurities: [103], eventGroups: { 'Two boats collided': [101, 102] } },
    },
    11: {
      articleIds: [201],
      metadata: { articles: 1, split: 'heldout', routerStructure: 'single_story' },
      labels: { impurities: [], eventGroups: {} },
    },
  },
  articles: {
    101: { title: 'A', url: 'http://a', publishDate: '2026-01-02T00:00:00.000Z', sourceId: 1 },
    102: { title: 'B', url: 'http://b', publishDate: '2026-01-01T00:00:00.000Z', sourceId: 2 },
    103: { title: 'C', url: 'http://c', publishDate: '2026-01-01T06:00:00.000Z', sourceId: 3 },
    201: { title: 'D', url: 'http://d', publishDate: '2026-01-01T00:00:00.000Z', sourceId: 4 },
  },
  consumed: [{ at: '2026-01-03', by: 'first-arm', note: '首轮' }],
});

// ── 清单校验:坏清单必须当场炸,且说清是哪一处 ──────────────────────────
function rejects(mutate, re) {
  const ds = good();
  ds.id = 'bad'; // 文件名叫 bad,id 要跟着改,否则先撞上「id 与文件名不一致」那条
  mutate(ds);
  write('bad', ds);
  assert.throws(() => loadDataset('bad'), re, `这份清单本该被拒: ${re}`);
}
rejects(ds => { delete ds.source.workflowId; }, /source\.workflowId/);
rejects(ds => { ds.days = ['2026-1-1']; }, /不是 YYYY-MM-DD/);
rejects(ds => { ds.clusters = {}; }, /clusters 为空/);
rejects(ds => { ds.clusters['10'].articleIds = []; }, /articleIds 必须是非空整数数组/);
rejects(ds => { delete ds.clusters['10'].labels; }, /缺 labels/);
rejects(ds => { ds.clusters['10'].labels.impurities = null; }, /impurities 必须是整数数组/);
// 标注指到簇外:没有任何下游会报错,只会让读数悄悄错,所以必须在这里拦
rejects(ds => { ds.clusters['10'].labels.impurities = [999]; }, /不在本簇成员内/);
rejects(ds => { ds.clusters['10'].labels.eventGroups.x = [101, 999]; }, /不在本簇成员内/);
rejects(ds => { ds.clusters['10'].labels.eventGroups.x = [101]; }, /只有 1 篇/);
rejects(ds => { delete ds.articles['102']; }, /articles 里没有 102 的元数据/);
rejects(ds => { delete ds.consumed; }, /缺 consumed/);
// 丢弃池:两个方向都要断言,否则标注挂在一个取不到正文的空编号上也没人报错
rejects(ds => { ds.dropped = { noise: [], notSelected: {} }, ds.dropped.noise = null; }, /noise 必须是整数数组/);
rejects(ds => { ds.dropped = { noise: [], notSelected: null }; }, /notSelected 必须是对象/);
rejects(ds => {
  ds.dropped = { noise: [301], notSelected: {} }; // 301 没有元数据
}, /dropped\.noise：articles 里没有 301 的元数据/);
rejects(ds => {
  ds.articles['301'] = { title: 'E', url: 'http://e', publishDate: '2026-01-01T00:00:00.000Z', sourceId: 5 };
  ds.dropped = { noise: [301], notSelected: { 12: [301] } };
}, /在丢弃池里重复出现/);
rejects(ds => { ds.dropped = { noise: [101], notSelected: {} }; }, /已在收录簇里/);
rejects(ds => {
  ds.articles['301'] = { title: 'E', url: 'http://e', publishDate: '2026-01-01T00:00:00.000Z', sourceId: 5 };
  ds.dropped = { noise: [], notSelected: { 10: [301] } };
}, /同时出现在 clusters 里/);
rejects(ds => { ds.dropped = { noise: [], notSelected: { '-1': [301] } }; }, /簇编号必须是整数字符串/);
// 顶层 split 拼错一个字母不会让任何下游报错,只会让「这份是不是 holdout」永远答错
rejects(ds => { ds.split = 'bogus'; }, /split 只能是/);
rejects(ds => { ds.split = 'Test'; }, /split 只能是/);
rejects(ds => { ds.split = null; }, /split 只能是/);
// 顶层 targetOf 同理:拼错不报错,只会让「这个分数说的是产品还是判官」永远答错
rejects(ds => { ds.targetOf = 'scorer'; }, /targetOf 只能是/);
rejects(ds => { ds.targetOf = 'Judge'; }, /targetOf 只能是/);
rejects(ds => { ds.targetOf = null; }, /targetOf 只能是/);
// labelBalance 只校验形状:坏形状当场拒,不是等到算 κ 时才发现分母是字符串
rejects(ds => { ds.labelBalance = []; }, /labelBalance 不是对象/);
rejects(ds => { ds.labelBalance = { supported: '78' }; }, /labelBalance\.supported 要是非负整数/);
rejects(ds => { ds.labelBalance = { supported: -1 }; }, /labelBalance\.supported 要是非负整数/);
rejects(ds => { ds.labelBalance = { supported: 1.5 }; }, /labelBalance\.supported 要是非负整数/);
// id 与文件名不一致 = 悄悄用错数据集
rejects(ds => { ds.id = 'other'; }, /id 与文件名不一致/);
writeFileSync(`${DS_DIR}broken.json`, '{not json');
assert.throws(() => loadDataset('broken'), /不是合法 JSON/);

// ── 正常载入 ────────────────────────────────────────────────────────────
write('synth', good());
const ds = loadDataset('synth');
assert.deepEqual(datasetClusters(ds), [10, 11]);
assert.deepEqual(datasetClusters(ds, { split: 'dev' }), [10]);
assert.deepEqual(datasetClusters(ds, { split: 'heldout' }), [11]);
// 顶层 split 两个方向:缺键合法(good() 就没写),写对了照常载入
assert.equal(ds.split, undefined, '缺 split 的清单照常合法');
const withSplit = good();
withSplit.id = 'synth-split';
withSplit.split = 'validation';
write('synth-split', withSplit);
assert.equal(loadDataset('synth-split').split, 'validation');
// targetOf / labelBalance 同样两个方向:缺键合法,写对了照常载入
assert.equal(ds.targetOf, undefined, '缺 targetOf 的清单照常合法');
assert.equal(ds.labelBalance, undefined, '缺 labelBalance 的清单照常合法');
const withTarget = good();
withTarget.id = 'synth-target';
withTarget.targetOf = 'judge';
withTarget.labelBalance = { supported: 78, unsupported: 22 };
write('synth-target', withTarget);
const loadedTarget = loadDataset('synth-target');
assert.equal(loadedTarget.targetOf, 'judge');
assert.deepEqual(loadedTarget.labelBalance, { supported: 78, unsupported: 22 });

// ── 缺正文:报错必须点名重建命令,否则调用方不知道下一步做什么 ──────────
assert.throws(() => loadClusterArticles(ds, 10), /fetch-dataset\.mjs --dataset=synth/);
assert.throws(() => loadClusterArticles(ds, 10), /缺 3 篇正文/);

// ── 切句与排序 ──────────────────────────────────────────────────────────
mkdirSync(`${DATA_ROOT}synth/content`, { recursive: true });
writeFileSync(`${DATA_ROOT}synth/content/101.txt`, 'Alpha ruled out a deal. Beta denied it.');
writeFileSync(`${DATA_ROOT}synth/content/102.txt`, 'Two boats collided near the port.');
writeFileSync(`${DATA_ROOT}synth/content/103.txt`, 'Unrelated filler.');
const arts = loadClusterArticles(ds, 10);
assert.deepEqual(arts.map(a => a.id), [102, 103, 101], '必须按 publishDate 升序');
assert.deepEqual(Object.keys(arts[0]).sort(), ['content', 'id', 'publishDate', 'sentences', 'sourceId', 'title']);
const a101 = arts.find(a => a.id === 101);
assert.deepEqual(a101.sentences, ['Alpha ruled out a deal.', 'Beta denied it.'], '切句要走 lib.mjs 的 splitSentences');
assert.equal(a101.title, 'A');
assert.equal(a101.sourceId, 1);
// sentences 下标 +1 = 输出契约的 sources[].sentence
assert.equal(a101.sentences[2 - 1], 'Beta denied it.');
assert.throws(() => loadClusterArticles(ds, 999), /没有 cluster 999/);

// ── 标注读取 ────────────────────────────────────────────────────────────
const labels = labelsOf(ds, 10);
assert.deepEqual(labels.impurities, [103]);
assert.deepEqual(labels.eventGroups, { 'Two boats collided': [101, 102] });
assert.deepEqual(labelsOf(ds, 11), { impurities: [], eventGroups: {} });
// 返回副本:调用方改了不该影响清单
labels.impurities.push(999);
assert.deepEqual(labelsOf(ds, 10).impurities, [103], 'labelsOf 必须返回副本');

// ── sample 视图 ────────────────────────────────────────────────────────
const samples = sampleView(ds);
assert.deepEqual(samples.map(s => s.id), ['c10', 'c11'], '默认 cluster 粒度,每簇一个 sample');
assert.deepEqual(samples[0].input, { clusterId: 10, articleIds: [101, 102, 103] });
assert.deepEqual(samples[0].target, { impurities: [103], eventGroups: { 'Two boats collided': [101, 102] } });
assert.equal(samples[0].metadata.routerStructure, 'topic_bag');
assert.equal('content' in samples[0].input, false, 'input 只给编号,正文按需读');
// scope:显式列表与 limit
assert.deepEqual(sampleView(ds, { scope: { clusters: [11] } }).map(s => s.id), ['c11']);
assert.deepEqual(sampleView(ds, { scope: { clusters: [11] } })[0].input.articleIds, [201]);
assert.deepEqual(sampleView(ds, { scope: { limit: 1 } }).map(s => s.id), ['c10']);
assert.deepEqual(sampleView(ds, { scope: { limit: 0 } }), []);
// 抄错簇号不该静默少一个样本
assert.throws(() => sampleView(ds, { scope: { clusters: [999] } }), /没有 cluster 999/);
// target 是副本:调用方改了不该回写清单
sampleView(ds)[0].target.impurities.push(999);
assert.deepEqual(labelsOf(ds, 10).impurities, [103], 'sampleView 的 target 必须是副本');
// day 粒度留桩:它的 target(全局事件清单)造法还没验过精度
assert.throws(() => sampleView(ds, { view: 'day' }), /还没实现/);
assert.throws(() => sampleView(ds, { view: 'day' }), /ADR 0003/);
assert.throws(() => sampleView(ds, { view: 'week' }), /不认识的 view/);

// ── 消耗记录:只增不改 ──────────────────────────────────────────────────
recordConsumption('synth', { by: 'arm-a', note: '快档', at: '2026-01-04' });
recordConsumption('synth', { by: 'arm-b', at: '2026-01-05' });
const after = JSON.parse(readFileSync(`${DS_DIR}synth.json`, 'utf8'));
assert.deepEqual(after.consumed.map(r => r.by), ['first-arm', 'arm-a', 'arm-b'], '历史必须原样留在最前');
assert.deepEqual(after.consumed[0], { at: '2026-01-03', by: 'first-arm', note: '首轮' }, '历史记录不许被改写');
assert.equal(after.consumed[2].note, '');
// 其余键一字不改
const base = good();
for (const k of ['id', 'source', 'days', 'clusterSnapshot', 'selection', 'clusters', 'articles']) {
  assert.deepEqual(after[k], base[k], `recordConsumption 不该动 ${k}`);
}
assert.throws(() => recordConsumption('synth', {}), /必须写明 by/);
// 写回的清单仍然合法
assert.equal(loadDataset('synth').consumed.length, 3);

// 缩进:写回必须与生成方(一律 `null, 1`)一致。不一致的话第一次记消耗就整份重排版,
// git diff 炸成几千行、真正改的那一行淹在里面 —— 逐行比一遍,变化只许出现在 consumed 上。
const canon = good();
canon.id = 'synth-indent';
writeFileSync(`${DS_DIR}synth-indent.json`, `${JSON.stringify(canon, null, 1)}\n`);
const beforeLines = readFileSync(`${DS_DIR}synth-indent.json`, 'utf8').split('\n');
recordConsumption('synth-indent', { by: 'arm-c', at: '2026-01-06' });
const afterLines = readFileSync(`${DS_DIR}synth-indent.json`, 'utf8').split('\n');
const changed = [
  ...beforeLines.filter(l => !afterLines.includes(l)),
  ...afterLines.filter(l => !beforeLines.includes(l)),
];
assert.deepEqual(changed.filter(l => !/"(at|by|note)"|^\s*[{}],?$/.test(l)), [],
  `记一次消耗不该动 consumed 以外的行,实际动了: ${JSON.stringify(changed.slice(0, 5))}`);
assert.equal(afterLines.length - beforeLines.length, 5, 'consumed 追加一条 = 多 5 行(一个对象三个字段)');

// ── 丢弃池:可缺键(向后兼容),写入只补不覆盖 ────────────────────────────
const base0 = good();
base0.id = 'synth2';
write('synth2', base0);
const ds2Before = loadDataset('synth2');
assert.deepEqual(droppedArticleIds(ds2Before), [], '没有 dropped 键的老清单照常合法,丢弃池为空');
assert.deepEqual(datasetArticleIds(ds2Before), [101, 102, 103, 201]);
assert.deepEqual(datasetArticleIds(ds2Before, { includeDropped: true }), [101, 102, 103, 201]);

const droppedMeta = {
  302: { title: 'F', url: 'http://f', publishDate: '2026-01-01T00:00:00.000Z', sourceId: 6 },
  301: { title: 'E', url: 'http://e', publishDate: '2026-01-02T00:00:00.000Z', sourceId: 5 },
  303: { title: 'G', url: 'http://g', publishDate: '2026-01-01T12:00:00.000Z', sourceId: 7 },
  // 已在清单里的编号:元数据必须**不被覆盖**,标注就挂在它上面
  101: { title: '覆盖了就说明只补不覆盖是假的', url: 'x', publishDate: 'x', sourceId: 999 },
};
const res = recordDropped('synth2', { noise: [302, 301], notSelected: { 12: [303] }, articles: droppedMeta });
assert.equal(res.added, 3, '只补清单还没有的编号');
assert.deepEqual(res.dropped.noise, [301, 302], 'noise 落盘时排序');

const ds2 = loadDataset('synth2');
assert.deepEqual(ds2.dropped, { noise: [301, 302], notSelected: { 12: [303] } });
assert.deepEqual(droppedArticleIds(ds2).sort((a, b) => a - b), [301, 302, 303]);
assert.deepEqual(datasetArticleIds(ds2, { includeDropped: true }), [101, 102, 103, 201, 301, 302, 303]);
assert.deepEqual(datasetArticleIds(ds2), [101, 102, 103, 201], '不传开关时仍只有收录的那批');
assert.equal(ds2.articles['101'].title, 'A', 'recordDropped 不许覆盖既有元数据');
assert.equal(ds2.articles['101'].sourceId, 1);
assert.equal(ds2.articles['301'].title, 'E');
// 标注与其余键一字不改
for (const k of ['id', 'source', 'days', 'clusterSnapshot', 'selection', 'clusters', 'consumed']) {
  assert.deepEqual(ds2[k], base0[k], `recordDropped 不该动 ${k}`);
}

// 丢弃池里的文章要能取到正文,否则标不了
mkdirSync(`${DATA_ROOT}synth2/content`, { recursive: true });
assert.throws(() => loadArticlesByIds(ds2, [301], 'dropped'), /的 dropped 缺 1 篇正文/);
writeFileSync(`${DATA_ROOT}synth2/content/301.txt`, 'Dropped article body. Second sentence.');
const dropped301 = loadArticlesByIds(ds2, [301], 'dropped');
assert.equal(dropped301.length, 1);
assert.equal(dropped301[0].title, 'E');
assert.deepEqual(dropped301[0].sentences, ['Dropped article body.', 'Second sentence.']);

rmSync(TMP, { recursive: true, force: true });
console.log('dataset tests passed');
