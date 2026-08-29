/**
 * ── 便携模块 ──────────────────────────────────────────────────────────────
 * 变体产出 vs 基线产出的对拍指标。纯函数，无 I/O。
 *
 * 度量取舍：**基线不是金标**，它只是"线上现在这样"。所以这里量的是「偏离」而不是
 * 「对错」——问题是"最小到哪一步会突变"，突变的定义就是偏离突然变大。
 *
 * 分两类字段，因为它们的下游后果完全不同：
 *   硬字段  language / completeness / content_quality / primary_location
 *           —— 枚举，驱动质量门（LOW_QUALITY / JUNK 会被拦）。翻一个就是真回归。
 *   软字段  五个数组 —— 拼成 search text 去做 embedding。逐字不同没关系，
 *           **语义漂了才有关系**，所以最终裁决看 embedding 余弦，不看字面 Jaccard。
 */

// ── 从 apps/backend/src/lib/core/utils.ts 逐字拷来 ─────────────────────────
// 不 import 的原因：那个文件 import 了 hono 与 ../../app，脱离 backend 加载不了。
// 这是一次性原型，拷贝可接受；抬进生产时不要把这份拷贝一起带走。
export function generateSearchText(data: any): string {
  const joinSafely = (arr: string[] | null | undefined): string =>
    (arr ?? []).map((s) => s?.trim()).filter(Boolean).join(' ');

  const summary = (data.event_summary_points ?? [])
    .map((p: string) => p?.trim() ?? '')
    .filter((p: string) => p !== '')
    .map((p: string) => (p.endsWith('.') ? p : `${p}.`))
    .join(' ');

  const keywords = joinSafely(data.thematic_keywords);
  const tags = joinSafely(data.topic_tags);
  const entities = joinSafely(data.key_entities);
  const focus = joinSafely(data.content_focus);

  let location = data.primary_location?.trim() ?? '';
  if (['GLOBAL', 'WORLD', '', 'NONE', 'N/A'].includes(location.toUpperCase())) location = '';

  const title = data.title?.trim() ?? '';
  const parts = [title, location, summary, entities, keywords, tags, focus]
    .filter(Boolean).map((p: string) => p.trim()).filter((p: string) => p !== '');

  let combined = '';
  parts.forEach((part: string, index: number) => {
    if (index === 0) combined = part;
    else combined += combined.endsWith('.') ? ' ' + part : '. ' + part;
  });
  if (combined && !combined.endsWith('.')) combined += '.';
  return combined;
}

// ── 指标 ──────────────────────────────────────────────────────────────────

export const HARD_FIELDS = ['language', 'completeness', 'content_quality', 'primary_location'] as const;
export const SOFT_FIELDS = ['event_summary_points', 'thematic_keywords', 'topic_tags', 'key_entities', 'content_focus'] as const;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const tokens = (arr: string[]) => new Set(norm((arr ?? []).join(' ')).split(' ').filter((w) => w.length > 2));

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  a.forEach((x) => { if (b.has(x)) inter++; });
  return inter / (a.size + b.size - inter);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export interface HardDiff { field: string; base: string; cand: string; same: boolean }
export interface SoftDiff { field: string; baseN: number; candN: number; tokenJaccard: number; phraseJaccard: number }

export interface Comparison {
  hard: HardDiff[];
  soft: SoftDiff[];
  /** 硬字段一致数 / 总数 —— 任何 <1 都是要人看的 */
  hardAgreement: number;
  /** 软字段 token Jaccard 均值 */
  softTokenMean: number;
  /** search text 余弦（需外部提供向量；无向量时为 null） */
  searchCosine: number | null;
}

export function compareOutputs(base: any, cand: any, vectors?: { base: number[]; cand: number[] }): Comparison {
  const hard: HardDiff[] = HARD_FIELDS.map((f) => {
    const b = String(base?.[f] ?? ''), c = String(cand?.[f] ?? '');
    // primary_location 大小写/别名不算翻车，其余枚举严格比
    const same = f === 'primary_location' ? norm(b) === norm(c) : b === c;
    return { field: f, base: b, cand: c, same };
  });

  const soft: SoftDiff[] = SOFT_FIELDS.map((f) => {
    const b = (base?.[f] ?? []) as string[], c = (cand?.[f] ?? []) as string[];
    return {
      field: f, baseN: b.length, candN: c.length,
      tokenJaccard: jaccard(tokens(b), tokens(c)),
      phraseJaccard: jaccard(new Set(b.map(norm)), new Set(c.map(norm))),
    };
  });

  return {
    hard, soft,
    hardAgreement: hard.filter((h) => h.same).length / hard.length,
    softTokenMean: soft.reduce((a, s) => a + s.tokenJaccard, 0) / soft.length,
    searchCosine: vectors ? cosine(vectors.base, vectors.cand) : null,
  };
}

/** qwen3-30b-a3b-fp8 官方计费：4,625 neurons/M input，30,475/M output */
export const NEURONS = { input: 4625 / 1e6, output: 30475 / 1e6 };
export const USD_PER_NEURON = 0.011 / 1000;

export function neuronsOf(promptTokens: number, completionTokens: number): number {
  return NEURONS.input * promptTokens + NEURONS.output * completionTokens;
}
