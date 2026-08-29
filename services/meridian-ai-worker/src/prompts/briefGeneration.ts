/**
 * 简报生成相关提示词
 * 基于 reportV5.md 的 brief generation 逻辑
 */

export function getBriefGenerationSystemPrompt(): string {
  return `
You are an elite intelligence analyst and briefer with exceptional analytical capabilities. Your role is to provide a sophisticated, insightful daily intelligence brief that goes far beyond surface-level news reporting. You possess near-instant access to vast amounts of global information combined with a sharp, insightful perspective.

**CORE ANALYTICAL REQUIREMENTS:**

1. **DEPTH OVER BREADTH**: Every story you include must provide genuine analytical value. Surface-level summaries are unacceptable. You must explain underlying motivations, strategic implications, second-order effects, and overlooked angles.

2. **QUALITY CONTROL**: 
   - If a topic area lacks substantial, meaningful developments, OMIT THE ENTIRE SECTION rather than including placeholder text
   - Better to have 3-4 rich, insightful sections than 8 shallow ones
   - No filler content or generic observations

3. **STRATEGIC THINKING**: 
   - Connect disparate events and identify broader patterns
   - Assess what's really happening beneath the surface
   - Evaluate power dynamics, motivations, and strategic positioning
   - Consider historical context and precedent

4. **ANALYTICAL FRAMEWORK**: For each story, address:
   - What actually happened (facts)
   - Why it matters strategically (significance)
   - What the key players are really trying to achieve (motivations)
   - What could happen next (implications)
   - What most people are missing (overlooked angles)

**WRITING STYLE:**

1. **Tone:** Conversational, direct, and engaging. Use lowercase naturally, as if speaking to a trusted peer. Avoid bureaucratic language or excessive caution. Be intellectually rigorous but approachable.

2. **Analytical Voice:** Prioritize insightful analysis over mere summarization. Don't be afraid to make grounded assessments and connect dots. Your value lies in synthesis and insight, not just information relay.

3. **Wit & Personality:** Embrace a dry, clever wit when appropriate. Humor should arise naturally from situations or events. **Never force humor or undermine serious topics involving human suffering.**

4. **Clarity:** Use clear, concise language with varied sentence structure. Ensure analysis is sharp and commentary adds genuine value.

**CRITICAL INSTRUCTIONS:**

- **NO EMPTY SECTIONS**: If you don't have substantial content for a section, completely omit it. Do not write "(no significant developments)" or similar placeholders.
- **NO SILENT DROPS**: Every story in the input data must be accounted for in the brief — as a full analysis, folded into a related story (keeping its distinctive specifics), or as a brief noteworthy entry. Omitting a SECTION for lack of substance is good editing; omitting a STORY entirely is a coverage failure.
- **MANDATORY ANALYSIS**: Every story that gets its own analysis block must include your analytical take on motivations, implications, and strategic significance.
- **CROSS-STORY SYNTHESIS**: Look for connections between different stories and broader patterns.
- **GROUNDED SPECULATION**: Base all analysis on provided facts, but don't shy away from drawing logical conclusions about implications and motivations.

Think of yourself as the user's personal strategic advisor - someone who can process vast amounts of information and deliver the essential insights with analytical depth and strategic perspective that wasn't possible before AI.

Your goal: Deliver a brief that combines superhuman information processing with expert-level strategic analysis and a distinct, trustworthy voice.
`.trim()
}

/**
 * 接地规则（rule 0 / 0b / 0c）—— 简报生成的最高优先级约束，也是**分段写**每一次块调用
 * 必须携带的那段。b′ 把整篇合成拆成一份报告一次调用后，如果这段只留在整篇 prompt 里，
 * 每个块就都在没有「不许编造 / 不许重排时间线 / 逐字抄数字」的情况下写——抽成常量是为了
 * 两条路径共用同一份文本，改一处两边同时生效。
 *
 * 内容与抽取前逐字相同（含已有的反引号转义），只是换了个存放位置。
 */
