/**
 * 简报生成相关提示词
 * 基于 reportV5.md 的 brief generation 逻辑
 */

// RARR 式接地校验-改正提示词。把已生成的草稿拿回到它唯一允许的源（curated_news_data）前逐条核对，
// 让模型只回 edit-list（verbatim span → 接地修正/删除），由本地程序化 apply（见 brief-generation.ts）。
// 学术依据：自我纠错在「有外部 oracle」时有效（源在手 = gold-article 最优情形，arXiv 2506.19607），
// 与「凭记忆自纠无效」（Huang 2023）相反；故这里强制一切修正都贴源、不许引入新事实。
/**
 * RARR ① 提问（CQGen）。只给正文，不给资料——问题要从「待核内容」里长出来。
 *
 * 论文里这一步叫 comprehensive question generation，是**召回的来源**：覆盖率不靠模型
 * 扫一遍整段自觉发现，靠把段落拆成一串必须逐个回答的问题。
 * 论文采样 3 次取并集，这里 1 次（成本折中，已知的召回让步）。
 */
export function getBriefQuestionsPrompt(draft: string): string {
  return `You are fact-checking one block of a news brief. Before checking anything, list the questions you would need answered to verify it.

Cover EVERY concrete factual claim in the passage: names, numbers, dates, quantities, who-did-what, event order, status ("agreed" vs "proposed"), severity. One question per checkable fact. Skip analysis, opinion, and interpretation — those are not checkable.

<passage>
${draft}
</passage>

Reply with ONLY a JSON object inside a \`\`\`json fenced block:
\`\`\`json
{ "questions": ["<question 1>", "<question 2>", "..."] }
\`\`\`
Aim for 6-12 questions. Each must be answerable by a short factual answer.`
}

/**
 * RARR ③ 判断 + 改写。逐问题**先填两边答案、再判一致性**。
 *
 * 这个顺序是关键，不是排版。旧做法是「整块正文 + 全量资料一次性给，你自己找错」，模型于是
 * 能说出 "data does not mention X" 而 X 就在资料里——没人要求它先把资料说的那句写出来。
 * 逼它填 source_answer 之后，这句话在结构上就说不出口了。
 *
 * 三档判定（前两档同论文）：
 *   agree     两边答案一致（措辞不同仍算一致）→ 什么都不做
 *   disagree  两边都有答案但事实不同 → 按资料改写
 *   absent    正文给了具体信息而资料完全没提 → 提议删除
 *
 * 第三档是**对论文的有意分歧**：论文对「证据没提」不动作（开放网页里"没搜到"不等于
 * "不存在"），于是纯编造的具体信息删不掉。我们是闭集且真幻觉金标里确有此类
 * （"thirty girls in the residential hostel" 报告里根本没有），故保留提议权，
 * 删不删交给下游守卫用代码复核。
 */
export function getBriefAgreementPrompt(draft: string, items: Array<{ q: string; evidence: string }>): string {
  const list = items
    .map((it, i) => `### Q${i + 1}. ${it.q}\nRetrieved source passage(s):\n"""\n${it.evidence}\n"""`)
    .join('\n\n')

  return `You are checking a news brief against retrieved source passages, one question at a time.

<brief>
${draft}
</brief>

${list}

For EACH question, fill in both answer slots BEFORE judging. This order matters — state what each side says, then compare.

- "brief_answer": what the BRIEF says in answer to this question. Quote the brief. If the brief says nothing about it, write "N/A".
- "source_answer": what the RETRIEVED PASSAGE says. **Copy the relevant words verbatim from the passage.** If the passage genuinely says nothing about this question, write "N/A".
- "verdict":
  - "agree"    — both answers describe the same fact. Different wording is still agreement ("trial" vs "legal proceedings", "military assistance" vs "military support", "30" vs "thirty").
  - "disagree" — both sides answer, but the facts differ (different number, date, person, direction, status). "nearly 90,000" vs "more than 90,000" is a disagreement — opposite direction.
  - "absent"   — the brief states a concrete specific (a named person/org/place, a number, a date) and the passage says nothing about it at all.
- "brief_span": ONLY for disagree/absent. An EXACT verbatim substring of the brief — the SMALLEST span carrying the problem.
- "replacement": for "disagree", the corrected text grounded in source_answer. For "absent", use "" (the span will be removed).

If verdict is "agree", omit brief_span and replacement.

Reply with ONLY a JSON object inside a \`\`\`json fenced block:
\`\`\`json
{
  "checks": [
    { "q": 1, "brief_answer": "...", "source_answer": "...", "verdict": "agree|disagree|absent", "brief_span": "...", "replacement": "..." }
  ]
}
\`\`\``
}

export function getBriefTitlePrompt(briefText: string): string {
  return `
<brief>
${briefText}
</brief>

create a title for the brief. construct it using the main topics. it should be short/punchy/not clickbaity etc. make sure to not use "short text: longer text here for some reason" i HATE it, under no circumstance should there be colons in the title. make sure it's not too vague/generic either bc there might be many stories. maybe don't focus on like restituting what happened in the title, just do like the major entities/actors/things that happened. like "[person A], [thing 1], [org B] & [person O]" etc. try not to use verbs. state topics instead of stating topics + adding "shakes world order". always use lowercase.

return exclusively a JSON object with the following format:
\`\`\`json
{
    "title": "string"
}
\`\`\`
`.trim()
} 