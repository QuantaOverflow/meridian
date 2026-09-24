/**
 * 面向**读者**的散文摘要。
 *
 * 给**人**读的 2-3 句导语（reports.tldr_prose），渲染在简报页标题下方。
 * （原先并列的机器格式 tldr 从没被读过，2026-09-24 删除。）
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
