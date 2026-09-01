// 去重层：把 story-validation 从**同一个簇**里切出来的重复故事并回去。
//
// 病灶（2026-08-30 实测，两期数据 + 94 条人工金标）：LLM 把「一个大事件」切得过碎。
// 一场尼泊尔冰川溃决洪水的 91 篇报道被切成 22 个故事，占掉简报 25 个名额里的 11 个，
// 把基辅无人机袭击致 37 死、五角大楼封禁 Anthropic 被判违法等挤出简报。跨天复现
// （8/28 同一场灾难 74 篇 → 14 个故事）。对照组：「一袋不相干小事」的杂物袋簇几乎不过拆
// （过拆倍数 1.1-1.3），所以缺陷集中在**单一大事件的大簇**上。
//
// 判据来源：`brief_stories.centroid`（成员文章 embedding 的均值，聚类时已算好躺在库里）。
// 拿 94 条人工金标校准出阈值 0.94（校准时用的是单链），在 5 个簇里 4 个与金标**逐条相同**，
// 且顺手把误入尼泊尔簇的津巴布韦车祸孤立了出来（那是聚类塞错的，没让它找）。
// ⚠️ 那批金标文件已丢失，重跑对拍前得先重建——见 docs/engineering-notes/event-dedup-industry-patterns.md。
//
// 2026-09-01 聚合由单链改为全链（complete-linkage），理由与实测见 buildMergeGroups。
// 原「中东伞」那条已知缺陷（单链把霍尔木兹谈判、卡塔尔斡旋、六个月盘点串成一片，
// A↔B、B↔C 过线而 A↮C）随之消失：全链要求组内所有对都过线，构造上不可能串联。
//
// 已知缺陷（别指望这一层解决）：
//  · 两条一组的合并只靠一条边支撑，余弦分不开真假：
//    实测「基辅袭击 vs 泽连斯基无人机计划」(0.9445，不该合) 夹在
//    「纳根德拉辞职」(0.9579，该合) 与「科伦坡测试赛」(0.9423，该合) 中间。
//    LLM importance 差也无效（尼日尔兵变那对差 4 却该合，基辅那对差 3 却不该合）。
//    → 故两条组交给 LLM 确认（起标题那次调用顺便做，零增量成本）；≥3 条的组不确认。
//  · 「≥3 条不确认」的依据在改全链后才真正成立：单链时代所谓「多条边互相印证」是假的
//    （7 期实测 32 个多条组里 21 个内部存在没过线的配对），全链下组内每一对都过线。
//    但过线 ≠ 同一发生——原型实测判官对「同题材不同发生」仍有假阳（美国遣返阿富汗人
//    × Milo 被遣返，两两问也判成一件事）。逐对送确认是下一步，见 prototypes/dedup-band。

/** 参与去重的最小 story 形状。index 是它在 validatedStories.stories 里的下标。 */
export interface DedupStory {
  index: number;
  clusterId: number;
  importance: number;
  articleIds: number[];
  title: string;
}

/** 两条 story 的 centroid 余弦。a/b 是 DedupStory.index。 */
export interface CosinePair {
  a: number;
  b: number;
  cos: number;
}

export interface MergeGroup {
  /** 组内成员的 index，升序 */
  indices: number[];
  /** 组内**全部配对**的最小余弦，全链下保证 ≥ 阈值（观测用：越接近阈值越可疑） */
  minCos: number;
  /** 只有两条的组需要 LLM 确认（单边支撑） */
  needsConfirm: boolean;
}

/** 默认阈值。94 条人工金标校准，别随手改——改了得重跑 scripts/eval 的去重对拍。 */
export const DEFAULT_MIN_COSINE = 0.94;

/** 合并后单条 story 的文章上限。见 pickSpreadArticles 的注释。 */
export const DEFAULT_ARTICLE_CAP = 30;

/**
 * 全链（complete-linkage）凝聚出合并组。只在**同一个 clusterId 内**合并——跨簇相似是
 * 聚类该管的事，这一层不越权（越权的代价见 memory: clustering-prune-overreach）。
 *
 * ⚠️ 2026-09-01 由单链改为全链。单链「组内任意一对过线即可入组」，靠传递性串联：
 * A↔B 过线、B↔C 过线，A↮C 完全不像也会被并进同一组，而合并后 A 和 C 被写成同一件事。
 *
 * 实测（7 期真实数据，阈值不变仍是 0.94）：
 *   聚合   组数  合掉的故事  最大组  ≥3条的组  其中"组内全对最小 < 阈值"
 *   单链     76         257      14        32                        21
 *   全链     91         228       6        27                         0
 * 即 32 个多条组里有 21 个（66%）内部存在没过线的配对，全链定义上把它归零；
 * 那个 14 条的巨团正是串出来的，全链下最大 6 条。
 * 代价是少合 29 条故事，其中「正确地不合」与「误拆」的比例目前没有金标可量。
 *
 * 一手来源（docs/engineering-notes/event-dedup-industry-patterns.md）：
 * 单链 = transitive closure / connected components，是 entity resolution 文献里最原始的
 * 一档；Hassanzadeh et al. VLDB'09 (PVLDB 2(1):1282-1293) 受控实验实测其精度显著低于
 * 其他所有算法，失效模式（chaining、阈值越松越严重）与上表完全吻合。
 * 本仓库上游的 candidate-grouping.ts 早就是全链，理由逐字相同——这一层是漏网的。
 *
 * 注：`pairs` 可以只带 ≥ minCosine 的边（生产就是这么查 SQL 的）。缺失的边按 0 处理，
 * 而按定义它本来就低于阈值、必然阻止合并，所以结论不受影响。
 */
