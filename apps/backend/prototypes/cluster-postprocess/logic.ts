/**
 * 聚类后处理层的**纯逻辑**（无 I/O、无终端代码）。TUI 只是它的外壳，验完可以整块搬进生产。
 *
 * ## 这个原型在回答什么
 *
 * 聚类（不降维 + 余弦阈值凝聚）把阈值调严之后纯度涨、但事件被切碎。设想是补一层后处理：
 * 用簇质心余弦筛出「疑似被切开」的簇对，交给 LLM 成对判定，判 same 的合回去；同时把
 * 「只有题材没有事」的题材袋标出来处理掉。**这一层的判决与聚合规则对不对，是这个原型要试的。**
 *
 * 三个拿不准、纸上想不清楚的点：
 *   1. 成对判定会传递：A-B 合、B-C 合，但 A 与 C 可能完全不像。全链约束（组内所有对都得
 *      判 same）够不够挡住链式雪球？会不会把该合的也挡了？
 *   2. `unknown`（判官说拿不准）默认不合，代价有多大？
 *   3. 合并后的大小守卫该卡在几篇？卡太紧会挡住真·大事件（尼泊尔洪灾 71 篇）。
 *
 * 附带第四问：题材袋该丢、该拆、还是只标记。
 */

export type ClusterId = number;
export type ArticleId = number;

export interface Cluster {
  id: ClusterId;
  articleIds: ArticleId[];
}

/** 候选簇对。cos = 两簇质心的余弦。 */
export interface Pair {
  a: ClusterId;
  b: ClusterId;
  cos: number;
}

export type Verdict = 'same' | 'different' | 'unknown';

export const pairKey = (a: ClusterId, b: ClusterId) => `${Math.min(a, b)}|${Math.max(a, b)}`;

export function unitCentroid(ids: ArticleId[], vec: Map<ArticleId, Float64Array>): Float64Array {
  const dim = vec.get(ids[0])!.length;
  const c = new Float64Array(dim);
  for (const id of ids) {
    const v = vec.get(id)!;
    for (let k = 0; k < dim; k++) c[k] += v[k];
  }
  let n = 0;
  for (let k = 0; k < dim; k++) n += c[k] * c[k];
  n = Math.sqrt(n) || 1;
  for (let k = 0; k < dim; k++) c[k] /= n;
  return c;
}

const dot = (x: Float64Array, y: Float64Array) => {
  let s = 0;
  for (let k = 0; k < x.length; k++) s += x[k] * y[k];
  return s;
};

/**
 * 第一级：零 LLM 的候选生成。簇质心余弦 ≥ thr 的簇对进候选，按 cos 降序（先判最像的）。
 *
 * 实测（F1/F2 金标，凝聚 t=0.08）：thr=0.90 时 F2 候选 81 对、召回 44/44；F1 候选 58 对、
 * 召回 23/23。也就是说这一级零漏，精度交给第二级。
 */
export function buildMergeCandidates(
  clusters: Cluster[],
  vec: Map<ArticleId, Float64Array>,
  thr: number
): Pair[] {
  const cents = new Map<ClusterId, Float64Array>();
  for (const c of clusters) cents.set(c.id, unitCentroid(c.articleIds, vec));
  const out: Pair[] = [];
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const cos = dot(cents.get(clusters[i].id)!, cents.get(clusters[j].id)!);
      if (cos >= thr) out.push({ a: clusters[i].id, b: clusters[j].id, cos });
    }
  }
  return out.sort((x, y) => y.cos - x.cos);
}

export interface MergeGuards {
  /** 合并后簇的篇数上限。超过则拒绝这次合并（防雪球）。 */
  maxMergedSize: number;
  /** 全链：一组要合并，组内**所有**簇对都必须判 same。关掉就退化成单链（会串）。 */
  completeLinkage: boolean;
}

export interface MergeOutcome {
  /** 合并后的分组：每组是一批原簇 id */
  groups: ClusterId[][];
  merges: number;
  /** 判 same 但被全链挡下的对（组内存在未判 same 的对） */
  blockedByLinkage: Pair[];
  /** 判 same 但被大小守卫挡下的对 */
  blockedByGuard: Pair[];
}

/**
 * 第三级：聚合。按 cos 降序逐对处理，只吃 verdict==='same' 的对。
 * unknown / different / 未判 一律不合（保守：合错=两件事写成一条，读者直接看得见）。
 */
export function applyMerges(
  clusters: Cluster[],
  candidates: Pair[],
  verdicts: Map<string, Verdict>,
  guards: MergeGuards
): MergeOutcome {
  const groupOf = new Map<ClusterId, number>();
  const groups: ClusterId[][] = clusters.map((c, i) => {
    groupOf.set(c.id, i);
    return [c.id];
  });
  const sizeOf = new Map<ClusterId, number>(clusters.map(c => [c.id, c.articleIds.length]));
  const groupSize = groups.map(g => sizeOf.get(g[0])!);
  const blockedByLinkage: Pair[] = [];
  const blockedByGuard: Pair[] = [];
  let merges = 0;

  for (const p of candidates) {
    if (verdicts.get(pairKey(p.a, p.b)) !== 'same') continue;
    const ga = groupOf.get(p.a)!;
    const gb = groupOf.get(p.b)!;
    if (ga === gb) continue;

    if (guards.completeLinkage) {
      // 组内所有跨组对都得判 same；没进过候选的对天然是 undefined，即挡住
      let ok = true;
      for (const x of groups[ga]) {
        for (const y of groups[gb]) {
          if (verdicts.get(pairKey(x, y)) !== 'same') { ok = false; break; }
        }
        if (!ok) break;
      }
      if (!ok) { blockedByLinkage.push(p); continue; }
    }
    if (groupSize[ga] + groupSize[gb] > guards.maxMergedSize) { blockedByGuard.push(p); continue; }

    for (const y of groups[gb]) groupOf.set(y, ga);
    groups[ga] = groups[ga].concat(groups[gb]);
    groupSize[ga] += groupSize[gb];
    groups[gb] = [];
    groupSize[gb] = 0;
    merges++;
  }
  return { groups: groups.filter(g => g.length > 0), merges, blockedByLinkage, blockedByGuard };
}

