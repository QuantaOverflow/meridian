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
}

export type GuardKind = 'noop' | 'bad_delete' | 'graft' | 'bloat';

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

/** G2 误删：要删掉的内容在源里逐字存在 —— 这正是「误删」的定义 */
export function isBadDelete(span: string, replacement: string, source: string): boolean {
  return replacement === '' && inSource(span, source);
}

/** G3 空转：替换文本与原文逐字相同（忽略大小写与首尾空白） */
export function isNoop(span: string, replacement: string): boolean {
  return replacement.trim().toLowerCase() === span.trim().toLowerCase();
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
export function applyGroundedEdits(
  draft: string,
  edits: GroundedEdit[],
  fullSource: string
): ApplyResult {
  let text = draft;
  let applied = 0;
  let skipped = 0;
  let deleted = false;
  const blocked: BlockedEdit[] = [];

  for (const e of edits) {
    if (!e || typeof e.brief_span !== 'string' || e.brief_span.length === 0) continue;
    const span = e.brief_span;
    const replacement = typeof e.replacement === 'string' ? e.replacement : '';
    const reason = typeof e.reason === 'string' ? e.reason : '';

    // 顺序：空转 → 误删 → 嫁接 → 膨胀。先筛掉不改内容的那类，拦截统计才读得懂。
    let guard: GuardKind | null = null;
    if (isNoop(span, replacement)) guard = 'noop';
    else if (isBadDelete(span, replacement, fullSource)) guard = 'bad_delete';
    else if (isGraft(span, replacement, fullSource)) guard = 'graft';
    else if (replacement && isBloat(span, replacement)) guard = 'bloat';
    if (guard) {
      blocked.push({ guard, span, replacement, reason });
      continue;
    }

    // 只认精确子串命中：命中才改，没命中宁可不动（防误伤），与既有 verifyAndCorrect 一致
    if (text.includes(span)) {
      text = text.replace(span, replacement);
      applied++;
      if (replacement === '') deleted = true;
    } else {
      skipped++;
    }
  }

  return { text, applied, skipped, blocked, deleted };
}

/** 拦截数按守卫分类汇总，供日志/传感器用 */
export function tallyGuards(blocked: BlockedEdit[]): Record<GuardKind, number> {
  const t: Record<GuardKind, number> = { noop: 0, bad_delete: 0, graft: 0, bloat: 0 };
  for (const b of blocked) t[b.guard]++;
  return t;
}
