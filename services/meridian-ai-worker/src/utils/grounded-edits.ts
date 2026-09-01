/**
 * RARR 编辑表的确定性守卫 + 应用器（零 LLM）。
 *
 * RARR 校验环节让模型回 edit-list（verbatim span → 接地修正，空串=删除），由程序精确子串
 * apply。问题是**校验器自己也会出错**，而且错法有规律——2026-08-29 在第 75 期 25 个块上
 * 逐条人工裁定，四类占了绝大多数：
 *
 *   G1 专名嫁接  源里明明有这个名字，却要换成另一个名字。oracle=full（校验时给全部 25 份
 *                报告）会让模型看见别的报告里的同类角色，把对的改成错的——实测把加州总
 *                检察长 `rob bonta` 改成另一个州的 `Jay Jones`。**比漏改严重**。
 *                实测拦下 3 条，其中 2 条真错、1 条无害误报。
 *   G2 误删      要删掉的内容在源里逐字存在。实测 2/2 拦对，两次模型都在 reason 里谎称
 *                「data does not mention X」而源里 X 逐字在。
 *                ⚠️ 这条守卫的判据与「误删」的度量共用，所以"加了它误删归零"是同义反复，
 *                不能当证据。真正的证据是那两条人工裁定。
 *   G3 空转      替换文本与原文逐字相同，模型在输出「确认」而不是「修改」。实测 23-50 条，
 *                占输出预算 20-30%（不拦不改坏正文，但会把编辑表挤爆导致复读/截断）。
 *   G4 膨胀      替换文本比原文长一半以上。实测这类 edit 内容全是「补上草稿没写的细节」
 *                而不是修错。RARR 原论文把「最小编辑」当核心约束，本家实现此前丢了这条。
 *
 * 为什么用代码而不是 prompt：给 RARR 加「最小编辑」约束的两版实测**都比不加更差**
 * （禁加长→等长重写，相似度 0.85→0.72；禁改成大写→改成小写并抹掉重音，空转 23→50）。
 * 每加一条约束，模型换一条逃逸路径。见 memory: rarr-prompt-constraint-negative。
 */

export interface GroundedEdit {
  brief_span?: string;
  replacement?: string;
  reason?: string;
  /** RARR 式举证：源里支持本次改动的**逐字**片段。缺失或不在源里 → G5 拦。 */
  source_says?: string;
}

export type GuardKind = 'noop' | 'bad_delete' | 'graft' | 'bloat' | 'unquoted' | 'budget';

export interface BlockedEdit {
  guard: GuardKind;
  span: string;
  replacement: string;
  reason: string;
}

export interface ApplyResult {
  text: string;
  /** 真正落到正文上的 edit 数 */
  applied: number;
  /** span 在正文里没精确命中 → 宁可不动（防误伤），与被守卫拦下是两回事 */
  skipped: number;
  blocked: BlockedEdit[];
  /** 是否发生过删除，调用方据此决定要不要收拾删除留下的空白 */
  deleted: boolean;
  /** 被压回全小写文风的替换条数（留痕：RARR 破坏文风的频率是个要跟的信号） */
  recased: number;
  /** 删除预算是否被触发（触发时整批删除型 edit 作废，替换型照常应用） */
  budgetTripped: boolean;
  /** 保留度 Pres_Lev = max(1 - Lev(draft,out)/len(draft), 0)，RARR 论文式 3。越接近 1 改得越少 */
  presLev: number;
}

/**
 * 词边界匹配。**不能用 includes**：子串匹配下 `'op'` 之类的短片段在任何长源里恒真，
 * 会让 G1/G2 无差别拦截所有 edit（踩过）。太短的片段一律不判，宁可漏拦。
 */
export function inSource(span: string, source: string): boolean {
  const t = span.trim().toLowerCase();
  if (t.length < 4) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(source.toLowerCase());
}

/** 像专名：有字母、不含数字/货币符号、≤4 词 */
function nameish(s: string): boolean {
  return /[a-z]/i.test(s) && !/[\d$%]/.test(s) && s.trim().split(/\s+/).length <= 4;
}

/**
 * G1 专名嫁接。
 * ⚠️ 必须限定在**专名**上。第一版把数字也管了，会拦掉 RARR 正在**正确修复**的跨块金额
 * 冲突（$18 billion → $17.1 billion）。数字需要归一，人名只有一个正确指称，不能一刀切。
 */
export function isGraft(span: string, replacement: string, source: string): boolean {
  if (!replacement || replacement.toLowerCase() === span.toLowerCase()) return false;
  if (!(nameish(span) && nameish(replacement))) return false;
  // 单个短词（"op"、"nato"）歧义太大，不判
  if (span.trim().split(/\s+/).length < 2 && span.trim().length < 6) return false;
  return inSource(span, source);
}

