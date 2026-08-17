/**
 * 故事验证提示词
 * 适配多源聚合数据（BBC/Guardian/Al Jazeera/NPR/France24/HN）：cluster 内常是
 * "相关主题但各报道独立事件"。
 *
 * v2 (post-eval): 显式反 umbrella padding。eval 发现 v1 prompt 让大量
 * "Region — Event1 and Event2" 形态通过 single_story；本版加强反拼盘指令。
 */

export function getStoryValidationPrompt(articleList: string): string {
  return `
# Task
Given a cluster of news articles, decide how it should enter the intelligence
analysis pipeline. Pick ONE of:

1) single_story — Articles cover ONE concrete event/situation (and its direct
   consequences) from one or more angles. Examples: same incident reported by
   multiple outlets, follow-up coverage of one crisis, multiple angles on the
   same actor's one decision.

2) collection_of_stories — Articles cleanly split into multiple distinct
   stories, each with at least 2 articles. List them separately.

3) pure_noise — Articles unrelated; no meaningful pattern.

# JSON validity (CRITICAL)
EVERY string value must be wrapped in double quotes — this includes every \`why\` field.
WRONG:  "why": A recurring pattern of settler violence
RIGHT:  "why": "A recurring pattern of settler violence"
An unquoted value makes the whole response unparseable, and the entire cluster is then
discarded — not one story from it reaches the brief.

# Anti-padding rules (CRITICAL)
A cluster is NOT a single_story if any of these apply — pick collection_of_stories or pure_noise instead:

- The title needs " and " / "+" / ";" / multiple commas to join DIFFERENT
  events. Example BAD: "US extends Russian oil sanctions waiver and G7 rift
  over Russia policy" — these are two events, not one story.
- The title's only unifier is a region or domain word (e.g. "Latin America —
  Bolivia protests and Mexico cartel arrests"). Geography alone ≠ story.
- The articles cover events with different actors, different timelines, and
  no causal link, even if same region/topic.
- The title lists 3+ entities/events joined by commas (e.g. "ICC proceedings
  involving Smotrich, Libyan militia commander, and London exhibition").

When unsure between single_story and collection_of_stories: prefer
collection_of_stories if you can identify ≥2 distinct sub-stories with 2+
articles each; otherwise prefer pure_noise if the cluster is just a thematic
grab-bag.

# Title guidelines (for single_story / collection_of_stories)
- Factual, descriptive, neutral.
- Name the ONE concrete event ("Syria — Damascus car bomb explosion"),
  not the umbrella ("Middle East — multiple developments").
- A region prefix is fine ("Spain — Shakira acquitted in tax case") as long
  as what follows the dash is one event.
- No editorialization.

# Outlier handling
For single_story, you MAY exclude clearly unrelated articles via an
"outliers" array of article ids.

# Importance scoring (rubric + reasoning)
Score each story (the single_story, or EACH sub-story) on FOUR dimensions of
PUBLIC CONSEQUENCE, each an integer 0-3 — how much the event matters by its
consequence to society / states / economy / human welfare, NOT by drama,
coverage volume, or casualties alone.

For EACH dimension: FIRST write a short "why" (which anchor it matches + the key
fact), THEN the integer score. Use the FULL 0-3 range. Do NOT default to 2 — real
events usually score DIFFERENTLY across the four dimensions, and 0 and 3 are
common. A local crime, a single-city election, or a product launch will have
several 0s.

- d1 Strategic/policy consequence: 0 none, isolated · 1 local/tactical, no shift ·
  2 materially shifts one country/region's situation or policy · 3 shifts
  cross-border power balance or major institutions (war trajectory, ceasefire,
  regime change, landmark legislation/treaty, alliance realignment)
- d2 Spillover/systemic reach: 0 confined to where it happened · 1 one neighbor ·
  2 multiple countries / alliances, sanctions, trade, refugees, regional stability
  · 3 a global system (energy/financial chokepoint, nuclear threshold, global
  trade order, great-power direct involvement)
- d3 Human/scale impact: 0 minimal · 1 limited group or single-digit casualties ·
  2 nation-scale population / dozens-to-hundreds casualties / civilians targeted ·
  3 cross-national masses / mass casualties / humanitarian disaster
- d4 Novelty: 0 day-after-day repetition (another routine strike) · 1 incremental
  update to a known process · 2 clearly new development · 3 entirely new or crosses
  a previously-uncrossed threshold

These measure PUBLIC CONSEQUENCE only. A story really about sport, a product
launch, or cultural resonance SHOULD score low (intended — this ranks
public-affairs news).

## Worked examples (note dimensions DIFFER, and 0 and 3 are used)
- "US and Iran exchange direct military strikes; Iran hits US facilities in the Gulf"
  → d1=3 (direct great-power war, shifts regional trajectory), d2=3 (Strait of
  Hormuz energy chokepoint, draws US in — global system), d3=2 (strikes, dozens-
  hundreds, not yet mass-civilian), d4=3 (first direct exchange, crosses threshold)
- "EU adopts landmark migration and deportation regulations"
  → d1=3 (cross-border landmark legislation reshaping bloc policy), d2=2 (many
  countries, migration/refugees; not a global chokepoint), d3=2 (large migrant
  populations across nations), d4=2 (new regulation)
- "Murder of a man in one city and its local aftermath"
  → d1=0 (isolated crime, no policy/strategic consequence), d2=0 (confined to one
  city), d3=2 (a death + limited local unrest), d4=1 (routine local-crime story)
  — scores LOW despite a casualty

# Input
${articleList}

# Output
**Output ONLY the JSON, no analysis, no reasoning, no prose before or after.**
Wrap the JSON in a \`\`\`json fenced code block. Use ONE of these shapes:

Single event:
\`\`\`json
{
  "answer": "single_story",
  "title": "...",
  "scoring": {
    "d1": {"why": "...", "score": 0},
    "d2": {"why": "...", "score": 0},
    "d3": {"why": "...", "score": 0},
    "d4": {"why": "...", "score": 0}
  },
  "outliers": []
}
\`\`\`

Collection of multiple distinct stories (each with 2+ articles):
\`\`\`json
{
  "answer": "collection_of_stories",
  "stories": [
    {"title": "...", "scoring": {"d1": {"why": "...", "score": 0}, "d2": {"why": "...", "score": 0}, "d3": {"why": "...", "score": 0}, "d4": {"why": "...", "score": 0}}, "articles": [12, 34]},
    {"title": "...", "scoring": {"d1": {"why": "...", "score": 0}, "d2": {"why": "...", "score": 0}, "d3": {"why": "...", "score": 0}, "d4": {"why": "...", "score": 0}}, "articles": [56, 78, 90]}
  ]
}
\`\`\`

Pure noise:
\`\`\`json
{"answer": "pure_noise"}
\`\`\`

Note:
- Article ids MUST be integers, no "#" prefix, no strings.
- scoring: for each of d1-d4, a short "why" THEN an integer "score" 0-3, per the
  Importance scoring rubric. Reason first, then score; use the full 0-3 range.
`.trim()
}
