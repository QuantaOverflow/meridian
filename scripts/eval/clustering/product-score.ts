/**
 * 产品口径打分器。零 LLM、零网络、纯确定性。
 *
 *   tsx product-score.ts --window=F1 [--strict] [--topic] <labels.json ...>
 *
 * ## 为什么另起一把尺（2026-09-05）
 *
 * `full-score.ts` 报的 ARI / B-cubed 是聚类文献的通用指标：比「两个划分像不像」，
 * 按**篇对**算，且把单元素组也算分。而产品要的是「有多少个簇能直接当简报里的一块」，
 * 按**簇**算，且**单元素不算分**——F1 有 595 个、F2 有 715 个单元素组，占一半以上，
 * 通用指标里超过一半的分来自这些我们根本不看的部分。
 *
 * 产品口径由三条截断定义（与目标一一对应）：
 *
 *   ① 预测侧：<2 篇的簇忽略（不进任何分母）—— 一块至少要有两篇报道才成故事
 *   ② 参考侧：<2 篇的事件忽略 —— 只有一家报过的事本来就不该成簇
 *   ③ 视角：按簇算纯度，按事件算跨簇 —— 「一块=一件事」与「一件事别跨簇」各有各的数
 *
 * ## 默认口径是宽松（members + related）
 *
 * 事件评论算进事件簇：一个簇装着 9 篇尼泊尔洪灾的机制/舆论评论，它讲的仍是那件事。
 * 传 `--strict` 可以退回只算 members。
 *
 * ## 指标
 *
 *   交付率     目标事件里，有 ≥2 篇落进同一个簇的比例        （不漏）
 *   簇纯度     每个簇里主导事件占几成，宏平均                （一块=一件事）
 *   题材袋率   主导事件凑不出 2 篇的簇，占全部簇的比例        （空簇）
 *   跨簇数     交付事件的成员散在几个簇，宏平均              （不跨簇）
 *   完整率     交付事件的最大一块占该事件的比例，宏平均       （不跨簇的强度）
 *   进簇率     落进 ≥2 簇的文章占全库比例                    （防「难的全扔噪声」刷分）
 */
import { readFileSync } from 'node:fs';
import { loadFull, referencePartition } from './full-score.js';

interface Row {
  name: string;
  簇数: number;
  进簇率: number;
  交付率: number;
  簇纯度: number;
  题材袋率: number;
  跨簇数: number;
  完整率: number;
}

function scoreOne(
  name: string,
  labels: Map<number, number>,
  ref: Map<number, string>,
  universeSize: number,
  minSize: number
): Row {
  // ① 预测侧截断：<2 篇的簇（含噪声 -1）整个忽略
  const bySize = new Map<number, number[]>();
  for (const [id, c] of labels) {
    if (c < 0) continue;
    (bySize.get(c) ?? bySize.set(c, []).get(c)!).push(id);
  }
  const clusters = [...bySize.entries()].filter(([, ids]) => ids.length >= minSize);
  const inCluster = new Map<number, number>();
  for (const [c, ids] of clusters) for (const id of ids) inCluster.set(id, c);

  // ② 参考侧截断：<2 篇的事件组忽略（solo 组天然被排除）
  const byRef = new Map<string, number[]>();
  for (const [id, g] of ref) {
    if (g.startsWith('solo:')) continue;
    (byRef.get(g) ?? byRef.set(g, []).get(g)!).push(id);
  }
  const targets = [...byRef.entries()].filter(([, ids]) => ids.length >= minSize);

  // ③ 簇视角：主导事件命中数 / 簇大小
  //
  // ⚠ 题材袋判据固定用 POCKET_HIT=2，**不跟 minSize 走**。两者是两件事：
  // minSize 是产品截断（一块至少几篇才进简报），题材袋问的是「这簇里到底有没有一件事」，
  // 判据是「有没有任何一个金标事件在这簇里占到 2 篇」。绑在一起会让 --min=3 时
  // 「主导事件只占 2 篇」的真事件簇被误算成题材袋（实测 F2 报 0.174，实际 0.07）。
  const POCKET_HIT = 2;
  let pureSum = 0;
  let pocket = 0;
  for (const [, ids] of clusters) {
    const tally = new Map<string, number>();
    for (const id of ids) {
      const g = ref.get(id);
      // 纯度与题材袋都按「≥2 篇的金标事件」算，与 minSize 无关
      if (g && !g.startsWith('solo:') && (byRef.get(g)?.length ?? 0) >= POCKET_HIT) {
        tally.set(g, (tally.get(g) ?? 0) + 1);
      }
    }
    const top = [...tally.values()].sort((a, b) => b - a)[0] ?? 0;
    pureSum += top / ids.length;
    if (top < POCKET_HIT) pocket++;
  }

  // 事件视角：交付 / 跨簇 / 完整
  let delivered = 0;
  let spreadSum = 0;
  let wholeSum = 0;
  for (const [, ids] of targets) {
    const spread = new Map<number, number>();
    for (const id of ids) {
      const c = inCluster.get(id);
      if (c !== undefined) spread.set(c, (spread.get(c) ?? 0) + 1);
    }
    const top = [...spread.values()].sort((a, b) => b - a)[0] ?? 0;
    // 交付判据同样用 2：事件只要有 2 篇落进同一个（已过 minSize 截断的）簇就算交付。
    // minSize 已经在上面把小簇滤掉了，这里再卡一次会重复惩罚。
    if (top < POCKET_HIT) continue;
    delivered++;
    spreadSum += [...spread.values()].filter(n => n >= 1).length;
    wholeSum += top / ids.length;
  }

  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    name,
    簇数: clusters.length,
    进簇率: r3(inCluster.size / universeSize),
    交付率: r3(delivered / Math.max(1, targets.length)),
    簇纯度: r3(pureSum / Math.max(1, clusters.length)),
    题材袋率: r3(pocket / Math.max(1, clusters.length)),
    跨簇数: r3(spreadSum / Math.max(1, delivered)),
    完整率: r3(wholeSum / Math.max(1, delivered)),
  };
}

