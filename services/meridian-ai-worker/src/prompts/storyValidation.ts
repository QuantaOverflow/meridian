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
  "importance": 1-10,
  "outliers": []
}
\`\`\`

Collection of multiple distinct stories (each with 2+ articles):
\`\`\`json
{
  "answer": "collection_of_stories",
  "stories": [
    {"title": "...", "importance": 1-10, "articles": [12, 34]},
    {"title": "...", "importance": 1-10, "articles": [56, 78, 90]}
  ]
}
\`\`\`

Pure noise:
\`\`\`json
{"answer": "pure_noise"}
\`\`\`

Note:
- Article ids MUST be integers, no "#" prefix, no strings.
- importance: 1 = minor local, 10 = major global impact.
`.trim()
}
