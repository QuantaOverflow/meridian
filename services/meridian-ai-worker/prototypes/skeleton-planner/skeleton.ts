/**
 * 骨架规划器 —— 纯逻辑部分。TUI 是一次性外壳，这个模块是将来要抬进
 * services/meridian-ai-worker/src/services/brief-generation.ts 的那一块。
 *
 * 无 I/O、无终端代码、无 console。调用方注入 llm 函数。
 */

// ── 输入：去重后的事件（一个 cluster = 一个真实事件）────────────────────

export interface NewsEvent {
  clusterId: number;
  importance: number;
  articles: number;
  /** 同一事件下 story-validation 产出的多条标题（重复视角） */
  titles: string[];
}

export interface DayInput {
  reportId: number;
  storyRows: number;
  /** 生产里这一期实际写出的 <u> 块数，用作对照 */
  actualBlocksInBrief: number;
  events: NewsEvent[];
}

// ── 输出：骨架 ──────────────────────────────────────────────────────────

export type Form = 'block' | 'folded' | 'noteworthy';

export interface Placement {
  clusterId: number;
  form: Form;
  /** form=folded 时，折进哪个 clusterId */
  into?: number;
  /** form=block 时的短标题；folded/noteworthy 可为空 */
  title?: string;
  why?: string;
}

export interface SkeletonSection {
  heading: string;
  /** 为什么这些事件属于同一条主线 */
  throughLine: string;
  placements: Placement[];
}

export interface Skeleton {
  sections: SkeletonSection[];
  noteworthy: number[];
}

// ── prompt 构造（纯函数）────────────────────────────────────────────────

export const SYSTEM = `you are the planning stage of a daily intelligence brief.
you do NOT write prose. you decide structure only, and you output json only.`;

/**
 * 刻意不给板块数量范围、不给块数下限、不给任何配额。
 * 只给判据，让结构完全由当天内容决定 —— 这正是本原型要检验的假设。
 */
export function buildPrompt(day: DayInput): string {
  const lines = day.events.map(
    (e) =>
      `- cluster ${e.clusterId} | importance ${e.importance} | ${e.articles} articles\n` +
      e.titles.map((t) => `    · ${t}`).join('\n')
  );

  return `below are today's news events. each \`cluster\` is ONE real-world event; the
bullets under it are multiple phrasings of that same event produced upstream, not
separate events.

${lines.join('\n')}

decide the structure of today's brief. rules:

1. group events into sections. a section is a real through-line — a shared conflict,
   mechanism, or consequence. "asia" or "technology" is not a through-line; "china's
   export controls and who they bite" is. name each section after what it actually is.
2. for every cluster choose exactly one form:
   - "block"      — its own titled analysis, with its own short title
   - "folded"     — merged into another cluster's block (give \`into\`), ONLY when it is
                    genuinely a facet of that same story rather than a separate event
   - "noteworthy" — a one-to-two sentence entry in the catch-all
3. every cluster id must appear exactly once across all sections + noteworthy.
4. there is NO target number of sections and NO target number of blocks. derive both
   from the material. if today is one dominant story, say so with one section. if today
   is fifteen unrelated events, say that instead.
5. for "folded", \`why\` must state what makes it the same story, not merely a related topic.

output json only, this exact shape:

{
  "sections": [
    { "heading": "...", "throughLine": "...",
      "placements": [
        { "clusterId": 25, "form": "block", "title": "..." },
        { "clusterId": 11, "form": "folded", "into": 25, "why": "..." }
      ] }
  ],
  "noteworthy": [49, 39]
}`;
}

// ── 校验（纯函数，零 LLM）───────────────────────────────────────────────

export interface Issue {
  level: 'error' | 'warn';
  message: string;
}

export function validate(sk: Skeleton, day: DayInput): Issue[] {
  const issues: Issue[] = [];
  const all = day.events.map((e) => e.clusterId);
  const seen = new Map<number, number>();

  const placed = sk.sections.flatMap((s) => s.placements);
  for (const p of placed) seen.set(p.clusterId, (seen.get(p.clusterId) ?? 0) + 1);
  for (const c of sk.noteworthy) seen.set(c, (seen.get(c) ?? 0) + 1);

  for (const c of all) {
    const n = seen.get(c) ?? 0;
    if (n === 0) issues.push({ level: 'error', message: `cluster ${c} 未落地（漏了）` });
    if (n > 1) issues.push({ level: 'error', message: `cluster ${c} 出现 ${n} 次（应恰好一次）` });
  }
  for (const c of seen.keys()) {
    if (!all.includes(c)) issues.push({ level: 'error', message: `cluster ${c} 不在输入里（编造）` });
  }

  const blockIds = new Set(placed.filter((p) => p.form === 'block').map((p) => p.clusterId));
  for (const p of placed) {
    if (p.form === 'folded') {
      if (p.into === undefined) issues.push({ level: 'error', message: `cluster ${p.clusterId} folded 但没写 into` });
      else if (!blockIds.has(p.into)) issues.push({ level: 'error', message: `cluster ${p.clusterId} folded 到 ${p.into}，但后者不是 block` });
      if (!p.why?.trim()) issues.push({ level: 'warn', message: `cluster ${p.clusterId} folded 没给理由` });
    }
    if (p.form === 'block' && !p.title?.trim()) {
      issues.push({ level: 'warn', message: `cluster ${p.clusterId} 是 block 但没标题` });
    }
  }
  for (const s of sk.sections) {
    if (!s.placements.some((p) => p.form === 'block')) {
      issues.push({ level: 'warn', message: `板块「${s.heading}」一个 block 都没有` });
    }
  }
  return issues;
}

// ── 统计（纯函数）──────────────────────────────────────────────────────

export interface Stats {
  events: number;
  sections: number;
  blocks: number;
  folded: number;
  noteworthy: number;
  /** blocks / events。1.0 = 每个事件独立成篇；0.33 = 压缩三倍 */
  blockRatio: number;
  blocksPerSection: number[];
}

export function stats(sk: Skeleton, day: DayInput): Stats {
  const placed = sk.sections.flatMap((s) => s.placements);
  const blocks = placed.filter((p) => p.form === 'block').length;
  return {
    events: day.events.length,
    sections: sk.sections.length,
    blocks,
    folded: placed.filter((p) => p.form === 'folded').length,
    noteworthy: sk.noteworthy.length,
    blockRatio: day.events.length ? blocks / day.events.length : 0,
    blocksPerSection: sk.sections.map((s) => s.placements.filter((p) => p.form === 'block').length),
  };
}

// ── 从 LLM 原始输出里抠 JSON（纯函数）──────────────────────────────────

export function parseSkeleton(raw: string): Skeleton | null {
  const candidates = [
    raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1],
    raw.match(/\{[\s\S]*\}/)?.[0],
    raw,
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const o = JSON.parse(c.replace(/,\s*([}\]])/g, '$1'));
      if (Array.isArray(o?.sections)) {
        return { sections: o.sections, noteworthy: Array.isArray(o.noteworthy) ? o.noteworthy : [] };
      }
    } catch {
      /* 下一个候选 */
    }
  }
  return null;
}
