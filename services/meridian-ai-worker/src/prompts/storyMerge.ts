/**
 * 去重层的确认 + 起标题提示词。
 *
 * 上游 backend 已用 story centroid 余弦（阈值 0.94、单链）把同簇的重复故事聚成组，
 * 这里只做两件确定性代码做不了的事：
 *   ① 两条一组时确认「是不是同一个发生」——单边支撑，余弦分不开真假。
 *      实测反例：「基辅袭击 vs 泽连斯基无人机计划」(0.9445，不该合) 夹在
 *      「纳根德拉辞职」(0.9579，该合) 与「科伦坡测试赛」(0.9423，该合) 中间。
 *   ② 给合并后的故事起一个新标题（不从成员里挑——挑出来的往往是分量最重的那条，
 *      会把其它成员讲的事盖掉）。
 * ≥3 条的组有多条边互相印证，不做确认，只起标题。
 *
 * 判准逐字取自 story-validation 的金标 rubric（2026-08-30 人工标注 94 条确认）。
 */

export interface MergeCandidate {
  title: string;
  /** 该故事的成员报道标题，用来判断底层发生是不是同一个 */
  articleTitles: string[];
}

const CRITERIA = `An "occurrence" is one real happening in the world.

- Different STAGES or FOLLOW-UPS of one storyline are ONE occurrence.
  A protest, then the negotiations, then the exam being cancelled — one occurrence.
  A person detained, then deported — one occurrence.
  A disaster, then the rescue, then the aid, then the updated death toll — one occurrence.
- Two happenings are DIFFERENT occurrences only when the underlying happening itself
  differs. Two separate rulings by the same court, two airstrikes on different days of
  the same war, an attack by one side and an announcement by the other — different,
  even when the subject matter is identical.
- Sharing a country, a person, a topic or a conflict is NOT a reason to call them one
  occurrence.`;

/** 两条一组：确认 + 起标题。 */
export function getStoryMergeConfirmPrompt(candidates: MergeCandidate[]): string {
  const block = candidates
    .map((c, i) => `[${i + 1}] ${c.title}\n${c.articleTitles.map((t) => `    - ${t}`).join('\n')}`)
    .join('\n\n');

  return `Two news stories below were produced from the same article cluster and look
near-identical by embedding. Decide whether they report the SAME occurrence.

${CRITERIA}

${block}

If they are the same occurrence, also give ONE title covering both: factual, descriptive,
neutral, naming the one concrete event (a region prefix like "Nepal — " is fine).
No editorialising. Do not favour either input title — write the title the merged story
deserves.

Output ONLY JSON:
{"same_occurrence": true|false,
 "title": "<merged title, empty string when same_occurrence is false>",
 "reason": "<one clause naming the occurrence(s)>"}`;
}

/** ≥3 条一组：不确认，只起标题。 */
export function getStoryMergeTitlePrompt(candidates: MergeCandidate[]): string {
  const block = candidates.map((c, i) => `[${i + 1}] ${c.title}`).join('\n');
  return `The news stories below all report the same occurrence and have been merged into
one. Write ONE title for the merged story.

${block}

Factual, descriptive, neutral; name the one concrete event (a region prefix like
"Nepal — " is fine); no editorialising. Do not just copy the longest or most dramatic
input — several of these describe different aspects of the same happening, and the title
must cover the whole thing rather than one aspect.

Output ONLY JSON:
{"title": "<merged title>"}`;
}
