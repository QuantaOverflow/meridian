/**
 * 情报分析提示词
 * 基于 notebook 中的 final_process_story 逻辑
 */

/**
 * 情报分析提示词。
 *
 * **形状：纯 markdown，不包 JSON。** 2026-09-10 去掉了最后那层 JSON 外壳——实测它的解析
 * 失败率约 20%（两个真实故事各 10 次，4 次失败：前置分析退化成枚举循环烧光 token，或字符串
 * 值里出现未转义引号），为此养着一整套重采样 + 传感器 + 耗尽告警，在处理一个自己制造的问题。
 * 正文本来就是 markdown，原型 report-3step 改成纯 markdown 后 4/4 切分成功。
 *
 * 更早（2026-09-09）先去掉的是**整形层**，理由是一手实测：
 * 模型的 `contradictions` 每次形状不同（簇 0 给 `{field, conflictingInformation}`、
 * 簇 3 给纯字符串），而整形代码 `buildContradictions` 只认 `{issue, conflictingClaims}`
 * ——两种都认不出，一律兜底成 `{issue:"Contradiction", conflictingClaims:[]}`，
 * **内容被静默丢光，不报错不留日志**。同类事故还有 `[object Object]`（模型给对象、
 * 模板串插值）。这类 bug 全部出在「给模型的自由输出套固定 JSON 形状」这一层，
 * 而报告的绝大部分内容最终只是被原样渲染成 markdown 喂给写作层——那就不该是 JSON。
 *
 * 现在代码只寻址 `executiveSummary`（骨架步、块标题、storyLabel、补录兜底都用它）
 * 和 `status`，`body` 原样透传，形状对不上的可能性归零。
 *
 * **正文四节的取舍依据**（2026-09-09 六臂对照，见 prototypes/block-writer/out/report-arms/）：
 * - 删掉了「关键发展」——它是整形代码拿 timeline 复制的副本，写作层看两遍同一份内容
 * - 删掉了旧的 informationGaps——它写的是「报道没写什么」，拿去检索必然落空，
 *   而且渲染时被错标成「影响评估」喂给写作层
 * - 删掉了旧的 significance.reasoning——现编的通用推理，不指向任何具体的人或数字
 * - 「争点」是新加的（模型本来就在产出，只是被整形代码扔了），实测四个独立设计的臂
 *   都自发产出了这一格且质量高
 * - 「相关方」要求**列全所有被引述过的人和机构，不要只留主角**：实测让模型筛「谁是
 *   主角」会筛到只剩 6-7 个，把学者、行业协会、研究机构全删光——而那是原文里唯一
 *   提供解读和反证的信源。写作层看不见他们的名字就永远不会去检索他们的话。
 */
