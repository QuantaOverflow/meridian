/**
 * 主线分块（storyline）提示词：把一个大事件的若干碎片按**叙事主线**归并成 3-5 块。
 *
 * 与 storyMerge.ts 正交，别混：
 *   storyMerge   问「底层发生是不是同一个」——管去重，把重复报道合回去
 *   storyline    问「读者读起来是不是同一条主线」——管分块，把一件大事分成几个角度
 * 一场洪灾的救援报道与成因复盘**确实是同一个发生**（storyMerge 的判准原文就写着
 * "A disaster, then the rescue, then the aid, then the updated death toll — one occurrence."），
 * 但它们是两条主线。两个目标塞进一个 yes/no 会互相污染，故分开。
 *
 * 形式是实测选出来的（2026-09-03，读数见 apps/backend/prototypes/dedup-band/FINDINGS.md）：
 *   · 逐对问「是否同一段」❌ ——「同段」不是等价关系（A↔B、B↔C 同段不代表 A↔C），
 *     逐对 + 全链聚合强行要传递性，碎成 9 块且把标题逐字相同的重复对判成不同段
 *   · 一次性全局划分 ❌ —— glm-4.7-flash / qwen3-30b / llama-3.3-70b 共 9 轮，
 *     7 轮连「每个 id 恰好出现一次」都做不到，且 9 轮全部违反明写的篇数上限
 *   · **两段式**（1 次命名 + N 次独立归类）✅ —— 合法划分由构造保证（每条恰好选一个），
 *     传递性问题消失，记账负担归零。这是唯一没崩的形式。
 *
 * ⚠️ 两段 prompt 都必须保持**事件无关**：不得出现任何具体事件的角度词。写死角度既是打补丁
 * （换个事件就失效），也会让离线评估的「角度覆盖」指标自动变好——本轮就是这么被骗了一次
 * （P3 臂把参照划分的三个角度写进约束，成绩虚高，泛化改写后回落）。
 * 见 index.ts 的 storyline 端点：那里有运行时断言，指令含事件专有词即拒。
 */

export interface StorylineUnit {
  /** 该单元的成员报道标题。**真实报道标题，不要传自动生成的 story 标题** */
  articleTitles: string[];
}

export interface StorylineDef {
  name: string;
  covers: string;
}

/**
 * 第 1 步：只命名主线，不分配。
 *
 * 四条硬约束逐条都是实测加上去的（每加一条 6 轮人读，合理率变化在括号里）：
 *   互斥 + 不许 and 粘两个角度          基线，拦名字层面的融合
 *   不许按行为主体属性拆（国籍/地区/机构）  3/6 → 6/6。不加则「外国失踪者」与「澳洲失踪者」
 *                                        并存，互斥被违反
 *   **恰好一条**总述线（原为「至多一条」）  写「至多」时模型 6/6 次一条都不生成 → 讲整体
 *                                        进展的报道无处可去，散进其他线造出巨块
 *
 * 输入只给成员报道标题、不给 story 标题：story 标题是 story-validation 自动生成的，
 * 实测一个大事件里 21/21 条都是同一批通用词（两条甚至逐字相同），且与内容对不上
 * （讲失踪徒步者的那条，标题里一个字没提）。它排在最显眼位置会主导判断。
 */
export function getStorylinePlanPrompt(units: StorylineUnit[]): string {
  const n = units.reduce((s, u) => s + u.articleTitles.length, 0);
  const block = units
    .map((u, i) => `[Group ${i + 1}] (${u.articleTitles.length} reports)\n${u.articleTitles.map(t => `  - ${t}`).join('\n')}`)
    .join('\n\n');

  return `Below are ${n} news reports, nearly all from ONE news event.
A daily brief cannot spend many blocks on one event — it needs 3-5.

Propose 3-5 STORYLINES the brief should use. A storyline is one continuous piece of prose the
reader can read without feeling anything repeats. Name it by what it covers, not by the event.
Do NOT assign the reports yet.

Hard constraints:
- The storylines must be mutually exclusive. No two may cover the same material.
- Exactly ONE storyline must be a general overview of the event as a whole — its overall
  scale and progress. Reports that add nothing beyond that belong there. It is limited to
  what none of the other storylines cover, and may not restate their material.
- Every other storyline must be a specific angle: a question a reader would ask about this
  event that the overview does not answer.
- Do not join two different angles with "and" into one storyline. Two angles = two storylines.
- Do not split one angle into several storylines by an attribute of the people or places
  involved (nationality, region, organisation, age). If two storylines answer the same
  question about different subsets of actors, they are ONE storyline.

${block}

Output ONLY JSON:
{"storylines": [{"name": "<short name>", "covers": "<one clause: what belongs here>"}, ...]}`;
}

/**
 * 第 2 步：一个单元选一条主线。**没有「都不属于」这个选项**——聚类误入是上游的锅，
 * 给了这个出口后实测被当垃圾桶用，一轮扔掉 44% 的文章，而当时的指标只罚「放错筐」
 * 不罚「不放筐」，于是扔得最狠那轮读数最好看。
 *
 * 「选最具体的那条」这条规则是必需的：每篇报道都会提到事件本身，那是共同点不是区分点，
 * 不加这条时分类器拿不准就往总述线倒。
 *
 * `storylines` 传进来的顺序由调用方**按单元置换**（见 backend 的 storyline.ts）：
 * 实测存在位置偏置，总述线排在展示第 1 位时被选中的比率是排其他位的 3 倍。
 */
export function getStorylineAssignPrompt(storylines: StorylineDef[], unit: StorylineUnit): string {
  return `A daily brief covers one big news event using these storylines:

${storylines.map((s, i) => `[${i + 1}] ${s.name} — ${s.covers}`).join('\n')}

Which ONE storyline do the reports below belong to? Judge by the headlines themselves.
You must pick exactly one — answer with its number.

Pick the MOST SPECIFIC storyline that fits. Every report mentions the event itself — that is
what they all have in common, not what tells them apart. Choose a general-overview storyline
only when the reports add nothing beyond the event's overall scale or progress; if they answer
a narrower question that another storyline names, choose that one.

Reports:
${unit.articleTitles.map(t => `  - ${t}`).join('\n')}

Output ONLY JSON: {"storyline": <1-${storylines.length}>, "reason": "<one clause>"}`;
}

/**
 * 运行时断言用：指令段若出现具体事件的专有词，说明 prompt 被写死成了某个事件的补丁
 * （既不泛化，又会让离线的角度覆盖指标虚高）。命中即拒，不静默放行。
 */
export const EVENT_SPECIFIC_LEAK = /\b(nepal|tibet|glacier|glacial|flood|rescue|missing persons|casualt\w*|hurricane|earthquake|wildfire)\b/i;
