/**
 * 故事验证提示词
 * 基于 reportV5.md 的 process_story 函数逻辑
 */

export function getStoryValidationPrompt(articleList: string): string {
  return `
# Task
Determine if the following collection of news articles is:
1) A single story - A cohesive narrative where all articles relate to the same central event/situation and its direct consequences
2) A collection of stories - Distinct narratives that should be analyzed separately
3) Pure noise - Random articles with no meaningful pattern
4) No stories - Distinct narratives but none of them have more than 3 articles

# Important clarification
A "single story" can still have multiple aspects or angles. What matters is whether the articles collectively tell one broader narrative where understanding each part enhances understanding of the whole.

# Handling outliers
- For single stories: You can exclude true outliers in an "outliers" array
- For collections: Focus **only** on substantive stories (3+ articles). Ignore one-off articles or noise.

# Title guidelines
- Titles should be purely factual, descriptive and neutral
- Include necessary context (region, countries, institutions involved)
- No editorialization, opinion, or emotional language
- Format: "[Subject] [action/event] in/with [location/context]"

# Input data
Articles (format is (#id) [title](url)):
${articleList}

# Output format
Start by reasoning step by step. Consider:
- Central themes and events
- Temporal relationships (are events happening in the same timeframe?)
- Causal relationships (do events influence each other?)
- Whether splitting the narrative would lose important context

Return your final answer in JSON format:
\`\`\`json
{
    "answer": "single_story" | "collection_of_stories" | "pure_noise" | "no_stories",
    // single_story_start: if answer is "single_story", include the following fields:
    "title": "title of the story",
    "importance": 1-10, // global significance (1=minor local event, 10=major global impact)
    "outliers": [] // array of article ids to exclude as unrelated
    // single_story_end
    // collection_of_stories_start: if answer is "collection_of_stories", include the following fields:
    "stories": [
        {
            "title": "title of the story",
            "importance": 1-10, // global significance scale
            "articles": [] // list of article ids in the story (**only** include substantial stories with **3+ articles**)
        },
        ...
    ]
    // collection_of_stories_end
}
\`\`\`

Example for a single story:
\`\`\`json
{
    "answer": "single_story",
    "title": "The Great Fire of London",
    "importance": 8,
    "outliers": [123, 456] // article ids to exclude as unrelated
}
\`\`\`

Example for a collection of stories:
\`\`\`json
{
    "answer": "collection_of_stories",
    "stories": [
        {
            "title": "The Great Fire of London",
            "importance": 8,
            "articles": [123, 456] // article ids in the story
        },
        ...
    ]
}
\`\`\`

Example for pure noise:
\`\`\`json
{
    "answer": "pure_noise"
}
\`\`\`

Example for distinct narratives with no stories that contain more than 3+ articles:
\`\`\`json
{
    "answer": "no_stories"
}
\`\`\`

Note:
- Always include articles IDs (outliers, articles, etc...) as integers, not strings and never include the # symbol.
`.trim()
} 