export function buildMergeGroups(
  stories: DedupStory[],
  pairs: CosinePair[],
  minCosine = DEFAULT_MIN_COSINE
): MergeGroup[] {
  const byIndex = new Map(stories.map((s) => [s.index, s]));
  const key = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  const sim = new Map<string, number>();
  for (const p of pairs) {
    if (p.cos < minCosine) continue;
    const sa = byIndex.get(p.a);
    const sb = byIndex.get(p.b);
    if (!sa || !sb || sa.clusterId !== sb.clusterId) continue;
    sim.set(key(p.a, p.b), p.cos);
  }
  const cos = (a: number, b: number) => sim.get(key(a, b)) ?? 0;

  // 贪心凝聚：每轮并「组间最小相似度」最大的那一对，直到没有任何一对的最小相似度过线。
  // 以最小相似度作优先级 = 最保守的那对先并，与 candidate-grouping.ts 的做法一致。
  // 并列时取下标最小的一对，保证同一批输入永远得到同一个划分（工作流重放要求确定性）。
  let groups: number[][] = stories.map((s) => [s.index]);
  for (;;) {
    let best: [number, number] | null = null;
    let bestSim = -Infinity;
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        if (byIndex.get(groups[a][0])!.clusterId !== byIndex.get(groups[b][0])!.clusterId) continue;
        let mn = 1;
        outer: for (const x of groups[a]) {
          for (const y of groups[b]) {
            const s = cos(x, y);
            if (s < mn) mn = s;
            if (mn < minCosine) break outer; // 全链的合并条件就是最小值 ≥ 阈值，早剪枝
          }
        }
        if (mn >= minCosine && mn > bestSim) {
          bestSim = mn;
          best = [a, b];
        }
      }
    }
    if (!best) break;
    const [a, b] = best;
    groups[a] = groups[a].concat(groups[b]);
    groups.splice(b, 1);
  }

  const out: MergeGroup[] = [];
  for (const indices of groups) {
    if (indices.length < 2) continue;
    const sorted = indices.slice().sort((x, y) => x - y);
    // 全链下这个值就是「组内全部配对的最小余弦」，且保证 ≥ 阈值。
    // 单链时代它只是链上最小边，管不到组内没连边的那些对——正是那个读数掩盖了串联。
    let mn = 1;
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++) mn = Math.min(mn, cos(sorted[i], sorted[j]));
    out.push({ indices: sorted, minCos: mn, needsConfirm: sorted.length === 2 });
  }
  return out.sort((a, b) => b.indices.length - a.indices.length);
}

/**
 * 合并后的文章按**发布时间跨度均匀取样**，取到 cap 篇。
 *
 * ⚠️ 上限与取样方式都是实测定的，不是拍的（2026-08-30，真实的 89 篇尼泊尔报道
 * 打生产 /meridian/intelligence/analyze-single-story）：
 *   91 篇（283k 字符）→ 300 秒超时**硬失败**，所以上限是必须的，不是优化
 *   50 篇 → 相对 30 篇在任何测得的轴上都没有收益
 *   30 篇「按时间均匀取」事实覆盖 9/10，「按最新优先取」只有 7/10
 * 取样方式是唯一测出真实差异的杠杆：最新优先会漏掉早期发生的事（尼方拒绝外援、
 * 灾难对铁路项目的影响），而那些恰恰是简报该讲的。
 *
 * 输出保持时间升序（下游报告的时间线叙述依赖这个顺序）。
 */
export function pickSpreadArticles(
  articleIds: number[],
  publishedAt: Map<number, number>,
  cap = DEFAULT_ARTICLE_CAP
): number[] {
  const known = articleIds.filter((id) => publishedAt.has(id));
  // 缺时间戳的排在最后，不参与均匀取样但也不无故丢弃
  const unknown = articleIds.filter((id) => !publishedAt.has(id));
  const sorted = [...known].sort((x, y) => publishedAt.get(x)! - publishedAt.get(y)!);

  if (sorted.length + unknown.length <= cap) return [...sorted, ...unknown];
  if (sorted.length <= cap) return [...sorted, ...unknown.slice(0, cap - sorted.length)];

  // 等距抽样，**两端锚定**：i=0 取最早、i=cap-1 取最新。
  // 不能写成 floor(i * len/cap)——那样够不着末尾（89 篇取 30 只到第 86 篇），
  // 而最新那篇恰恰是最不能丢的（最新伤亡数、最新进展）。
  const step = (sorted.length - 1) / (cap - 1);
  const out: number[] = [];
  for (let i = 0; i < cap; i++) out.push(sorted[Math.round(i * step)]);
  return Array.from(new Set(out));
}

/** 合并结果：一条新 story 替换掉组内全部成员。 */
export interface MergedStory {
  title: string;
  importance: number;
  articleIds: number[];
  storyType: string;
  /** 观测用：这条是由哪些原始 story 并出来的 */
  mergedFrom: number[];
  /** 观测用：被文章上限截掉了几篇 */
  articlesDropped: number;
}

/**
 * 把一个合并组压成一条 story。
 * importance 取组内最大值——importance 是 LLM 生成的、仅供参考，这里只用它做排序输入，
 * 不用它做任何同一性判断（用它做守卫已实测无效，见文件头）。
 */
export function collapseGroup(
  members: DedupStory[],
  title: string,
  publishedAt: Map<number, number>,
  cap = DEFAULT_ARTICLE_CAP
): MergedStory {
  const allIds = Array.from(new Set(members.flatMap((m) => m.articleIds)));
  const picked = pickSpreadArticles(allIds, publishedAt, cap);
  return {
    title,
    importance: Math.max(...members.map((m) => m.importance ?? 0)),
    articleIds: picked,
    storyType: 'SINGLE_STORY',
    mergedFrom: members.map((m) => m.index),
    articlesDropped: allIds.length - picked.length,
  };
}
