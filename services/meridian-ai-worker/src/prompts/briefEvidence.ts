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
/**
 * 一次自检最多报几条 gap。**这是上限不是目标**——2026-09-09 实测 23 块里 23 块
 * 都精确报满 6 条，claims 那边 24/24 都报满 4 条：schema 的 maxItems 在没有别的
 * 数量锚点时会被模型当成要凑的数。prompt 里已显式写明「空列表是有效答案」并给了
 * 门槛（读者会被误导 / 会据此行动），改上限治不了这个，改问法才行。
 */
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

/**
 * 【找漏改成两段】2026-09-09。
 *
 * 原来是一次自由生成：给报告 + 初稿，让模型直接吐「初稿漏了哪些点」。实测两个失效：
 *   · 23 块里 23 块精确报满 maxItems=6，从不返回空列表
 *   · 44% 的条目其实是对**初稿已写内容**挑修饰细节（"会面持续三小时"、"他是房地产商"）
 * 两版 prompt 修补都无效，第二版把反面例句写进 schema 的 description 后反而恶化到 95%
 * ——schema 里的文本会被模型当上下文读（arXiv:2604.14862），等于给了它一个模板去模仿。
 *
 * 改成业界在「覆盖/遗漏」任务上一致的结构（arXiv:2510.07926、EMNLP 2025 omission、
 * Meta CoVe arXiv:2309.11495）：**穷举候选 → 逐条二元判定 → 只留判「没覆盖」的**。
 * 本仓自己的 coverage-judge（κ0.965，scripts/eval/coverage-judge/）就是这个结构，
 * 只是一直只用在事后评估。
 *
 * 两段各自的设计要点：
 *   ① 穷举段**不看初稿**——它只从报告里列点，没有「和初稿比」这个任务，
 *      也就没有「挑细节」这个失败模式的立足点。schema 不设 maxItems（数字会变成目标）。
 *   ② 判定段只做一件事：这个点初稿讲没讲。covered=true 时**必须引初稿原句**，
 *      不能空口说覆盖了——这是把「检索失败伪装成事实断言」那类失效堵死的同一招。
 */
