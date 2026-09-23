/**
 * 简报生成相关提示词
 * 基于 reportV5.md 的 brief generation 逻辑
 */

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