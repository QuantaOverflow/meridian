import { z } from 'zod';

/**
 * 文章分析结果的 Zod schema
 */
export const articleAnalysisSchema = z.object({
  language: z.string().length(2),
  primary_location: z.string(),
  completeness: z.enum(['COMPLETE', 'PARTIAL_USEFUL', 'PARTIAL_USELESS']),
  content_quality: z.enum(['OK', 'LOW_QUALITY', 'JUNK']),
  
  event_summary_points: z.array(z.string()),
  thematic_keywords: z.array(z.string()),
  topic_tags: z.array(z.string()),
  key_entities: z.array(z.string()),
  content_focus: z.array(z.string())
});

/**
 * 分析文章的提示模板
 */
export function getArticleAnalysisPrompt(title: string, content: string): string {
  return `
# Article Text:
<scraped_news_article>
# ${title.trim()}

${content.trim()}
</scraped_news_article>

**Goal:** Extract structured, semantically dense information from this article. This data will be used primarily for matching articles to diverse user interests via semantic similarity search and keyword filtering. Focus on extracting core facts and concepts; human readability is secondary to informational density.

**Output Format:** Return only the JSON object below. Follow the examples provided.

**--- Start Examples ---**

**Example 1: Tech Product Launch**

*Input Article Snippet (Conceptual):*
\`\`\`
Headline: NovaCorp Unveils 'Photon' AI Chip for Edge Computing
Body: San Francisco – NovaCorp today announced Photon, its new AI accelerator chip designed for low-power edge devices. Photon boasts 10 TOPS performance at under 2 watts, targeting IoT and autonomous systems. CEO Jane Smith highlighted partnerships with device makers OmniGadget and AutoDrive. Initial benchmarks show significant speedups in image recognition tasks compared to competitors. Shipments begin Q3. Analysts see this intensifying competition in the edge AI market.
\`\`\`

*Output JSON:*
\`\`\`json
{
  "language": "en",
  "primary_location": "USA",
  "completeness": "COMPLETE",
  "content_quality": "OK",
  "event_summary_points": [
    "NovaCorp announces Photon AI chip",
    "Designed for low-power edge devices",
    "Specs: 10 TOPS, <2W power",
    "Targets IoT, autonomous systems",
    "Partnerships: OmniGadget, AutoDrive",
    "Shipments start Q3"
  ],
  "thematic_keywords": [
    "Edge AI acceleration",
    "Low-power computing",
    "AI hardware market",
    "Competitive landscape",
    "IoT enablement",
    "Autonomous system components"
  ],
  "topic_tags": [
    "Artificial Intelligence",
    "Semiconductors",
    "Edge Computing",
    "Internet of Things (IoT)",
    "Hardware",
    "NovaCorp"
  ],
  "key_entities": [
    "NovaCorp",
    "Photon",
    "Jane Smith",
    "OmniGadget",
    "AutoDrive",
    "San Francisco"
  ],
  "content_focus": [
    "Technology",
    "Business"
  ]
}
\`\`\`

**Example 2: Geopolitical Development**

*Input Article Snippet (Conceptual):*
\`\`\`
Headline: Maritime Tensions Rise in Azure Strait After Naval Incident
Body: Tensions flared today in the Azure Strait following a close encounter between naval vessels from Accadia and Borealia. Accadia claims a Borealian patrol boat entered its territorial waters, issuing warnings before escorting it out. Borealia disputes the boundary claim and accuses Accadian ships of aggressive maneuvers. The strait is a critical shipping lane. Regional powers call for de-escalation. This follows months of diplomatic friction over fishing rights.
\`\`\`

*Output JSON:*
\`\`\`json
{
  "language": "en",
  "primary_location": "GLOBAL", // Region specific, but involves multiple nations, treat as global issue unless focused solely on one nation's internal perspective
  "completeness": "COMPLETE",
  "content_quality": "OK",
  "event_summary_points": [
    "Naval encounter in Azure Strait",
    "Involved Accadia and Borealia vessels",
    "Accadia alleges territorial water violation",
    "Borealia disputes boundary, alleges aggression",
    "Regional powers urge calm"
  ],
  "thematic_keywords": [
    "Maritime security",
    "Geopolitical tension",
    "Territorial disputes",
    "Freedom of navigation",
    "International relations",
    "Shipping lane security",
    "De-escalation efforts"
  ],
  "topic_tags": [
    "International Relations",
    "Maritime Law",
    "Geopolitics",
    "Accadia",
    "Borealia",
    "Azure Strait",
    "Naval Operations"
  ],
  "key_entities": [
    "Accadia",
    "Borealia",
    "Azure Strait"
  ],
  "content_focus": [
    "World Affairs",
    "Security",
    "Politics"
  ]
}
\`\`\`

**Example 3: Scientific Breakthrough Report**

*Input Article Snippet (Conceptual):*
\`\`\`
Headline: Researchers Develop Novel Catalyst for Greener Plastic Production
Body: A team at Quantum University has developed a new palladium-based catalyst that enables the production of common plastics using significantly less energy and generating fewer harmful byproducts. Published in 'Nature Synthesis', the study shows a 30% reduction in energy requirements for polymerization. Lead researcher Dr. Eva Rostova notes potential for large-scale industrial adoption, reducing the carbon footprint of plastic manufacturing. Further testing is needed for durability.
\`\`\`

*Output JSON:*
\`\`\`json
{
  "language": "en",
  "primary_location": "N/A", // Specific university, but discovery is global relevance, location not central focus
  "completeness": "COMPLETE",
  "content_quality": "OK",
  "event_summary_points": [
    "New palladium catalyst developed",
    "Created by Quantum University researchers",
    "Reduces energy use (30%) in plastic production",
    "Lowers harmful byproducts",
    "Published in 'Nature Synthesis'"
  ],
  "thematic_keywords": [
    "Green chemistry",
    "Sustainable manufacturing",
    "Catalysis innovation",
    "Plastic production efficiency",
    "Carbon footprint reduction",
    "Industrial process improvement"
  ],
  "topic_tags": [
    "Chemistry",
    "Materials Science",
    "Sustainability",
    "Plastics",
    "Research",
    "Catalysis"
  ],
  "key_entities": [
    "Quantum University",
    "Eva Rostova",
    "Nature Synthesis",
    "Palladium"
  ],
  "content_focus": [
    "Science",
    "Technology",
    "Environment"
  ]
}
\`\`\`

**--- End Examples ---**

**Now, analyze the following article and provide the JSON output:**

\`\`\`json
{
  "language": "string",              // ISO 639-1 alpha-2 code.
  "primary_location": "string",      // Dominant ISO 3166-1 alpha-3 country code associated with the article's content, "GLOBAL" if worldwide scope, or "N/A" if not applicable/determinable.
  "completeness": "COMPLETE" | "PARTIAL_USEFUL" | "PARTIAL_USELESS", // Assess if the *extracted text* seems complete or truncated.
  "content_quality": "OK" | "LOW_QUALITY" | "JUNK", // Assess the *nature* of the content.
  "event_summary_points": ["string"], // If content quality is OK and completeness is not PARTIAL_USELESS: List of 2-5 short, factual bullet points about the specific event reported. Focus on: Who did what? What was the outcome? Where? Use keywords and essential facts, not full sentences. Empty array otherwise.
  "thematic_keywords": ["string"],   // If content quality is OK and completeness is not PARTIAL_USELESS: List of 3-7 keywords/phrases representing the broader significance, context, or underlying theme. Answer: Why does this matter? What larger trend is this part of? Empty array otherwise.
  "topic_tags": ["string"],          // If content quality is OK and completeness is not PARTIAL_USELESS: List of 3-7 concise keywords/phrases for the core subjects/concepts discussed. Think potential user interests or search terms. Empty array otherwise.
  "key_entities": ["string"],        // If content quality is OK and completeness is not PARTIAL_USELESS: List of specific proper nouns (people, organizations, named locations like cities/regions, product names) central to the event described. Empty array otherwise.
  "content_focus": ["string"]        // If content quality is OK and completeness is not PARTIAL_USELESS: List of 1-3 tags describing the article's primary angle from the allowed list: ["Politics", "Business", "Technology", "Science", "World Affairs", "Economy", "Environment", "Health", "Security", "Culture", "Human Interest", "Analysis", "Breaking News"]. Empty array otherwise.
}
\`\`\`

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
  // 这里简化了提示内容，你可以从 articleAnalysis.prompt.ts 文件复制完整内容
}