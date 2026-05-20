/**
 * 故事验证提示词
 * 适配多源聚合数据（BBC/Guardian/Al Jazeera/NPR/France24/HN）：cluster 内常是
 * "相关主题但各报道独立事件"。原版要求"同一事件 3+ 篇报道"过于严苛，会导致全部
 * NO_STORIES。本版放宽规则：
 *   - story 阈值 3+ → 2+
 */

export function getStoryValidationPrompt(articleList: string): string {
  return `
# Task
Given a cluster of news articles, decide how it should enter the intelligence
analysis pipeline. Pick ONE of:

1) single_story — Articles cover a single event/situation (and its direct
   consequences) from one or more angles. Multiple outlets reporting the same
   incident, follow-up coverage of the same crisis, etc.

2) collection_of_stories — Articles cleanly split into multiple distinct
   stories, each with at least 2 articles. List them separately.

3) pure_noise — No meaningful pattern; articles are unrelated.

# Title guidelines
- Factual, descriptive, neutral.
- Include region/actor context (e.g. "Middle East — Iran, Gaza, Lebanon
  developments").
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