export function getIntelligenceAnalysisPrompt(storyArticleMd: string): string {
  const prePrompt = `
You are a highly skilled intelligence analyst working for a prestigious agency. A cluster of related news articles has been filed by a set of reporters. Your task is to report **what these reporters say** — this report is an account of THIS REPORTING, not an account of the world. The quality, accuracy, precision, and **consistency** of your analysis are crucial, as this report will directly inform a high-level daily brief and potentially decision-making.

Every statement you write must survive this test: **"According to these articles, <your statement>"** — read it back; if it does not hold, the statement does not belong in the report. This applies even to statements you know to be true about the world: your task is not to say what is true, it is to say what these reporters reported. A reader of your report needs to know what THIS REPORTING said; anything you add from your own knowledge destroys that, however accurate it is.

Your report is **not** the finished brief. A writer downstream will turn it into prose, and that writer **can search the full original articles** for any wording you point them at. So your job is to tell them what happened and **where the material is** — not to reproduce the material. Name every person and organisation whose words appear in the coverage; the writer can only retrieve quotes from people they know exist.

First, assess if the articles provided contain sufficient content for analysis:

Here is the cluster of related news articles you need to analyze:

<articles>
`.trim()

  const postPrompt = `
</articles>

BEGIN ARTICLE QUALITY CHECK:
Before proceeding with analysis, verify if the articles contain sufficient information:
1. Check if articles appear empty or contain minimal text (fewer than ~50 words each)
2. Check for paywall indicators ("subscribe to continue", "premium content", etc.)
3. Check if articles only contain headlines/URLs but no actual content
4. Check if articles appear truncated or cut off mid-sentence

If ANY of these conditions are true, reply with a single line and nothing else:
INCOMPLETE: <brief reason — empty articles, paywalled content, etc.>

ONLY IF the articles contain sufficient information for analysis, proceed with the full analysis below:

Before writing the report, conduct a preliminary analysis:
a) List key themes across all articles
b) Note every person and organisation who is quoted or whose position is described
c) Identify where the articles disagree with each other, or where one party's claim is contradicted by another
It's okay for this section to be quite long as it helps structure your thinking.

Then output the report as **pure markdown**. No JSON, no \`<final_json>\` or any other tag, no preamble before the first heading. Use exactly this structure:

# Summary
<2-4 sentences: what these articles report — the critical developments, the central conflict, and the overall assessment as told by this reporting>

## Timeline
...

## Parties
...

## Disputes
...

## Open
...

**\`# Summary\`** is read by a downstream planner on its own, so it must stand alone. Write only what these reporters said; if a detail (a figure, a year, a precedent, a "first since…") is not in their reporting, it is not part of this summary, no matter how confident you are that it is true.

The four sections below follow \`# Summary\`, in this order, using exactly these headings:

## Timeline
One bullet per event, in the order the events happened (not the order they were reported). Format each as:
\`* [<when>] <what happened, brief and factual> — src: "<verbatim fragment from an article that states WHEN this happened>"\`
- \`<when>\`: use an ISO date (YYYY-MM-DD) ONLY when an article states an explicit calendar date for the event. If the article expresses timing relatively ("Thursday", "yesterday", "two days ago"), copy that wording VERBATIM — do NOT convert it to a calendar date yourself (weekday-to-date arithmetic is error-prone; preserving the source's wording stays faithful). Never fall back to the publication date or today's date.
- \`src:\` is the exact sentence fragment (<=160 chars) your \`<when>\` is taken from, copied word-for-word. It must agree with \`<when>\`: if the fragment says "Saturday", \`<when>\` must be "Saturday". This binds each date to its evidence so a human can audit the ordering. If no article sentence gives this event's timing, write \`src: none\`.

## Parties
One bullet per person or organisation, formatted \`* <name> (<role as this reporting describes it>) — <what they want, claim, or face, in one clause>\`.
**List everyone whose words or position appear in the coverage — not just the principals.** That includes analysts, historians, economists, industry groups, trade associations, research institutes, spokespeople, local officials and named witnesses. These secondary voices are usually the only people in the coverage who explain *why* something is happening or who contradict a principal's claim, and the writer downstream cannot retrieve a quote from someone they were never told exists. Describe each actor the way this reporting describes them — do not fill in titles, honours, years or biography from your own knowledge.

## Disputes
One bullet per point of disagreement, formatted \`* <what is in dispute> — <party A's position> vs <party B's position>; <settled | one side unrebutted | unresolved>\`.
This covers: articles reporting different figures for the same thing; one party's claim being contradicted by another party or by the reporting itself; two sides giving incompatible accounts; and decisions left hanging.
**When the dispute IS a numeric disagreement, write the competing numbers** (e.g. "death toll: 7 vs 11", "$20bn vs $27.6bn") — the disagreement cannot be stated without them. Otherwise keep to what is contested, not the full argument; the writer retrieves the wording.
If the coverage genuinely contains no disagreement, write \`* none\` — do not manufacture disputes to fill the section.

## Open
One bullet per thing the reporting itself leaves unsettled — a decision not yet taken, an outcome not yet known, a claim not yet verified. These are questions about the world that the coverage raises, **not** a list of what the reporters failed to cover.

**What does NOT belong in the body:** quotations (beyond the short \`src:\` timing fragments), percentages and dollar figures outside a numeric dispute, motive analysis, second-order effects, and your own assessment of why the story matters. The writer downstream retrieves all of that from the original articles. Your job is to point, not to reproduce.

**Final requirements:**
*   **Grounding — report the reporting, not the world:** Base your entire analysis **SOLELY** on the content within the provided \`<articles>\` tags. Before writing any specific detail — a figure, a year, a count, a precedent, a title, a "first since…" — ask: **can I read back "According to these articles, <this detail>"?** If these reporters did not say it, you may not write it. Being right about the world is not the same as reporting what was filed.
*   **Dates and relative time — do NOT compute or invent dates:** The \`> Published:\` line is when the article was FILED, not when the events happened; never assign it to an event unless the article explicitly says the event occurred on that date. When articles conflict on a date, that belongs in \`## Disputes\`, not a silent pick.
*   **Scrutinize sources:** note when a claim originates solely from a single outlet — that belongs in \`## Disputes\` as "one side unrebutted".

Put your preliminary analysis first in any format you prefer, then a line containing only \`---\`, then the report starting with \`# Summary\`. Everything after that line is the report.
`.trim()

  return prePrompt + '\n\n' + storyArticleMd + '\n\n' + postPrompt
}

