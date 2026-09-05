/**
 * 「一簇 → 一个 story」判官的**纯逻辑**（无 I/O、无终端代码）。验完可整块搬进 ai-worker。
 *
 * ## 这个原型在回答什么
 *
 * 聚类换成不降维凝聚之后，一簇 ≈ 一件事（F2 纯度 0.804），但还剩两个残渣：
 * 15-18% 的簇是「只有题材没有事」的题材袋，交付簇里还有约 20% 的文章不属于主事件。
 * 设想是把这两件事一起交给写 story 的那次 LLM 调用顺手做掉：
 *
 *   问它：这簇讲的是不是同一件事？是 → 给事件名 + 指出哪几篇不属于；否 → 判 NO_EVENT
 *
 * **不传正文**，只传已有的结构化字段（标题 / 事件要点 / 关键实体 / 地点）——这是本原型
 * 要验的第二件事：这些字段够不够判。
 *
 * 两个已知风险（都是本仓库踩过的），所以判决分三档而不是二档：
 *   · 让 LLM 拒绝整簇 = 簇级硬门的 LLM 版，全有全无。零 LLM 的硬门就这么把 8 篇 NASA
 *     望远镜簇、11 篇阿富汗驱逐簇整个抹掉过 → 所以要能区分 NO_EVENT 与「拿不准」。
 *   · 篇级排除是安全的（每篇一个是非题），让它划分整簇是已证伪的（91 篇 12 轮只 1 轮对）
 *     → 所以只问「哪几篇不属于」，不问「这簇该切成几块」。
 */

export interface ArticleFields {
  id: number;
  title: string;
  primary_location?: string;
  event_summary_points?: string[];
  key_entities?: string[];
  thematic_keywords?: string[];
}

/** 喂给判官的字段档位。titles = 最省；rich = 加事件要点与实体。 */
export type FieldMode = 'titles' | 'rich';

export function renderArticle(a: ArticleFields, mode: FieldMode): string {
  if (mode === 'titles') return `[${a.id}] ${a.title}`;
  const bits = [`[${a.id}] ${a.title}`];
  if (a.primary_location) bits.push(`  地点：${a.primary_location}`);
  if (a.event_summary_points?.length) bits.push(`  要点：${a.event_summary_points.slice(0, 4).join('；')}`);
  if (a.key_entities?.length) bits.push(`  实体：${a.key_entities.slice(0, 6).join('、')}`);
  return bits.join('\n');
}

function promptBase(articles: ArticleFields[], mode: FieldMode): string {
  return `你在给一份新闻简报做选题。下面是聚类算法归到一组的若干篇报道（只给标题与结构化字段，没有正文）。

判断这一组是不是在讲**同一件具体发生的事**（same happening），而不是同一个题材下的若干件不相干的事。

${CRITERIA_BASE}

输出 JSON，不要任何其他文字：
{
  "verdict": "EVENT" | "NO_EVENT" | "UNSURE",
  "event": "一句话说这件事是什么（NO_EVENT 时留空）",
  "excluded_ids": [不属于这件事的文章 id，没有就给空数组],
  "reason": "一句话理由"
}

说明：
- verdict=EVENT 表示这组确实是一件事（允许有个别混进来的篇，放进 excluded_ids）
- verdict=NO_EVENT 表示这组只是同题材的一堆不同的事，整组不该成为简报里的一条
- 信息不足以判断时给 UNSURE，不要硬猜
- excluded_ids 只放**确定**不属于这件事的，宁可少放

报道：
${articles.map(a => renderArticle(a, mode)).join('\n')}`;
}

const CRITERIA_BASE = `判据：
- 同一件事：同一时间地点发生的同一个事件及其直接组成部分/直接后续（伤亡更新、救援、官方处置、当事方正式回应都算）
- 不是同一件事：只共享题材、地域、人物或赛事名（例：两场不同的枪击案；同一项赛事下的不同比赛；同一个国家的不同社会新闻）
- 就事件本身写的分析、评论、机制解读，算同一件事`;

/** 变体名。base = 基线（勿改，要能随时跑回来）。 */
export type Variant = 'base' | 'v1' | 'v2' | 'v3';