// ── 题材袋 ────────────────────────────────────────────────────────────────────

const CAP_STOP = new Set(
  'The A An In On At Of For And Or But To From With As By New Why How What When Who Where This That It Is Are Was Were Be Been After Before Over Under Into Out Up Down Not No Us We I You He She They His Her Their Its My Your Our Says Said'.split(' ')
);

/** 一批标题里覆盖率最高的那个专有名词覆盖了多少比例。移植自 lib/core/storyline.ts 的同名函数。 */
export function entityShare(titles: string[]): number {
  if (titles.length < 2) return 1;
  const per = titles.map(t => {
    const s = new Set<string>();
    for (const m of t.matchAll(/\b[A-Z][A-Za-z’']{2,}\b/g)) {
      const w = m[0].replace(/[’']s$/i, '');
      if (!CAP_STOP.has(w)) s.add(w);
    }
    for (const m of t.matchAll(/[一-龥]{2,4}/g)) s.add(m[0]);
    return s;
  });
  const tally = new Map<string, number>();
  for (const ws of per) for (const w of ws) tally.set(w, (tally.get(w) ?? 0) + 1);
  let best = 0;
  for (const n of tally.values()) if (n > best) best = n;
  return best / titles.length;
}

export type PocketPolicy = 'keep' | 'flag' | 'drop';

export interface PocketDecision {
  id: ClusterId;
  share: number;
  size: number;
  isPocket: boolean;
}

/**
 * 第四问：零 LLM 的题材袋判据。共享专名占比 < shareThr 即判题材袋。
 * 生产的 storyline 层已有同型守卫（块 ≥5 篇且 share <0.40 就拆），这里是把它前移到簇级。
 */
export function detectPockets(
  clusters: Cluster[],
  titleOf: Map<ArticleId, string>,
  shareThr: number
): PocketDecision[] {
  return clusters.map(c => {
    const share = entityShare(c.articleIds.map(id => titleOf.get(id) ?? ''));
    return { id: c.id, share, size: c.articleIds.length, isPocket: share < shareThr };
  });
}

// ── 产品口径指标（与 scripts/eval/clustering/product-score.ts 同定义，原型内自带一份）──

export interface Metrics {
  clusters: number;
  delivery: number;
  purity: number;
  pocketRate: number;
  spread: number;
  wholeness: number;
}

/**
 * @param partition 后处理之后的划分：一组 = 一块
 * @param goldOf    文章 → 金标事件名（只含 ≥2 篇的事件）
 * @param goldSize  事件名 → 篇数
 */
export function scoreProduct(
  partition: ArticleId[][],
  goldOf: Map<ArticleId, string>,
  goldSize: Map<string, number>
): Metrics {
  const blocks = partition.filter(b => b.length >= 2);
  let pureSum = 0;
  let pocket = 0;
  for (const b of blocks) {
    const tally = new Map<string, number>();
    for (const id of b) {
      const g = goldOf.get(id);
      if (g) tally.set(g, (tally.get(g) ?? 0) + 1);
    }
    const top = Math.max(0, ...tally.values());
    pureSum += top / b.length;
    if (top < 2) pocket++;
  }
  const whereOf = new Map<ArticleId, number>();
  blocks.forEach((b, i) => b.forEach(id => whereOf.set(id, i)));
  const byEvent = new Map<string, ArticleId[]>();
  for (const [id, g] of goldOf) (byEvent.get(g) ?? byEvent.set(g, []).get(g)!).push(id);

  let delivered = 0;
  let spreadSum = 0;
  let wholeSum = 0;
  for (const [name, ids] of byEvent) {
    if ((goldSize.get(name) ?? 0) < 2) continue;
    const spread = new Map<number, number>();
    for (const id of ids) {
      const w = whereOf.get(id);
      if (w !== undefined) spread.set(w, (spread.get(w) ?? 0) + 1);
    }
    const top = Math.max(0, ...spread.values());
    if (top < 2) continue;
    delivered++;
    spreadSum += spread.size;
    wholeSum += top / ids.length;
  }
  const targets = [...byEvent.keys()].filter(n => (goldSize.get(n) ?? 0) >= 2).length;
  return {
    clusters: blocks.length,
    delivery: delivered / Math.max(1, targets),
    purity: pureSum / Math.max(1, blocks.length),
    pocketRate: pocket / Math.max(1, blocks.length),
    spread: spreadSum / Math.max(1, delivered),
    wholeness: wholeSum / Math.max(1, delivered),
  };
}
