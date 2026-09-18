/**
 * 【写作层 v3 的 prompt】输入是 report-v3 的渲染（utils/brief-writer-v3.ts renderReportForWriter：
 * 要点、其余细节、人物、原话、分歧），输出是简报里的一块英文正文。编排见 services/brief-writer-v3.ts。
 *
 * 几条对着已知失效的写法（apps/backend/prototypes/brief-writer-v3/GOAL.md「已知失败模式」）：
 *   · 不在 prompt 里写要禁止的措辞——写了模型就学会照抄那个句式。只正面说「观点要挂在具名的人下面」
 *   · 长度给字符区间 + 明确的形式（几段 / 一段 / 一句）和停止信号：要点、原话都是清单，清单 + 没有停止信号 = 复读高危
 *   · 不再为长度重写（「压到 X 字符」的重写会原样返回）；超硬上限由代码删尾句
 *   · 要点按报道日排，明说是报道日不是发生日
 */
import type { Tier } from '../utils/brief-writer-v3';

/** prompt 里给的目标区间（用户拍板）。硬上限在 utils TIER_MAX，由代码兜底。 */
export const TIER_TARGET: Record<Tier, [number, number]> = {
  lead: [1200, 2000],
  more: [500, 900],
  brief: [80, 180],
};

function tierTask(tier: Tier): string {
  const [lo, hi] = TIER_TARGET[tier];
  const words = `roughly ${Math.round(lo / 6)}–${Math.round(hi / 6)} words`;
  if (tier === 'lead') {
    return `This is the day's top story. Write ${lo.toLocaleString('en-US')}–${hi.toLocaleString('en-US')} characters (${words}) in three or four paragraphs separated by blank lines. Open with the most important development, then cover the key points in the order they happened and what the people involved said. Stop after the fourth paragraph at the latest.`;
  }
  if (tier === 'more') {
    return `This is one of the day's other important stories. Write a single paragraph of ${lo}–${hi} characters (${words}): what happened, the most important details, and what the people involved said. Stop at the end of that one paragraph.`;
  }
  return `This is a one-line item. Write exactly one sentence of at most ${hi} characters that tells the reader what happened.`;
}

const RULES = `How to write it:
- Build the item from the key points. They are listed in the order they were first reported, earliest first. These are reporting times, not event times, so take the order of events from the notes on how events relate and from the wording of the points.
- Where notes on how events relate are given, follow them. For an [update], give only the latest value and leave the earlier value out, also where a key point or a named person gives the earlier value. For a [conflict], if you mention that point, give both versions and who gave each. For a [future] event, use the future tense. Present one event as a response to, retaliation for, or result of another only when a [cause] note says so; otherwise report the events side by side.
- Use the other details only where they explain a key point.
- Use only facts, names and figures that appear in the material. Introduce a person by name and role, as listed under people.
- You may use the quotes. Copy a quote word for word inside quotation marks and name its speaker. Put quotation marks only around words taken from the quotes.
- Every opinion, prediction or interpretation in the item must belong to a named person from the material. Report what happened; leave the commentary to the people quoted.
- Mention any other disagreement between accounts only if you can state both versions concretely: who gave which figure or which claim. If you cannot name both versions, leave the disagreement out.
- Plain prose only: no title, no headings, no lists, no markdown formatting.
- Normal sentence case. Names of people, places and organisations keep their capital letters.`;

export function getWritePrompt(
  material: string, tier: Tier, relations = '',
  sameSurname: Array<{ surname: string; primary: string[]; roles: Record<string, string>; relatives: Array<{ of: string; names: string[] }> }> = []
): string {
  // 同姓的不同当事方：报道原文常只写姓，照抄就分不清是谁（c13 实测）。名单由代码从当事方里算出，每个当事方只点主名。
  // 只说「每次写全名」不够：新闻写法第二次提到就缩成姓（G3 Round 3/4 探针约一半块违反），所以给一个合规的替代——角色。
  // 同一条目里的家属按报道习惯称「关系 + 名」。放在 prompt 末尾（离输出最近）
  const names = sameSurname.map(g => {
    const who = g.primary.map(x => (g.roles[x] ? `${x} (${g.roles[x]})` : x)).join(' and ');
    const rel = g.relatives.map(r => ` Refer to ${r.names.join(' and ')}, listed with ${r.of}, by first name together with their relationship to ${r.of}.`).join('');
    return `\n\nDifferent people in this story share the surname ${g.surname}: ${who}. The material often calls them just "${g.surname}", so a reader cannot tell who is meant. Refer to each of them by full name, or after the first mention by their role as given in brackets; never by "${g.surname}" alone or with a title such as Mr or Ms.${rel}`;
  }).join('');
  return `You are writing one item for a daily world-news brief, in English, for a reader who has not seen any of the material.

<material>
${material}
</material>
${relations ? `\nNotes on how events relate. A model worked these out from the key points and their source sentences; they are not themselves quoted from the reporting:\n${relations}\n` : ''}
${tierTask(tier)}

${RULES}${names}

Reply with the item text only.`;
}

