/**
 * 故事验证提示词（两段式：判官 + 复核）
 *
 * 2026-08-21 架构替换。此前是单段式 `getStoryValidationPrompt`：把整簇丢给模型，让它自己回答
 * single_story / collection_of_stories / pure_noise 并划出所有子故事。
 *
 * 那个形态有个结构性缺陷：`outliers` 数组**只存在于 single_story 分支**，
 * collection_of_stories 没有任何合法位置安放「不属于任何故事」的成员。模型只剩三条路，全错：
 * 硬配对 / 整簇丢弃 / 默默不提（2026-08-18 生产实测 352/967 篇进簇文章走的是「默默不提」）。
 * kimi-k2.6 的思维链原文点破过这一点：
 *   "This implies that for collection_of_stories, you may NOT exclude articles... Thus pure_noise is correct."
 *
 * 现在改成：几何先出候选组（backend 的 lib/core/candidate-grouping.ts，全链 cos≥0.90），
 * 模型只做两件小事——
 *   1) 判官 getStoryJudgePrompt：在一个候选组里找出所有 ≥2 篇报道同一发生的子集（可为空）
 *   2) 复核 getStoryVerifyPrompt：对判官确认的每个故事做一次严格二审（confirm/split/trim）
 *
 * 实测（人工严口径，scripts/eval/story-validation/rubric.md，08-18 与 08-20 两天独立复验）：
 *   生产原形态 41.7% → 本形态 89-92%；进简报的前 15 条精度 93.3%（两天相同）。
 */

/**
 * 标题规范。与旧 prompt 逐字相同（旧版标题为
 * `# Title guidelines (for single_story / collection_of_stories)`，此处去掉括号内的分支名——
 * 新形态没有这两个分支。原型实测该括号占 9 个 token，去掉后与原型 prompt 逐字节一致）。
 */
const TITLE_SEC = `# Title guidelines
- Factual, descriptive, neutral.
- Name the ONE concrete event ("Syria — Damascus car bomb explosion"),
  not the umbrella ("Middle East — multiple developments").
- A region prefix is fine ("Spain — Shakira acquitted in tax case") as long
  as what follows the dash is one event.
- No editorialization.`

/** 重要性打分 rubric。与旧 prompt 逐字相同——换架构不动打分口径，便于与历史 importance 可比。 */
const SCORING_SEC = `# Importance scoring (rubric + reasoning)
Score each story (the single_story, or EACH sub-story) on FOUR dimensions of
PUBLIC CONSEQUENCE, each an integer 0-3 — how much the event matters by its
consequence to society / states / economy / human welfare, NOT by drama,
coverage volume, or casualties alone.

For EACH dimension: FIRST write a short "why" (which anchor it matches + the key
fact), THEN the integer score. Use the FULL 0-3 range. Do NOT default to 2 — real
events usually score DIFFERENTLY across the four dimensions, and 0 and 3 are
common. A local crime, a single-city election, or a product launch will have
several 0s.

- d1 Strategic/policy consequence: 0 none, isolated · 1 local/tactical, no shift ·
  2 materially shifts one country/region's situation or policy · 3 shifts
  cross-border power balance or major institutions (war trajectory, ceasefire,
  regime change, landmark legislation/treaty, alliance realignment)
- d2 Spillover/systemic reach: 0 confined to where it happened · 1 one neighbor ·
  2 multiple countries / alliances, sanctions, trade, refugees, regional stability
  · 3 a global system (energy/financial chokepoint, nuclear threshold, global
  trade order, great-power direct involvement)
- d3 Human/scale impact: 0 minimal · 1 limited group or single-digit casualties ·
  2 nation-scale population / dozens-to-hundreds casualties / civilians targeted ·
  3 cross-national masses / mass casualties / humanitarian disaster
- d4 Novelty: 0 day-after-day repetition (another routine strike) · 1 incremental
  update to a known process · 2 clearly new development · 3 entirely new or crosses
  a previously-uncrossed threshold

These measure PUBLIC CONSEQUENCE only. A story really about sport, a product
launch, or cultural resonance SHOULD score low (intended — this ranks
public-affairs news).

## Worked examples (note dimensions DIFFER, and 0 and 3 are used)
- "US and Iran exchange direct military strikes; Iran hits US facilities in the Gulf"
  → d1=3 (direct great-power war, shifts regional trajectory), d2=3 (Strait of
  Hormuz energy chokepoint, draws US in — global system), d3=2 (strikes, dozens-
  hundreds, not yet mass-civilian), d4=3 (first direct exchange, crosses threshold)
- "EU adopts landmark migration and deportation regulations"
  → d1=3 (cross-border landmark legislation reshaping bloc policy), d2=2 (many
  countries, migration/refugees; not a global chokepoint), d3=2 (large migrant
  populations across nations), d4=2 (new regulation)
- "Murder of a man in one city and its local aftermath"
  → d1=0 (isolated crime, no policy/strategic consequence), d2=0 (confined to one
  city), d3=2 (a death + limited local unrest), d4=1 (routine local-crime story)
  — scores LOW despite a casualty`

