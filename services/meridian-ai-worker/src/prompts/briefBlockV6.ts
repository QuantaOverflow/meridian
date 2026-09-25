/**
 * 【简报块 v6 · prompt】逐字搬自原型
 * `eval/cluster-to-brief/arms/direct-raw/direct-raw.mjs`（`anchorPrompt` / `writePrompt`），
 * 取 `WRITE_AT_END=1 / WRITE_TIER=exec / WRITE_SUPPORT=1 / WRITE_REPAIR=mech` 这一条路径上的
 * 展开结果（ANCHOR_SOURCES=4、WRITE_LEN={max:5,sources:8,exec 文案}、REPAIR_FULL=false）。
 *
 * **exec 档一个字都别改**：每句措辞都有实测来历（原型 25–64 行的注释记了试过又撤掉的那些），
 * 改一个字就挪动了已冻结的读数。要改先回原型重跑 eval。
 *
 * 2026-09-21 三档各自一个篇幅：`more`（= 原 exec 档）逐字不变，`lead` 放到 7 句、
 * `brief` 收到 1 句。篇幅只由 schema 的 `sentences.maxItems` 约束——实测里句数准、
 * 字数（prompt 里的一句话）三档全超标，所以不加任何字数校验。
 * 见 `WRITE_LEN` 与 `COVERAGE_BRIEF` 上的注释。
 */
import {
  ANCHOR_SOURCES,
  WRITE_MAX_SENTENCES,
  WRITE_MAX_SOURCES,
  V6_TIERS,
  normalizeTier,
  type V6Anchor,
  type V6Tier,
  type SentenceTable,
} from '../utils/brief-block-v6';
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
/**
 * 篇幅档。形状与原型 `WRITE_LEN` 一致（max / sources / text）。
 *
 * `more` 是原型 `WRITE_TIER=exec` 的逐字展开，**一个字都别改**——那是唯一有实测读数的配置，
 * `test/fixtures/brief-block-v6-more-prompt.txt` / `-more-schema.json` 把它冻住了。
 * `lead` 只把篇幅那一句换成 5–7 句，其余逐字同 `more`；`brief` 收到一句。
 *
 * 篇幅只靠 `max`（→ schema 的 `sentences.maxItems`）约束：实测里句数由 schema 硬约束所以准，
 * 字数只是 prompt 里的一句话所以三档全超标。**不要加字数校验或截断。**
 */
export interface WriteLen {
  min: number;
  max: number;
  sources: number;
  text: string;
}

const WRITE_LEN: { lead: WriteLen; more: WriteLen; brief: WriteLen } = {
  lead: {
    min: 5,
    max: 7,
    sources: WRITE_MAX_SOURCES,
    text: `An executive brief: 5–7 sentences in a single paragraph, roughly 1,000–1,400 characters.
  The first sentence is the bottom line — the single most important development, stated so a busy
  reader who stops there knows what happened. Each following sentence synthesizes a group of
  related key points into one statement at a higher level (for example the losses, the costs, the
  official reactions), keeping only the one or two figures that matter most; never enumerate items.
  Say why it matters only when a source states it, and attribute it ("the report warned...").
  Write no analysis, motivation or prediction of your own.`,
  },
  more: {
    min: 3,
    max: WRITE_MAX_SENTENCES,
    sources: WRITE_MAX_SOURCES,
    text: `An executive brief: 3–5 sentences in a single paragraph, at most about 800 characters.
  The first sentence is the bottom line — the single most important development, stated so a busy
  reader who stops there knows what happened. Each following sentence synthesizes a group of
  related key points into one statement at a higher level (for example the losses, the costs, the
  official reactions), keeping only the one or two figures that matter most; never enumerate items.
  Say why it matters only when a source states it, and attribute it ("the report warned...").
  Write no analysis, motivation or prediction of your own.`,
  },
  brief: {
    min: 1,
    max: 1,
    sources: WRITE_MAX_SOURCES,
    text: `A single-sentence brief item, at most about 250 characters. State only the single
  most important development, at the level a reader who stops here needs. Do not enumerate
  secondary details, reactions or background. Say why it matters only when a source states
  it, and attribute it ("the report warned..."). Write no analysis, motivation or prediction
  of your own.`,
  },
};