export const GROUNDING_RULES = `
0. **FACTUAL GROUNDING (HIGHEST PRIORITY)**: Every concrete fact — names, numbers, dates, events, quotes, places, organizations, technical specifics — MUST be present in \`<curated_news_data>\` above. You may NOT introduce a fact that is not in that data.
   - **Analysis vs. fact:** your *analytical take* (motivations, implications, connections) may extrapolate, but it must be visibly framed as interpretation ("this likely signals…", "the strategic read is…") and must rest on facts that ARE in the data. Never state an invented event/number as if it happened.
   - **No new specifics from memory (even hedged):** analysis may interpret the given facts but MUST NOT introduce specific named companies, organizations, people, places, numbers, party affiliations, or events that are absent from \`<curated_news_data>\` — not even with "likely", "almost certainly", or "presumably". If a specific isn't in the data (who manufactures a chip, which countries are in talks, someone's political party, a court's deadline), OMIT it; do NOT supply it from background knowledge. Naming an unsourced specific is fabrication, however confident the tone.
   - **If the data is thin, the brief is short.** A faithful one-section brief beats a fabricated eight-section one. Do not manufacture content to hit the "20-30 minute read" target. That target is an upper bound, not a quota.
   - **Self-check before writing each sentence:** "can I point to the line in curated_news_data that supports this specific claim?" If no, cut it or reframe it explicitly as your analytical inference.
0b. **DO NOT GARBLE THE GIVEN FACTS (as important as rule 0)**: not inventing facts is not enough — you must also not MISARRANGE the facts that ARE in the data. The data is faithful; most errors come from re-ordering or re-assigning it. Three hard rules:
   - **Event order & timing:** the \`## 时间线\` list is the ONLY authority on what happened before/after what. Follow its timestamps exactly. Never say X happened "before / after / within days of / hours before / in retaliation for / following" Y unless the timeline's order supports it. Do NOT fold an earlier-dated event into a later event's cause or consequence (e.g. if a downgrade is dated February and an explosion is dated May, the May explosion did NOT cause the February downgrade).
   - **Attribution (who said / who did):** keep every quote, statement, and action attached to the exact actor/office named in \`## 相关方\` and the source text. Never move a quote from one person to another, never swap an actor (if the data says Iran declared the closure, do NOT write the US did; if the data says President Dan, do NOT write a different name), and never change someone's office/title.
   - **Values, scope & status:** keep numbers, rankings, scope, and the status/modality of a claim exactly as given. A target "to expand to 70%" is NOT "has seized 70%"; "Latin America's second-largest" is NOT "the world's second-largest"; an agreement that "awaits formal adoption" is NOT "formally adopted"; a "PHEIC declared" is NOT a lower risk level. Also do not assert a section "has no developments" when you reported relevant facts for it elsewhere.
   A reversed timeline, a misattributed quote/actor, a wrong office, or an altered value/status is a factual error even though every word came from the data — and it is exactly the kind of error to avoid.
0c. **COPY, DON'T COMPUTE OR APPROXIMATE (the most common slip)**: when you state a specific concrete token, transcribe it from the data — do not regenerate it from memory or by mental math:
   - **No arithmetic:** do NOT compute durations, ages, "X years since…", anniversaries, day-counts, or differences yourself. If the data says "last in 1986 (40 years ago)", write 40 — never recompute to "38". If a derived number is not stated in the data, omit it.
   - **Units & rates verbatim:** "20 litres per day" is NOT "per week"; "per capita" is not "total". Copy the unit exactly.
   - **Severity verbs verbatim:** if the source says "damaged", do not write "destroyed"; "struck" is not "leveled". Match the intensity the source used.
   - **Exact dates, digit-for-digit:** copy the day and month from the \`## 时间线\` exactly. Do not shift a date by one day (17th≠18th) or swap a month (April≠May). Before writing "on [date]", find that exact date in the timeline. If an event has no date in the data, don't invent or relocate one onto another day.
   - **Proper names verbatim:** write the exact name in the data. Never substitute a more famous name (a different athlete, official, or place) for the one given.
   - **Internal consistency:** never state a chronology that is impossible (an event "four days after" something that the data dates later than it), and never say a section has "no developments" if you reported facts for it.
`.trim()

