/**
 * 简报生成相关提示词
 * 基于 reportV5.md 的 brief generation 逻辑
 */

export function getBriefTitlePrompt(briefText: string): string {
  return `
<brief>
${briefText}
</brief>

Write the headline for this daily brief. It appears on the brief's page and in the list of past briefs, where it is all a reader has to tell one day from another.

- Name the one or two most consequential developments of the day. The brief is ordered by importance, so they are in its first section. Do not try to cover every story.
- Say what happened: each development needs its actor and what they did, not just a topic. "France's school protests draw 250,000" tells the reader something; "France, schools" does not.
- One line, at most 14 words. Join two developments with "as", "while" or a comma.
- Sentence case: capitalise the first word and proper nouns, nothing else. No full stop at the end.
- No colon anywhere. No "X: Y" shape.
- Plain and specific. No hype words ("shakes", "stuns", "rocks"), no verdict about what it all means, no question.
- Use only what the brief states, and keep the status of each claim: a demand is not an agreement, a proposal is not a decision, an arrest is not a conviction.

return exclusively a JSON object with the following format:
\`\`\`json
{
    "title": "string"
}
\`\`\`
`.trim()
} 