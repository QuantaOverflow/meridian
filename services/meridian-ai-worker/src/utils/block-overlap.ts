/**
 * 块间内容重复传感器（确定性，零 LLM）。**只报不改。**
 *
 * 分段写（b′）把一份简报拆成 25 次独立调用，没有跨块仲裁者。写作 prompt 把同节其他块的
 * executiveSummary 全文铺进去、附一句「别复述」，模型把「别写这些」读成了「写这些」——
 * 2026-08-31 实测：report 78 的块「himalayan glacial collapse kills over 900 in nepal」
 * 整段在写块「evacuation of students from flooded nepalese schools」的内容（同一所学校、
 * 同一个校长、同样的 69 所学校 / 两辆巴士）。这类重复现有传感器一个都看不见：
 * `checkBlockConsistency` 只比数值冲突，`checkBriefHygiene` 只看标点与结构。
 *
 * ## 判据：块内文档频率（df）自校准，不用专名词表
 *
 * 简报 prompt 明写 "use lowercase by default"，正文全小写 —— 靠大小写识别专名这条路是死的。
 * 改用「这个词出现在本篇几个块里」：`nepal`/`flood` 会散布在十几个块（df 高，是话题词，
 * 共享属正常），`tribhuvan`/`dawadi`/`1,643` 只可能属于一个块（df 低，是具体细节，
 * 共享即可疑）。df 在**每篇简报内部**重算，换一天不用改词表——这是它比固定词表强的地方
 * （`checkBlockConsistency` 的 PLACES 词表就吃过换天会漂的亏）。
 *
 * 两路信号互补：
 *   S1 稀有词共享  抓「改写着抄」——换了措辞，但专名/数字带不走
 *   S2 长 n-gram   抓「逐字抄」——如 "two buses as remnants of the property"
 * 任一路超阈即报。两路都给绝对量和归一量，因为短块（RARR 误删后只剩一两句）
 * 会让归一量虚高，只看比率会误报。
 *
 * ## 阈值来历（2026-08-31，report 76/77/78 三期 900 对，见 scripts/eval/block-overlap/）
 *
 *   cont   对                                              判定依据
 *   0.52   78[5,6] 冰川崩塌 ↔ 学校疏散                     人工核实：整段照抄
 *   0.48   77[17,22] 泽连斯基无人机 ↔ CIA 局长访莫斯科     未人工核实
 *   0.40   78[9,10] Modi 乌兹别克 ↔ Modi-普京会晤          交接文档已判重复
 *   0.30   76[11,12] 对伊六个月僵局 ↔ 对伊六个月军事行动   标题几乎同名
 *   0.26   78[4,10] 俄中伊聚首 ↔ Modi-普京（**跨节**）     同一场 SCO 峰会
 *   0.23   78[1,2] 石油协议 ↔ 专家质疑可行性               人工核实：块 2 无新信息
 *   0.19   78[7,8] 加拿大贸易战两块                        交接文档判为**不重复**
 *
 * 已知阴性落在 0.19，已知/疑似阳性从 0.22 起 → 阈值取 0.22。**n=3 期，且只有两条
 * （0.52 与 0.19）是人工逐句核实过的**，其余是读标题+共享词判的，别当成验过的精度。
 *
 * ⚠️ 已知局限：
 *   · 同节两块讲同一事件的不同侧面，本来就共享专名 —— 本传感器**不区分**「该共享」与
 *     「照抄」，它测的是重合度，判不了正当性。所以是传感器不是门。
 *   · 只看正文字面。两块用完全不同的措辞讲同一件事（无共享专名）抓不到。
 *   · report 76 的尼泊尔 11 块两两只有 0.18-0.22：切得越碎，单对重合越像"正常"。
 *     **本传感器只测块对，不测「一个事件占了几块」**，后者要看情报名额（去重层的活）。
 */

import { splitBriefBlocks, type Block } from './block-consistency';

export interface BlockPairOverlap {
  a: number;
  b: number;
  titleA: string;
  titleB: string;
  /** 两块是否属于同一个 `## ` 节 */
  sameSection: boolean;
  /** 共享的稀有词（df ≤ rareDfMax），按稀有度排序。给人读的证据，不是打分依据 */
  sharedRare: string[];
  /**
   * 打分依据：idf 加权的共享词质量 / min(两块各自的 idf 质量)。
   * 不用「稀有词个数 / 稀有词总数」是因为硬截断有悬崖——一个事件被切成 11 块时，
   * `trishuli` 在其中 5 块出现，df=5 就跌出"稀有"，于是**切得越碎越看不见**，
   * 正好在最该报警的情况下失明（report 76 的 11 块尼泊尔实测到这个坑）。
   * idf 连续衰减没有这个断点。
   */
  containment: number;
  /** 共享的长 n-gram（原文词序），逐字抄的直接证据 */
  sharedNgrams: string[];
}

export interface OverlapOptions {
  /** 词出现在 ≤ 这么多个块里才算「稀有」。25 块的简报上取 3 */
  rareDfMax?: number;
  /** n-gram 长度。取 6：短于 5 会撞上通用套话，长于 7 抓不到改一个词的抄 */
  ngram?: number;
  /** 报出门槛：共享稀有词绝对数 */
  minSharedRare?: number;
  /** 报出门槛：containment */
  minContainment?: number;
  /** 报出门槛：共享 n-gram 数（任一路超阈即报） */
  minSharedNgrams?: number;
}

