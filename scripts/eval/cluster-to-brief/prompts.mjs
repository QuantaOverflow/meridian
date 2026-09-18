/**
 * 慢档的 prompt 与 schema。
 *
 * 事件抽取那两个抄自 `apps/backend/prototypes/block-writer/scratch/rubric-prompts.ts`
 * (抄而不 import:原件在 prototypes 下、被 .gitignore 挡掉)。**逐字沿用**,因为已缓存的
 * 四簇清单(c2/c21/c78/c82)是用它抽的,改措辞就不是同一把基准了。
 */

/** 每批最多抽 nArticles × EVENTS_PER_ARTICLE 条,防止模型无节制展开。 */
export function eventsSchema(maxItems) {
  return {
    type: 'object',
    required: ['events'],
    additionalProperties: false,
    properties: {
      events: {
        type: 'array',
        maxItems,
        items: {
          type: 'object',
          required: ['event', 'articleIds'],
          additionalProperties: false,
          properties: {
            event: {
              type: 'string',
              maxLength: 200,
              description:
                'One thing that happened, was said, or was decided, written as a self-contained sentence in your own words. Name the actor and the object explicitly ("Judge Fernando Rodriguez declined to block Castro\'s release"), never a pronoun and never "the official" when the articles give a name — this line is read on its own, with no article next to it. Include the timing if the articles give it. Under 30 words.',
            },
            articleIds: {
              type: 'array',
              items: { type: 'number' },
              description:
                'The ids (#number in the heading) of every article in this batch that reports this event. Two articles reporting the same event go in ONE entry with both ids.',
            },
          },
        },
      },
    },
  };
}

export function getEventsPrompt(batchArticleMd, nArticles, maxItems) {
  return `You are compiling a checklist of what happened, from ${nArticles} news articles that belong to one ongoing story.

Every entry must survive this test: **"According to these articles, <your entry>"** — read it back; if it does not hold, it does not belong. Do not add anything from your own knowledge, however accurate.

Here are the articles:

<articles>

${batchArticleMd}

</articles>

List the distinct EVENTS these articles report: things that happened, decisions that were taken, statements that were made, conditions that were found. One entry per event. Two articles reporting the same event give ONE entry with both ids, not two entries.

Include an event whether or not it is dramatic — a legal deadline expiring, a death toll being revised, a minister making an accusation all count. Leave out standing background that is not itself an event ("Nepal is mountainous"), and leave out an outlet's framing or commentary.

## Output

Emit one JSON object matching this schema. Each field's \`description\` tells you exactly what goes in it — follow them literally.

\`\`\`json
${JSON.stringify(eventsSchema(maxItems), null, 2)}
\`\`\`

The JSON must be 100% valid: no trailing commas, properly quoted and escaped strings, exactly the keys above.

**Your entire response is that JSON object. Nothing before the opening brace, nothing after the closing brace — no prose, no code fence, no tags.**`;
}
