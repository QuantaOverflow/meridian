/**
 * 【复读检测 · 纯函数】不碰网络、不碰 env。
 *
 * 写作层 v3（services/brief-writer-v3.ts、prompts/briefWriterV3.ts、本文件的其余纯函数）
 * 已退役删除。只留 detectRepetition —— 简报块 v6 的解析处靠它挡 glm-4.7-flash 的复读退化
 * （services/brief-block-v6.ts；frequency_penalty 是缓解不是解药）。
 */

/**
 * 复读检测。两条腿：
 *   ① 句级：同一句（>25 字符）出现 ≥3 次，或 ≥10 句里不同句占比 <0.8
 *   ② 词级：任一 12 词片段出现 ≥4 次——治「复读但不断句」，句级切不开的那种
 * 旧 25 块上只判出 12,407 字符那块（同句 78 遍），其余 0 误判（verify V1.3 考）。
 */
export function detectRepetition(text: string): boolean {
  const ss = text.split(/(?<=[.!?])\s+/).map(x => x.trim().toLowerCase()).filter(x => x.length > 25);
  const count = new Map<string, number>();
  for (const s of ss) count.set(s, (count.get(s) ?? 0) + 1);
  const maxRep = Math.max(0, ...count.values());
  if (maxRep >= 3) return true;
  if (ss.length >= 10 && count.size / ss.length < 0.8) return true;
  const w = text.toLowerCase().split(/\s+/).filter(Boolean);
  const N = 12;
  const shingles = new Map<string, number>();
  for (let i = 0; i + N <= w.length; i++) {
    const k = w.slice(i, i + N).join(' ');
    const n = (shingles.get(k) ?? 0) + 1;
    if (n >= 4) return true;
    shingles.set(k, n);
  }
  return false;
}