export const GAP_CANDIDATE_SCHEMA = {
  type: 'object', required: ['points'], additionalProperties: false,
  properties: {
    points: {
      // 刻意不设 maxItems：数字会被当成要凑够的目标。多报无妨——下一段会逐条筛。
      type: 'array',
      items: {
        type: 'object', required: ['point', 'keywords'], additionalProperties: false,
        properties: {
          point: {
            type: 'string', maxLength: 200,
            description: 'One thing the report states, named concretely — who did what, with the specifics. Not a topic label.',
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

/**
 * 判定改成三档而不是布尔。依据 docs/engineering-notes/prompt-engineering-self-critique.md
 * 建议 ③：二元「有没有提到」这条边界模型执行不稳（v1 实测 44% 的条目是「提到了但漏细节」
 * 被当成漏报），而**具体判据比抽象原则稳**。三档把「提没提」和「说没说清」分开，
 * 只有前两档进重写。
 *
 * ⚠️ 这条是从「具体 > 抽象」的宽泛共识做的推论，**没有直接论文支持**（文档里标了弱证据），
 * 所以这一版要实测，别当成已验证的做法。
 */
export const COVERAGE_SCHEMA = {
  type: 'object', required: ['judgements'], additionalProperties: false,
  properties: {
    judgements: {
      type: 'array',
      items: {
        type: 'object', required: ['i', 'verdict', 'evidence'], additionalProperties: false,
        properties: {
          i: { type: 'integer', description: 'The number of the point being judged, exactly as given.' },
          verdict: {
            type: 'string', enum: ['absent', 'weakened', 'told'],
            description: 'absent = the draft never brings this matter up. weakened = the draft raises it but leaves the reader with the wrong impression of what happened. told = the draft conveys it, even if in fewer words or without every specific.',
          },
          evidence: {
            type: 'string', maxLength: 300,
            description: 'For weakened and told, the sentence from the draft that raises the matter, quoted verbatim. For absent, the empty string.',
          },
        },
      },
    },
  },
} as const;

export interface GapCandidate { point: string; keywords: string[] }
export interface CoverageJudgement { i: number; verdict: 'absent' | 'weakened' | 'told'; evidence: string }

/** 找漏第一段：只读报告，穷举它陈述的点。**刻意不给初稿**——没有对比就没有挑细节的余地。 */
export function getGapCandidatePrompt(report: string): string {
  return `Below is an intelligence report on one news story.

<report>
${report}
</report>

List the things this report states — each as a concrete point a reader could be told. Work through the report and list what is there.

Include what happened, who did or said it, and the numbers and dates that carry meaning. Skip the report's own remarks about its sourcing, its gaps and its contradictions: those describe the reporting, not the world.

For each point, give the phrases a reporter would have used when writing about it, so a program can pull the original wording.

Emit one JSON object matching this schema. Follow each field's \`description\` literally.

\`\`\`json
${JSON.stringify(GAP_CANDIDATE_SCHEMA, null, 2)}
\`\`\`

**Your entire response is that JSON object. Nothing before the opening brace, nothing after the closing brace.**`;
}

/** 找漏第二段：逐条判初稿讲没讲。covered=true 必须引初稿原句。 */
export function getGapCoveragePrompt(draft: string, points: GapCandidate[]): string {
  const list = points.map((p, i) => `${i + 1}. ${p.point}`).join('\n');
  return `Below is a draft news brief, then a numbered list of points.

<draft>
${draft}
</draft>

<points>
${list}
</points>

For each numbered point, place the draft in one of three states.

**told** — the draft conveys this point. A brief says things in fewer words than a report: leaving out a duration, a title, an exact figure or a date still counts as told, so long as the reader ends up with the right picture of what happened.

**weakened** — the draft raises the matter but leaves the reader with the wrong impression of it: it says a thing was considered when it was decided, or reports a claim as a finding, or gives a figure that changes the meaning.

**absent** — the draft never brings this matter up.

For told and weakened, quote the sentence from the draft that raises the matter. A point you cannot quote for is absent.

Judge every point. Emit one JSON object matching this schema. Follow each field's \`description\` literally.

\`\`\`json
${JSON.stringify(COVERAGE_SCHEMA, null, 2)}
\`\`\`

**Your entire response is that JSON object. Nothing before the opening brace, nothing after the closing brace.**`;
}

/**
 * 【找漏第三版：回到「读者需要什么」】2026-09-09。
 *
 * 前两版都走偏了，而且是往同一个方向偏：
 *   v1（原始）  给报告 + 初稿，问「初稿漏了报告里的什么」——diff 任务
 *   v2（两段式）穷举报告的点 → 逐条判初稿覆盖没覆盖——**更彻底的 diff**
 * v2 确实治好了凑数（每块恒定 6 条 → 分布铺开、首次出现「没有漏报」），但它把任务换掉了：
 * 隐含标准变成「简报应尽量复述报告」，而简报比报告短是**有意的**。读数也印证——
 * 每块报出的漏报数随报告长度走（块13 报 9 条、块10 报 8 条），而读者的需要不该随材料长度线性增长。
 *
 * 本意是**从读者视角往前推理**：只读到这一块的人，在哪里卡住。所以这一版：
 *   · 只给初稿，**不给报告**。给了报告，模型就会去枚举它——前两版都栽在这里。
 *     不给，它只能从「读完这段我还不明白什么」出发，那才是要问的问题。
 *   · 产出的是**读者的疑问**，不是「报告里的第 N 条」。
 *   · 有没有材料回答，交给程序去原文里检索（backingFor，逐字短语命中才算），
 *     检不到就丢。这一步顺带绕开了「拿报告当事实源」——材料来自原文，不来自报告。
 *   · 因此只需要一次 LLM 调用（v2 是两次）。
 *
 * schema 不设 maxItems：数字会被当成要凑够的目标（v1 实测 23/23 都报满 6）。
 */
export const READER_GAP_SCHEMA = {
  type: 'object', required: ['needs'], additionalProperties: false,
  properties: {
    needs: {
      type: 'array',
      items: {
        type: 'object', required: ['need', 'keywords'], additionalProperties: false,
        properties: {
          need: {
            type: 'string', maxLength: 200,
            description: 'What the reader is left unable to understand or judge, written as the thing they would need to be told. Name it concretely.',
          },
          keywords: {
            type: 'array', items: { type: 'string' },
            description: 'Two or three phrases likely to appear VERBATIM in the original news coverage that would answer this. Use a reporter\'s words, not your paraphrase — a program matches these against the article text literally.',
          },
        },
      },
    },
  },
} as const;

export interface ReaderNeed { need: string; keywords: string[] }

/**
 * 找漏（读者视角）：**只给初稿**。不给报告是刻意的——见 READER_GAP_SCHEMA 的注释。
 */
export function getReaderGapPrompt(title: string, draft: string): string {
  return `Below is one section of a news brief, titled "${title}". Assume a reader who reads this and nothing else.

<section>
${draft}
</section>

Read it as that reader. Where are you left unable to follow what happened, unable to see why it matters, or unable to judge what is likely to come of it?

Name what you would need to be told. Ask about this story — not about background a reader is expected to bring. Something that reads as complete needs nothing; say so with an empty list.

For each one, give the phrases a reporter would have used when covering it, so a program can go look for the answer in the original articles.

Emit one JSON object matching this schema. Follow each field's \`description\` literally.

\`\`\`json
${JSON.stringify(READER_GAP_SCHEMA, null, 2)}
\`\`\`

**Your entire response is that JSON object. Nothing before the opening brace, nothing after the closing brace.**`;
}

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

A brief is meant to be shorter than the report. Most of what it leaves out is detail a reader does not need. Your job is to find the exceptions.

Go through the report and identify points the draft does not convey. A point only mentioned in passing, without saying what actually happened, counts as left out. Do not list things the draft already covers in different words.

Only list a point if a reader of the brief alone would be **misled**, or would be missing something they would **act on**. Detail that merely adds texture does not qualify.

**Return only the points that clear that bar. If the draft already conveys everything that matters, return an empty list — that is a valid and expected answer, not a failure to look hard enough.** The schema's \`maxItems\` is a ceiling, not a target. List what you find in the order a reader would miss it most.

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
