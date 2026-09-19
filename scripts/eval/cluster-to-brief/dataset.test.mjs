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

const { loadDataset, datasetClusters, loadClusterArticles, labelsOf, recordConsumption } = await import('./dataset.mjs');

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

rmSync(TMP, { recursive: true, force: true });
console.log('dataset tests passed');