/**
 * 事件关系表（Goal 3）：写之前从事实 + 出处原句里抽出原文明说的先后、因果/回应、数字更新、说法冲突、将来的事。
 * 纯 JSON、无 schema、无条数上限（本仓实测 json_schema 召回减半、maxItems 被当成要凑满的数）。
 * 「只记原文明说的」是这一步的核心：模型会把时间上相邻写成因果（GOAL3「已知失败模式」）。
 */
export function getRelationsPrompt(facts: string, earlierTimes = ''): string {
  return `You are preparing notes for a news writer. Below are the facts reported about one news story. Each line starts with a reference [article:sentence] to the original sentence, then the time of the earliest report that carried it, then how many reports carried it. Some lines are followed by the original sentence.

<facts>
${facts}
</facts>
${earlierTimes ? `\nThese lines from the facts give a time earlier than the reports themselves (an earlier month or year, "last month"). Under some of them, "compare" lines from the facts share words with them and may report the same action:\n<earlier_times>\n${earlierTimes}\n</earlier_times>\n` : ''}
Find where the reporting states how these facts relate. Go through four checks, in this order:
1. Figures. For each figure reported with more than one value (a death toll, a count, an amount of money):
   - kind "update": a later report gives a newer value — the report times, or words such as "rose to", "later" or "revised", show it. Say what the latest value is and that it replaced the earlier one. In "sources", list every line that reports one of the values, the earlier ones as well as the latest.
   - kind "conflict": different sources give different values and neither is a later update of the other. Say which source gave which value.
2. Timing (kind "order"). Events the reporting dates (a day, a month, "earlier", "last week") or says came before or after another event. Then go through the lines under earlier_times one by one, with their compare lines: if a compare line reports the same action by the same party (the same announcement, attack or decision, not a different incident) without that earlier time, as a new development, or as a response, write an order note saying the action happened at the earlier time, put both lines in "sources", and do not write a cause note for that action.
3. Responses (kind "cause"). An action the reporting explicitly calls a response to, retaliation for, or result of another action; name both actions. Events that are only close in time are not a cause.
4. Future (kind "future"). Anything the reporting says is expected, planned, scheduled or will happen.

Each note must connect facts: two values of a figure, two events, or an event and its date or time. Do not restate a single fact on its own. Write each note as one plain sentence without reference numbers, and put the references it rests on in "sources". If the reporting does not state a relation, leave it out. When you have gone through the four checks, stop.

Reply with one JSON object and nothing else:
{"relations": [{"kind": "update", "statement": "one plain sentence", "sources": ["123456:7"]}]}`;
}

/**
 * one-source 变体（GOAL「限融合」spike）：每句正文最多用 1–2 个编号要点，规划（哪句用哪些要点）
 * 与写（照分组写）合成一次调用——产出 JSON，每句带上它用了哪些要点的编号，供代码做局部接地检查。
 */
function oneSourceTierTask(tier: Tier): string {
  if (tier === 'lead') return 'This is the day\'s top story. Write about 8–14 sentences across three or four paragraphs, roughly 1,200–2,000 characters in total. Open with the most important development, then cover the key points in the order they happened and what the people involved said. Stop after the fourth paragraph at the latest.';
  if (tier === 'more') return 'This is one of the day\'s other important stories. Write about 3–6 sentences in a single paragraph, roughly 500–900 characters in total: what happened, the most important details, and what the people involved said.';
  return 'This is a one-line item. Write exactly one sentence of at most 180 characters that tells the reader what happened, drawn from at most two of the key points below.';
}