/**
 * tier → 篇幅档。
 *
 * **不传 / 非法值走 `more` 档**（`normalizeTier` 同一个默认值）：本轮之前不传 tier 拿到的
 * 就是 exec 档（= 现在的 `more`）。`lead` 这轮改长了，默认若跟着它走，
 * 会把唯一有实测读数的那条路径静默换掉，所以默认在这里钉死在 `more`。
 */
const writeLenOf = (tier?: V6Tier | string): WriteLen =>
  WRITE_LEN[V6_TIERS.includes(tier as V6Tier) ? (tier as V6Tier) : 'more'];

/**
 * `no_sentences` 重试提示里的句数说明（bug B5）：句数是 tier 相关的（brief 档 schema
 * 的 sentences.maxItems 只有 1），写死一份「3-5 sentences」会在 brief 档上与 schema
 * 矛盾。句数只从 `WRITE_LEN`（经 `writeLenOf`）读，不在这里另抄一份数字。
 */
export function noSentencesHint(tier?: V6Tier | string): string {
  const { min, max } = writeLenOf(tier);
  const count = min === max ? `${max} sentence${max === 1 ? '' : 's'}` : `${min}-${max} sentences`;
  return `verdict written must come with ${count}.`;
}

const writeSchemaOf = (len: WriteLen) => ({
  type: 'object', additionalProperties: false, required: ['verdict', 'reason', 'title', 'sentences'],
  properties: {
    verdict: { type: 'string', enum: ['written', 'not_a_single_event'] },
    reason: { type: 'string', maxLength: 500 },
    title: { type: 'string', maxLength: 120 },
    sentences: {
      type: 'array', maxItems: len.max,
      items: {
        type: 'object', additionalProperties: false, required: ['text', 'sources'],
        properties: {
          text: { type: 'string', maxLength: 400 },
          sources: {
            type: 'array', minItems: 1, maxItems: len.sources,
            items: {
              type: 'object', additionalProperties: false, required: ['articleId', 'sentence'],
              properties: { articleId: { type: 'integer' }, sentence: { type: 'integer' } },
            },
          },
        },
      },
    },
  },
});

export const getWriteSchema = (tier?: V6Tier | string) => writeSchemaOf(writeLenOf(tier));

/**
 * 必写档说明。`lead` / `more` 原样不动（lead 从 5 句放到 7 句，MUST COVER 只会更好满足）。
 *
 * `brief` 档换掉：那一档只准写 1 句，而一个簇常有 5–12 条 MUST COVER，
 * 「每条都要写进去」与「只写一句」是自相矛盾的指令，模型只能二选一、选哪个不可控。
 * 排序信息保留（让模型知道哪条最多人报），只去掉「必须每条都覆盖」的要求。
 */
const COVERAGE_EXEC = `Key points are ordered by how many articles reported them. The points marked MUST COVER are the
most widely reported and are part of this story by definition: include every one of them, even if
it looks like a separate thread (for example a rescue alongside a cost report) — at summary
level is enough: the reader must learn its substance, not its detail. Then add other
points as space allows, preferring the more widely reported ones.`;

const COVERAGE_BRIEF = `Key points are ordered by how many articles reported them. Write about the most widely
reported one; leave out the rest.`;

export function getWritePrompt(anchors: V6Anchor[], sentences: SentenceTable, tier?: V6Tier | string): string {
  const len = writeLenOf(tier);
  const isBrief = normalizeTier(tier) === 'brief';
  return `You are writing one item for a daily world-news brief, in English, for a reader who has not
seen any of the material. The material below is key points marked in the reporting of one news
cluster, each followed by the original source sentences, labeled [articleId:sentence]. The labels
are for citing only.

<material>
${writeMaterial(anchors, sentences, !isBrief)}
</material>

Decide first: if the material has no single dominant story (a miscellaneous topic bag), return
verdict not_a_single_event with a reason, an empty title and no sentences. Otherwise write ONE item
about the dominant story; leave out key points that belong to other stories.

${isBrief ? COVERAGE_BRIEF : COVERAGE_EXEC}

How to write it:
- ${len.text} It must read as one connected item, not a list of facts: compress minor
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
  (up to ${len.sources}). Never write the [articleId:sentence] labels inside text.
- Plain prose, normal sentence case. title: a short headline for the story, under 10 words.

Return only JSON matching this schema:\n${JSON.stringify(writeSchemaOf(len))}`;
}
