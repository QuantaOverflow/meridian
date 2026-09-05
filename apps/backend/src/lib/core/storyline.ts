// 块的命名与打分辅助。**主线分块层已于 2026-09-05 删除**——聚类换成不降维凝聚
// （余弦阈值 0.10、最小 3 篇成簇）之后一簇 ≈ 一件事（两窗人读全覆盖金标实测簇纯度
// 0.864/0.913、题材袋率 0.072/0.000），切分的必要性消失，改由 ai-worker 的
// `/meridian/cluster/judge` 一簇一次判定 + 起名。
//
// 被删掉那层的实测负结果保留在 ../../docs/engineering-notes/prototype-findings-dedup-storyline.md，别重跑：
//  · 让模型一次吐出「主线 + 每篇归属」：91 篇上 12 轮只有 1 轮把 id 分对
//  · 逐篇归类给「都不属于」出口：纯簇上扔掉 25.3%，其中真该扔的只有 2 篇（精度 8.7%）
//  · 主线命名限 3-5 条：杂物袋簇被迫硬合，跨事件同组 23-27 对
//
// 本文件现在只剩三样活的：块的事件键（dominantEntity）、同事件配额上限、显著性打分。

// ⚠️ 同一把尺在**簇级完全分不开**，别拿它判断一个簇是不是垃圾袋：真事件大簇（伊朗 0.39、
// 俄乌 0.33）和纯垃圾袋（0.09/0.13/0.16）混在一起——大事件的簇本来就含多条角度、用词发散。
// ============================================================================

/** 大写开头但不是专有名词的常见词。小而克制：宁可留噪声，也不要维护一张会过期的词表。 */
const CAP_STOPWORDS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'And', 'But', 'For', 'Not', 'How', 'Why', 'What',
  'When', 'Where', 'Who', 'After', 'Before', 'From', 'With', 'Into', 'Over', 'New', 'More',
  'Two', 'One', 'Three', 'His', 'Her', 'Its', 'Their', 'Watch', 'Video', 'Photos', 'Live',
  'Scientists', 'Researchers', 'Man', 'Woman', 'People', 'Former', 'First', 'Can', 'Could', 'Will',
]);

/**
 * 标题里的专有名词候选。
 *
 * ⚠️ 连字符**不能**进字符类：否则 `Nepal-Tibet` / `China-Nepal` 各算一个独立名字，同一个
 * Nepal 被拆成三个，真事件块的共享比例被系统性压低（实测尼泊尔主块 0.85 被压到 0.54，
 * 差点让这把尺看起来分不开）。分子按**词**统计，不按连字符短语。
 */