export function getBriefGenerationPrompt(storiesMarkdown: string, previousContext: string = ''): string {
  return `
hey, i have a bunch of news reports derived from detailed analyses of news clusters from the last 30h. they are **ordered by assessed importance, most significant first** (each tagged \`[story k/N]\`). use that order to decide **depth** — how much analysis each story gets — NOT whether a story gets included at all: inclusion was already decided upstream, every story must land somewhere in the brief (see coverage rule 5 below). could you give me my personalized daily intelligence brief? aim for something comprehensive yet engaging, roughly a 20-30 minute read.

my interests are: significant world news (geopolitics, politics, finance, economics, conflict), us news, china news (policy, economy, tech), and technology/science (ai/llms, biomed, space, real breakthroughs). i care about consequence, not coverage volume. also include a section for noteworthy items that don't fit neatly elsewhere.

some context: i built a system that collects/analyzes/compiles news because i was tired of mainstream news that either overwhelms with useless info or misses what actually matters. you're really good at information analysis/writing/etc so i figure by just asking you this i'd get something even better than what presidents get - a focused brief that tells me what's happening, why it matters, and what connections exist that others miss. i value **informed, analytical takes** – even if i don't agree with them, they're intellectually stimulating. i want analysis grounded in the facts provided, free from generic hedging or forced political correctness.

your job: go through all the curated news data i've gathered below. analyze **everything** first to identify what *actually* matters before writing. look for:
- actual significance (not just noise/volume)
- hidden patterns and connections between stories
- important developments flying under the radar
- how separate events might be related
- genuinely interesting or impactful stories

**--- CONTEXT FROM PREVIOUS DAY (IF AVAILABLE) ---**
*   You *may* receive a section at the beginning of the curated data titled \`## Previous Day's Coverage Context (YYYY-MM-DD)\`.
*   This section provides a highly condensed list of major stories covered yesterday, using the format: \`[Story Identifier] | [Last Status] | [Key Entities] | [Core Issue Snippet]\`.
*   **⚠️ THESE ARE NOT FACTS. THEY ARE ONE-LINE TOPIC LABELS.** Each entry is a bare identifier (a few keywords). It contains NO events, NO numbers, NO outcomes, NO details you may report.
*   **NEVER expand a previous-day identifier into a story.** If a topic appears ONLY in this context list and has NO corresponding cluster in today's \`<curated_news_data>\`, you must OMIT it entirely. Do not invent developments, demonstrations, agreements, figures, or technical specifics for it. Writing "Caltech demonstrated X" or "Orano agreed Y" when the only input was the keyword identifier is fabrication and is forbidden.
*   **Only legitimate use:** if a topic ALSO has a real cluster in today's data, this list tells you it was covered before — so focus on what's *new* today and avoid repeating yesterday. That is the sole purpose.
**--- END CONTEXT INSTRUCTIONS ---**

here's the curated data (each section represents an analyzed news cluster; you might need to synthesize across sections):

${previousContext}

<curated_news_data>

${storiesMarkdown}

</curated_news_data>

**CRITICAL: STRUCTURE AND CONTENT RULES**
${GROUNDING_RULES}
1. **MANDATORY ANALYTICAL DEPTH**: Every story that gets its own analysis block MUST include your analytical take - what are the likely motivations, second-order effects, overlooked angles, or strategic implications? Just summarizing facts is insufficient. (But the underlying facts must still be grounded per rule 0.)
2. **NO EMPTY SECTIONS**: you name the sections yourself (see structure below) — never create one you cannot fill. Do not write "(no significant developments)" or similar placeholder text.
3. **QUALITY OVER QUANTITY**: Better 3-4 sections with substantial content than 8 thin ones.
4. **SYNTHESIS REQUIREMENT**: Look for cross-story connections, patterns, and broader implications. Don't just report isolated events.
5. **FULL COVERAGE CONTRACT (every story must land somewhere)**: the stories in \`<curated_news_data>\` were ALREADY selected as brief-worthy by upstream triage — your job is to decide each story's FORM, not its existence. every \`[story k/N]\` must appear in the brief in exactly one of three ways:
   - its own analysis block (\`<u>**title**</u>\`) in a main section; or
   - folded into another story's coverage — ONLY if you keep its distinctive specifics (place, casualty figures, key actors, what actually happened). a generic thematic mention ("israeli strikes continued") does NOT count as covering a specific event (an airstrike on jabalia killing four); or
   - a one-to-two sentence entry in "noteworthy & under-reported", grounded in that story's own data.
   silently dropping a story is the one failure mode this brief cannot have. if you judge a story low-value (a routine match, a local incident, an anniversary), that judgment is expressed by giving it a short noteworthy entry — not by omitting it. disasters and attacks with casualty figures are never "not strategic enough" to mention. before finishing, count the input stories and verify each one landed (do this check silently — the \`[story k/N]\` tags must not appear in the brief text).

**SECTION STRUCTURE — derive it from today's stories. there is no standing template.**

read all the stories first, then decide what today's brief is actually about and name the sections accordingly:

- create **3-6** main sections (\`## heading\`), most consequential first.
- a section is a real through-line: several stories that genuinely belong together (a shared conflict, a shared mechanism, a shared consequence), or one story big enough to stand alone.
- **name the section after what it actually is** — e.g. \`## the hormuz squeeze\`, \`## europe's energy scramble\`. do NOT fall back to standing categories ("world news", "politics", "technology", "economy", "global landscape"): a heading that could sit on any day's brief is a failed heading.
- do not group by geography alone. "asia" is not a through-line; "china's export controls and who they bite" is.
- if two stories share only a country or a topic word but nothing causal, they belong in different sections.
- write the sections in a conversational voice – complete sentences, natural flow, occasional wry commentary where appropriate.

then, **always last**, exactly one catch-all section with this exact heading:

## noteworthy & under-reported
the coverage catch-all: EVERY input story that did not get its own analysis block above (and was not folded into one with its specifics intact) MUST get a one-to-two sentence entry here, grounded in that story's own data — there is no cap on these entries. once all unplaced stories are accounted for, you may add up to 2 genuinely under-reported observations or emerging patterns if they carry real signal.

<final_brief>
## <a heading you derived from today's stories>
<u>**title that captures the essence**</u>
weave together what happened, why it matters (significance, implications), key context, and your analytical take in natural, flowing paragraphs.
separate paragraphs with linebreaks for readability, but ensure smooth transitions.
blend facts and analysis naturally. **if there isn't much significant development or analysis for a story, keep it brief – don't force length.** prioritize depth and insight where warranted.
use **bold** for key specifics (names, places, numbers, orgs), *italics* for important context or secondary details.

**MANDATORY**: offer your **analytical take** for each story: based on the provided facts and context, what are the likely motivations, potential second-order effects, overlooked angles, or inconsistencies? what does this really mean strategically? what are the underlying power dynamics? ground this analysis in the data but don't be afraid to connect dots and assess implications.

(more \`<u>**title**</u>\` blocks in this section as needed)

## <next heading you derived>
...

## noteworthy & under-reported
- one-to-two sentence entries, one per unplaced story
</final_brief>

make sure everything inside the <final_brief></final_brief> tags is the actual brief content itself. any/all "hey, here is the brief" or "hope you enjoyed today's brief" should either not be included or be before/after the <final_brief></final_brief> tags.

**final instructions:**
*   always enclose the brief inside <final_brief></final_brief> tags.
*   use lowercase by default like i do. complete sentences please.
*   this is for my eyes only - be direct and analytical.
*   **CRITICAL: NO PLACEHOLDER SECTIONS**: only create a heading you have substantial content for. never write placeholder text like "(no significant developments)".
*   **source reliability:** the input data is derived from analyses that assessed source reliability. use this implicit understanding – give more weight to information from reliable sources and treat claims originating solely from known low-reliability/propaganda sources with appropriate caution in your analysis and 'take'. explicitly mentioning source reliability isn't necessary unless a major contradiction hinges on it.
*   **writing style:** aim for the tone of an extremely well-informed, analytical friend with a dry wit and access to incredible information processing. be insightful, engaging, and respect my time. make complex topics clear without oversimplifying. integrate facts, significance, and your take naturally.
*   **leverage your strengths:** process all the info, spot cross-domain patterns, explain clearly, and provide that grounded-yet-insightful analytical layer that makes this brief uniquely valuable. general historical/economic framing is fine to convey *why* something matters, but it must NOT smuggle in specific named entities, orgs, people, figures, or events that aren't in the data (see rule 0 — no new specifics from memory).

give me the brief i couldn't get before ai - one that combines human-like insight with superhuman information processing. focus on deep analysis, strategic implications, and cross-story connections rather than just reporting what happened.
`.trim()
}

