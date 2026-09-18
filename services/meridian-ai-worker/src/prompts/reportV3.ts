/**
 * 【报告层 v3 · prompt】一个簇的原文 → 带出处的事实、当事方、分歧。
 *
 * 三个 prompt 逐字搬自原型（apps/backend/prototypes/srl-extractive/，只在本地）：
 *   抽取   cite-select.mjs 的 INSTRUCTIONS + CITE_SCHEMA（挑重点的带出处自由句）
 *   去重   dedup-v2.mjs 的分组判定 prompt（同一事实的判据 + 三类不许合并 + 示例）
 *   各方   prompt-voices-md.md（概述 / 当事方 / 分歧，markdown 输出）
 * 措辞是实测出来的（见 docs/adr/0004-brief-writer-v3.md 与 memory report-extraction-dedup-conclusions），
 * 改之前先看那两处的证伪清单。
 */

// ── 抽取 ────────────────────────────────────────────────────────────────
const CITE_INSTRUCTIONS = `You are writing down the factual record of a news story from the numbered sentences above, for a downstream writer who can look up any original sentence by its number.

Write only the facts that matter for the story these articles are about: the main events, actions, decisions and measures, with their key figures and dates. For each such fact:
- write one short, self-contained sentence in your own words. Name the actor (no "he", "it", "they"), say what happened and to what, and keep every number the sentences give for it;
- cite the number(s) of the sentence(s) it comes from; if several sentences report the same fact, write it once and cite all of them.

Skip: background detail, colour and earlier history unless it is central to the story; quotes of positions, reactions and commentary. What someone said counts only when saying it was itself the event (a bill announced, a verdict delivered, a threat issued) — not their opinion about it.

Only what the cited sentences say. Every name and number in your sentence must appear in a sentence you cite.

It is fine to write very few facts, or none, for a batch of sentences that adds nothing beyond what you would already have from the rest of the story. Do not pad the list and do not write the same fact twice.`;

export const CITE_SCHEMA = {
  type: 'object',
  required: ['facts'],
  additionalProperties: false,
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['text', 'cite'],
        additionalProperties: false,
        properties: {
          text: { type: 'string', minLength: 1, description: 'The fact as one short, self-contained sentence in your own words.' },
          cite: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the sentences this fact comes from, as integers (3, not "s3").' },
        },
      },
    },
  },
} as const;

const CITE_FORMAT = `Answer with a JSON object matching this schema:
${JSON.stringify(CITE_SCHEMA, null, 1)}

Example (made-up, not from these articles):
{"facts":[{"text":"Meridian Robotics recalled 40,000 delivery drones after battery fires damaged two warehouses","cite":[3,9]}]}`;

/**
 * 产出约束。2026-09-14 实测（`prototypes/cost-split/`，满覆盖对照）：
 * neurons/句 −8~19%、completion token/句 −19~40%，而**召回不降反升**（c18 20→22，c0 12→13 满分），
 * 越界引用 0 条。机制是把「写重复」和「写漏」分开惩罚——只说「别灌水」会让模型连主线一起省。
 *
 * ⚠️ 位置是实测的一部分：它拼在**整个 prompt 的最末尾**（JSON 格式示例之后）。挪位置等于换了一个没测过的 prompt。
 * 相关节点：docs/knowledge/nodes/decision-tighter-output-constraint.md
 */
const OUTPUT_CONSTRAINT = `

One more constraint on your output: be as short as possible while still covering every fact that matters for the story. Prefer fewer, denser facts over many overlapping ones — if two candidate facts would largely restate the same event, merge them into the single most complete sentence instead of writing both. Do not add a fact whose content is already fully covered by an earlier fact in your list. Every fact you omit that a downstream writer would need is a miss, so do not cut facts that are load-bearing for the story — cut only redundancy and marginal detail.`;

export interface CiteBatchPart {
  article: { id: number; title: string; publishDate?: string };
  localStart: number;
  sentences: string[];
}

/** 句子编号跨整批连续；调用方负责把 s<k> 映射回（文章, 句号）。 */
export function getCitePrompt(parts: CiteBatchPart[]): string {
  let n = 0;
  const sections = parts
    .map((p, i) => {
      const lines = p.sentences.map(x => `s${++n}: ${x}`).join('\n');
      return `Article ${i + 1}${p.localStart > 0 ? ' (continued)' : ''}: ${p.article.title}\nPublished: ${p.article.publishDate ?? 'unknown'}\n${lines}`;
    })
    .join('\n\n');
  return `Numbered sentences (numbering runs across all articles in this batch):\n\n${sections}\n\n${CITE_INSTRUCTIONS}\n\n${CITE_FORMAT}${OUTPUT_CONSTRAINT}`;
}

// ── 去重 ────────────────────────────────────────────────────────────────
export const PARTITION_SCHEMA = {
  type: 'object',
  required: ['subgroups'],
  additionalProperties: false,
  properties: {
    subgroups: {
      type: 'array',
      items: {
        type: 'object',
        required: ['indices', 'figuresDiffer'],
        additionalProperties: false,
        properties: {
          indices: { type: 'array', items: { type: 'integer' } },
          figuresDiffer: { type: 'boolean' },
        },
      },
    },
  },
} as const;

