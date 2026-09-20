/**
 * 【简报块 v6 · prompt】逐字搬自原型
 * `scripts/eval/cluster-to-brief/arms/direct-raw/direct-raw.mjs`（`anchorPrompt` / `writePrompt`），
 * 取 `WRITE_AT_END=1 / WRITE_TIER=exec / WRITE_SUPPORT=1 / WRITE_REPAIR=mech` 这一条路径上的
 * 展开结果（ANCHOR_SOURCES=4、WRITE_LEN={max:5,sources:8,exec 文案}、REPAIR_FULL=false）。
 *
 * **一个字都别改**：每句措辞都有实测来历（原型 25–64 行的注释记了试过又撤掉的那些），
 * 改一个字就挪动了已冻结的读数。要改先回原型重跑 eval。
 */
import { ANCHOR_SOURCES, WRITE_MAX_SENTENCES, WRITE_MAX_SOURCES, type V6Anchor, type SentenceTable } from '../utils/brief-block-v6';
import { writeMaterial } from '../utils/brief-block-v6';

// ── 窗口步：只标重点，不写散文 ──────────────────────────────────────────
export const ANCHOR_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['anchors'],
  properties: {
    anchors: {
      type: 'array', maxItems: 12,
      items: {
        type: 'object', additionalProperties: false, required: ['topic', 'sources'],
        properties: {
          topic: { type: 'string', maxLength: 100 },
          sources: {
            type: 'array', minItems: 1, maxItems: ANCHOR_SOURCES,
            items: {
              type: 'object', additionalProperties: false, required: ['articleId', 'sentence'],
              properties: { articleId: { type: 'integer' }, sentence: { type: 'integer' } },
            },
          },
        },
      },
    },
  },
} as const;

export function getAnchorPrompt(window: { index: number; text: string }, totalWindows: number): string {
  return `You are one pass of a news brief pipeline. Below is raw source text, with every sentence
labeled [articleId:sentence]. This is window ${window.index + 1}/${totalWindows} of one cluster; it may
contain several unrelated stories. Do NOT write any prose. Your job is only to mark what matters.

List up to 12 key points from this raw text. A key point is one newsworthy claim: what happened,
a concrete figure, a consequence, or a named person's statement. For each key point give a short
event-specific label in topic, and in sources cite the exact sentence(s) that state it — if several
articles report the same claim, cite them together (up to ${ANCHOR_SOURCES}). Prefer claims corroborated by
multiple articles, but a specific important claim may cite one source. Do not merge different
claims into one key point.

RAW ARTICLES\n${window.text}\n\nReturn only JSON matching this schema:\n${JSON.stringify(ANCHOR_SCHEMA)}`;
}

// ── 写作步：一簇一块正文，逐句标出处 ────────────────────────────────────
export const WRITE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdict', 'reason', 'title', 'sentences'],
  properties: {
    verdict: { type: 'string', enum: ['written', 'not_a_single_event'] },
    reason: { type: 'string', maxLength: 500 },
    title: { type: 'string', maxLength: 120 },
    sentences: {
      type: 'array', maxItems: WRITE_MAX_SENTENCES,
      items: {
        type: 'object', additionalProperties: false, required: ['text', 'sources'],
        properties: {
          text: { type: 'string', maxLength: 400 },
          sources: {
            type: 'array', minItems: 1, maxItems: WRITE_MAX_SOURCES,
            items: {
              type: 'object', additionalProperties: false, required: ['articleId', 'sentence'],
              properties: { articleId: { type: 'integer' }, sentence: { type: 'integer' } },
            },
          },
        },
      },
    },
  },
} as const;

export function getWritePrompt(anchors: V6Anchor[], sentences: SentenceTable): string {
  return `You are writing one item for a daily world-news brief, in English, for a reader who has not
seen any of the material. The material below is key points marked in the reporting of one news
cluster, each followed by the original source sentences, labeled [articleId:sentence]. The labels
are for citing only.

<material>
${writeMaterial(anchors, sentences, true, true)}
</material>

Decide first: if the material has no single dominant story (a miscellaneous topic bag), return
verdict not_a_single_event with a reason, an empty title and no sentences. Otherwise write ONE item
about the dominant story; leave out key points that belong to other stories.

Key points are ordered by how many articles reported them. The points marked MUST COVER are the
most widely reported and are part of this story by definition: include every one of them, even if
it looks like a separate thread (for example a rescue alongside a cost report) — at summary
level is enough: the reader must learn its substance, not its detail. Then add other
points as space allows, preferring the more widely reported ones.

How to write it:
- An executive brief: 3–5 sentences in a single paragraph, at most about 800 characters.
  The first sentence is the bottom line — the single most important development, stated so a busy
  reader who stops there knows what happened. Each following sentence synthesizes a group of
  related key points into one statement at a higher level (for example the losses, the costs, the
  official reactions), keeping only the one or two figures that matter most; never enumerate items.
  Say why it matters only when a source states it, and attribute it ("the report warned...").
  Write no analysis, motivation or prediction of your own. It must read as one connected item, not a list of facts: compress minor
  detail, and put related figures together in one sentence.
- Say each fact once. If several key points report the same fact, use it once.
- Use only facts, names and figures from the original sentences; never from memory. Any number in
  a sentence must appear in a source sentence that sentence cites. Keep attribution and
  uncertainty: every opinion, prediction or interpretation belongs to a named person or outlet.
  Present one event as the cause of or response to another only when a source sentence says so.
  Do not present different people's statements as agreeing with, echoing or answering each other
  unless a source sentence says so; report each person's statement on its own.
- Copy a quote word for word inside quotation marks and name its speaker.
- For each sentence, cite in sources the exact source sentences that support every part of it
  (up to ${WRITE_MAX_SOURCES}). Never write the [articleId:sentence] labels inside text.
- Plain prose, normal sentence case. title: a short headline for the story, under 10 words.

Return only JSON matching this schema:\n${JSON.stringify(WRITE_SCHEMA)}`;
}