const OUTPUT_SPEC = `输出 JSON，不要任何其他文字：
{
  "verdict": "EVENT" | "NO_EVENT" | "UNSURE",
  "event": "一句话说这件事是什么（NO_EVENT 时留空）",
  "excluded_ids": [不属于这件事的文章 id，没有就给空数组],
  "reason": "一句话理由"
}

说明：
- verdict=EVENT 表示这组确实是一件事（允许有个别混进来的篇，放进 excluded_ids）
- verdict=NO_EVENT 表示这组只是同题材的一堆不同的事，整组不该成为简报里的一条
- 信息不足以判断时给 UNSURE，不要硬猜
- excluded_ids 只放**确定**不属于这件事的，宁可少放`;

/** v1：只放宽「什么算同一件事」的正向判据（写定义、不写案例）；反向判据与 base 逐字相同。 */
const CRITERIA_V1 = `判据 —— 什么叫「同一件具体发生的事」（一个 happening）：
一个 happening 由「时间 + 地点 + 参与者 + 动作」共同确定：同一批参与者在同一段时间、同一地点，发生的同一个动作或同一场变故。只要这些报道指向的是同一个 happening，就都算同一件事，这包括它的各种延展：
- 它的组成部分与后续进展：处置、救援、调查、伤亡与损失的更新、善后、追责
- 它的不同侧面：不同参与者、不同受影响群体各自的处境，不同地点受到的连带影响与波及
- 它的不同阶段：起因、经过、结果。同一个 happening 的先后阶段性质可以完全相反，仍是同一件事，不要因为两篇讲的阶段不同就当成两件事
- 各方针对它作出的回应、反驳、追问、辩护，以及由此直接引发的交锋
- 针对它本身写的分析、评论、背景与解读
- 一个人去世同样是一个 happening：讣告、生平与作品回顾、悼念、各界反应、影响评价，都属于这同一件事

不是同一件事：这些报道指向的是各自独立的不同 happening——
- 只共享题材、地域、人物或赛事名（例：两场不同的枪击案；同一项赛事下的不同比赛；同一个国家的不同社会新闻）`;

/** v2 = v1 + 「续报中数字与细节会被修正，不构成矛盾」一条（只讲机制，不举具体数字）。 */
const ROLLING_NUMBERS = `

注意：随着报道推进，同一个 happening 的伤亡人数、损失规模与事实细节会被不断修正和更新，各家媒体侧重的细节与采访对象也各不相同。先后两篇给出的数字对不上，是续报的常态，属于同一件事的特征而不是反证。判断依据是时间、地点、参与者、动作是否指向同一个 happening，不是各篇的数字与细节是否逐一吻合。`;

/** v3 备选 a：强化反向判据——共享参与者 ≠ 同一个 happening（纯定义，无案例）。 */
const SUBJECT_GUARD = `

反向同样要卡住：**共享参与者不等于同一个 happening**。同一个人、同一家公司、同一个机构、同一项议题底下，各自独立发生的动作是不同的事——动作本身不同、发生的时间地点不同、彼此既不是对方的组成部分也不是对方的直接后续，那么哪怕话题高度相关、甚至互为因果，仍是两件事。
自检：用一句话说出「谁、在何时何地、做了或发生了什么」。如果必须用两句互不包含的话才说得清这一组的核心，就是两件事。`;

/** v3 备选 b：代价不对称，拿不准偏 EVENT。 */
const ASYMMETRIC_COST = `

权衡：两个方向的代价不对称。真事件被判成 NO_EVENT，这条新闻读者就永远看不到了；题材袋没判出来，只是简报里多一条含混的。所以按上述判据衡量后仍拿不准的，倾向给 EVENT，不要给 NO_EVENT。`;

void SUBJECT_GUARD;

/** v2 = base 判据逐字不动，只补「同一件事」的外延条款（侧面/阶段/连带影响/回应/讣告/续报数字）。 */
const WIDEN = `

「同一件事」的外延按下面这样理解，不要读得过窄：
- 同一件事的不同侧面算同一件事：不同受影响群体各自的处境、不同当事方各自的遭遇、不同地点受到的连带影响与波及
- 同一件事的不同阶段算同一件事：起因、经过、结果，先后阶段的性质可以完全相反，仍属同一件事
- 围绕这件事的各方回应、反驳、追问、辩护，以及由此直接引发的交锋，算同一件事
- 一个人去世本身就是一件事：讣告、生平与作品回顾、悼念、各界反应、影响评价，都属于这一件事
- 续报中伤亡人数、损失规模与事实细节会被不断修正，先后两篇的数字对不上是续报的常态，属于同一件事的特征而不是反证`;