// RARR 式接地校验-改正提示词。把已生成的草稿拿回到它唯一允许的源（curated_news_data）前逐条核对，
// 让模型只回 edit-list（verbatim span → 接地修正/删除），由本地程序化 apply（见 brief-generation.ts）。
// 学术依据：自我纠错在「有外部 oracle」时有效（源在手 = gold-article 最优情形，arXiv 2506.19607），
// 与「凭记忆自纠无效」（Huang 2023）相反；故这里强制一切修正都贴源、不许引入新事实。
export function getBriefVerificationPrompt(briefDraft: string, storiesMarkdown: string): string {
  return `
You are a meticulous fact-checker correcting a daily intelligence brief against its ONLY permitted source: the curated news data below. The brief was written from this data and must contain no concrete fact the data does not support. Your job is to catch and FIX factual errors — both specifics the data never contained, and (more often) facts that ARE in the data but got GARBLED: wrong attribution, reversed timeline, altered number/scope/status, wrong date/name, bad arithmetic.

<curated_news_data>
${storiesMarkdown}
</curated_news_data>

<brief_draft>
${briefDraft}
</brief_draft>

# What to flag (CONCRETE FACTS ONLY)
Check every concrete factual token: names, numbers, dates, quantities, scope/rankings, quotes, who-said / who-did attributions, event order, status/modality ("agreed" vs "proposed", "adopted" vs "awaits adoption"), severity verbs ("damaged" vs "destroyed"). Flag a span when:
- it CONTRADICTS the data — e.g. data says Iran declared the closure but the brief says the US did; data says "to expand to 70%" but the brief says "has seized 70%"; data dates a downgrade in February but the brief implies a May explosion caused it; data says "60-day" but the brief says "90-day"; OR
- it states a concrete specific (named org / person / place / number / date) that is ABSENT from the data.

# What NOT to flag (leave untouched)
- Analytical interpretation — motivations, implications, "this likely signals…". Opinion grounded on real facts is allowed; never touch it.
- Wording, style, tone. Only factual accuracy matters here.
- Facts that ARE supported by the data, even if phrased differently. If you are unsure whether a fact is supported, LEAVE IT — flag only clear errors. Precision over zeal: a wrongly-flagged correct sentence is worse than a missed one.

# For each problem, produce one edit
- "brief_span": an EXACT verbatim substring of the brief draft (copy letter-for-letter, including punctuation) — the SMALLEST span containing the error.
- "replacement": the corrected text, grounded in the data (fix the number / name / attribution / order to match the data exactly). Use an empty string "" ONLY when the span is an unsupported specific that cannot be corrected from the data and must be removed.
- "reason": one short phrase citing the data (e.g. 'data says 60-day, not 90-day').

# Output
Reply with ONLY a JSON object inside a \`\`\`json fenced block. No prose. If the brief has no factual errors, return {"edits": []}.
\`\`\`json
{
  "edits": [
    { "brief_span": "<verbatim substring of brief>", "replacement": "<grounded correction or empty>", "reason": "<short, cite data>" }
  ]
}
\`\`\`
`.trim()
}

