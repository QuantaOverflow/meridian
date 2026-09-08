/**
 * 【写作层的证据链】三个 prompt：写前声明判断、写后自检找漏、按材料重写。
 *
 * 为什么写作层需要自己去检索，而不是只读情报报告：
 * 报告讲的是 WHAT HAPPENED，而简报的写作风格（briefSkeleton.ts 的 VOICE）要求
 * "why it matters strategically, the likely motivations, second-order effects"——
 * 这类材料**报告结构上不收**。实测簇 82：原文里 Ellison 说「Abbott 有法律义务却选择无视
 * 法律」、Moriarty 说「他要是跑了责任在一个人身上」、Abbott 发言人说「把联邦法院征用来
 * 接管州长职权」，报告里 0 条、检索片段里 0 条。模型被要求写分析、手里只有事实性引语，
 * 就只能自己造——「他位于 rio grande 对岸」（人在美国境内）、「面临严重联邦指控」
 * （联邦检察官只是在考虑起诉）两条致命错都是这么来的。
 *
 * 三段各自对着一个实测出来的失败：
 *
 * **① 提问要问「判断」不是「事实」**。第一版问的是 "what you still need"，模型理解成
 * 「报告里还缺哪些事实」，8 个问题全在问开枪细节、法律论点，两个问的还是报告里已有的东西；
 * 拿回一堆事实之后成稿变成事实堆叠、分析整个消失——致命错归零不是学会了有据分析，是不分析了。
 * 改成「先声明你要下的判断，程序去查有没有支撑」之后，4 条判断全是判断，且可证伪。
 *
 * **② 关键词要的是「记者会怎么写」**。schema 里写死 "Use their words, not your paraphrase;
 * a program matches these against the article text literally"——下游用逐字短语匹配当支撑判据，
 * 模型给转述就永远匹配不上。
 *
 * **③ 自检是独立任务，不是同一次调用里的约束**。写作时模型在一大堆材料里做隐式取舍，
 * 实测材料到位 11/14、三份稿全写只有 4/14——三分之二的材料白给。而 102 份成稿
 * `finish_reason` 全是 stop、平均输出 458 token（上限 2500），**篇幅有余量**；
 * 核心事件（≥6 篇报道）采纳率只有 38–56%，**也不是合理取舍**。
 * 单独一次「找漏」调用的注意力分配跟「写一篇好稿」完全不同，不参与显著性竞争。
 * 实测四簇：期望单份覆盖 41.1%（初稿）→ 51.9%（补漏后），增益 15 格、只丢 1 格。
 *
 * **④ 重写而不是追加**。Chain of Density 原论文是重写；本仓 b′ 分段写踩过段间重复的坑，
 * 而 RARR 那次「43 条应用删除里 20 条经判官确认误删」说明改写很容易把写对的弄坏——
 * 所以 prompt 里明写「保留初稿已有的所有事实，这是扩写不是替换」。
 */

/** 一次写作最多声明几条判断。8 条会逼模型凑数——实测 8 条里 4 条逐字相同。 */
export const MAX_CLAIMS = 4;
/** 一次自检最多报几条 gap。 */
export const MAX_GAPS = 6;

export const CLAIM_SCHEMA = {
  type: 'object', required: ['claims'], additionalProperties: false,
  properties: {
    claims: {
      type: 'array', maxItems: MAX_CLAIMS,
      items: {
        type: 'object', required: ['claim', 'keywords'], additionalProperties: false,
        properties: {
          claim: {
            type: 'string', maxLength: 200,
            description: 'One judgement you intend to make in the brief that goes beyond restating what happened: why this matters, what a party is really after, what it costs whom, what follows from it, or what a reader would otherwise miss. Write it as the sentence you would actually put in the brief.',
          },
          keywords: {
            type: 'array', items: { type: 'string' },
            description: 'Two or three phrases likely to appear VERBATIM in the original coverage and to back this judgement up — what an official, a lawyer, a prosecutor or a critic would have been quoted saying about it. Use their words, not your paraphrase; a program matches these against the article text literally.',
          },
        },
      },
    },
  },
} as const;

export const GAP_SCHEMA = {
  type: 'object', required: ['gaps'], additionalProperties: false,
  properties: {
    gaps: {
      type: 'array', maxItems: MAX_GAPS,
      items: {
        type: 'object', required: ['point', 'reason', 'keywords'], additionalProperties: false,
        properties: {
          point: {
            type: 'string', maxLength: 200,
            description: 'One thing the report states that the draft below does not tell the reader. Name it concretely — who did what — not a topic label.',
          },
          reason: {
            type: 'string', maxLength: 200,
            description: 'Why this belongs in the brief and why you judge the draft to have left it out. If the draft mentions it only in passing without saying what happened, say so.',
          },
          keywords: {
            type: 'array', items: { type: 'string' },
            description: 'Two or three phrases likely to appear VERBATIM in the original coverage of this point. Use a reporter\'s words, not your paraphrase — a program matches these against the article text literally.',
          },
        },
      },
    },
  },
} as const;

