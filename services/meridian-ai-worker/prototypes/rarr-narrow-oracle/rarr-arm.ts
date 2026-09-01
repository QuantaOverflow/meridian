/**
 * 【原型】按 RARR 论文结构重做块校验：提问 → 逐问题检索 → 逐问题判断 → 改写。
 *
 * 论文（Gao et al. ACL 2023, arXiv 2210.08726）的三段：
 *   ① CQGen  从正文生成"覆盖所有方面"的问题清单，采样 3 次取并集提高覆盖
 *   ② 检索   每个问题各自检索证据；网页按"四句滑窗"切片，只取 top J=1
 *   ③ 判断   agreement model 用 CoT：**先分别说出正文和证据对该问题的答案**，再判是否一致
 *
 * 为什么这样能治我们的病：现在的做法是「整块正文 + 26KB 资料一次性给，你自己找错」，
 * 模型于是能说出「data does not mention X」而 X 就在资料里。论文把开放式任务变成封闭式——
 * 手里只有一个问题和一小段证据，答案栏必须填，填不出「没提」这种话。
 *
 * 与论文的两处偏离（都是成本折中，已实测的部分见 probe 输出）：
 *   · 论文每 (问题,证据) 一次调用；这里把全部问题合并成**一次**调用，每项各带自己的证据片段。
 *     调用数 1 → 2（提问 + 判断），而非 1 → N。
 *   · 论文 CQGen 采样 3 次取并集；这里 1 次。覆盖会低一些，是已知的召回让步。
 *
 * 与论文的一处**有意分歧**：论文里证据未提及某内容时 agreement model「什么都不做」，
 * 于是纯编造的具体信息删不掉。我们的真幻觉金标里有这类（"thirty girls in the residential
 * hostel"，报告里根本没有）。所以第三档 `absent` 保留下来允许删除——但删不删由下游守卫
 * 用代码复核（hybrid 臂实测：模型敢提、代码来否，比让 prompt 自我克制好）。
 */
import { rankSourcesByRelevance } from '../../src/services/faithfulness-prompts.js';

export interface QAItem { q: string; evidence: string }

/** ① 提问。只给正文，不给资料——问题要从"待核内容"里长出来，不是从资料里。 */
export function getQuestionGenPrompt(draft: string): string {
  return `You are fact-checking one block of a news brief. Before checking anything, list the questions you would need answered to verify it.

Cover EVERY concrete factual claim in the passage: names, numbers, dates, quantities, who-did-what, event order, status ("agreed" vs "proposed"), severity. One question per checkable fact. Skip analysis, opinion, and interpretation — those are not checkable.

<passage>
${draft}
</passage>

Reply with ONLY a JSON object inside a \`\`\`json fenced block:
\`\`\`json
{ "questions": ["<question 1>", "<question 2>", "..."] }
\`\`\`
Aim for 6-12 questions. Each must be answerable by a short factual answer.`;
}

/**
 * ③ 判断 + 改写。逐问题填两个答案栏，再判一致性。
 *
 * 三档判定（前两档同论文，第三档是我们的扩展，理由见文件头）：
 *   agree     两边答案一致 → 什么都不做
 *   disagree  两边都有答案但不同 → 改写正文以对齐资料
 *   absent    资料对这个问题**完全没有**说法，而正文给出了具体信息 → 提议删除
 */
export function getAgreementEditPrompt(draft: string, items: QAItem[]): string {
  const list = items
    .map((it, i) => `### Q${i + 1}. ${it.q}\nRetrieved source passage(s):\n"""\n${it.evidence}\n"""`)
    .join('\n\n');

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
\`\`\``;
}

/**
 * ② 证据切片 + 逐问题检索。
 * 论文用"跨网页的四句滑窗"切片；这里按报告的行结构切（情报报告是 markdown 条目式，
 * 一行一个事实），每 4 行一片，步长 2 行留重叠——防止一个事实被切在两片边界上。
 */
export function buildWindows(reports: string[]): string[] {
  const out: string[] = [];
  for (const rep of reports) {
    const lines = rep.split('\n').filter((l) => l.trim());
    for (let i = 0; i < lines.length; i += 2) {
      const w = lines.slice(i, i + 4).join('\n');
      if (w.trim().length > 40) out.push(w);
      if (i + 4 >= lines.length) break;
    }
  }
  return out;
}

/**
 * 每个问题取 top-J 证据片段。**J=1 同论文**——首跑用 J=2 且不限问题数，17 问题 × 2 片
 * 拼出 25KB，比收窄前的 oracle 还大，"每问题一小段"就落空了。
 * 问题数也一并封顶：论文靠采样三次取并集提覆盖，不是靠单次问出十几个。
 */
export function retrieveFor(questions: string[], windows: string[], J = 1, maxQ = 12): QAItem[] {
  return questions.slice(0, maxQ).map((q) => ({
    q,
    evidence: rankSourcesByRelevance(q, windows, J).map((i) => windows[i]).join('\n…\n'),
  }));
}

/** 把逐问题判定结果折成既有的编辑表形状，好复用 applyGroundedEdits 与全部度量 */
export function checksToEdits(checks: any[]): Array<{ brief_span: string; replacement: string; reason: string; source_says: string }> {
  const out: Array<{ brief_span: string; replacement: string; reason: string; source_says: string }> = [];
  for (const c of checks ?? []) {
    if (!c || c.verdict === 'agree') continue;
    if (typeof c.brief_span !== 'string' || !c.brief_span) continue;
    out.push({
      brief_span: c.brief_span,
      replacement: c.verdict === 'absent' ? '' : String(c.replacement ?? ''),
      reason: `${c.verdict}: brief="${String(c.brief_answer ?? '').slice(0, 60)}" source="${String(c.source_answer ?? '').slice(0, 60)}"`,
      source_says: c.verdict === 'absent' ? '' : String(c.source_answer ?? ''),
    });
  }
  return out;
}