function promptWith(articles: ArticleFields[], mode: FieldMode, criteria: string): string {
  return `你在给一份新闻简报做选题。下面是聚类算法归到一组的若干篇报道（只给标题与结构化字段，没有正文）。

判断这一组是不是在讲**同一件具体发生的事**（same happening），而不是同一个题材下的若干件不相干的事。

${criteria}

${OUTPUT_SPEC}

报道：
${articles.map(a => renderArticle(a, mode)).join('\n')}`;
}

export function buildPrompt(
  articles: ArticleFields[],
  mode: FieldMode,
  variant: Variant = (process.env.VARIANT as Variant) || 'base'
): string {
  switch (variant) {
    case 'v1':
      return promptWith(articles, mode, CRITERIA_V1);
    case 'v2':
      return promptWith(articles, mode, CRITERIA_BASE + WIDEN);
    case 'v3':
      return promptWith(articles, mode, CRITERIA_BASE + WIDEN + ASYMMETRIC_COST);
    default:
      return promptBase(articles, mode);
  }
}

export interface JudgeOutput {
  verdict: 'EVENT' | 'NO_EVENT' | 'UNSURE';
  event: string;
  excluded_ids: number[];
  reason: string;
}

/** 解析。解析不出来不静默降级成某个安全默认值，返回 null 让调用方当失败处理。 */
export function parseJudge(content: string): JudgeOutput | null {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let raw: any;
  try {
    raw = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const v = String(raw.verdict ?? '').toUpperCase();
  if (v !== 'EVENT' && v !== 'NO_EVENT' && v !== 'UNSURE') return null;
  return {
    verdict: v,
    event: String(raw.event ?? ''),
    excluded_ids: Array.isArray(raw.excluded_ids) ? raw.excluded_ids.map(Number).filter(Number.isFinite) : [],
    reason: String(raw.reason ?? ''),
  };
}

// ── 与金标比对 ────────────────────────────────────────────────────────────────

export interface ClusterTruth {
  clusterId: number;
  articleIds: number[];
  /** 该簇命中最多的金标事件（宽松口径：members + related），命中 <2 篇则为 null = 题材袋 */
  dominantEvent: string | null;
  /** 金标口径下不属于主事件的文章 */
  impureIds: number[];
}

export interface Scored {
  clusterId: number;
  mode: FieldMode;
  truthIsPocket: boolean;
  out: JudgeOutput | null;
  /** 题材袋判定是否正确 */
  pocketCorrect: boolean;
  /** 篇级排除：命中的杂质数 / 误排的真成员数 */
  excludedHit: number;
  excludedMiss: number;
  excludedFalse: number;
}

export function scoreOne(truth: ClusterTruth, out: JudgeOutput | null, mode: FieldMode): Scored {
  const isPocket = truth.dominantEvent === null;
  const said = out?.verdict;
  const pocketCorrect = out === null ? false : isPocket ? said === 'NO_EVENT' : said === 'EVENT';
  const impure = new Set(truth.impureIds);
  const excluded = new Set(out?.excluded_ids ?? []);
  let hit = 0;
  let falsePos = 0;
  for (const id of excluded) (impure.has(id) ? (hit++) : (falsePos++));
  return {
    clusterId: truth.clusterId,
    mode,
    truthIsPocket: isPocket,
    out,
    pocketCorrect,
    excludedHit: hit,
    excludedMiss: impure.size - hit,
    excludedFalse: falsePos,
  };
}

export function aggregate(rows: Scored[]) {
  const pockets = rows.filter(r => r.truthIsPocket);
  const events = rows.filter(r => !r.truthIsPocket);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const hit = sum(rows.map(r => r.excludedHit));
  const miss = sum(rows.map(r => r.excludedMiss));
  const fp = sum(rows.map(r => r.excludedFalse));
  return {
    n: rows.length,
    parseFail: rows.filter(r => r.out === null).length,
    unsure: rows.filter(r => r.out?.verdict === 'UNSURE').length,
    pocketRecall: pockets.length ? pockets.filter(r => r.pocketCorrect).length / pockets.length : NaN,
    eventKept: events.length ? events.filter(r => r.pocketCorrect).length / events.length : NaN,
    excludedPrecision: hit + fp ? hit / (hit + fp) : NaN,
    excludedRecall: hit + miss ? hit / (hit + miss) : NaN,
    excludedHit: hit,
    excludedMiss: miss,
    excludedFalse: fp,
  };
}