const PARTITION_EXAMPLE = `Example (illustrative only, not from the real data):
[0] The mayor announced a $2 million renovation of the central park starting in March.
[1] City officials confirmed a $2.3 million renovation of the park will begin in the spring.
[2] The mayor's office set April 15 as the deadline for park renovation bids.
[3] Local vendors criticized the short bidding window for the park project.
[4] The mayor's office set the bid deadline for park renovation as April 15.
[5] The county approved a separate $2 million grant for river cleanup.

Correct partition: subgroups = [
  {"indices": [0,1], "figuresDiffer": true},
  {"indices": [2,4], "figuresDiffer": false},
  {"indices": [3], "figuresDiffer": false},
  {"indices": [5], "figuresDiffer": false}
]
- 0 and 1 both state that the mayor's office announced the park renovation — same fact, different wording, different reported figures ($2M vs $2.3M): figures for the same quantity don't need to match to be the same fact.
- 2 and 4 both state the bid deadline was set to April 15 — a DIFFERENT fact from the announcement (0/1), even though it's part of the same event/speech. Category (b): different claims in the same event.
- 3 is a reaction/opinion, not a restatement of any fact above — stays alone.
- 5 shares the number "$2 million" with 0/1, but is a different actor (the county, not the mayor) doing a different action (a grant, not a park renovation) on a different subject (river cleanup, not the park). Category (c): sharing a round number or topic is NOT evidence of being the same fact — keep it separate.`;

export const PARTITION_INTRO = {
  r1: 'You are deduplicating short fact sentences extracted from several news articles about the same story. Several articles can report the exact same underlying fact in different wording; the sentences below were flagged as similar candidates by an automated first pass.',
  r2: 'You are checking, across several already-deduplicated groups of facts from the same news story, whether any of them actually state the same underlying fact (they were grouped separately by an earlier pass and may have been missed). Each sentence below is the representative wording of one such group.',
  r3: (n: number) =>
    `You previously grouped the ${n} sentences below as all stating the same underlying fact. Double-check: do ALL of them really state the same fact? If any state a different fact (see the categories above), split them out into their own subgroup.`,
};

export function getPartitionPrompt(items: string[], intro: string): string {
  const listed = items.map((t, i) => `[${i}] ${t}`).join('\n');
  return `${intro}

Two entries state the same fact when they have the same actor, the same action, and the same object/target — regardless of exact wording. Different reported figures (numbers, amounts, dates, percentages) for the same quantity still count as the same fact.

Do NOT merge entries that fall into any of these categories, even if they look similar:
(a) Different actors doing the same kind of action (e.g. two different countries each imposing their own 50% tariff — same action, different actor, NOT the same fact).
(b) Different claims made in the same event or speech (e.g. a minister announcing a new bill, and the same minister separately setting the bill's deadline — two different facts from one speech).
(c) Entries that merely share a round number or a topic without describing the same specific action (e.g. two unrelated budget items that both happen to be "$10 million").

For each subgroup you output, also report whether the figures (numbers/amounts/dates/percentages) differ across its member entries.

${PARTITION_EXAMPLE}

Now here are the real entries:
${listed}

Every entry (0 to ${items.length - 1}) must appear in exactly one subgroup — a subgroup may contain just one entry if it states a fact none of the others do. Return the full partition as "subgroups".`;
}

// ── 各方与分歧 ──────────────────────────────────────────────────────────
const VOICES_TEMPLATE = `You are indexing a news cluster for a downstream writer who can search the full original articles themselves: what the story is, who spoke, and where the coverage disagrees. A person missing from your list is a source that writer will never retrieve.

**You are not deciding who matters.** List everyone. Which voice is worth quoting is judged downstream.

Output **pure markdown only**. No JSON, no tags. Use exactly this structure and nothing else:

# Summary
<2-4 sentences: what this is. A downstream planning step reads this section alone with no other context, so it must stand on its own.>

## Parties
* <name> (<the identity this reporting gives them>) — <what they claim, want, or face, in your own compressed words>

## Conflicts
* <what the articles do not agree on> — <side A as the articles state it> vs <side B as the articles state it>

<articles>
{{ARTICLES}}
</articles>

## Section rules

**# Summary** — report only what these articles say happened. If a detail is not in their reporting, it is not in this summary, however sure you are that it is true.

**## Parties** — list **every** person and organization who is quoted, or whose position or action is described: principals, and equally analysts, historians, economists, industry associations, research institutes, spokespeople, officials, companies, named witnesses. A name missing here is a source the downstream writer will never retrieve.

- Their identity comes only from what this reporting gives them — no title, year, or biography from outside knowledge.
- Compress their position into your own short clause. Their actual wording stays in the articles for the writer to retrieve.
- This is where "X said Y" belongs: state what X holds, not the sentence X uttered.
- A photographer, a byline, or someone merely named — with no position and no action described — is not a party.
- Write names as plain text. No bold, no asterisks, no other markdown inside a name, identity or clause.

**## Conflicts** — record where the articles do not line up: different figures for the same thing, a claim one party rebuts, two incompatible accounts of one event. State both sides as the articles state them.

- Numeric mismatches carry their numbers ("death toll: 7 vs 11", "$20bn vs $27.6bn").
- Record the mismatch and stop. Do not say which side is right, whether it is resolved, or whether it matters — those are downstream judgements.
- One side only counts as a conflict when another article or party contradicts it. A figure or claim that nothing in the coverage contests is a fact, and a separate step records facts.
- Write each conflict as exactly two sides separated by " vs ". One line per disagreement — do not pile several disagreements, or a list of figures, into one line.
- If the articles agree throughout, write \`* none\`.

## Do not include

Events and their dates — a separate step handles the factual record. Quotations: compress each position into your own clause; the original wording stays in the articles for the writer to retrieve.`;

export function getVoicesPrompt(articlesMarkdown: string): string {
  return VOICES_TEMPLATE.replace('{{ARTICLES}}', articlesMarkdown);
}