/**
 * G2 误删。**2026-09-01 换判据**：原判据是「整段 span 逐字在源里」，两期简报 43 条被应用的
 * 删除**拦下 0 条**——实际被删的是 130-216 字符的整句转述，措辞与源不同，整句逐字匹配永远
 * 落空。文件头原写的"实测 2/2 拦对"是在两条短片段上得到的，不成立于真实形态。
 *
 * 新判据：span 的**实词逐个**在源里。9 条经独立复核确认的误删在本判据下 9/9 全中。
 * 局限：判不了搭配——"betancourt as a private operator" 实词全在源里，但源只说他是商人。
 * 所以它是必要条件不是充分条件，配合 G5（举证）与删除预算一起用。
 */
const TOK_STOP = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'had', 'was', 'were',
  'been', 'are', 'its', 'their', 'they', 'them', 'not', 'but', 'all', 'any', 'which', 'who',
  'when', 'where', 'while', 'after', 'before', 'into', 'over', 'under', 'about', 'than', 'then',
  'also', 'such', 'only', 'more', 'most', 'some', 'other', 'said', 'says', 'would', 'could',
  'should', 'may', 'might', 'must', 'his', 'her', 'she', 'him', 'out', 'off', 'per', 'via', 'due',
]);

/** span 的实词是否**全部**出现在源里（长度≥4 或含数字才算实词） */
export function allTokensInSource(span: string, source: string): boolean {
  const src = source.toLowerCase();
  const toks = [...new Set((span.toLowerCase().match(/[a-z0-9][a-z0-9\'\u2019.\-]*/g) ?? [])
    .map((t) => t.replace(/[.\'\u2019\-]+$/, ''))
    .filter((t) => (t.length >= 4 || /\d/.test(t)) && !TOK_STOP.has(t)))];
  if (!toks.length) return false;   // 全是虚词 → 判不了，交给别的守卫
  return toks.every((t) => new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(src));
}

export function isBadDelete(span: string, replacement: string, source: string): boolean {
  return replacement === '' && allTokensInSource(span, source);
}

/**
 * G5 未举证（RARR 式）。论文的 agreement model 先「说出源对同一问题的答案」再判是否矛盾；
 * 我们把它落成一个**可机器核验**的输出字段 `source_says`：必须是源里的逐字片段。
 *
 * 为什么是字段不是 prompt 约束：memory `rarr-prompt-constraint-negative` 记过「每加一条约束，
 * 模型换一条逃逸路径」——那说的是模型能悄悄绕开的**约束**。这里是能被程序验证的**产物**，
 * 引不出源里的原话就发不出这条 edit。9 条误删的理由全是「data does not mention X」而 X 逐字
 * 在源里，这类断言在举证要求下根本写不出来。
 */
export function isUnquoted(edit: GroundedEdit, source: string): boolean {
  const q = (edit.source_says ?? '').trim();
  if (q.length < 8) return true;                       // 太短的"引文"不算举证
  return !source.toLowerCase().includes(q.toLowerCase());
}

/** Levenshtein，只用于 Pres_Lev。O(n·m)，块级文本（<5KB）够用 */
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * 保留度（RARR 论文式 3）：`max(1 - Lev(x,y)/len(x), 0)`。1.0 = 没改，0 = 全改掉。
 *
 * 立这个指标的理由是论文 2.3 点破的那件事：只优化有据率会被"删光"这个平凡解通吃
 * （"an adversarial editor could ensure 100% attribution by simply replacing the input"）。
 * 本项目此前**只测忠实度、从不测保留度**，所以某个块被删掉 85% 正文时没有任何指标会响。
 */
export function presLev(before: string, after: string): number {
  if (!before.length) return 1;
  return Math.max(1 - lev(before, after) / before.length, 0);
}

/** G3 空转：替换文本与原文逐字相同（忽略大小写与首尾空白） */
export function isNoop(span: string, replacement: string): boolean {
  return replacement.trim().toLowerCase() === span.trim().toLowerCase();
}

/**
 * 把替换文本压回简报的全小写文风，但**保留全大写缩写**。
 *
 * 简报 prompt 明写 "use lowercase by default like i do"，生成端照做了；RARR 的替换文本
 * 却按标准大小写回来，于是修一处事实就带回一处文风破口。
 * 2026-08-29 dry-run 逐条归因坐实：成品正文里 12 个大写起首专名，**11 个来自 RARR 的
 * 替换文本**，生成端只贡献 1 个（November）。
 *
 * 为什么用代码而不是 prompt：给 RARR 加"别改成大写"的约束实测更差——模型改成全小写的
 * 同时把 nicolás 的重音也抹了，空转从 23 涨到 50（见 memory: rarr-prompt-constraint-negative）。
 *
 * "强制小写会误伤 IRGC" 这条担心已证伪：保留 ≥2 个连续大写字母的 token 即可。
 * 拿 dry-run 的 77 条真实替换验：8 条被规整，IRGC 零误伤。
 */
const ACRONYM = /\b[A-Z][A-Z0-9&.\-]*[A-Z]\b/g;

export function toHouseCase(replacement: string): string {
  const out: string[] = [];
  let last = 0;
  ACRONYM.lastIndex = 0;
  for (let m = ACRONYM.exec(replacement); m; m = ACRONYM.exec(replacement)) {
    out.push(replacement.slice(last, m.index).toLowerCase(), m[0]);
    last = m.index + m[0].length;
  }
  out.push(replacement.slice(last).toLowerCase());
  return out.join('');
}

/** G4 膨胀：替换比原文长出一半以上 —— 在补充信息而不是修错 */
export function isBloat(span: string, replacement: string): boolean {
  return replacement.trim().length > 1.5 * span.trim().length;
}

/**
 * 逐条过守卫后应用编辑表。
 *
 * @param draft      待修正的正文（整篇或单块）
 * @param edits      模型回的编辑表
 * @param fullSource **全量**源 markdown。守卫一律查全量：原名只要在任何一份报告里存在，
 *                   就不该被替换/删掉。用单份源查会把跨报告的正确内容判成"源里没有"。
 */
export interface ApplyOptions {
  /**
   * 删除预算：整块被删掉的字符占草稿的比例上限，超了就**整批删除型 edit 作废**
   * （替换型不受影响）。RARR 论文脚注 3 有同类保险（"reject edits with edit distance above
   * 50 characters or 0.5 times the original text length"），但它的 y 是句子级短文本，
   * 50 字符照搬到 600-2700 字符的块上会把绝大多数正当删除也拦掉，故改成**累计比例**。
   *
   * 0.4 的来历：两期 50 块实测，正常块净减 0-31%，病态块 65-85%，中间是空的。
   * ⚠️ 那是净变化（含替换）而非纯删除量，n=2 期——这个数是**待复验的起点**，不是定论。
   */
  deletionBudget?: number;
  /** 是否要求每条 edit 举证（G5）。默认开；关掉用于 A/B 对照 */
  requireQuote?: boolean;
}

export function applyGroundedEdits(
  draft: string,
  edits: GroundedEdit[],
  fullSource: string,
  opts: ApplyOptions = {}
): ApplyResult {
  const budget = opts.deletionBudget ?? 0.4;
  const requireQuote = opts.requireQuote !== false;

  // 预算是**批级**判断，必须在逐条应用之前算：等边删边看会变成"删到一半停手"，
  // 留下语义半截的正文，比整批不删更糟。
  const delChars = edits.reduce(
    (t, e) => t + ((e?.replacement ?? '') === '' && typeof e?.brief_span === 'string' ? e.brief_span.length : 0), 0
  );
  const budgetTripped = draft.length > 0 && delChars / draft.length > budget;

  let text = draft;
  let applied = 0;
  let skipped = 0;
  let deleted = false;
  let recased = 0;
  const blocked: BlockedEdit[] = [];

  for (const e of edits) {
    if (!e || typeof e.brief_span !== 'string' || e.brief_span.length === 0) continue;
    const span = e.brief_span;
    const replacement = typeof e.replacement === 'string' ? e.replacement : '';
    const reason = typeof e.reason === 'string' ? e.reason : '';

    // 顺序：空转 → 预算 → 未举证 → 误删 → 嫁接 → 膨胀。
    // 先筛掉不改内容的那类，拦截统计才读得懂；预算排在个别守卫之前，因为它是批级判断。
    let guard: GuardKind | null = null;
    if (isNoop(span, replacement)) guard = 'noop';
    else if (budgetTripped && replacement === '') guard = 'budget';
    else if (requireQuote && isUnquoted(e, fullSource)) guard = 'unquoted';
    else if (isBadDelete(span, replacement, fullSource)) guard = 'bad_delete';
    else if (isGraft(span, replacement, fullSource)) guard = 'graft';
    else if (replacement && isBloat(span, replacement)) guard = 'bloat';
    if (guard) {
      blocked.push({ guard, span, replacement, reason });
      continue;
    }

    // 压回全小写文风（保留缩写）。放在守卫之后：守卫判的是"这条 edit 该不该应用"，
    // 大小写是"应用时怎么写"，两件事。
    const cased = replacement ? toHouseCase(replacement) : replacement;
    if (cased !== replacement) recased++;

    // 只认精确子串命中：命中才改，没命中宁可不动（防误伤），与既有 verifyAndCorrect 一致
    if (text.includes(span)) {
      text = text.replace(span, cased);
      applied++;
      if (cased === '') deleted = true;
    } else {
      skipped++;
    }
  }

  return { text, applied, skipped, blocked, deleted, recased, budgetTripped, presLev: presLev(draft, text) };
}

/** 拦截数按守卫分类汇总，供日志/传感器用 */
export function tallyGuards(blocked: BlockedEdit[]): Record<GuardKind, number> {
  const t: Record<GuardKind, number> = { noop: 0, bad_delete: 0, graft: 0, bloat: 0, unquoted: 0, budget: 0 };
  for (const b of blocked) t[b.guard]++;
  return t;
}