/**
 * 判官：对一个几何候选组，找出其中所有 ≥2 篇报道同一发生的子集。
 *
 * 与旧 prompt 的关键差别：
 *   ①「找出所有子集」而非「整组是不是一个故事」——组内可产出多个故事，也可以一个都没有
 *   ② 显式消歧：详略/角度/枝节不同 ≠ 不同事件（旧版这里失分最多）
 *   ③ 显式消歧：转载/重复稿/不同语言或简繁版 = 同一事件
 *   ④ 去掉旧版鼓励拒绝的措辞（"answering false is correct and common"）
 * 部分覆盖是合法输出：与本组任何其他文章都不同事的文章，直接不列即可——
 * 这正是旧形态缺的那个「合法出口」。
 */
export function getStoryJudgePrompt(articleList: string): string {
  return `
# Task
You are a JUDGE, not a grouper. Below is a small set of news articles that an automatic
text-similarity algorithm put in the same group. The algorithm has NO understanding of
content — it only measured word/vector overlap, so the group may well be wrong.

Your job:

  Find EVERY subset of 2 or more of these articles that report the SAME concrete event
  (or its direct consequences / immediate follow-up), and list each subset you find.

Same event means the same specific occurrence: the same incident, the same strike, the
same ruling, the same announcement or decision, the same match, the same disaster — or
direct follow-up coverage of it.

# Differences that do NOT split an event
Two reports of the same event are almost never identical. The following are NORMAL and
must NOT be treated as evidence of different events:
- one article carries an extra detail, extra background, or a side thread the other omits;
- different angle, framing or emphasis (reactions vs. facts, official vs. victim view);
- different depth or length (a short wire item vs. a long feature);
- different headline wording, different outlet, different URL, different publication time;
- a duplicate, syndicated or reprinted copy of the same story;
- the same content in a different language, or in Traditional vs. Simplified Chinese.
"The two articles do not contain exactly the same content" is NOT a reason to say they
report different events.

# Differences that DO split an event
Only a difference in the underlying occurrence itself: two separate court rulings by the
same court; two separate airstrikes on different days in the same war; two different
policy moves by the same government; two different matches in the same tournament; two
profiles of the same person about different things. Articles that share only a TOPIC, a
REGION, a PERSON, an INSTITUTION, or a long-running conflict, while describing different
occurrences, do not belong to one event.

# A group may hold more than one event
Output ONE entry per event. If articles A, B, C report one event and D, E report a
different one, output TWO entries. An article that shares no event with any other article
here is simply left out — partial coverage of the group is correct and expected. Each
article id may appear in at most one entry.

If no 2 articles in this group report the same event, output an empty list. Do that when
the articles genuinely describe different occurrences — not merely because they differ in
detail, wording or depth.

${TITLE_SEC}
- Each entry's title names the ONE event that entry's articles share.

${SCORING_SEC}

# Input
${articleList}

# Output
**Output ONLY the JSON, no analysis, no reasoning, no prose before or after.**
Wrap the JSON in a \`\`\`json fenced code block.

\`\`\`json
{
  "events": [
    {
      "members": [12, 34],
      "title": "...",
      "scoring": {
        "d1": {"why": "...", "score": 0},
        "d2": {"why": "...", "score": 0},
        "d3": {"why": "...", "score": 0},
        "d4": {"why": "...", "score": 0}
      },
      "reason": "one sentence naming the shared event"
    }
  ],
  "left_out": "one sentence: which ids (if any) you left out and why"
}
\`\`\`

If no two articles report the same event:
\`\`\`json
{"events": [], "left_out": "one sentence saying what they share and why that is not one event"}
\`\`\`

Note:
- EVERY string value must be wrapped in double quotes, including every \`why\`, \`reason\` and \`left_out\`.
- Article ids MUST be integers, no "#" prefix, no strings.
- Every id in "members" must be one of the ids listed in Input.
- Each entry's "members" must have at least 2 ids.
`.trim()
}

