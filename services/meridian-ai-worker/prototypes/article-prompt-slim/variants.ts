/**
 * ── 便携模块 ──────────────────────────────────────────────────────────────
 * 文章分析 prompt 的瘦身候选。**赢的那个变体直接抬进 src/prompts/articleAnalysis.ts。**
 * 纯函数，不含 I/O、不含终端代码。
 *
 * 要回答的问题：
 *   现状 prompt 模板固定 10,264 字符，其中 47% 是三条 few-shot 示例、36% 是 Detailed
 *   Criteria。中位文章正文才 2,912 字符——**模板是正文的 3.5 倍**，每天白付 686 遍。
 *   按奥卡姆剃刀：**保留 few-shot 这个技巧，但砍到最小**，前提是不出现明显质量突变。
 *   最小到哪一步会突变？
 *
 * 刻意保留 `zero`（无示例）这个变体：它是对照。不测它就无法证明留下来的那条示例
 * 确实在干活——剃刀要剃掉的是**没有作用**的部分，不是"看起来多余"的部分。
 */

// ── 各段原文（逐字取自现状 prompt，改动只在"取哪几段"）───────────────────

const HEADER = (title: string, content: string) => `
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
`.trim();

/**
 * 保留的那条示例选 Example 2（地缘政治）。理由：语料以世界新闻为主，它最贴近真实分布。
 * 但这也正是风险所在——单条示例可能把模型锚在这一个题材上，所以 fixtures 里刻意放了
 * 中文、宣言体、体育转会、名人这些离它最远的样本。
 */
const EXAMPLE_GEO_FULL = `
**Example: Geopolitical Development**

*Input Article Snippet (Conceptual):*
\`\`\`
Headline: Regional Powers Convene Summit on Water Rights Dispute
Body: Representatives from three neighbouring states met in Geneva to negotiate access to the shrinking Blue River basin. Talks follow a decade of rising tension and two failed treaties. Mediator Elena Ruiz said a framework agreement was reached but requires ratification. Analysts note the deal sidesteps the contested upstream dam project.
\`\`\`

*Output JSON:*
<final_json>
{
  "language": "en",
  "primary_location": "Switzerland",
  "completeness": "COMPLETE",
  "content_quality": "OK",
  "event_summary_points": [
    "Three states meet in Geneva over Blue River basin",
    "Follows decade of tension, two failed treaties",
    "Framework agreement reached, awaits ratification",
    "Deal sidesteps contested upstream dam"
  ],
  "thematic_keywords": [
    "Transboundary water rights",
    "Resource scarcity diplomacy",
    "Treaty ratification risk",
    "Unresolved infrastructure dispute"
  ],
  "topic_tags": [
    "Water Resources",
    "Diplomacy",
    "Regional Security",
    "Environment"
  ],
  "key_entities": [
    "Blue River",
    "Geneva",
    "Elena Ruiz"
  ],
  "content_focus": [
    "World Affairs",
    "Environment"
  ]
}
</final_json>
`.trim();

/** 同一条示例，去掉散文外壳：只留一行输入 + JSON。示例的作用是示范**输出形状**，
 *  输入片段那段散文对形状没有贡献。 */
const EXAMPLE_GEO_LEAN = `
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
`.trim();

const SCHEMA_BLOCK = `
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
`.trim();