const argv = process.argv.slice(2);
const win = (argv.find(a => a.startsWith('--window=')) ?? '--window=F1').split('=')[1];
const strict = argv.includes('--strict');
const minSize = Number((argv.find(a => a.startsWith('--min=')) ?? '--min=2').split('=')[1]);
const topic = argv.includes('--topic');
const files = argv.filter(a => !a.startsWith('--'));

const gold = loadFull(win);
const ref = referencePartition(gold, { topic, loose: !strict });
const universe = [...gold.universe].filter(id => !gold.excluded.has(id));
const targetCount = [...new Set([...ref.values()].filter(g => !g.startsWith('solo:')))].filter(g => {
  let n = 0;
  for (const [, v] of ref) if (v === g) n++;
  return n >= minSize;
}).length;

console.log(
  `【${win} ${topic ? '主题层' : '事件层'} / ${strict ? '严格' : '宽松(members+related)'} / 产品口径】\n` +
    `全库 ${universe.length} 篇（已排除 ${gold.excluded.size} 篇）；目标事件（≥2 篇）${targetCount} 个\n` +
    `截断：<${minSize} 篇的簇忽略、<${minSize} 篇的事件忽略\n`
);

const rows: Row[] = [];
for (const f of files) {
  const raw = JSON.parse(readFileSync(f, 'utf-8'));
  const labels = new Map<number, number>();
  for (const [k, v] of Object.entries(raw.labels as Record<string, number>)) {
    const id = Number(k);
    if (!gold.excluded.has(id)) labels.set(id, Number(v));
  }
  const missing = universe.filter(id => !labels.has(id)).length;
  if (missing > universe.length * 0.02) {
    throw new Error(`${f}: 有 ${missing} 篇不在 labels 里（>2%），窗口对不上`);
  }
  rows.push(scoreOne(f.split('/').pop()!.replace(/\.json$/, ''), labels, ref, universe.length, minSize));
}

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
console.log(
  pad('配置', 34) + pad('簇数', 8) + pad('进簇率', 9) + pad('交付率', 9) + pad('簇纯度', 9) + pad('题材袋率', 11) + pad('跨簇数', 9) + '完整率'
);
for (const r of rows) {
  console.log(
    pad(r.name, 34) +
      pad(String(r.簇数), 8) +
      pad(r.进簇率.toFixed(3), 9) +
      pad(r.交付率.toFixed(3), 9) +
      pad(r.簇纯度.toFixed(3), 9) +
      pad(r.题材袋率.toFixed(3), 11) +
      pad(r.跨簇数.toFixed(2), 9) +
      r.完整率.toFixed(3)
  );
}
