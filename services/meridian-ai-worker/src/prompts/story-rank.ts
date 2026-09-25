/**
 * 故事重要性排序（story rank）提示词：一次调用从当期全部候选故事里挑出前 N 条并排序。
 *
 * ## 它取代了什么
 *
 * 排序原来是纯机械的：选材层 `importance + log2(1+源数)`（story-ranking.ts）、
 * 分档层 `篇数 × 源数`（brief-v3.ts）。两处口径还不同，而 `importance` 本身就是
 * `blockScore` 的钳位版（storyline.ts），所以源数被算了两次。
 *
 * 机械分量的是**报道热度**，不含重要性。2026-09-21 那期实测后果：一条明星加沙争议
 * 排第 4（14 篇 5 源），一条持续 40 天的地区战争威胁排第 13（10 篇 3 源），一次双边
 * 会晤排第 11。取前 25 时这个误差无害，取前 10 时它决定什么上桌。
 *
 * ## 为什么是「挑前 N + 排序」，不是「打分」也不是「全排」
 *
 * 三个形态在 2026-09-21/09-20 两期上离线对照过（同模型、同输入、各 3 轮）：
 *
 *   形态                         判据达成   三轮前 10 交集   成本/轮
 *   全部候选一次排完（listwise）    3/6        5/10          77 neurons，且 1/3 轮全废
 *   逐条四维打分（0-3 加总）        3/6        5/10         423 neurons
 *   挑前 12 + 硬约束 ★采用         6/6        8/12          44 neurons
 *
 * 全排废掉的原因：模型排完真实 id 后不停手，继续输出连续整数直到 1000，吃光 token 预算
 * （glm-4.7-flash 的复读退化，本仓第五次）。只要前 12 输出短，这条风险大降。
 *
 * 逐条打分废掉的原因不是成本，是**分数抖**：temperature 0 下同一条三轮总分 12/8/11，
 * 最大极差 5。文献上细粒度绝对量表本来就有大约一半方差来自判官噪声。排序不需要绝对分。
 *
 * ## 三条硬约束为什么在这儿而不在判据里
 *
 * 它们是代码能查的，不靠模型自觉：
 *  1. 同议题/同国家最多 2 条——**上限而不是下限**。下限（比如「至少一条科技」）在没货的
 *     日子会硬塞一条琐事；上限只会把重复的挤出去，腾出的位置由排序自己填。
 *  2. eventKey 不许重复——顺带治了聚类把一件事切成两簇的老问题（同期同时有
 *     「某武装组织导弹袭击某机场」与光秃秃的「某武装组织」）。实测模型会主动认出这对，
 *     选信息全的那条、把另一条放进落选。这一层挡住了排序层摆不平的东西。
 *  3. 禁止类型清单——两期实测 20 个该挡的簇零漏网。
 *
 * ## 判据为什么写成这样（两期离线迭代 v0→v3）
 *
 * 基线（只有四维 + 三条约束）的病：**偏好动能事件，排斥制度事件**。一场州选举（执政党
 * 失利、极右大涨，8 篇 7 源）和一次政府禁止三家主流媒体进入（22 篇 9 源）两期都被压到
 * 前 12 之外。三处修正，每处都是通用原则：
 *
 *  · v1 在「战略/政策后果」里把动能与制度两类**明确平权**，并列出制度类的三种形态
 *  · v2 把四维改成**整体权衡而非逐项 gate**——制度事件结构性地在「溢出」维拿不到分
 *    （局限一国），而动能事件天然跨境，等权加总下战略维会被淹没
 *  · v3 收窄禁止清单第 3 条：原文 `local election procedure` 太宽，可能把正经选举一起
 *    挡掉，改成「例行内部机制（计票后勤、候选人退出、党内符号争议）」并显式排除
 *    「改变执政权的选举」
 *
 * 结果：媒体禁入那条从 v0-v2 两期都进不了前 12，到 v3 在两期都进（第 10 / 第 2）。
 *
 * ⚠️ 判据必须保持**事件无关**：不得出现具体事件、国家、机构、人物的专有词。离线迭代时
 * 有一道机械闸——从三期全部标题抽出 290 个专名，prompt 指令段命中任何一个即作废。
 * 这里是常量文本，闸没法在运行时跑，**改这段文本必须重跑那道离线闸**
 * （scratchpad 的 tune/extract-propernouns.mjs 是当时的实现）。
 *
 * ⚠️ 三轮洗牌 + Borda 聚合**不是可选项**。单轮输出会自相矛盾（实测一轮里同一条既在
 * 第 1 名又在落选名单里，落选理由还引用它自己的报道量），也会偶发违反禁止清单
 * （实测一轮把一场国葬选进前 12，聚合把它挤掉了）。
 */

