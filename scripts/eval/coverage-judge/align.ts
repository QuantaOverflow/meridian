// ============================================================================
// 决定论对齐器 —— 无 LLM 的第三把独立尺（三角测量里对抗 self-preference 的锚）
//
// 直接移植 error-analysis/assemble-trace.ts 的洞1 对齐逻辑（专有名词加权词汇重叠），
// 额外按命中块的「块类型」把 present 再分成 headline / noteworthy。
//   - dropped/covered 二分：强（proper-noun 命中即 covered，宁缺毋误配，阈值 1.0）
//   - headline/noteworthy 三分：弱（靠块首标记猜，仅作参考票，非决策依据）
// 纯离线确定性、无嵌入/API 依赖，因此完全无 self-preference，是判官(qwen)与 codex(GPT)
// 之外的第三独立信号：三者一致→暂定 gold；分歧→交人裁。
// ============================================================================

export type Disposition = 'headline' | 'noteworthy' | 'dropped';

const STOP = new Set(
  ('the a an and or of to in on at as by is are was were be been has have had it its this that these those not no new first ever talks talk meeting meet report reports says said will would can could may might about across against between during than then them they their there here what which who whose why how when where over under after before amid into from with focus response day live crisis ' +
    'january february march april june july august september october november december 2024 2025 2026 2027').split(
    /\s+/
  )
);

// 标题/摘要 → 锚词，保留大小写以识别专有名词（首字母大写且非停用词）
function anchorTerms(title: string): { term: string; proper: boolean }[] {
  const seen = new Set<string>();
  const out: { term: string; proper: boolean }[] = [];
  for (const raw of title.split(/[^A-Za-z0-9]+/).filter(Boolean)) {
    const term = raw.toLowerCase();
    if (term.length <= 3 || STOP.has(term) || seen.has(term)) continue;
    seen.add(term);
    out.push({ term, proper: /^[A-Z]/.test(raw) });
  }
  return out;
}

// 简报切块：<u>**标题**</u> 主 story、## / ### 小节头、noteworthy 的 - 项 各自成块
export function segmentBrief(brief: string): string[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.join('').trim()) blocks.push(cur.join('\n'));
    cur = [];
  };
  for (const line of brief.split('\n')) {
    if (/<u>\s*\*\*/.test(line) || /^\s*#{2,3}\s/.test(line) || /^\s*-\s+\*\*/.test(line)) flush();
    cur.push(line);
  }
  flush();
  return blocks;
}

// 块类型：块首标记 → headline（story 块/小节头）或 noteworthy（bullet/内联提及）
function classifyBlock(block: string): Disposition {
  const firstMarkerLine =
    block.split('\n').find((l) => /<u>\s*\*\*/.test(l) || /^\s*#{2,3}\s/.test(l) || /^\s*-\s+\*\*/.test(l)) || '';
  if (/<u>\s*\*\*/.test(firstMarkerLine) || /^\s*#{2,3}\s/.test(firstMarkerLine)) return 'headline';
  return 'noteworthy'; // - ** bullet 或 preamble 内联提及
}

// 给一条 story 对齐到最匹配的简报块。score = Σ 命中词 (专有?3:1)·(1/df)·min(块内出现次数,3)。
// 要求 ≥1 专有名词命中且 score≥1.0，否则 dropped（宁缺毋误配）。
export function alignDisposition(
  label: string,
  blocks: string[]
): { disposition: Disposition; score: number; hits: string[]; blockIdx: number } {
  const blocksLow = blocks.map((b) => b.toLowerCase());
  const terms = anchorTerms(label);
  const df = (t: string) => blocksLow.reduce((n, b) => n + (b.includes(t) ? 1 : 0), 0) || 1;
  let best = { idx: -1, score: 0, hits: [] as string[] };
  for (let i = 0; i < blocksLow.length; i++) {
    let score = 0;
    let proper = false;
    const hits: string[] = [];
    for (const { term, proper: isProper } of terms) {
      const count = blocksLow[i].split(term).length - 1;
      if (!count) continue;
      score += (isProper ? 3 : 1) * (1 / df(term)) * Math.min(count, 3);
      if (isProper) proper = true;
      hits.push(term);
    }
    if (proper && score > best.score) best = { idx: i, score, hits };
  }
  if (best.idx >= 0 && best.score >= 1.0) {
    return { disposition: classifyBlock(blocks[best.idx]), score: best.score, hits: best.hits, blockIdx: best.idx };
  }
  return { disposition: 'dropped', score: best.score, hits: best.hits, blockIdx: -1 };
}