function extractCapWords(title: string): string[] {
  const out: string[] = [];
  for (const m of title.matchAll(/\b[A-Z][A-Za-z’']{2,}\b/g)) {
    // 去所有格：Nepal's / Nepal’s → Nepal，否则同一个国家被拆成两个名字
    const w = m[0].replace(/[’']s$/i, '');
    if (w.length >= 3 && !CAP_STOPWORDS.has(w)) out.push(w);
  }
  return out;
}

/**
 * 词形归并表：把 Russian → Russia、Nepali → Nepal、Iranian → Iran 收到同一个键上。
 * 判据是「更短的那个是更长那个的前缀，且长度 ≥5」——不引入词干算法，够用且可预测。
 * （代价：China 不是 Chinese 的前缀，这一对合不了。接受。）
 */
function canonicalMap(words: Iterable<string>): Map<string, string> {
  const all = [...new Set(words)].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const map = new Map<string, string>();
  for (const w of all) {
    let base = w;
    for (const s of all) {
      if (s.length >= 5 && s.length < w.length && w.startsWith(s)) { base = map.get(s) ?? s; break; }
    }
    map.set(w, base);
  }
  return map;
}

/**
 * 标题里的**连续大写短语**（`Hong Kong` / `Sri Lanka` / `Imran Khan`）。
 *
 * 只用于给块起名，**不用于统计**：`entityShare` 与分组仍按单词，那条路验过（生产 35/35 块
 * 全 ≥0.50，误杀 0），不动。而按词取出来的名字当标题会残缺——实测把 `Hong Kong` 显示成
 * `Hong`、`China` 与 `Chinese` 分成两块。
 */
function extractCapPhrases(title: string): string[] {
  const out: string[] = [];
  for (const m of title.matchAll(/\b[A-Z][A-Za-z’']{2,}(?:[ -][A-Z][A-Za-z’']{2,})*\b/g)) {
    // 掐掉句首的大写停用词（`Why Australia's` → `Australia`）与所有格尾巴（`Europe's` → `Europe`）：
    // 两者都不是名字的一部分，留着会让块名读起来像半句话。
    let words = m[0].split(/[ -]/);
    while (words.length > 1 && CAP_STOPWORDS.has(words[0])) words = words.slice(1);
    const ph = words.join(' ').replace(/[’']s$/i, '');
    if (ph.length >= 3 && !CAP_STOPWORDS.has(ph)) out.push(ph);
  }
  return out;
}

/**
 * 一批标题里覆盖率最高的那个专有名词。**跨簇的「事件键」用它**。
 *
 * 判定是按簇独立跑的——一次只看一个簇，不知道别的簇存在。所以聚类把同一个事件分到两个簇时，
 * 两边各自判定、各自起名，谁也不知道对方存在（2026-09-04 实测尼泊尔洪灾在前 25 格里占了
 * 7 格）。故在出块之后按这个键做同事件配额收口。
 *
 * 并列取字典序最小的，保证工作流重放得到同一个键。
 */
export function dominantEntity(titles: string[]): string {
  const perTitle = titles.map(extractCapWords);
  const canon = canonicalMap(perTitle.flat());
  const tally = new Map<string, number>();
  for (const ws of perTitle) {
    for (const w of new Set(ws.map(x => canon.get(x) ?? x))) tally.set(w, (tally.get(w) ?? 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [k, n] of [...tally.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (n > bestN) { bestN = n; best = k; }
  }
  return best;
}

/**
 * 同一事件最多占简报几格。
 *
 * 4 是验收目标 ①「一件大事不刷屏」定的线。2026-09-04 实测：主线切细后尼泊尔洪灾占了 7 格
 * （簇 55 五格 + 簇 54 两格），超线。
 */
export const PER_EVENT_BLOCK_CAP = 4;

/**
 * 块的显著性分。**纯公式、零 LLM**，取代 story-validation 的 LLM importance(1-10)。
 *
 * ⚠️ 这是一次**有代价的降级，不是等价替换**。选择层原来的排序是
 * `importance + log2(1+源数)`，NDCG@10 = 0.958（silver gold，5 run，偏乐观）；历史对照里
 * 「纯 importance 无覆盖度」是 0.872，而**纯公式这一档从未被测过**，rubric 贡献 +0.068、
 * 覆盖度只贡献 +0.018 —— 大头正是被删掉的那个。
 *
 * 2026-09-02 那期实测的具体换人（零 LLM 重排真数据）：
 *   挤进前 15：航母停靠泰国(9源16篇)、图派克案宣判(7源15篇)、梅西退役(6源15篇)、
 *              时代广场刺伤(7源8篇)、Trump 要求苹果改湖名(6源10篇)
 *   被挤出去：刚果埃博拉死亡超 3000(3源4篇)、习近平访埃及(3源5篇)、上合峰会(4源6篇)
 * 机制：**广泛报道 ≠ 重要**。接受这个降级是明确决定，不是没看见。
 *
 * 公式取对数是为了边际递减（第 2 个独立源比第 6 个信息量大）；源数权重是篇数的 2 倍，
 * 因为独立源数是文献里更强的客观显著性信号（GDELT breaking-news 检测同源）。
 */
export function blockScore(distinctSources: number, articleCount: number): number {
  return Math.log2(1 + Math.max(0, distinctSources)) + 0.5 * Math.log2(1 + Math.max(0, articleCount));
}

/**
 * 落库用的 importance(1-10)。**排序不要用它**——排序用 blockScore 原值，这里的取整与钳位
 * 会把区分度磨掉。存在的唯一理由是下游已有消费者：前端 storyThreads 用
 * `latest_importance > mean_importance` 判线索升温、用 `ORDER BY importance` 选代表 story，
 * 写 null 会让升温标记全灭、排序退化成随机序。
 *
 * 语义已从「LLM 判断的重要性」变成「客观显著性」，跨期口径一致，故升温判断仍成立。
 */
export function blockImportance(distinctSources: number, articleCount: number): number {
  return Math.min(10, Math.max(1, Math.round(blockScore(distinctSources, articleCount) * 1.8)));
}