import type { RankCandidate } from '@meridian/contracts';

/** 数据块起始标记（指令段与候选数据的分隔）。 */
const RANK_DATA_BLOCK_MARK = '\n# Stories\n';

/** 一次要挑出多少条。12 = 分档层 lead(4) + more 前 8。 */
export const RANK_TOP_N = 12;

/** 落选名单条数。它是唯一能看见模型判据的窗口，便宜，别省。 */
const RANK_NEAR_MISS_N = 5;

export function getStoryRankPrompt(candidates: RankCandidate[]): string {
  // 渲染成 JSON 数组、缩进 2——与离线迭代逐字节相同。换成 `[id] title` 纯文本试过，
  // 同期排序立刻变形（见 @meridian/contracts 的 RankCandidate.articles 注释）。
  const list = JSON.stringify(
    candidates.map(c => ({ id: c.id, title: c.title, articles: c.articles })),
    null,
    2
  );
  return `From the news stories below, select the ${RANK_TOP_N} most important, ranked most important first.

# What importance means
Importance means PUBLIC CONSEQUENCE, judged on four dimensions:
- Strategic/policy consequence: does it shift a country's or region's policy, or the
  cross-border balance of power, or major institutions? This dimension covers two
  event types on EQUAL footing, neither outranks the other by default:
    (a) kinetic/security action -- military strikes, armed clashes, sanctions,
        embargoes, supply cutoffs;
    (b) institutional/procedural shifts -- a vote or election result that changes
        who holds governing power, a change in top national leadership, or a
        government formally restricting who -- including which press outlets --
        may access official institutions or proceedings.
  Do not discount a story just because nothing was fired, struck, or blocked
  physically -- a change in who governs, or a formal restriction on institutional
  access, can carry the same policy consequence as a military or economic action.
- Spillover/systemic reach: is it confined to where it happened, or does it reach
  multiple countries, alliances, trade, refugees, energy or financial chokepoints?
- Human/scale impact: how many people are affected; casualty or humanitarian scale.
- Today's development: does this carry a substantive new development today, or is it
  only repeated coverage of an already-known situation? A long-running situation with
  a real new development today ranks HIGH on this dimension; a story new to the news
  cycle but carrying no substantive development ranks LOW.

These four dimensions are weighed together as a whole, not each required as a pass/
fail gate. A story with a large enough Strategic/policy consequence can rank at the
top even when its Spillover/systemic reach stays inside one country -- a shift in who
governs, or a formal restriction a government places on institutional access, does
not need to also cross a border to count as highly important; judge how large the
shift itself is, not how many borders it crossed.

Judge on a global scale. Do NOT weight by any single country's national interest --
this means: do not rank a story higher just because it involves a particular country
you might consider important, and do not rank a story lower just because the country
involved is small. Weigh it by consequence, not by whose country it is.
Importance is NOT drama, NOT volume of coverage, NOT controversy, NOT celebrity
involvement.

# Hard constraints on your selection
1. At most 2 of the ${RANK_TOP_N} may concern the same ongoing issue, and at most 2 may be from
   the same country.
2. No two of the ${RANK_TOP_N} may report the SAME event. Give each selected story an eventKey:
   a short lowercase slug naming the single underlying event (e.g. "capital-city-
   transit-strike"). Two stories about the same event must not both appear.
3. The following NEVER belong in the ${RANK_TOP_N}, however widely covered: sports results,
   celebrity health or gossip, film, television, or entertainment awards, ceremonial
   occasions (state funerals, award ceremonies, inaugurations), and the routine
   internal mechanics of a local or lower-house election or bypoll (vote-counting
   logistics, candidate withdrawals, internal party symbol disputes). This exclusion
   does NOT cover a vote or election whose result changes who holds governing power --
   that is a policy-consequence event under the dimension above, not a procedural one.

# Also report your near-misses
Then list exactly ${RANK_NEAR_MISS_N} stories that came close but did not make it, each with one short
sentence saying why it lost out.

# Output
Output ONLY JSON, no prose before or after:
{"selected":[{"id":0,"eventKey":"...","category":"...","why":"..."}],
 "nearMisses":[{"id":0,"why":"..."}]}
\`category\` is one of: geopolitics-security, economy-finance, technology, society-other.
${RANK_DATA_BLOCK_MARK}${list}
`;
}
