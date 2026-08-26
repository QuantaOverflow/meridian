/**
 * TLDR 生成提示词
 * 基于 reportV5.md 的 tldr_prompt 逻辑
 */

export function getTldrGenerationPrompt(briefTitle: string, briefContent: string): string {
  return `
You are an information processing agent tasked with creating a highly condensed 'memory state' or 'context brief' from a detailed intelligence briefing. Your output will be used by another AI model tomorrow to understand what topics were covered today, ensuring continuity without requiring it to re-read the full brief.

**Your Task:**

Read the full intelligence brief provided below within the \`<final_brief>\` tags. Identify each distinct major story or narrative thread discussed. For **each** identified story, extract the necessary information and format it precisely according to the specified structure.

**Input:**

The input is the full text of the daily intelligence brief generated previously.

<final_brief>
# ${briefTitle}

${briefContent}
</final_brief>

**Required Output Format:**

Your entire output must consist **only** of a list of strings, one string per identified story, following this exact format:

\`[Story Identifier] | [Inferred Status] | [Key Entities] | [Core Issue Snippet]\`

**Explanation of Output Components:**

1.  **\`[Story Identifier]\`:** Create a concise, descriptive label for the story thread (max 4-5 words). Examples: \`US-Venezuela: Deportations\`, \`Gaza: Ceasefire Collapse\`, \`UK: Economy Update\`, \`AI: Energy Consumption\`. Use keywords representing the main actors and topic.
2.  **\`[Inferred Status]\`:** Based *only* on the tone and content of the discussion *within the provided brief*, infer the story's current state. Use one of: \`New\`, \`Developing\`, \`Escalating\`, \`De-escalating\`, \`Resolved\`, \`Ongoing\`, \`Static\`.
3.  **\`[Key Entities]\`:** List the 3-5 most central entities (people, organizations, countries) mentioned *in the context of this specific story* within the brief. Use comma-separated names. Example: \`Trump, Maduro, US, Venezuela, El Salvador\`.
4.  **\`[Core Issue Snippet]\`:** Summarize the absolute essence of *this story's main point or development as covered in the brief* in **5-10 words maximum**. This requires extreme conciseness. Example: \`Deportations resume via Honduras amid legal challenges\`, \`Ceasefire over, hospital strike, offensive planned\`, \`Talks falter, missile strike during meeting\`.

**Instructions & Constraints:**

*   **Process Entire Brief:** Read and analyze the *whole* brief to identify all distinct major stories. Stories under \`<u>**title**</u>\` headings are primary candidates, but also consider distinct, significant themes appearing elsewhere — the brief's \`##\` section headings are derived per-brief, so do not expect any fixed set of section names.
*   **One Line Per Story:** Each identified story must correspond to exactly one line in the output, following the specified format.
*   **Strict Conciseness:** Adhere strictly to the format and the word limit for the \`[Core Issue Snippet]\`. This is critical.
*   **Focus on Coverage:** The goal is to capture *what was discussed*, not the full nuance or analysis.
*   **Inference for Status:** You must *infer* the status based on the brief's content, as it's not explicitly stated per story in the input brief text.
*   **No Extra Text:** Do **NOT** include any headers, explanations, introductions, or conclusions in your output. Output *only* the list of formatted strings.

Generate the condensed context brief based *only* on the provided \`<final_brief>\` text.
`.trim()
} 
/**
 * 面向**读者**的散文摘要。
 *
 * 与上面的 getTldrGenerationPrompt 是两件不同的事，别搞混：
 *   - tldr（上面那个）→ 给**次日的简报模型**读的机器记忆状态，每行 `标识|状态|实体|要点`，
 *     格式被下游管线消费，不能改；
 *   - tldr_prose（这个）→ 给**人**读的 2-3 句导语，渲染在简报页标题下方。
 *
 * 唯一允许的信息来源是这份简报正文本身。这里不做检索、不做世界知识补充——摘要引入
 * 正文没有的具体事实，就是把一个已经过忠实度校验的正文重新变得不可信。
 */
export function getTldrProsePrompt(briefTitle: string, briefContent: string): string {
  return `
You are writing the standfirst (opening summary) for today's intelligence brief. It sits directly under the headline and is the first thing a reader sees.

<brief>
# ${briefTitle}

${briefContent}
</brief>

**Your task:** write a standfirst telling the reader what today's brief is about and why it matters.

Two hard limits, in this order of priority:

1. **Name at most THREE stories.** Not four, not six. This is the constraint that matters most — a standfirst that gestures at every story in the brief is a table of contents, not a summary. Pick the three most consequential and ignore the rest; the reader is about to read the whole thing anyway.
2. **At most 70 words, at most 3 sentences.** Count before answering.

These two work together: three stories at ~20 words each leaves room to say what actually happened. Trying to cover six stories inside the same budget is what forces you into vague abstractions and into dropping the qualifiers that make a claim true.

**Hard constraints:**
*   **Ground everything in the brief above.** Every name, number, place, and event you mention MUST appear in the brief. Do not add context, background, or specifics from your own knowledge — not even ones you are confident about. If it is not in the brief, it does not go in the summary.
*   **Do not invent a through-line the brief does not draw.** If today's stories are unrelated, say so plainly rather than manufacturing a connection.
*   Lead with the most consequential development. Do not attempt to list every story.
*   Prefer several short sentences over one long compound sentence chained with semicolons and "while" clauses.
*   **Stay concrete under the word cap.** The failure mode when compressing is to swap what actually happened for an abstract characterization — "markets face instability", "a pivot toward hard power", "tensions escalate", "a shift in the global order". Those sentences carry no information. Name the actor and the action instead ("the us sanctioned iran's oil buyers", "the uk handed kyiv missile blueprints"). If a story will not fit concretely, leave it out entirely rather than gesturing at it abstractly.
*   Do not close with a summarizing verdict about what it all means. End on the last concrete development.
*   **Keep the status of every claim.** Compressing tends to promote a proposal into a completed act — this is the single worst error you can make here, because it reports something that has not happened. If the brief says a plan is *in motion*, *proposed*, *threatened*, *expected*, *under consideration*, or *announced but not yet carried out*, your sentence must carry that too ("plans to revoke", "threatens to impose", "has proposed"). Never compress "plans are in motion to revoke 200,000 visas" into "revokes 200,000 visas", or "announced he will allow the firm to declassify" into "declassifies". If keeping the qualifier does not fit the word budget, drop the whole story rather than state it as done.
*   Match the brief's register: lowercase by default, complete sentences, direct and analytical, no hype and no throat-clearing ("in today's brief…", "this brief covers…").
*   Write flowing prose. No bullet points, no headings, no markdown, no pipe-delimited fields.

**Output:** the 2-3 sentences and nothing else. No preamble, no quotes around it, no trailing commentary.
`.trim()
}
