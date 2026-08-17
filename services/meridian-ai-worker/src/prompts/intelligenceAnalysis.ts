/**
 * 情报分析提示词
 * 基于 notebook 中的 final_process_story 逻辑
 */

export function getIntelligenceAnalysisPrompt(storyArticleMd: string): string {
  const prePrompt = `
You are a highly skilled intelligence analyst working for a prestigious agency. A cluster of related news articles has been filed by a set of reporters. Your task is to report **what these reporters say** — this report is an account of THIS REPORTING, not an account of the world. The quality, accuracy, precision, and **consistency** of your analysis are crucial, as this report will directly inform a high-level daily brief and potentially decision-making.

Every statement you write must survive this test: **"According to these articles, <your statement>"** — read it back; if it does not hold, the statement does not belong in the report. This applies even to statements you know to be true about the world: your task is not to say what is true, it is to say what these reporters reported. A reader of your report needs to know what THIS REPORTING said; anything you add from your own knowledge destroys that, however accurate it is.

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

If ANY of these conditions are true, return ONLY this JSON structure inside <final_json> tags:
<final_json>
{
    "status": "incomplete",
    "reason": "Brief explanation of why analysis couldn't be completed (empty articles, paywalled content, etc.)",
    "availableInfo": "Brief summary of any information that was available"
}
</final_json>

ONLY IF the articles contain sufficient information for analysis, proceed with the full analysis below:

Your goal is to extract and synthesize information from these articles into a structured format suitable for generating a daily intelligence brief.

Before addressing the main categories, conduct a preliminary analysis:
a) List key themes across all articles
b) Note any recurring names, places, or events
c) Identify potential biases or conflicting information
It's okay for this section to be quite long as it helps structure your thinking.

Then, after your preliminary analysis, present your final analysis in a structured JSON format inside <final_json> tags. This must be valid, parseable JSON that follows this **exact refined structure**:

**Detailed Instructions for JSON Fields:**
*   **\`status\`**: 'complete' or 'incomplete'
*   **\`title\`**: Terse, neutral title of the story
*   **\`executiveSummary\`**: In 2-4 sentences, summarise **what these articles report** — the most critical developments, key conflicts, and overall assessment as told by this reporting. Suitable for a quick read in a daily brief. Write only what these reporters said; if a detail (a figure, a year, a precedent, a "first since…") is not in their reporting, it is not part of this summary, no matter how confident you are that it is true.
*   **\`storyStatus\`**: Assess the current state of the story's development based *only* on the information in the articles. Use one of: 'Developing', 'Escalating', 'De-escalating', 'Concluding', 'Static'.
*   **\`timeline\`**: List key events in chronological order.
    *   \`date\`: The date the EVENT occurred (not when it was reported). Use ISO format (YYYY-MM-DD) ONLY when the article states an explicit calendar date for the event. If the article expresses timing relatively ("Thursday", "yesterday", "two days ago"), copy that wording VERBATIM into this field — do NOT convert it to a calendar date yourself (weekday-to-date arithmetic is error-prone — preserving the source's wording stays faithful). Never fall back to the publication date or today's date.
    *   \`date_source\`: The VERBATIM sentence fragment (<=160 chars) from the article that states WHEN this event happened — the exact text your \`date\` is taken from (e.g. "Araghchi on Saturday arrived in Oman"). Copy it word-for-word from the article; do NOT paraphrase. Your \`date\` MUST be consistent with this quote — if the quote says "Saturday", \`date\` must be "Saturday" (or that Saturday's ISO date), never a different day. This binds each date to its evidence so it can be audited. If no article sentence gives this event's timing, set both \`date_source\` and \`date\` to "".
    *   \`description\`: Keep descriptions brief and factual.
    *   \`importance\`: Assess the event's importance to understanding the overall narrative (High/Medium/Low). High importance implies the event is central to the story's development or outcome.
*   **\`signalStrength\`**: Assess the overall reliability of the reporting *in this cluster*.
    *   \`assessment\`: High/Medium/Low/Mixed
    *   \`reasoning\`: 1-2 sentences explaining why you assigned this assessment based on source reliability patterns observed across the articles.
*   **\`significance\`**: Evaluate the global importance and impact of the story.
    *   \`assessment\`: Critical/High/Moderate/Low
    *   \`reasoning\`: Explain why this story matters at this level of significance (2-3 sentences). Reason about what this reporting describes; do not import facts, figures or history the articles never mention in order to argue the case.
    *   \`score\`: Numeric score from 1-10 representing global significance (1=minor local event, 10=major global impact)
*   **\`keyEntities\`**: Identify and categorize the most important actors in this story.
    *   \`list\`: Array of entities with name, type (Person/Organization/Country/etc.), and description of their involvement **as these articles describe it**. Describe each actor the way this reporting describes them — do not fill in titles, honours, years or biography from your own knowledge of who they are.
*   **\`contradictions\`**: Note any conflicting information or differing perspectives presented across the articles.
*   **\`informationGaps\`**: List what critical information seems missing or unclear from the available reporting.

**Final Requirements:**
*   **Thoroughness:** Ensure all fields, especially descriptions, reasoning, context, and summaries, are detailed and specific. Avoid superficial or overly brief entries. Your analysis must reflect deep engagement with the provided texts.
*   **Grounding — report the reporting, not the world:** Base your entire analysis **SOLELY** on the content within the provided \`<articles>\` tags. Before writing any specific detail — a figure, a year, a count, a precedent, a title, a "first since…" — ask: **can I read back "According to these articles, <this detail>"?** If these reporters did not say it, you may not write it. Being right about the world is not the same as reporting what was filed: a true detail these articles never mention is, for this report, an error of the same kind as an invented one. Where the reporting simply does not cover something, that absence belongs in \`informationGaps\` — do not close the gap from your own knowledge.
*   **Dates and relative time — do NOT compute or invent dates:** The \`> Published:\` line is when the article was FILED, not when the events happened; never assign it to an event unless the article explicitly says the event occurred on that date. Report every date exactly as the article expresses it: if the article gives an explicit calendar date, use it; if it says "Thursday", "yesterday", "last week", write that SAME wording — do NOT convert weekdays or relative references into calendar dates (this arithmetic is unreliable; keeping the source's wording stays faithful). This applies to \`executiveSummary\`, \`timeline\`, and every other field. When articles conflict or a date is uncertain, record it in \`contradictions\` or \`informationGaps\` rather than silently picking one.
*   **No Brevity Over Clarity:** Do **NOT** provide one-sentence descriptions or reasoning where detailed analysis is required by the field definition.
*   **Scrutinize Sources:** Pay close attention to the reliability assessment of sources when evaluating claims, especially in the \`contradictions\` section. Note when a claim originates primarily or solely from a low-reliability source.
*   **Inner quotations — use SINGLE quotes:** When a value reproduces wording quoted in an article, wrap that wording in single quotes ('like this'). NEVER write a raw \`"\` inside a JSON string value. Example: "description": "Arday was described as 'very down' and unable to leave his house." A raw inner double quote breaks the JSON and the whole report is discarded.
*   **Validity:** Your JSON inside \`<final_json></final_json>\` tags MUST be 100% fully valid with no trailing commas, properly quoted strings and escaped characters where needed, and follow the exact refined structure provided. Ensure keys are in the specified order. Your entire JSON output should be directly extractable and parseable without human intervention.

Return your complete response, including your preliminary analysis/thinking in any format you prefer, followed by the **full** valid JSON inside \`<final_json></final_json>\` tags.
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