/** 现状的 Detailed Criteria，逐字。3,727 字符。 */
const CRITERIA_FULL = `
**Detailed Criteria Clarifications:**

*   **Completeness:**
    *   \`COMPLETE\`: Appears to be the full article text available in the input.
    *   \`PARTIAL_USEFUL\`: Text appears truncated (e.g., paywall fade-out, "read more" link cut-off, abruptly ends mid-paragraph) but enough core information is present to understand the basic story and extract meaningful data.
    *   \`PARTIAL_USELESS\`: Only headline, lede, or a tiny snippet is present. Virtually no usable content beyond the absolute minimum to identify the topic, making extraction of summaries/keywords impossible or pointless.

*   **Content Quality:**
    *   \`OK\`: Standard news reporting, analysis, interviews, press releases, or other substantive factual content. Well-structured and informative.
    *   \`LOW_QUALITY\`: Content is present but potentially problematic. Examples: very thin/short updates with little new info, heavy on opinion/ranting with minimal facts, celebrity gossip focus, sensationalized or clickbait-style writing (even if factual), user-generated content (like comments sections mistakenly scraped), lists/roundups with minimal detail per item. *May be useful depending on user needs, but flag it.*
    *   \`JUNK\`: Input text is clearly not usable article content. Examples: Error messages (404, 500), login/signup prompts, ad-heavy pages with no real article, navigation menus or site boilerplate text only, code snippets, raw data tables without context, content is obviously machine-generated gibberish or non-prose, duplicate template text. *These should generally be filtered out entirely.*

*   **Semantic Density:** For \`event_summary_points\` and \`thematic_keywords\`, prioritize packing meaning into keywords and short phrases. Avoid conversational filler ("As reported today...", "It is interesting to note that..."), introductory clauses, or full grammatical sentences. Think like you're writing concise tags or dense factual notes for a database entry, not prose for a human reader.

*   **Distinctions between Key Fields:**
    *   \`event_summary_points\`: Focus strictly on the *specific facts* of the *event being reported* in this article. Who did what, when, where, what was the immediate outcome? Use keywords and essential nouns/verbs.
    *   \`thematic_keywords\`: Describe the *broader context, significance, and underlying forces* related to the event. Why does this event matter in the bigger picture? What trends does it connect to? What are the potential implications? Use conceptual phrases.
    *   \`topic_tags\`: Identify the *core subjects or categories* the article falls under. What general areas of interest does this article cover? Think of these like index terms or categories in a library. Use concise nouns or noun phrases.
    *   \`key_entities\`: List the *specific named proper nouns* (people, organizations, specific geographic locations like cities/regions if central to the event, product names, legislative bill names, etc.) that are the main actors or subjects *within the specific event*.

*   **\`content_focus\` Selection:** Choose the 1-3 tags from the provided list \`["Politics", "Business", "Technology", "Science", "World Affairs", "Economy", "Environment", "Health", "Security", "Culture", "Human Interest", "Analysis", "Breaking News"]\` that best capture the *primary angle or lens* through which the article presents the information. An article about a new environmental regulation could be \`Environment\` and \`Politics\` and maybe \`Economy\` if it focuses on business impact. \`Analysis\` is for pieces primarily offering interpretation or opinion on events, rather than just reporting them. \`Breaking News\` suggests a focus on immediate, unfolding events.
`.trim();

/**
 * 压缩版 criteria：保留全部**判据**，砍掉举例与解释性散文。
 * 两个枚举字段（completeness / content_quality）刻意保留完整的档位定义——它们下游驱动
 * 质量门（LOW_QUALITY / JUNK 会被拦），改动它们的判据分布是真回归，不是省 token。
 */
const CRITERIA_SLIM = `
**Criteria:**

*   \`completeness\`: \`COMPLETE\` = full text. \`PARTIAL_USEFUL\` = truncated (paywall, cut-off, ends mid-paragraph) but core story still extractable. \`PARTIAL_USELESS\` = only headline/lede/snippet; extraction pointless.
*   \`content_quality\`: \`OK\` = substantive reporting, analysis, interview, press release. \`LOW_QUALITY\` = thin update, opinion/rant with few facts, celebrity gossip, clickbait, scraped comments, minimal-detail roundup. \`JUNK\` = not article content at all (error page, login prompt, nav boilerplate, code, raw tables, gibberish, template text).
*   **Semantic density:** \`event_summary_points\` and \`thematic_keywords\` are dense tags, not prose. No filler, no full sentences.
*   **Field distinctions:** \`event_summary_points\` = specific facts of THIS event (who/what/when/where/outcome). \`thematic_keywords\` = broader context, significance, implications. \`topic_tags\` = subject categories, like index terms. \`key_entities\` = named proper nouns central to the event.
*   \`content_focus\`: pick 1-3 from \`["Politics", "Business", "Technology", "Science", "World Affairs", "Economy", "Environment", "Health", "Security", "Culture", "Human Interest", "Analysis", "Breaking News"]\` — the primary lens, not every topic touched.
`.trim();

