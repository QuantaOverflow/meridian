// 文章取样工具。
//
// 这个文件曾经是**去重层**：把 story-validation 从同一个簇里切出来的重复故事并回去
// （centroid 余弦 + 全链凝聚 + 两条组交 LLM 确认）。那一层随 story-validation 于 2026-09-05
// 退役，其代码于 2026-09-22 清理时删除——聚类换成不降维凝聚之后一簇 ≈ 一件事，切分层
// 不存在了，也就没有「把切碎的并回去」这件事。
//
// 删掉的那些代码里有一批实测读数，已蒸馏进 docs/knowledge/，删代码前落库：
//   lesson-llm-oversplits-single-large-event   过拆病灶（91 篇切 22 条、占 11/25 个名额）
//   measure-story-merge-threshold-094          阈值 0.94 的来历与它的失效边界（金标已丢失）
//   lesson-single-link-merge-falsified         单链 vs 全链 7 期对照 + Hassanzadeh VLDB'09
//   mechanism-spread-sampling-article-cap      下面这个函数的依据
//
// 现在只剩取样：合并后（或簇本身）篇数超上限时，按发布时间跨度均匀取。

/** 单条 story 的文章上限。见 pickSpreadArticles 的注释。 */
export const DEFAULT_ARTICLE_CAP = 30;

/**
 * 文章按**发布时间跨度均匀取样**，取到 cap 篇。
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