/**
 * 复核：对判官确认的一个故事做严格二审，抓「把两三件不同的事钉在一起再起个伞状标题」。
 *
 * 这一步是拿召回换精度：08-20 实测它把 103 个故事削到 74 个，事件召回 98%→76%，
 * 但严精度 75.7%→89.2%、**前 15 条精度 53.3%→93.3%**。
 * 下游 maxStoriesToGenerate 只放 15 条进情报分析，所以按「实际进简报的真故事条数」算
 * 是 8 条 → 14 条，复核这一步是净赚的。
 */
export function getStoryVerifyPrompt(storyTitle: string, articleBlock: string, articleCount: number): string {
  return `
# Task
A first-pass grouper claims the articles below all report ONE news event, and gave the
group this title:

  "${storyTitle || '(no title)'}"

You are the second-pass REVIEWER. The first pass is known to over-merge: it sometimes
staples together two or three genuinely different happenings that merely share a word, a
person, a place or a theme, and then invents an umbrella title that covers all of them.
Your job is to catch exactly that, WITHOUT breaking apart groups that are legitimately
one event.

# What still counts as ONE event
Do NOT split these apart — they are one event reported more than once:
- Different STAGES or FOLLOW-UPS of one storyline: a protest, then the negotiations, then
  the protest ending; an arrest, then the charge, then the court appearance; a crash, then
  the rescue, then the death toll update. One continuing chain of consequences = one event.
- Different SIDES or ANGLES of the same happening: the death and the autopsy result; the
  remark and the reaction to it; the accusation and the denial; officials' account and
  the victim's family's account; facts in one piece, analysis of the same piece in another.
- Different DEPTH, wording, outlet, language or publication time; a duplicate, syndicated
  or reprinted copy; a short wire item vs. a long feature on the same happening.
- One article carrying an extra detail or side thread that the others omit.

# What is NOT one event
Split or trim these:
- Two (or more) DISTINCT occurrences tied together only by a shared word, a shared person,
  a shared institution, a shared place, a shared date, or a shared long-running conflict.
  Examples: two different court rulings; two different films' box-office figures for the
  same day; a policy announcement plus an unrelated scandal at the same ministry; a
  celebrity's public appearance plus a death in that celebrity's family; a research funding
  cut plus an unrelated database deletion.
- A general think-piece / overview / explainer about a topic, sitting next to a report of
  one specific incident in that topic. Two separate overview pieces on a theme are also
  not one event.
- Beware of a title that joins two things with "and", or that is broad enough to be true
  of several different happenings — that is often the umbrella you are supposed to break.

# Your three possible actions
Choose exactly ONE:

1. "confirm" — every article listed reports the same single event (per the rules above).

2. "split" — the group actually contains MORE THAN ONE distinct event. Output one entry
   per distinct event, each with at least 2 article ids and its own title. Any article
   that belongs to no such group of 2+ is listed in "dropped". Use this action whenever a
   true event is hiding inside the group — do NOT throw good articles away just because
   the group as a whole is wrong.

3. "trim" — the group IS built around one event, but some listed articles do not belong to
   it. List those ids in "remove". If removing them leaves fewer than 2 articles, that is
   allowed and expected — it simply means this group never had a real shared event; still
   use "trim" and list every id that must go.

Only ever move an article out when its own reported happening is different. Extra detail,
different angle, or later stage is never a reason to remove or split.

# Input articles (${articleCount})
${articleBlock}

# Output
**Output ONLY the JSON, no analysis, no prose before or after.**
Wrap it in a \`\`\`json fenced code block.

\`\`\`json
{
  "action": "confirm" | "split" | "trim",
  "groups": [ {"members": [12, 34], "title": "..."} ],
  "dropped": [56],
  "remove": [78],
  "reason": "one or two sentences naming the event(s) and justifying the action"
}
\`\`\`

Rules:
- "groups" and "dropped" are used ONLY with action "split"; "remove" ONLY with action
  "trim"; with "confirm" leave all three as empty lists.
- With "split" there must be at least 2 groups, each with at least 2 ids.
- Every id you mention must be one of the input ids. Ids are integers, no "#", no quotes.
- No id may appear in more than one group.
- EVERY string value must be wrapped in double quotes.
`.trim()
}
