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
  kind: 'proper_noun_variant' | 'duplicate_sentence' | 'meta_label_leak' | 'missing_section' | 'story_tag_leak';
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
  const tokens = sourceText.split(/(\s+)/).filter((t) => t.trim());
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
    const t = raw.replace(/^[("']+/, '');
    const bare = t.replace(/[.,;:!?)"']+$/, '');
    // 句末标点必须断开跨度：源里 "…the Court. ICC officials…" 若不断，会拼出并不存在的
    // 专名 "Court ICC"，随后简报里任何以 court 开头的二元组都可能被误报（实测大量假阳）。
    const endsSentence = /[.;:!?]$/.test(t);
    const isCap = /^[A-Z][A-Za-z'\-]*$/.test(bare);
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
    const strict = parts.slice(1, -1).some((p) => CONNECTORS.has(p));
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

function findMissingSections(brief: string): HygieneFinding[] {
  // 只查唯一的必需区：prompt 里其余各节都明确「没内容就整节省略」，缺失是合法编辑决策。
  return /^##\s*what matters now/im.test(brief)
    ? []
    : [{ kind: 'missing_section', detail: '缺主区标题 "## what matters now"' }];
}

/**
 * @param brief   成品简报正文
 * @param sourceText 喂给合成步的全部源文本（storiesMarkdown 或情报报告摊平）
 */
export function checkBriefHygiene(brief: string, sourceText: string): HygieneFinding[] {
  return [
    ...findMissingSections(brief),
    ...findMetaLabelLeaks(brief),
    ...findStoryTagLeaks(brief),
    ...findDuplicateSentences(brief),
    ...findProperNounVariants(brief, extractProperPhrases(sourceText)),
  ];
}