export interface ProposedClaim { claim: string; keywords: string[] }
export interface ReportedGap { point: string; reason: string; keywords: string[] }

/** 调用①：写之前声明要下的判断，供程序去查有没有支撑。 */
export function getClaimProposalPrompt(report: string, title: string): string {
  return `You are about to write one section of a news brief titled "${title}". Below is the intelligence report you have been given.

<report>
${report}
</report>

The report tells you WHAT HAPPENED. Your brief also has to say why it matters, what the parties are really after, and what follows — and the report deliberately does not contain those; they only exist in what people were quoted saying in the original coverage.

**Before you write, state the judgements you intend to make, and a program will go find whether the coverage backs them.** For each one, give the phrases a reporter would have used when quoting someone making that point.

Do not list facts you already have. Do not ask for more detail about the incident. Every entry must be a judgement that could turn out to be unsupported.

Emit one JSON object matching this schema. Follow each field's \`description\` literally.

\`\`\`json
${JSON.stringify(CLAIM_SCHEMA, null, 2)}
\`\`\`

**Your entire response is that JSON object. Nothing before the opening brace, nothing after the closing brace.**`;
}

/** 调用③：拿报告和初稿对照，找出初稿没写到的点，并给检索关键词。 */
export function getGapSelfCheckPrompt(report: string, draft: string): string {
  return `Below is an intelligence report and a draft brief written from it.

<report>
${report}
</report>

<draft>
${draft}
</draft>

The draft is shorter than the report and necessarily leaves things out. Your job is to find what it left out that a reader of this brief would need.

Go through the report and identify points the draft does not convey. A point only mentioned in passing, without saying what actually happened, counts as left out. Do not list things the draft already covers in different words.

For each gap, give the phrases a reporter would have used when writing about it, so a program can pull the original wording.

Emit one JSON object matching this schema. Follow each field's \`description\` literally.

\`\`\`json
${JSON.stringify(GAP_SCHEMA, null, 2)}
\`\`\`

**Your entire response is that JSON object. Nothing before the opening brace, nothing after the closing brace.**`;
}

/** 调用④：拿 gap 材料重写整篇。**扩写不是替换**——初稿写对的必须留着。 */
export function getGapRewritePrompt(draft: string, gapBlock: string): string {
  return `Below is your draft and material on points it left out.

<draft>
${draft}
</draft>

<missing_points>
${gapBlock}
</missing_points>

Rewrite the brief so it also covers these points, grounding each in the quoted wording. **Keep everything the draft already got right** — this is an expansion, not a replacement. Where a gap has no source material, leave it out rather than asserting it.

Write flowing paragraphs and nothing else. No title, no headings, no bullet list, no preamble.`;
}

/**
 * 渲染「判断 → 支撑」块。**没找到支撑的必须显式说出来**——
 * 早期版本没有这道门时 `BACKING FOUND: none` 一次都没触发过：判断句里有 Texas / Minnesota
 * 这类词，词面打分总能给出正分，检索永远返回两句「看着相关」的东西，
 * 于是「找不到支撑就别写」这条指令结构上永远不生效。现在只有逐字短语命中才算支撑。
 */
export function renderClaimEvidence(
  claims: ProposedClaim[],
  backingOf: (i: number) => Array<{ ref: number; text: string }>
): string {
  return claims
    .map((c, i) => {
      const hits = backingOf(i);
      return hits.length
        ? `JUDGEMENT YOU PROPOSED: ${c.claim}\nBACKING FOUND:\n${hits.map(h => `[#${h.ref}] ${h.text}`).join('\n')}`
        : `JUDGEMENT YOU PROPOSED: ${c.claim}\nBACKING FOUND: none — the coverage does not support this. Do not write it.`;
    })
    .join('\n\n');
}

/** 渲染「漏掉的点 → 原文材料」块。 */
export function renderGapEvidence(
  gaps: ReportedGap[],
  sourcesOf: (i: number) => Array<{ ref: number; text: string }>
): string {
  return gaps
    .map((g, i) => {
      const hits = sourcesOf(i);
      const head = `GAP: ${g.point}\nWHY: ${g.reason}`;
      return hits.length
        ? `${head}\nSOURCE:\n${hits.map(h => `[#${h.ref}] ${h.text}`).join('\n')}`
        : `${head}\nSOURCE: none found in the coverage.`;
    })
    .join('\n\n');
}

/** 判断/gap 去重：模型会拿同一句话把 maxItems 填满（实测 8 条里 4 条逐字相同）。 */
export function dedupeByText<T>(items: T[], keyOf: (x: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter(x => {
    const k = keyOf(x).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
