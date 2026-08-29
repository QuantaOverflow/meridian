/**
 * b′ 方案的提示词：**因果主线章节 + 独立事态**，简报分段写。
 *
 * 与 briefGeneration.ts 的整篇合成是两条路径，不是替换关系上的同一份 prompt：
 *   整篇合成  1 次调用把 N 份报告写成简报 —— 落地率 12%-56%（3-14 块，天天跳）
 *   b′        1 次规划 + N 次块写作     —— 落地率 100%（25/25，两轮零失败）
 *
 * b′ 的核心是把**结构**从模型手里拿走：块标题由规划步产出，章节归属、`<u>` 包装、
 * 覆盖补齐全部由代码做（见 brief-generation.ts 的 shapeSkeleton/assembleBrief）。
 * 写作调用只剩「写好这几段散文」，非空即成功，没有格式可违反。
 *
 * 反面教训（v1/v2 实测，别回退）：
 *   · 让模型「写一整节、节内自己分块、自己打 <u>」→ 整节忘打标记，前端靠数 <u> 认故事，丢整节
 *   · 要求「首行标题、空行、正文」→ 约 30% 的调用直接从正文写起，一整块作废
 */
import { GROUNDING_RULES } from './briefGeneration';

/**
 * 规划步：只读 N 条 executiveSummary，推因果主线并给每份报告一个块标题。
 * 明确允许「一份报告独自成节」——逼模型把无关联的报告塞进邻节凑整齐，是 v1 糊章节的来源。
 */
export function getBriefSkeletonPlanPrompt(summaries: string[]): string {
  const n = summaries.length;
  const list = summaries.map((s, i) => `[${i + 1}] ${s}`).join('\n\n');
  return `below are ${n} intelligence reports from today. decide the SECTION
structure of the brief. do not write the brief.

${list}

a section is a real through-line: several reports that genuinely belong together through a
shared conflict, a shared mechanism, or a shared consequence. it is NOT a topic bucket.

- if two reports share only a country or a topic word but nothing causal, they belong in
  DIFFERENT sections.
- a heading that could sit on any day's brief ("technology", "world news", "geopolitics")
  is a failed heading. name the section after what actually happened.
- some reports describe the same single event from different angles — put those together.
- there is no target number of sections. derive it from the material.
- a report that shares no causal link with any other report is fine on its own — give it a
  section of exactly one report. do NOT force it into a neighbouring section to look tidy.
- for each section, state the causal link in one clause: what makes these one story.

also give every report a block title: a short phrase naming what that specific development is.
titles sit next to each other in a table of contents, so make each one distinguishable — two
reports in the same section must not get near-identical titles.
**write titles in lowercase**, including proper nouns — that is this brief's house style
(e.g. "the six-month stalemate in the persian gulf", "from treaty partner to 51st state").
do NOT use Title Case.

output json only:
{"sections":[{"heading":"...","causalLink":"...","reports":[{"i":1,"title":"..."},{"i":4,"title":"..."}]}]}
every report index 1-${n} must appear exactly once.`;
}

/**
 * 补标题：规划步偶尔给某条报告漏了 title，或该索引根本没出现在规划里（被代码补进独立事态）。
 * 20 token 的小调用，比重跑整个规划便宜得多，也比用 `story 7` 这种占位标题交付强。
 */
export function getBlockTitlePrompt(executiveSummary: string): string {
  return `give a short plain-text title (a phrase, under 10 words) for this news development.
write it in lowercase, including proper nouns. output the title and nothing else.

${executiveSummary}`;
}

// 文风。刻意**不含**「use **bold** for key specifics」：那句是写原型时自己加的，不是从生产
// prompt 继承来的，实测把粗体密度推到 2.63 条每千字，而生产第 68-75 期是 0.00-0.81
// （69、71 两期全篇零粗体）——凭空把简报的视觉密度改成了另一个东西。
const VOICE = `write in lowercase by default, conversational and direct, complete sentences.
blend facts and analysis in flowing paragraphs — what happened, why it matters strategically,
the likely motivations, second-order effects, and what most people are missing.
use markdown emphasis sparingly, only where a specific genuinely carries the paragraph.`;

// 输出契约：**只有散文**。标题也是结构，已由规划步产出，写作调用不许再写一个。
const SHAPE = `write flowing paragraphs and nothing else.
no title line, no \`##\` heading, no \`<u>\` tags, no bullet list, no preamble, no sign-off —
the title is supplied elsewhere, do not write one.
do not let the \`[story k/N]\` tag appear in your output.`;

export interface BlockSectionContext {
  heading: string;
  causalLink: string;
  /** 同节其他块的 executiveSummary，用来防重复叙述（不是让模型去写它们） */
  siblingSummaries: string[];
}

/**
 * 写作步：一份报告 = 一次调用 = 一个块。
 *
 * `storyMarkdown` 只放**这一份**报告——防串源的关键。b′ 之前的臂让每次调用都看得见全部
 * 报告，模型会把邻近报告的实体嫁接进来（加州总检察长写成另一个州的）。
 * 校验环节（RARR）才用全量源，那是另一回事：写作要窄，核对要宽。
 */
export function getBriefBlockPrompt(
  storyMarkdown: string,
  title: string,
  section?: BlockSectionContext
): string {
  const ctx = section
    ? `this block belongs to the section **${section.heading}** — what makes that section one story:
${section.causalLink}

the same section also covers the developments below, each written up separately by someone
else. do NOT re-tell them; assume the reader has them. you may refer to the through-line, but
your paragraphs must be about YOUR story only:
${section.siblingSummaries.map((s) => `  · ${s}`).join('\n')}`
    : `this development stands on its own — it shares no causal line with the rest of today's
news. cover it on its own terms and do NOT reach for connections to stories you don't have.
be substantive but tight: this is a standalone item, not a headline act.`;

  return `you are writing ONE analysis block of today's intelligence brief.
the block already has its title: **${title}** — write the paragraphs that sit under it.

${ctx}

<curated_news_data>

${storyMarkdown}

</curated_news_data>

**CRITICAL: FACTUAL GROUNDING RULES (these outrank everything below)**
${GROUNDING_RULES}

${VOICE}

${SHAPE}`;
}