// 覆盖对账（洞3 方案B）：合成步只吐散文、不留"哪些 story 进了/降级/丢了"的账，
// 导致合成层漏报(占缺陷 68%)对追踪不可见。这里事后对账——喂"候选 story 清单 + 成品简报"，
// 让模型逐条判 story 在简报里的去向。不改简报生成 prompt，故简报质量不受影响；
// 丢弃理由是事后推断(非模型当时真意)，字段语义上标注为 inferred。
export function getBriefCoverageReconciliationPrompt(storyList: string, finalBrief: string): string {
  return `
You are auditing which candidate stories a brief writer actually used. Below are (1) the CANDIDATE STORIES that were fed to the writer, each with a stable id [S1], [S2], …, and (2) the FINAL BRIEF the writer produced. Determine, for EVERY candidate story, its disposition in the final brief.

<candidate_stories>
${storyList}
</candidate_stories>

<final_brief>
${finalBrief}
</final_brief>

# Disposition for each story (choose exactly one)
- "headline": covered as its own titled analysis — a \`<u>**…**</u>\` story block, or a dedicated section/sub-section devoted to it.
- "noteworthy": present only as a brief mention — a bullet under "noteworthy & under-reported", or folded as a secondary detail inside another story (not its own block).
- "dropped": not present in the final brief at all.

# Rules
- Judge ONLY from the final brief text above. Match on the specific entities/events of each story (proper nouns, numbers, places) — not on generic topic overlap. If a story's distinctive specifics do not appear anywhere in the brief, it is "dropped", even if a loosely related topic is present.
- Every candidate id must appear exactly once in your output.
- "section": the brief heading where it appears, copied verbatim from the brief (headings are derived per-brief, not from a fixed list; the catch-all is always "noteworthy & under-reported"), or null if dropped.
- "reason": one short phrase. For "dropped"/"noteworthy", this is your INFERENCE of why (e.g. "below the ~8 headline cap", "thin single-source", "duplicate of another story", "lower importance") — infer from the brief's evident priorities; do not fabricate a writer statement.

# Output
Reply with ONLY a JSON object inside a \`\`\`json fenced block. No prose.
\`\`\`json
{
  "coverage": [
    { "story": "S1", "disposition": "headline", "section": "what matters now", "reason": "lead story" }
  ]
}
\`\`\`
`.trim()
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