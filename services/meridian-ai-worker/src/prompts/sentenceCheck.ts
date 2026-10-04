/**
 * 【逐句核查 · prompt】核查 agent 的任务、检查清单、结论格式、文本协议与检索工具说明。
 *
 * 逐字搬自原型 `apps/backend/prototypes/writer-faithfulness/`（本地，不入库；冻结副本在
 * `.scratch/writer-checker-loop/port-source/`）：`checkers.mts` 的 SENTENCE_TASK / CHECKS（只取 v2 清单，
 * 不带 LINKS_V3）/ VERDICT / sentenceBlock / sentencePrompts（文本协议那一支），`agent-kit.mts` 的
 * PROTOCOL / LOOKUP_TOOLS / articleList。ADR 0010 的 held-out 读数就是这一版测出来的，**一个字都别改**。
 */
import { when, type CheckCluster } from '../utils/sentence-check';

/** 核一句时 agent 拿到的那块与那句（原型 checkers.mts 的 SentenceItem，去掉了 blockId）。 */
export interface SentenceItem {
  title: string;
  sentences: string[];
  /** 被核的那句的句号（1 起） */
  index: number;
  text: string;
  cited: [number, number][];
}

const SENTENCE_TASK = `You check one sentence of a news brief against the reporting it was written from (one news cluster).
A careful reader must not be misled. The sentence is wrong when any part of it says something the sources do not:
the wrong actor (who did or said it); a reversed direction; a relation between facts that no source states
(because, after, in response, as, in exchange for); a dropped qualifier or attribution (reportedly, according to,
expected, could); a figure that is wrong, stale (a later report changed it) or covers a different scope; a detail
changed, or merged from two separate facts; a fact no source gives; an earlier event presented as new; a part
that belongs to a different story. Accurate but awkward wording is fine, and so is faithful compression.
Check every part: who, what, numbers, time, qualifiers, and how the parts are linked. The support for a part may
be outside the sentences it cites, and a later report may contradict it.`;

// v2：把每个维度都变成必做一步的检查清单（原型 verify-agent.mts 记了为什么）
const CHECKS = (date: string) => `How to check — do every step, in order:
1. Split the sentence into its parts: each actor and action, each figure, each time, each attributed or quoted
   claim, each link between parts (and, after, as, because, while, in response).
2. For each part, find the sentences in the cluster that state it — not only the cited ones — and restate both
   sides: "Sentence says: …" / "Source says: …". Look for later or fuller reports of the same fact.
3. Check each part:
   - Time: when did the event happen? This brief was published on ${date} and covers about the day before. An
     event from before that must be dated or marked as earlier in the sentence; otherwise it reads as new.
   - Attribution: how do the sources attribute it — an official, a named person, an anonymous source, an outlet,
     "reportedly", or the reporter's own narration? The sentence must keep that attribution and its strength.
     One side's claim is not an agreement, and the absence of a denial is not support.
   - Figures: what exactly does the number count — which incident, place, group, time? Is it the latest value
     the cluster gives? If the sentence has two figures, are they from the same time and scope? Does the figure
     agree with the item's other sentences?
   - People: is every title or role in the sentence stated in the cluster for that person? Do not use what you
     know about them.
   - Links: does a source state the link between the parts?
4. A part that matches its cited sentence can still be wrong: the cited sentence may be an early or partial
   report, a headline, or contradicted by a later report or by the item's other sentences. Check it.
Decide only after steps 1–3. In your last Thought, list the parts and what each check found.`;

/**
 * 没有一篇带日期时去掉的那一句：清单里「Time」那条的其余部分照留（原样从 CHECKS 里删这一句，CHECKS 本身不动）。
 */
const DATE_SENTENCE = (date: string) => `This brief was published on ${date} and covers about the day before. `;
const checksOf = (date: string | null) => (date ? CHECKS(date) : CHECKS('').replace(DATE_SENTENCE(''), ''));

const VERDICT = `{"ok": true} or {"ok": false, "type": "actor | direction | relation | hedge | number | detail | fabricated | old-as-new | other-story",
 "problem": "what is wrong, in one sentence", "evidence": [[articleId, sentence], ...], "fix": "the sentence, corrected"}`;

const PROTOCOL = `Each turn, reply in exactly this format and nothing else:
Thought: <what you know, what you still need to check, and why this action>
Action: <one tool name>
Args: <one JSON object, on one line; escape a double quote inside a string as \\">`;

const LOOKUP_TOOLS = `- search {"query": "words"}: the cluster sentences that best match the words, up to 8, each labeled
  [articleId:sentence] with its article's publish time.
- timeline {"term": "a name, a word or a number"}: every cluster sentence containing the term, oldest report
  first. Use it to see how a fact changed between reports: counts, totals, forecasts, outcomes, statuses.
- read {"articleId": 123, "sentence": 4}: that sentence with two sentences before and after it, to see who is
  speaking and what "it", "also" or a heading refers to.`;

function articleList(c: CheckCluster): string {
  return [...c.articles]
    .sort((a, b) => a.published.localeCompare(b.published))
    .map(a => `[${a.id}] published ${when(a.published)}: ${a.title}`)
    .join('\n');
}

function sentenceBlock(item: SentenceItem, c: CheckCluster): string {
  const cited = item.cited
    .map(([a, n]) => c.byKey.get(`${a}:${n}`))
    .filter(Boolean)
    .map(s => `[${s!.articleId}:${s!.n}] (published ${when(s!.published)}) ${s!.text}`);
  return `The brief item, for context — title: ${item.title}
${item.sentences.map((s, i) => `S${i + 1}: ${s}`).join('\n')}

Check S${item.index}: ${item.text}
It cites:
${cited.join('\n')}`;
}

/**
 * 核查 agent 的 system 与 user prompt（原型 sentencePrompts 的文本协议一支、v2 清单）。
 * `date`：简报日期（YYYY-MM-DD）；null = 请求里没有带日期的文章，清单里去掉那句日期。
 */
export function sentencePrompts(item: SentenceItem, c: CheckCluster, date: string | null, maxSteps = 20): { system: string; user: string } {
  const system = `${SENTENCE_TASK}

${checksOf(date)}

${PROTOCOL}

Tools:
${LOOKUP_TOOLS}
- verdict ${VERDICT}: your result; it ends the task.

The checker rejects a verdict "ok": false that cites no evidence, or evidence that was never shown to you.
You have at most ${maxSteps} actions.`;
  const user = `The articles in this cluster, oldest first (${c.sents.length} sentences; look them up with the tools):
${articleList(c)}

${sentenceBlock(item, c)}`;
  return { system, user };
}
