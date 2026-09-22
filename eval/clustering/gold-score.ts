/**
 * 用事件金标给一个聚类结果打分。零 LLM、零网络，纯确定性。
 *
 *   npx tsx gold-score.ts <labels.json> [labels.json ...]
 *
 * labels.json 形状：{ "labels": { "<articleId>": <clusterId 或 -1> }, ... }
 * 金标：_data/clustering-F1/events.jsonl + meta-extra.json（判据与已知偏差见 rubric.md）
 *
 * ## 为什么同时报两族指标
 *
 * B-cubed 只在「金标覆盖到的文章」上算，所以 precision 不会因为簇里混了未标注文章而变低——
 * 它衡量的是「不同事件的文章有没有被揉进同一簇」。而簇里混进来的**未标注**文章（杂讯、别的事件）
 * 恰恰是这条管线的头号病，B-cubed 看不见它。故另报 per-event 纯度：分母是**整个簇**。
 *
 *   B-cubed precision   金标内部的混淆      低 = 把不同事件揉一起
 *   B-cubed recall      金标内部的碎裂      低 = 把一个事件拆散
 *   per-event 完整率     = B-cubed recall 的逐事件版，便于定位是哪个事件出问题
 *   per-event 纯度       事件所在簇有多大    低 = 簇里混了大量金标外的东西
 *
 * ## ⚠ per-event 纯度的适用范围（2026-09-05 实测订正）
 *
 * **纯度的绝对值不可信，只能做同种子配对的相对比较。**
 *
 * 它的分子在标注集内（人判过），分母是整个簇、越出了标注集——等于默认「未标注 = 不属于该事件」。
 * 而标注者复核确认的只是「这 24 个事件没漏成员」，不是「窗口里没有别的同类文章」。
 * 实测：俄乌那个 35 篇的簇人只标了 12 篇，其余 23 篇读标题全是俄乌战争报道，本该算命中却被当成
 * 污染（报 0.34 / 实际约 0.9）；以巴簇报 0.58 / 实际约 1.0；主题层宏平均偏低约 0.12。
 *
 * 根因是标注只覆盖 23%，不是分母选错了——只算标注集（B³-P）会对杂讯完全失明，两个分母各瞎一半。
 * 彻底修法是全覆盖参考划分（每篇都给归属、杂讯记单元素组），那时 B-cubed 就能看见杂讯，
 * 本指标可以退役。F2 起按此办，见 rubric.md「F2 起改为全覆盖划分」与
 * docs/engineering-notes/eval-design-principles.md 第五原则。
 *
 * ## 两个口径（不压成一个数，故意的）
 *
 *   严格  只算 members             事件本身有没有被拆散
 *   宽松  members + related        整条故事线有没有聚在一起
 *
 * 「洪灾引发的假信息/重建成本/电力贸易」算不算同一件事没有唯一答案（学界标注一致性约 69%），
 * 与其靠人拍一条线，不如两个口径都报。2026-09-04 实测：两者在 eps 0.10–0.35 全段读数一致，
 * 即当前聚类器根本没做这个区分——这个争议在数据上是空的。
 *
 * ## 四条样本资格规则（独立复核提出，逐条落实）
 *
 * 1. 单篇事件完整率恒 1.0，无信息量 → 不进宏平均；单独报「有没有被吞进大簇」
 * 2. 标了 exclude_from_primary 的事件不进宏平均（如 Dolly Parton：讣告首报不在窗口内，
 *    窗口里只有主题各异的回指稿，无共同事件锚点）
 * 3. duplicate_pairs（同源同时刻重复入库）只计一次，否则重复稿让分母虚高
 * 4. multi_label 文章确实属于该事件，算纯度时**不能当 false positive**：
 *    算法把它放进正确簇反而被扣分是错的 → 从纯度分母中剔除
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bcubed } from './metrics.js';
import type { Partition } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

interface GoldEvent {
  group: string;
  event: string;
  members: number[];
  related: Array<{ id: number }>;
  multi_label: Array<{ id: number }>;
  exclude_from_primary: boolean;
}

/** 单篇事件的纯度低于此值即判「被吞进大簇」。阈值是拍的，未经验证——只当信号别当门。 */
const SWALLOWED_PURITY = 0.2;

