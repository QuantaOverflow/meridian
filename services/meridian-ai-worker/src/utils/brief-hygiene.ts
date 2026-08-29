/**
 * 简报卫生检查（确定性，零 LLM）。
 *
 * 为什么需要另一把尺：忠实度判官问的是「这条 claim 在源里有支持吗」，验的是**语义蕴含**。
 * 而 2026-08-12 人工核对两篇简报抓出的问题里，有一整类是**字符级/结构级**的，判官必然放行：
 *   - `gulf of omah` / `gulf of omans` / `gulf of omman`（三篇简报三种错法，源里始终 Gulf of Oman）
 *     ——对应的事实确实在源里，判官判 supported 完全正确，错的是拼写。
 *   - 整句原样重复两遍。
 *   - 模型自造的元标签泄漏进正文：`*irrelevant context: *`（空壳，出现两次）。
 *   - 缺 `## what matters now` 主标题（同一 prompt，两次运行结果不同）。
 * 这些对读者的伤害极大——一个把地名拼错三种写法的简报，读者会怀疑其余每个数字——
 * 但它们在 unsupported/contradicted/dropped 三个指标上全是 0。
 *
 * 定位：纯传感器。只报不改。误报可容忍（人一眼能判），漏报才是问题，故阈值取宽。
 */

export interface HygieneFinding {
  kind: 'proper_noun_variant' | 'duplicate_sentence' | 'meta_label_leak' | 'missing_section'
    | 'story_tag_leak' | 'broken_punctuation' | 'truncated_text' | 'catch_all_anomaly';
  detail: string;
  /** 同一处缺陷被多条嵌套短语命中时的归并键（仅 proper_noun_variant 用） */
  dedupeKey?: string;
}

/** Levenshtein，仅用于短 token（专名），无需优化 */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * 从源文本里抽「大写专名短语」：连续首字母大写的词，允许中间夹 of/the/and/al- 这类小词。
 * 只取 ≥2 词的短语——单词专名（Iran、Trump）在简报里天然会变小写，比对会全是噪声；
 * 多词短语（Gulf of Oman、Air Force One）既稳定又正是出错的地方。
 */
const CONNECTORS = new Set(['of', 'the', 'and', 'for', 'on', 'in', 'de', 'la', 'al']);

