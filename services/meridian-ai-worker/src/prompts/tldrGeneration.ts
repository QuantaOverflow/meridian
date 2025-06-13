/**
 * TLDR 生成提示词
 * 基于 reportV5.md 的 tldr_prompt 逻辑
 */

export function getTldrGenerationPrompt(briefTitle: string, briefContent: string): string {
  return `
You are an information processing agent tasked with creating a highly condensed 'memory state' or 'context brief' from a detailed intelligence briefing. Your output will be used by another AI model tomorrow to understand what topics were covered today, ensuring continuity without requiring it to re-read the full brief.

**Your Task:**

Read the full intelligence brief provided below within the \`<final_brief>\` tags. Identify each distinct major story or narrative thread discussed. For **each** identified story, extract the necessary information and format it precisely according to the specified structure.

**Input:**

The input is the full text of the daily intelligence brief generated previously.

<final_brief>
# ${briefTitle}

${briefContent}
</final_brief>

**Required Output Format:**

Your entire output must consist **only** of a list of strings, one string per identified story, following this exact format:

\`[Story Identifier] | [Inferred Status] | [Key Entities] | [Core Issue Snippet]\`

**Explanation of Output Components:**

1.  **\`[Story Identifier]\`:** Create a concise, descriptive label for the story thread (max 4-5 words). Examples: \`US-Venezuela: Deportations\`, \`Gaza: Ceasefire Collapse\`, \`UK: Economy Update\`, \`AI: Energy Consumption\`. Use keywords representing the main actors and topic.
2.  **\`[Inferred Status]\`:** Based *only* on the tone and content of the discussion *within the provided brief*, infer the story's current state. Use one of: \`New\`, \`Developing\`, \`Escalating\`, \`De-escalating\`, \`Resolved\`, \`Ongoing\`, \`Static\`.
3.  **\`[Key Entities]\`:** List the 3-5 most central entities (people, organizations, countries) mentioned *in the context of this specific story* within the brief. Use comma-separated names. Example: \`Trump, Maduro, US, Venezuela, El Salvador\`.
4.  **\`[Core Issue Snippet]\`:** Summarize the absolute essence of *this story's main point or development as covered in the brief* in **5-10 words maximum**. This requires extreme conciseness. Example: \`Deportations resume via Honduras amid legal challenges\`, \`Ceasefire over, hospital strike, offensive planned\`, \`Talks falter, missile strike during meeting\`.

**Instructions & Constraints:**

*   **Process Entire Brief:** Read and analyze the *whole* brief to identify all distinct major stories. Stories under \`<u>**title**</u>\` headings are primary candidates, but also consider distinct, significant themes from other sections (e.g., a recurring topic in 'Global Landscape').
*   **One Line Per Story:** Each identified story must correspond to exactly one line in the output, following the specified format.
*   **Strict Conciseness:** Adhere strictly to the format and the word limit for the \`[Core Issue Snippet]\`. This is critical.
*   **Focus on Coverage:** The goal is to capture *what was discussed*, not the full nuance or analysis.
*   **Inference for Status:** You must *infer* the status based on the brief's content, as it's not explicitly stated per story in the input brief text.
*   **No Extra Text:** Do **NOT** include any headers, explanations, introductions, or conclusions in your output. Output *only* the list of formatted strings.

Generate the condensed context brief based *only* on the provided \`<final_brief>\` text.
`.trim()
} 