export function loadGold(dir = join(HERE, '../_data/clustering-F1')) {
  const events: GoldEvent[] = readFileSync(join(dir, 'events.jsonl'), 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
  const meta = JSON.parse(readFileSync(join(dir, 'meta-extra.json'), 'utf-8'));

  // 规则 3：重复对只留 id 较小的一条
  const drop = new Set<number>((meta.duplicate_pairs ?? []).map((p: number[]) => Math.max(...p)));
  // 规则 4 + non_article：纯度分母的豁免集
  const exempt = new Set<number>((meta.non_article ?? []).map((x: { id: number }) => x.id));
  for (const e of events) for (const m of e.multi_label ?? []) exempt.add(m.id);

  return { events, meta, drop, exempt };
}

interface GoldTopic {
  topic: string;
  events: string[];
  rationale?: string;
}

/**
 * 主题层金标（可选）。判据见 rubric.md「主题层」一节：
 * 同一冲突 / 同一持续局势下的一切归一个主题，粒度以「占简报一段」为准。
 * 事件层回答「同一件事的报道有没有聚在一起」，主题层回答「同一主题的事件有没有聚在一起」——
 * 两层用同一份 labels 打两次分，一个聚类结果可能在一层好、另一层差（那是粒度问题不是杂讯）。
 */
export function loadTopics(dir = join(HERE, '../_data/clustering-F1')): GoldTopic[] | null {
  const p = join(dir, 'topics-F1.jsonl');
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

/** 把事件层金标折叠成主题层：同一主题的 members / related / multi_label 取并集。 */
export function toTopicLayer(gold: ReturnType<typeof loadGold>, topics: GoldTopic[]) {
  const byName = new Map(gold.events.map(e => [e.event, e]));
  const seen = new Set<string>();
  const events: GoldEvent[] = topics.map(t => {
    const es = t.events.map(n => {
      const e = byName.get(n);
      if (!e) throw new Error(`主题「${t.topic}」引用了不存在的事件：${n}`);
      if (seen.has(n)) throw new Error(`事件被归入多个主题：${n}`);
      seen.add(n);
      return e;
    });
    return {
      group: 'T',
      event: t.topic,
      members: [...new Set(es.flatMap(e => e.members))],
      related: es.flatMap(e => e.related ?? []),
      multi_label: es.flatMap(e => e.multi_label ?? []),
      // 整个主题的事件都被排除才排除该主题
      exclude_from_primary: es.every(e => e.exclude_from_primary),
    };
  });
  const missing = gold.events.filter(e => !seen.has(e.event)).map(e => e.event);
  if (missing.length) throw new Error(`这些事件没有归入任何主题：${missing.join(' / ')}`);
  return { ...gold, events };
}

function eventSet(e: GoldEvent, loose: boolean, drop: Set<number>): Set<number> {
  const ids = loose ? [...e.members, ...(e.related ?? []).map(r => r.id)] : e.members;
  return new Set(ids.filter(i => !drop.has(i)));
}

export function scoreOne(
  gold: ReturnType<typeof loadGold>,
  labels: Map<number, number>,
  loose = false
) {
  const rows = [];
  for (const e of gold.events) {
    const E = [...eventSet(e, loose, gold.drop)].filter(i => labels.has(i));
    if (E.length === 0) continue;
    const spread = new Map<number, number>();
    for (const i of E) spread.set(labels.get(i)!, (spread.get(labels.get(i)!) ?? 0) + 1);
    const [top, topN] = [...spread.entries()].sort((a, b) => b[1] - a[1])[0];
    // 纯度分母 = 整个簇，但剔除豁免项（multi_label / non_article）。
    // 例外：豁免项若本身就是本单元的成员，它已经进了分子，必须同时留在分母，否则纯度会 >1。
    // （2026-09-05 修：主题层把多个事件的 members 取并集后，775911 同时是「加沙空袭 B」的
    //  member 与「杰宁空袭」的 multi_label，导致「以巴冲突」主题纯度读到 1.08。）
    const memberSet = new Set(E);
    let clusterSize = 0;
    for (const [id, c] of labels) if (c === top && (!gold.exempt.has(id) || memberSet.has(id))) clusterSize++;
    rows.push({
      name: e.event,
      n: E.length,
      完整率: topN / E.length,
      纯度: clusterSize ? topN / clusterSize : 0,
      碎片: [...spread.keys()].filter(c => c !== -1).length,
      进噪声: spread.get(-1) ?? 0,
      单篇: E.length === 1,
      排除: e.exclude_from_primary,
    });
  }
  return rows;
}

/** 规则 1+2：单篇事件与标记排除的事件不进宏平均 */
const macro = (rows: ReturnType<typeof scoreOne>, key: '完整率' | '纯度' | '碎片') => {
  const v = rows.filter(r => !r.单篇 && !r.排除).map(r => r[key]);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
};

/** 金标（members）作为参考划分，喂给已有的 bcubed()。它只在两个划分的交集上算。 */
function goldPartition(gold: ReturnType<typeof loadGold>): Partition {
  const p: Partition = new Map();
  for (const e of gold.events) for (const i of e.members) if (!gold.drop.has(i)) p.set(i, e.event);
  return p;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const useTopic = argv.includes('--topic');
  const files = argv.filter(a => a !== '--topic');
  let gold = loadGold();
  if (useTopic) {
    const topics = loadTopics();
    if (!topics) throw new Error('缺 gold/topics-F1.jsonl，无法按主题层打分');
    gold = toTopicLayer(gold, topics);
    console.log('【主题层】同一主题的事件有没有聚在一起（判据见 rubric.md 主题层一节）');
  } else {
    console.log('【事件层】同一件事的报道有没有聚在一起');
  }
  const ref = goldPartition(gold);
  const nMacro = gold.events.filter(e => e.members.length > 1 && !e.exclude_from_primary).length;
  console.log(
    `金标 ${gold.events.length} 个 / members ${[...ref.keys()].length} 篇；` +
      `进宏平均 ${nMacro} 个（单篇与标记排除的不算）；纯度豁免 ${gold.exempt.size} 条\n`
  );
  console.log(
    `${'配置'.padEnd(32)}${'B³-P'.padStart(7)}${'B³-R'.padStart(7)}${'B³-F1'.padStart(7)}` +
      `${'严格完整'.padStart(9)}${'宽松完整'.padStart(9)}${'纯度'.padStart(7)}${'碎片'.padStart(7)}${'单篇被吞'.padStart(9)}`
  );
  for (const f of files) {
    const d = JSON.parse(readFileSync(f, 'utf-8'));
    const labels = new Map<number, number>(
      Object.entries(d.labels as Record<string, number>).map(([k, v]) => [Number(k), v])
    );
    const b = bcubed(labels as Partition, ref);
    const s = scoreOne(gold, labels, false);
    const l = scoreOne(gold, labels, true);
    const singles = s.filter(r => r.单篇);
    const swallowed = singles.filter(r => r.纯度 < SWALLOWED_PURITY).length;
    const name = (f.split('/').pop() ?? f).replace('.json', '');
    console.log(
      `${name.padEnd(32)}${b.precision.toFixed(3).padStart(7)}${b.recall.toFixed(3).padStart(7)}` +
        `${b.f1.toFixed(3).padStart(7)}${macro(s, '完整率').toFixed(3).padStart(9)}` +
        `${macro(l, '完整率').toFixed(3).padStart(9)}${macro(s, '纯度').toFixed(3).padStart(7)}` +
        `${macro(s, '碎片').toFixed(2).padStart(7)}${`${swallowed}/${singles.length}`.padStart(9)}`
    );
  }
}
