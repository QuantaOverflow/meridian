/**
 * 【一次调用核查 · prompt】一句成稿、一次调用：system = 任务 + 检查清单 + 回复格式，user = 文章表 + 证据包 + 本块的句子。
 *
 * 逐字搬自冻结原型 `.scratch/one-call-sentence-check/port-source/one-call.mts`（TASK / CHECKS / PROSE(true) / prompts 里 `only` 有值的那一支）。
 * 读数是在这一版文字上测的（ADR 0012），**一个字都别改**。
 *
 * 清单文字与 `sentenceCheck.ts` 里 agent 的清单不是同一份（这份写 "Source [id:n] says"、末句是 "Decide a sentence only after steps 1–3 for that sentence."），
 * 所以不共用；`articleList` 与 `when` 是同一份，直接引。
 */
import { when, type CheckCluster } from '../utils/sentence-check';
import { articleList, type SentenceItem } from './sentenceCheck';
import type { OneCallPrompts } from '../types/one-call-check';

const TASK = `You check every sentence of one news brief item against the reporting it was written from (one news cluster).
A careful reader must not be misled. A sentence is wrong when any part of it says something the sources do not:
the wrong actor (who did or said it); a reversed direction; a relation between facts that no source states
(because, after, in response, as, in exchange for); a dropped qualifier or attribution (reportedly, according to,
expected, could); a figure that is wrong, stale (a later report changed it) or covers a different scope; a detail
changed, or merged from two separate facts; a fact no source gives; an earlier event presented as new; a part
that belongs to a different story. Accurate but awkward wording is fine, and so is faithful compression.
Check every part: who, what, numbers, time, qualifiers, and how the parts are linked. The support for a part may
be outside the sentences it cites, and a later report may contradict it.`;

const CHECKS = (date: string) => `How to check each sentence — do every step, in order:
1. Split the sentence into its parts: each actor and action, each figure, each time, each attributed or quoted
   claim, each link between parts (and, after, as, because, while, in response).
2. For each part, find the source sentences that state it — not only the cited ones — and restate both sides:
   "Sentence says: …" / "Source [id:n] says: …". Look for later or fuller reports of the same fact.
3. Check each part:
   - Time: when did the event happen? This brief was published on ${date} and covers about the day before. An
     event from before that must be dated or marked as earlier in the sentence; otherwise it reads as new.
   - Attribution: how do the sources attribute it — an official, a named person, an anonymous source, an outlet,
     "reportedly", or the reporter's own narration? The sentence must keep that attribution and its strength.
     One side's claim is not an agreement, and the absence of a denial is not support.
   - Figures: what exactly does the number count — which incident, place, group, time? Is it the latest value
     the cluster gives? If the sentence has two figures, are they from the same time and scope? Does the figure
     agree with the item's other sentences?
   - People: is every title or role in the sentence stated in the sources for that person? Do not use what you
     know about them.
   - Links: does a source state the link between the parts?
4. A part that matches its cited sentence can still be wrong: the cited sentence may be an early or partial
   report, a headline, or contradicted by a later report or by the item's other sentences. Check it.
Decide a sentence only after steps 1–3 for that sentence.`;

/** 没有一篇带日期时去掉的那一句（与 agent 的清单同一做法）：「Time」那条的其余部分照留。 */
const DATE_SENTENCE = (date: string) => `This brief was published on ${date} and covers about the day before. `;
const checksOf = (date: string | null) => (date ? CHECKS(date) : CHECKS('').replace(DATE_SENTENCE(''), ''));

// 原型的 PROSE(true)：只核一句的那一支
const PROSE = `Reply in two sections.
CHECKS
Do steps 1–4 for the sentence in writing: every part with the source words next to it, and for
each part every difference between the two, however small — a word added, dropped or changed, a different speaker,
a different count, time or order. Then say, for each difference, whether a careful reader of the sentence would
believe something the sources do not say.
RESULT
One JSON object: {"ok": true} or {"ok": false, "type": "actor | direction | relation | hedge | number | detail | fabricated | old-as-new | other-story",
 "problem": "what is wrong, in one sentence", "evidence": [[articleId, sentence], ...], "fix": "the sentence, corrected"}`;

const keyOf = (c: CheckCluster, k: string) => c.byKey.get(k)!;

export const oneCallPrompts: OneCallPrompts = (item: SentenceItem, c: CheckCluster, date, pack) => {
  const listing = pack.shown.map(k => keyOf(c, k)).map(s => `[${s.articleId}:${s.n}] (published ${when(s.published)}) ${s.text}`);
  const sentenceLines = item.sentences.map((text, i) => {
    if (i !== item.index - 1) return `S${i + 1}: ${text}`;
    const figures = pack.figures.length ? `\n   same thing counted, oldest report first: ${pack.figures.map(k => `[${k}]`).join(' ')}` : '';
    return `S${i + 1}: ${text}\n   cites: ${pack.cites.map(k => `[${k}]`).join(' ')}\n   also relevant: ${pack.also.map(k => `[${k}]`).join(' ') || '–'}${figures}`;
  });
  const task = TASK.replace('every sentence of one news brief item', 'one sentence of a news brief item').replace('A sentence is wrong', 'The sentence is wrong');
  const system = `${task}\n\n${checksOf(date)}\n\n${PROSE}`;
  const user = `The articles in this cluster, oldest first:
${articleList(c)}

Source sentences from the cluster (${listing.length} of ${c.sents.length}; the ones the item cites, their neighbours, the
closest matches for each sentence, and every sentence that counts the same thing as a figure in the item), oldest report first:
${listing.join('\n')}

The brief item — title: ${item.title}
${sentenceLines.join('\n')}\n\nCheck S${item.index}. The other sentences are context.`;
  return { system, user };
};