/**
 * 一行 primary_location 判据。**这是首轮实测长出来的变体**：
 * 砍示例后唯一的系统性偏移是 primary_location 粒度（6/10 篇越出噪声地板，而
 * language / completeness / content_quality 零翻车）。查因发现 criteria 里**根本没有
 * primary_location 的定义**——三条示例是靠"都写国家级"隐式在教。
 * 剃掉 4,839 字符的示例、补 96 字符的判据：这才是奥卡姆剃刀该有的形状。
 */
const CRITERIA_LOCATION = `*   \`primary_location\`: the country most central to the event (English country name). Use a city or region only when the event is inherently local to it.`;

// ── 变体 ──────────────────────────────────────────────────────────────────

export interface PromptVariant {
  id: string;
  label: string;
  /** 一句话说明这个变体在剃掉什么 */
  cuts: string;
  build: (title: string, content: string) => string;
}

const compose = (parts: string[]) => (title: string, content: string) =>
  [HEADER(title, content), ...parts].join('\n\n').trim();

/** 现状 prompt 的三条示例合起来 4,839 字符，这里只用它的长度做基线换算，不重复粘贴。 */
export const BASELINE_TEMPLATE_CHARS = 10264;

export const VARIANTS: PromptVariant[] = [
  {
    id: 'full',
    label: '现状（基线）',
    cuts: '不剃。3 条完整示例 + 完整 criteria',
    // 直接调生产函数，保证基线就是线上那一份，不会因为我抄错而失真
    build: (t, c) => PRODUCTION_PROMPT(t, c),
  },
  {
    id: 'one',
    label: '1 条完整示例',
    cuts: '砍掉 Tech / Science 两条示例',
    build: compose(['**Output Format:** Return ONLY the JSON object below. Follow the example provided.', EXAMPLE_GEO_FULL, SCHEMA_BLOCK, CRITERIA_FULL]),
  },
  {
    id: 'one-lean',
    label: '1 条精简示例',
    cuts: '上一档 + 示例去掉散文外壳，只留输入一行 + JSON',
    build: compose(['**Output Format:** Return ONLY the JSON object below. Follow the example provided.', EXAMPLE_GEO_LEAN, SCHEMA_BLOCK, CRITERIA_FULL]),
  },
  {
    id: 'minimal',
    label: '1 条精简示例 + 精简 criteria',
    cuts: '上一档 + criteria 去掉举例与解释散文，判据全留',
    build: compose(['**Output Format:** Return ONLY the JSON object below. Follow the example provided.', EXAMPLE_GEO_LEAN, SCHEMA_BLOCK, CRITERIA_SLIM]),
  },
  {
    id: 'minimal-loc',
    label: '精简 + 补 location 判据',
    cuts: '同 minimal，另补一行 primary_location 判据（96 字符）补上示例被砍掉的隐式示范',
    build: compose(['**Output Format:** Return ONLY the JSON object below. Follow the example provided.', EXAMPLE_GEO_LEAN, SCHEMA_BLOCK, CRITERIA_SLIM + '\n' + CRITERIA_LOCATION]),
  },
  {
    id: 'zero',
    label: '无示例（对照）',
    cuts: '示例全砍。**这一档是对照，不是候选**——用来验证留下的那条示例确实在干活',
    build: compose(['**Output Format:** Return ONLY the JSON object below.', SCHEMA_BLOCK, CRITERIA_SLIM]),
  },
];

/** 生产 prompt 由 tui 注入，避免这个纯模块 import 生产代码时把路径写死 */
let PRODUCTION_PROMPT: (t: string, c: string) => string = () => {
  throw new Error('未注入生产 prompt：先调 setProductionPrompt()');
};
export function setProductionPrompt(fn: (t: string, c: string) => string) {
  PRODUCTION_PROMPT = fn;
}

/** 模板净长度（不含正文），用来算省了多少 */
export function templateChars(v: PromptVariant): number {
  return v.build('T', 'C').length - 2;
}