// RARR 式接地校验-改正（环1 版）。与 briefGeneration.ts 的 getBriefVerificationPrompt 同构，
// 但源是 RSS 原文而非已压缩过一道的情报报告 —— 即文献里的 gold-article 最优情形
// （RARR+gold-article=83 vs RARR+Bing=73，arXiv 2506.19607），环1 天然占这一档。
//
// 为什么放在生成之后而不是生成之中：生成时引用（G-Cite）全面劣于事后引用（P-Cite）——
// 覆盖 27-37% vs 75%、人评正确率 69% vs 78%（arXiv 2509.21557）；且生成时约束的强制力
// 只能交给模型（实测它会建出 94% 逐字属实的引用清单后照样在正文编造 = post-rationalization,
// arXiv 2412.18004 量化 57% 引用系事后贴）。事后范式才能做到「模型只提议、代码执行」。
//
// 模型只回 edit-list（verbatim span → 接地修正/删除），由本地程序化 apply。
export function getIntelReportVerificationPrompt(reportFields: string, storyArticleMd: string): string {
  return `
You are a meticulous fact-checker correcting an intelligence report against its ONLY permitted source: the news articles below. The report was written from these articles and must contain no concrete fact the articles do not support. Your job is to catch and FIX factual errors — both specifics the articles never contained, and facts that ARE in the articles but got GARBLED: wrong attribution, reversed order, altered number/scope/status, wrong date/name, bad arithmetic.

<articles>
${storyArticleMd}
</articles>

<report_fields>
${reportFields}
</report_fields>

# What to flag (CONCRETE FACTS ONLY)
Check every concrete factual token: names, numbers, dates, quantities, scope/rankings, superlatives ("first since X", "third consecutive"), quotes, who-said / who-did attributions, event order, status/modality ("agreed" vs "proposed"), severity verbs ("damaged" vs "destroyed"). Flag a span when:
- it CONTRADICTS the articles — e.g. articles say "third time in four years" but the report says "third consecutive year"; articles say "14.5 km (nine miles)" but the report says "9–14.5 km"; articles attribute a claim to two former Air Force officials but the report attributes it to the Secret Service; OR
- it states a concrete specific (named org / person / place / number / year / precedent) that is ABSENT from the articles. **This applies even when the specific is true in the real world**: a report reader needs to know what THIS REPORTING said, so a correct-but-unsourced figure (e.g. an annual aid amount the articles never mention) is an error of the same kind as an invented one.

# What NOT to flag (leave untouched)
- Analytical interpretation — motivations, implications, "this likely signals…". Opinion grounded on real facts is allowed; never touch it.
- Wording, style, tone. Only factual accuracy matters here.
- Relative time wording ("Thursday", "a day earlier") deliberately copied from the articles — that is correct behaviour, not an error. Never "fix" it into a calendar date.
- Facts that ARE supported by the articles, even if phrased differently. If unsure whether a fact is supported, LEAVE IT — flag only clear errors. Precision over zeal: a wrongly-flagged correct sentence is worse than a missed one.

# For each problem, produce one edit
- "span": an EXACT verbatim substring of the report fields above (copy letter-for-letter, including punctuation) — the SMALLEST span containing the error.
- "replacement": the corrected text, grounded in the articles (fix the number / name / attribution / order to match the articles exactly). Use an empty string "" ONLY when the span is an unsupported specific that cannot be corrected from the articles and must be removed.
- "reason": one short phrase citing the articles (e.g. 'articles say third time in four years, not consecutive').

# Output
Reply with ONLY a JSON object inside a \`\`\`json fenced block. No prose. If the report has no factual errors, return {"edits": []}.
\`\`\`json
{
  "edits": [
    { "span": "<verbatim substring of report fields>", "replacement": "<grounded correction or empty>", "reason": "<short, cite articles>" }
  ]
}
\`\`\`
`.trim()
} 