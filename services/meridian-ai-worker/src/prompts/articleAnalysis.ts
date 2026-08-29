import { z } from 'zod';

/**
 * 文章分析 prompt。
 *
 * 2026-08-29 瘦身：模板 10,264 → 3,733 字符（-64%），单篇 24.5 → 15.3 neurons（-38%）。
 * 剃掉的是三条 few-shot 示例里的两条 + 示例的散文外壳 + criteria 的举例与解释散文；
 * **few-shot 这个技巧保留**（留一条精简示例）——原型对照实测证明它在干活。
 *
 * 关键发现（这才是这次改动的正当理由，省钱只是搭车）：
 *   砍示例后唯一的系统性偏移是 `primary_location` **粒度崩掉**
 *     India → "Ujjain-Garoth four-lane road, Ramakhedi village"
 *     China → "重慶"   /   USA → "Akron, Ohio"
 *   查因：Detailed Criteria 里**从来没有 primary_location 的定义**，三条示例是靠
 *   「都写国家级」隐式在教。而这个字段原样进 generateSearchText → embedding → 聚类，
 *   粒度不稳等于往聚类信号里掺噪声。基线自己也犯（"Gulf" / "Nepal-Tibet border"）。
 *   补 96 字符的显式判据后偏移归零。**剃 6,531 字符散文，补 96 字符判据。**
 *
 * 证据：prototypes/article-prompt-slim/（10 篇真实文章 × 6 臂 × 2 轮，含噪声地板对照）
 *   —— temp 0.1 非确定性，同一 prompt 自比即 6 处软字段差异，不建地板会把抖动读成退化。
 * 本函数正文由该原型的 `minimal-loc` 变体程序化生成，与实测过的那份逐字节相同。
 */
function getArticleAnalysisPrompt(title: string, content: string) {
  return `
# Article Text:
<scraped_news_article>
# ${title.trim()}

${content.trim()}
</scraped_news_article>

**CRITICAL: YOUR RESPONSE MUST BE VALID JSON ONLY. NO EXPLANATORY TEXT BEFORE OR AFTER THE JSON.**

**Goal:** Extract structured, semantically dense information from this article. This data will be used primarily for matching articles to diverse user interests via semantic similarity search and keyword filtering. Focus on extracting core facts and concepts; human readability is secondary to informational density.

**IMPORTANT FORMAT REQUIREMENT:**
- Start your response immediately with the opening brace {
- End your response with the closing brace }
- NO text before or after the JSON object
- Use the <final_json></final_json> tags to wrap your JSON response for reliable parsing

**Output Format:** Return ONLY the JSON object below. Follow the example provided.

**Example** — input: *"Regional Powers Convene Summit on Water Rights Dispute — three neighbouring states met in Geneva over the shrinking Blue River basin after a decade of tension and two failed treaties; mediator Elena Ruiz said a framework deal was reached but needs ratification, and it sidesteps the contested upstream dam."*

<final_json>
{
  "language": "en",
  "primary_location": "Switzerland",
  "completeness": "COMPLETE",
  "content_quality": "OK",
  "event_summary_points": ["Three states meet in Geneva over Blue River basin", "Follows decade of tension, two failed treaties", "Framework agreement reached, awaits ratification", "Deal sidesteps contested upstream dam"],
  "thematic_keywords": ["Transboundary water rights", "Resource scarcity diplomacy", "Treaty ratification risk", "Unresolved infrastructure dispute"],
  "topic_tags": ["Water Resources", "Diplomacy", "Regional Security", "Environment"],
  "key_entities": ["Blue River", "Geneva", "Elena Ruiz"],
  "content_focus": ["World Affairs", "Environment"]
}
</final_json>

**Now, analyze the following article and provide the JSON output:**

<final_json>
{
  "language": "string",
  "primary_location": "string",
  "completeness": "COMPLETE" | "PARTIAL_USEFUL" | "PARTIAL_USELESS",
  "content_quality": "OK" | "LOW_QUALITY" | "JUNK",
  "event_summary_points": ["string"],
  "thematic_keywords": ["string"],
  "topic_tags": ["string"],
  "key_entities": ["string"],
  "content_focus": ["string"]
}
</final_json>

**Criteria:**

*   \`completeness\`: \`COMPLETE\` = full text. \`PARTIAL_USEFUL\` = truncated (paywall, cut-off, ends mid-paragraph) but core story still extractable. \`PARTIAL_USELESS\` = only headline/lede/snippet; extraction pointless.
*   \`content_quality\`: \`OK\` = substantive reporting, analysis, interview, press release. \`LOW_QUALITY\` = thin update, opinion/rant with few facts, celebrity gossip, clickbait, scraped comments, minimal-detail roundup. \`JUNK\` = not article content at all (error page, login prompt, nav boilerplate, code, raw tables, gibberish, template text).
*   **Semantic density:** \`event_summary_points\` and \`thematic_keywords\` are dense tags, not prose. No filler, no full sentences.
*   **Field distinctions:** \`event_summary_points\` = specific facts of THIS event (who/what/when/where/outcome). \`thematic_keywords\` = broader context, significance, implications. \`topic_tags\` = subject categories, like index terms. \`key_entities\` = named proper nouns central to the event.
*   \`content_focus\`: pick 1-3 from \`["Politics", "Business", "Technology", "Science", "World Affairs", "Economy", "Environment", "Health", "Security", "Culture", "Human Interest", "Analysis", "Breaking News"]\` — the primary lens, not every topic touched.
*   \`primary_location\`: the country most central to the event (English country name). Use a city or region only when the event is inherently local to it.
`.trim();
}

export const articleAnalysisSchema = z.object({
  language: z.string().length(2),
  primary_location: z.string(),
  completeness: z.enum(['COMPLETE', 'PARTIAL_USEFUL', 'PARTIAL_USELESS']),
  content_quality: z.enum(['OK', 'LOW_QUALITY', 'JUNK']),
  event_summary_points: z.array(z.string()),
  thematic_keywords: z.array(z.string()),
  topic_tags: z.array(z.string()),
  key_entities: z.array(z.string()),
  content_focus: z.array(z.string()),
});

export type ArticleAnalysisResult = z.infer<typeof articleAnalysisSchema>;

export { getArticleAnalysisPrompt }; 