/** 常见英文功能词：专名损坏不会把词换成这些，出现即说明是巧合撞上的无关片段 */
const STOPWORDS = new Set([
  'and', 'was', 'were', 'is', 'are', 'this', 'that', 'has', 'have', 'had', 'it', 'its',
  'to', 'in', 'on', 'at', 'by', 'as', 'with', 'war', 'said', 'from', 'but', 'not', 'who',
  // 冠词必须在列：它同时是 CONNECTORS 成员，早期漏掉导致 "constitutional rights the"
  // 这类候选逃过功能词否决（生产 e2e 实测误报）。候选词若也在源短语里则自动豁免。
  'the', 'a', 'an',
]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 单复数 / 所有格 / 一方是另一方前缀（Middle East ↔ Middle Eastern）→ 视为合法形态变化 */
function isMorphologicalVariant(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/'s\b/g, '').replace(/s\b/g, '');
  if (norm(a) === norm(b)) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.startsWith(short);
}

export function extractProperPhrases(sourceText: string): string[] {
  const out = new Set<string>();
  const lines = sourceText.split(/\n+/); // 换行是硬边界：否则相邻字段会跨行拼出并不存在的专名
  const tokens: string[] = [];
  for (const line of lines) { tokens.push(...line.split(/\s+/).filter(Boolean), '\u0000'); }
  let run: string[] = [];
  const flush = () => {
    // 去掉首尾连接词（"Gulf of" / "the Houthis" 这种带残缺边界的跨度）
    while (run.length && CONNECTORS.has(run[run.length - 1].toLowerCase())) run.pop();
    while (run.length && CONNECTORS.has(run[0].toLowerCase())) run.shift();
    // 必须同时产出**子短语**：一个连续大写跨度里可能嵌着多个独立专名，
    // 只留最长的那个会让 "Gulf of Oman" 永远抽不出来（它埋在 "Forces in the Gulf of Oman" 里），
    // 而真正出错的恰恰是这种被埋住的短名——实测 report 55 因此漏报。
    const isCapTok = (t: string) => /^[A-Z]/.test(t);
    for (let i = 0; i < run.length; i++) {
      if (!isCapTok(run[i])) continue;
      for (let j = i + 1; j < run.length; j++) {
        if (!isCapTok(run[j])) continue;
        const phrase = run.slice(i, j + 1).join(' ').replace(/[.,;:!?)"']+$/, '');
        if (phrase.length >= 8) out.add(phrase);
      }
    }
    run = [];
  };
  for (const raw of tokens) {
    if (raw === '\u0000') { flush(); continue; }
    // 左括号是**边界**，不能只剥掉就接着并进当前跨度：storiesMarkdown 把实体渲染成
    // `* Los Angeles Lakers (An NBA franchise…)`，剥掉 "(" 后 "An" 是大写，于是拼出
    // 并不存在的专名 "Los Angeles Lakers An"——生产 report 55 实测误报即此因。
    // 括号内是**对该专名的描述**，与专名本身分属两段，必须断开。
    if (/^[(（[【]/.test(raw)) flush();
    const t = raw.replace(/^[("'（【[]+/, '');
    const bare = t.replace(/[.,;:!?)"'。，；：！？）】\]]+$/, '');
    // 句末标点必须断开跨度：源里 "…the Court. ICC officials…" 若不断，会拼出并不存在的
    // 专名 "Court ICC"，随后简报里任何以 court 开头的二元组都可能被误报（实测大量假阳）。
    // 含全角：storiesMarkdown 的实体行用 "：" 分隔名字与描述，只认半角会漏断。
    const endsSentence = /[.;:!?。；：！？)）]$/.test(t);
    // 单字母大写（A / I）不是专名，作端点会拼出 "Amnesty International A" 这种假短语
    const isCap = /^[A-Z][A-Za-z'\-]+$/.test(bare);
    const isConnector = run.length > 0 && CONNECTORS.has(bare.toLowerCase());
    if (isCap || isConnector) {
      run.push(bare);
      if (endsSentence) flush();
    } else flush();
  }
  flush();
  return [...out];
}

/**
 * 专名变体检测：源里有 "Gulf of Oman"，简报里出现 "gulf of omans" —— 词数相同、
 * 首词相同、整体编辑距离 1-3 且不完全相等 → 报。
 * 简报正文是小写文风，故一律 lowercase 后比。
 */
function findProperNounVariants(brief: string, phrases: string[]): HygieneFinding[] {
  const briefLower = brief.toLowerCase();
  const findings: HygieneFinding[] = [];
  const seen = new Map<string, number>(); // 差异词对 → 已记录的最短 target 长度
  for (const phrase of phrases) {
    const target = phrase.toLowerCase();
    // 必须按词边界判「已逐字出现」：用 includes 会让 "gulf of oman" 在 "gulf of omans"
    // 里判为命中，恰好放过要抓的那类错（实测 report 55 即因此漏报，靠更长的短语才兜住）。
    if (new RegExp(`(^|[^a-z])${escapeRe(target)}([^a-z]|$)`).test(briefLower)) continue;
    const parts = target.split(' ');
    // 含连接词的短语（Gulf of Oman、Strait of Hormuz）是固定专名，必须逐字一致 → 严格比。
    // 不含连接词的（Houthis、Vela Nova's、Middle Eastern）会正常发生单复数/所有格/构词变化，
    // 对它们放宽，否则传感器会被英文形态学噪声淹没——喊狼的传感器等于没有传感器。
    // 只看**内部**连接词：首词是冠词（"The Houthis"）不代表这是固定专名，
    // 而 "Gulf of Oman" 中间的 of 才是。误把前者算作严格会把正常单复数全报出来。
    // 'and' 排除在外：它连接的是两个并列实体（"US and Israel"）而非固定专名的组成部分，
    // 把它算作严格会让 Israel→israeli 这种正当构词变化被报出来（生产 e2e 实测误报）。
    const strict = parts.slice(1, -1).some((p) => CONNECTORS.has(p) && p !== 'and');
    // 在简报里找同词数、同首词的候选片段
    const words = briefLower.split(/\s+/);
    for (let i = 0; i + parts.length <= words.length; i++) {
      const cand = words.slice(i, i + parts.length).map((w) => w.replace(/[^a-z'\-]/g, '')).join(' ');
      if (!cand || cand === target) continue;
      if (cand.split(' ')[0] !== parts[0]) continue; // 首词必须相同，否则是无关短语
      if (!strict && isMorphologicalVariant(cand, target)) continue;
      // 专名不会退化成虚词：源作 "Trump Iran"、简报作 "trump and" 之类全是巧合撞上的
      // 二元组，不是拼写损坏。候选里出现源中没有的功能词即判无关。
      if (cand.split(' ').some((w) => STOPWORDS.has(w) && !parts.includes(w))) continue;
      const d = editDistance(cand, target);
      // 阈值随长度缩放：短短语上距离 3 几乎等于"任意相近的词"，只有长专名才容得下 2-3 处差异。
      const maxD = target.length >= 20 ? 3 : target.length >= 12 ? 2 : 1;
      if (d >= 1 && d <= maxD) {
        // 按**实际差异的那个词**去重，而非按整条短语：子短语机制会让同一处拼写损坏被
        // 嵌套的多条短语各报一次（"Gulf of Oman" / "Nova in the Gulf of Oman" / …），
        // 读起来像三个问题，其实是一个。保留最短的那条=定位最精确。
        const diff = parts.map((p, k) => (p === cand.split(' ')[k] ? null : `${p}→${cand.split(' ')[k]}`))
          .filter(Boolean).join(',');
        const prev = seen.get(diff);
        if (prev !== undefined && prev <= target.length) continue;
        seen.set(diff, target.length);
        findings.push({
          kind: 'proper_noun_variant',
          detail: `源作 "${phrase}"，简报作 "${cand}"（编辑距离 ${d}）`,
          dedupeKey: diff,
        });
      }
    }
  }
  // 上面的 seen 只保证"不重复记录更长的"，但更短的到得晚时前面已记过长的 → 末尾再收敛一次
  const best = new Map<string, HygieneFinding>();
  const out: HygieneFinding[] = [];
  for (const f of findings) {
    if (!f.dedupeKey) { out.push(f); continue; }
    const cur = best.get(f.dedupeKey);
    if (!cur || f.detail.length < cur.detail.length) best.set(f.dedupeKey, f);
  }
  return [...out, ...best.values()];
}

function findDuplicateSentences(brief: string): HygieneFinding[] {
  const counts = new Map<string, number>();
  for (const raw of brief.split(/(?<=[.!?])\s+/)) {
    const s = raw.trim().replace(/\s+/g, ' ');
    if (s.length < 40) continue; // 短句重复多为正常（标题、连接语）
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([s, n]) => ({ kind: 'duplicate_sentence' as const, detail: `重复 ${n} 次: ${s.slice(0, 120)}…` }));
}

function findMetaLabelLeaks(brief: string): HygieneFinding[] {
  const spans = new Map<number, string>(); // 按起始位置去重：空壳标签同时命中两条规则，否则一处报两次
  // ①空壳元标签：`*irrelevant context: *`（标签后无内容）
  for (const m of brief.matchAll(/\*\s*[a-z][a-z \-]{2,30}:\s*\*/gi)) {
    spans.set(m.index!, `空壳元标签: ${m[0]}`);
  }
  // ②模型自造的评述性标签（prompt 与源里都没有，2026-08-12 report 55 实证）
  for (const m of brief.matchAll(/irrelevant context\s*:/gi)) {
    const covered = [...spans.keys()].some((i) => m.index! >= i && m.index! < i + spans.get(i)!.length);
    if (!covered) spans.set(m.index!, `自造元标签: ${m[0]}`);
  }
  return [...spans.entries()].sort((a, b) => a[0] - b[0]).map(([, detail]) => ({ kind: 'meta_label_leak' as const, detail }));
}

/** prompt 明令 `[story k/N]` 标签不得出现在简报正文 */
function findStoryTagLeaks(brief: string): HygieneFinding[] {
  return [...brief.matchAll(/\[story\s+\d+\s*\/\s*\d+\]/gi)].map((m) => ({
    kind: 'story_tag_leak' as const,
    detail: `选择层标签泄漏: ${m[0]}`,
  }));
}

/**
 * 标点/断句损坏。全部来自 2026-08-12 生产 report 54 的实证，非预设：
 *   `the real overlooked angle is the psychological warfare aspect:.`  ← 冒号后直接句号
 *   `...carries significant diplomatic and operational risks..`        ← 双句号
 *   `...the Health Secretary's promotion of the disproven…`            ← 补录截断成残句
 *   `the us-moU points to...`                                          ← MoU 被写成 moU
 */
function findBrokenPunctuation(brief: string): HygieneFinding[] {
  const findings: HygieneFinding[] = [];
  for (const m of brief.matchAll(/[:;,]\s*[.。]/g)) {
    findings.push({ kind: 'broken_punctuation', detail: `标点断裂: "…${brief.slice(Math.max(0, m.index! - 40), m.index! + 3)}"` });
  }
  for (const m of brief.matchAll(/(?<!\.)\.\.(?!\.)/g)) {
    findings.push({ kind: 'broken_punctuation', detail: `双句号: "…${brief.slice(Math.max(0, m.index! - 40), m.index! + 2)}"` });
  }
  // 省略号收尾 = 句子被截断（正常行文里简报不使用省略号；补录 firstSentence 曾产出）
  for (const m of brief.matchAll(/…\s*$/gm)) {
    findings.push({ kind: 'truncated_text', detail: `省略号截断: "…${brief.slice(Math.max(0, m.index! - 60), m.index! + 1)}"` });
  }
  // 词内大小写损坏：小写起头却夹大写（moU / omAn）。散文里没有 camelCase，误报面很小。
  for (const m of brief.matchAll(/\b[a-z]+[A-Z][a-zA-Z]*\b/g)) {
    findings.push({ kind: 'broken_punctuation', detail: `词内大小写损坏: "${m[0]}"` });
  }
  return findings;
}

/**
 * 元评论泄漏：模型对**输入数据本身**的评述被写进给读者的正文。
 * report 55 是 `irrelevant context:`，report 54 是 `while the provided data for this
 * section was minimal, …`——措辞每次不同，故按语义模式匹配而非固定词串。
 */
function findMetaCommentary(brief: string): HygieneFinding[] {
  const patterns = [
    /\b(the )?(provided|available|given|input|supplied) (data|articles?|reports?|information|context)\b/gi,
    /\b(this|the) (section|story|cluster) (was|is|has) (minimal|empty|sparse|limited|insufficient)\b/gi,
    /\b(no|insufficient|limited) (data|information) (was )?(provided|available) (for|in) (this|the)\b/gi,
  ];
  // 三条模式会命中同一处的重叠片段（"the provided data" 与 "this section was minimal"
  // 在同一句里），按位置邻近归并，否则一处缺陷报两次。
  const hits = new Map<number, string>();
  for (const re of patterns) {
    for (const m of brief.matchAll(re)) {
      const near = [...hits.keys()].find((i) => Math.abs(i - m.index!) < 80);
      if (near === undefined) {
        hits.set(m.index!, `对输入数据的元评论: "…${brief.slice(Math.max(0, m.index! - 30), m.index! + m[0].length + 30)}…"`);
      }
    }
  }
  return [...hits.entries()].sort((a, b) => a[0] - b[0]).map(([, detail]) => ({ kind: 'meta_label_leak' as const, detail }));
}

function findMissingSections(brief: string): HygieneFinding[] {
  // 唯一的必需区是 catch-all。主线章节自 2026-08 起由模型依当天内容自行命名（没有固定
  // 模板），其余各节 prompt 也明确「没内容就整节省略」——缺失是合法编辑决策。
  // 原先查的是 "## what matters now"：那是已删除的固定模板里的标题，留着会 100% 命中、
  // 把整个卫生传感器淹掉（本条即改此）。
  return CATCH_ALL_RE.test(brief)
    ? []
    : [{ kind: 'missing_section', detail: '缺 catch-all 区标题 "## noteworthy & under-reported"' }];
}

// coverageRepair 用 /^##\s*noteworthy[^\n]*$/im 定位 catch-all 做程序化补录。模型若把标题
// 写成前缀变体（"## under-reported & noteworthy"），该正则匹配不到 → 走建区分支 → 一篇里
// 出现两个 catch-all，而且补录内容进的是新建那个。这是 prompt 与代码之间的口头协定，
// 没有任何校验；prompt 放开章节命名后风险变高，故在此留一个能真正触发的传感器。
const CATCH_ALL_RE = /^##\s*noteworthy[^\n]*$/im;

function findCatchAllAnomalies(brief: string): HygieneFinding[] {
  const headings = brief.split(/\r?\n/).filter((l) => /^##\s/.test(l) && /noteworthy|under[- ]reported/i.test(l));
  if (headings.length <= 1) return [];
  return [
    {
      kind: 'catch_all_anomaly',
      detail: `catch-all 区出现 ${headings.length} 个: ${headings.map((h) => h.trim()).join(' | ')}`,
    },
  ];
}

export interface HygieneOptions {
  /**
   * 是否要求存在 catch-all 区（`## noteworthy & under-reported`）。
   * 整篇合成路径必须有它（一句话降级条目的去处，也是补录的插入锚点）；
   * b′ 分段写路径**没有**这个区——每份报告都拿完整分析块，降级条目这个形态不存在。
   * 不给 b′ 关掉的话这条会 100% 命中，把整个卫生传感器淹掉（同 "what matters now" 那次）。
   */
  requireCatchAll?: boolean;
}

/**
 * @param brief   成品简报正文
 * @param sourceText 喂给合成步的全部源文本（storiesMarkdown 或情报报告摊平）
 */
export function checkBriefHygiene(brief: string, sourceText: string, options: HygieneOptions = {}): HygieneFinding[] {
  const requireCatchAll = options.requireCatchAll !== false;
  return [
    ...(requireCatchAll ? findMissingSections(brief) : []),
    ...findCatchAllAnomalies(brief),
    ...findMetaLabelLeaks(brief),
    ...findMetaCommentary(brief),
    ...findBrokenPunctuation(brief),
    ...findStoryTagLeaks(brief),
    ...findDuplicateSentences(brief),
    ...findProperNounVariants(brief, extractProperPhrases(sourceText)),
  ];
}