const RULES_ONE_SOURCE = `How to write it:
- The material's key points are numbered, e.g. [3]. Write the item sentence by sentence; each sentence must be based on at most two numbered key points (record their id or ids in "points"). Do not pull a name, figure or claim from a third key point into that sentence — if a detail belongs to another point, give it its own sentence. You may use connecting words between sentences (but, meanwhile, the day before, two days later); do not invent a fact to make the connection.
- The key points are listed in the order they were first reported, earliest first. These are reporting times, not event times, so take the order of events from the notes on how events relate and from the wording of the points.
- Where notes on how events relate are given attached to a point ([update]/[order]/[conflict]/[future]/[cause]), follow them for the sentence(s) built on that point. For an [update], give only the latest value and leave the earlier value out. For a [conflict], if you mention that point, give both versions and who gave each. For a [future] event, use the future tense. Present one event as a response to, retaliation for, or result of another only when a [cause] note says so.
- Use the other details, people and quotes only to name or explain the key point(s) a sentence is built on; do not use them to add a separate fact.
- Use only facts, names and figures that appear in the material. Introduce a person by name and role, as listed under people.
- You may use the quotes. Copy a quote word for word inside quotation marks and name its speaker. Put quotation marks only around words taken from the quotes.
- Every opinion, prediction or interpretation in the item must belong to a named person from the material.
- Mention any other disagreement between accounts only if you can state both versions concretely: who gave which figure or which claim.
- Plain prose sentences only: no title, no headings, no lists, no markdown formatting inside "text".
- Normal sentence case. Names of people, places and organisations keep their capital letters.`;

export function getOneSourceWritePrompt(
  material: string, tier: Tier, relations = '',
  sameSurname: Array<{ surname: string; primary: string[]; roles: Record<string, string>; relatives: Array<{ of: string; names: string[] }> }> = []
): string {
  const names = sameSurname.map(g => {
    const who = g.primary.map(x => (g.roles[x] ? `${x} (${g.roles[x]})` : x)).join(' and ');
    const rel = g.relatives.map(r => ` Refer to ${r.names.join(' and ')}, listed with ${r.of}, by first name together with their relationship to ${r.of}.`).join('');
    return `\n\nDifferent people in this story share the surname ${g.surname}: ${who}. The material often calls them just "${g.surname}", so a reader cannot tell who is meant. Refer to each of them by full name, or after the first mention by their role as given in brackets; never by "${g.surname}" alone or with a title such as Mr or Ms.${rel}`;
  }).join('');
  return `You are writing one item for a daily world-news brief, in English, for a reader who has not seen any of the material.

<material>
${material}
</material>
${relations ? `\nNotes on how events relate. A model worked these out from the key points and their source sentences; they are not themselves quoted from the reporting:\n${relations}\n` : ''}
${oneSourceTierTask(tier)}

${RULES_ONE_SOURCE}${names}

Reply with one JSON object and nothing else, in this exact shape:
{"paragraphs": [[{"points": [3], "text": "One sentence of plain prose, no [id] markers inside it."}, {"points": [5, 8], "text": "Another sentence."}]]}
Each inner array of "paragraphs" is one paragraph, in order; for a one-paragraph or one-sentence item, use a single inner array. "points" lists the id(s) (one or two) of the key points that sentence is built on.`;
}

/**
 * 接地修正：代码查出正文里材料中没有的名字/数字、引号里不逐字的话，点名让模型改成材料里的写法、
 * 或删掉 / 去掉引号改转述，其余不动。
 */
export function getGroundingFixPrompt(item: string, terms: string[], quotes: string[], material: string): string {
  const asks: string[] = [];
  if (terms.length) {
    asks.push(`These words or figures in the item do not appear anywhere in the material: ${terms.map(t => `"${t}"`).join(', ')}.
For each one: if it is a misspelling of a name or figure in the material, replace it with the exact form used in the material; otherwise remove it, rewording the sentence as little as possible.`);
  }
  if (quotes.length) {
    asks.push(`These passages are in quotation marks, but they are not word for word what the material says was said: ${quotes.map(q => `“${q}”`).join(', ')}.
For each one: either make the words inside the quotation marks exactly match the material, or remove the quotation marks and report it as indirect speech.`);
  }
  return `Below is the material on a news story and an item written from it for a daily world-news brief.

<material>
${material}
</material>

<item>
${item}
</item>

${asks.join('\n\n')}
Change nothing else and keep the same length and form.

Reply with the full corrected item text only.`;
}
