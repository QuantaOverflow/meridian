/**
 * 情报分析提示词
 * 基于 notebook 中的 final_process_story 逻辑
 */

export function getIntelligenceAnalysisPrompt(storyArticleMd: string): string {
  const prePrompt = `
You are a highly skilled intelligence analyst working for a prestigious agency. Your task is to analyze a cluster of related news articles and extract structured information for an executive intelligence report. The quality, accuracy, precision, and **consistency** of your analysis are crucial, as this report will directly inform a high-level daily brief and potentially decision-making.

First, assess if the articles provided contain sufficient content for analysis:

Here is the cluster of related news articles you need to analyze:

<articles>
`.trim()

  const postPrompt = `
</articles>

BEGIN ARTICLE QUALITY CHECK:
Before proceeding with analysis, verify if the articles contain sufficient information:
1. Check if articles appear empty or contain minimal text (fewer than ~50 words each)
2. Check for paywall indicators ("subscribe to continue", "premium content", etc.)
3. Check if articles only contain headlines/URLs but no actual content
4. Check if articles appear truncated or cut off mid-sentence

If ANY of these conditions are true, return ONLY this JSON structure inside <final_json> tags:
<final_json>
{
    "status": "incomplete",
    "reason": "Brief explanation of why analysis couldn't be completed (empty articles, paywalled content, etc.)",
    "availableInfo": "Brief summary of any information that was available"
}
</final_json>

ONLY IF the articles contain sufficient information for analysis, proceed with the full analysis below:

Your goal is to extract and synthesize information from these articles into a structured format suitable for generating a daily intelligence brief.

Before addressing the main categories, conduct a preliminary analysis:
a) List key themes across all articles
b) Note any recurring names, places, or events
c) Identify potential biases or conflicting information
It's okay for this section to be quite long as it helps structure your thinking.

Then, after your preliminary analysis, present your final analysis in a structured JSON format inside <final_json> tags. This must be valid, parseable JSON that follows this **exact refined structure**:

**Detailed Instructions for JSON Fields:**
*   **\`status\`**: 'complete' or 'incomplete'
*   **\`title\`**: Terse, neutral title of the story
*   **\`executiveSummary\`**: Provide a 2-4 sentence concise summary highlighting the most critical developments, key conflicts, and overall assessment from the articles. This should be suitable for a quick read in a daily brief.
*   **\`storyStatus\`**: Assess the current state of the story's development based *only* on the information in the articles. Use one of: 'Developing', 'Escalating', 'De-escalating', 'Concluding', 'Static'.
*   **\`timeline\`**: List key events in chronological order.
    *   \`description\`: Keep descriptions brief and factual.
    *   \`importance\`: Assess the event's importance to understanding the overall narrative (High/Medium/Low). High importance implies the event is central to the story's development or outcome.
*   **\`signalStrength\`**: Assess the overall reliability of the reporting *in this cluster*.
    *   \`assessment\`: High/Medium/Low/Mixed
    *   \`reasoning\`: 1-2 sentences explaining why you assigned this assessment based on source reliability patterns observed across the articles.
*   **\`significance\`**: Evaluate the global importance and impact of the story.
    *   \`assessment\`: Critical/High/Moderate/Low
    *   \`reasoning\`: Explain why this story matters at this level of significance (2-3 sentences)
    *   \`score\`: Numeric score from 1-10 representing global significance (1=minor local event, 10=major global impact)
*   **\`keyEntities\`**: Identify and categorize the most important actors in this story.
    *   \`list\`: Array of entities with name, type (Person/Organization/Country/etc.), and brief description of their involvement
*   **\`contradictions\`**: Note any conflicting information or differing perspectives presented across the articles.
*   **\`informationGaps\`**: List what critical information seems missing or unclear from the available reporting.

**Final Requirements:**
*   **Thoroughness:** Ensure all fields, especially descriptions, reasoning, context, and summaries, are detailed and specific. Avoid superficial or overly brief entries. Your analysis must reflect deep engagement with the provided texts.
*   **Grounding:** Base your entire analysis **SOLELY** on the content within the provided \`<articles>\` tags. Do not introduce outside information, assumptions, or knowledge.
*   **No Brevity Over Clarity:** Do **NOT** provide one-sentence descriptions or reasoning where detailed analysis is required by the field definition.
*   **Scrutinize Sources:** Pay close attention to the reliability assessment of sources when evaluating claims, especially in the \`contradictions\` section. Note when a claim originates primarily or solely from a low-reliability source.
*   **Validity:** Your JSON inside \`<final_json></final_json>\` tags MUST be 100% fully valid with no trailing commas, properly quoted strings and escaped characters where needed, and follow the exact refined structure provided. Ensure keys are in the specified order. Your entire JSON output should be directly extractable and parseable without human intervention.

Return your complete response, including your preliminary analysis/thinking in any format you prefer, followed by the **full** valid JSON inside \`<final_json></final_json>\` tags.
`.trim()

  return prePrompt + '\n\n' + storyArticleMd + '\n\n' + postPrompt
} 