// 功能词 + 简报体裁高频套话。不进稀有词候选。
const STOP = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'had', 'was', 'were',
  'been', 'being', 'are', 'its', 'their', 'they', 'them', 'these', 'those', 'than', 'then',
  'but', 'not', 'all', 'any', 'both', 'each', 'more', 'most', 'other', 'some', 'such', 'only',
  'own', 'same', 'too', 'very', 'can', 'will', 'just', 'also', 'into', 'over', 'under', 'after',
  'before', 'while', 'where', 'when', 'which', 'who', 'whom', 'whose', 'what', 'how', 'why',
  'about', 'against', 'between', 'through', 'during', 'above', 'below', 'again', 'further',
  'once', 'here', 'there', 'would', 'could', 'should', 'may', 'might', 'must', 'said', 'says',
  'according', 'articles', 'reports', 'reported', 'remains', 'remain', 'amid', 'amidst',
]);

/** 切词：全小写、保留数字里的逗号与点、剥掉首尾标点。长度 ≥3 或含数字才留。 */
function tokenize(text: string): string[] {
  const flat = text
    .replace(/\*+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    // 先摘掉音标再滤字符。不做的话 `nicolás` 会在 á 处断成 `nicol`，`rodríguez` 断成
    // `rodr`+`guez`——碎片各自 df=1，反而被当成"稀有词"计入重合，把分数灌虚。
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s'’\-.,]/g, ' ');
  const out: string[] = [];
  for (const raw of flat.split(/\s+/)) {
    const t = raw.replace(/^[\-'’.,]+/, '').replace(/[\-'’.,]+$/, '');
    if (!t) continue;
    if (t.length >= 3 || /\d/.test(t)) out.push(t);
  }
  return out;
}

function ngramsOf(tokens: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) out.add(tokens.slice(i, i + n).join(' '));
  return out;
}

/**
 * 给全部块两两打分。**不过滤**——阈值由调用方定，校准脚本要看完整分布。
 * 返回按 containment 降序。
 */
export function scoreBlockPairs(brief: string, opts: OverlapOptions = {}): BlockPairOverlap[] {
  const rareDfMax = opts.rareDfMax ?? 3;
  const n = opts.ngram ?? 6;
  const blocks: Block[] = splitBriefBlocks(brief);

  const tokens = blocks.map((b) => tokenize(b.text));
  const grams = tokens.map((t) => ngramsOf(t, n));
  const sets = tokens.map((t) => new Set(t.filter((w) => !STOP.has(w))));

  // df：一个词出现在几个块里（按块计一次，不按出现次数）
  const df = new Map<string, number>();
  for (const s of sets) for (const w of s) df.set(w, (df.get(w) ?? 0) + 1);

  const rare = sets.map((s) => new Set([...s].filter((w) => (df.get(w) ?? 0) <= rareDfMax)));
  // idf：df=1 权重最大，df=N（每块都有）权重 0。log 底无所谓，只用来排序与归一。
  const N = blocks.length;
  const idf = (w: string) => Math.log(N / Math.max(1, df.get(w) ?? N));
  const mass = sets.map((s) => [...s].reduce((t, w) => t + idf(w), 0));
  // 分母地板：min 归一对短块极不公平——RARR 误删后只剩一两句的残块（report 76 的块 9
  // 只剩 149 字符）质量极小，随便撞上一两个词就冲到 30%+ 霸榜。按本篇块质量中位数的
  // 四分之一设地板，等于声明「不足这个体量的块不当一整块看」。
  const sortedMass = [...mass].sort((x, y) => x - y);
  const medianMass = sortedMass[Math.floor(sortedMass.length / 2)] ?? 0;
  const massFloor = medianMass * 0.25;

  const out: BlockPairOverlap[] = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const sharedAll = [...sets[i]].filter((w) => sets[j].has(w));
      const sharedG = [...grams[i]].filter((g) => grams[j].has(g));
      if (!sharedAll.length && !sharedG.length) continue;
      const sharedMass = sharedAll.reduce((t, w) => t + idf(w), 0);
      const denom = Math.max(1e-9, massFloor, Math.min(mass[i], mass[j]));
      out.push({
        a: i,
        b: j,
        titleA: blocks[i].title,
        titleB: blocks[j].title,
        sameSection: blocks[i].section === blocks[j].section,
        // 只给人读：越稀有排越前，先看最像铁证的
        sharedRare: sharedAll.filter((w) => rare[i].has(w) && rare[j].has(w))
          .sort((x, y) => (df.get(x) ?? 0) - (df.get(y) ?? 0)),
        containment: sharedMass / denom,
        sharedNgrams: sharedG,
      });
    }
  }
  return out.sort((p, q) => q.containment - p.containment);
}

/** 传感器口径：超阈的块对。阈值默认值见文件头的校准说明。 */
export function checkBlockOverlap(brief: string, opts: OverlapOptions = {}): BlockPairOverlap[] {
  const minRare = opts.minSharedRare ?? 6;
  const minCont = opts.minContainment ?? 0.22;
  const minGrams = opts.minSharedNgrams ?? 2;
  return scoreBlockPairs(brief, opts).filter(
    (p) => (p.sharedRare.length >= minRare && p.containment >= minCont) || p.sharedNgrams.length >= minGrams
  );
}
