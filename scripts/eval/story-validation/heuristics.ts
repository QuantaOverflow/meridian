import type { Story, HeuristicResult, HeuristicFlag } from './types.js';

// region/domain token 静态列表（v1）—— 标题里命中 ≥2 个不同 token 视为 geo_stuffing
// 故意不含 umbrella 地区词 (Middle East, Latin America, East Asia, Caribbean, Europe)：
// 这些大词常作为合法"地区前缀 — 具体事件"形式出现 (e.g. "Middle East — Israel-Lebanon ...")，
// 不应该让 sub-token 一起被罚。要捕捉拼盘，靠 ≥2 个具体国家/领域 token 同时出现即可。
const REGION_DOMAIN_TOKENS = [
  // 具体国家/地区 (注意：'America' 故意不在内 —— 它会撞 Latin America/South America 等)
  'US', 'Africa', 'Israel', 'Gaza', 'Lebanon', 'Syria',
  'Ukraine', 'Russia', 'China', 'Spain', 'Australia', 'Japan', 'Korea',
  'France', 'Germany', 'UK', 'India', 'Iran', 'Cuba', 'Mexico', 'Bolivia',
  'Jamaica', 'Sierra Leone', 'Tasmania', 'DR Congo', 'Afghanistan',
  // 领域
  'Cybersecurity', 'AI', 'Sports', 'Politics', 'Legal', 'Health',
  'Climate', 'Diplomacy', 'Economy',
];

function detectPaddedTitle(title: string): string | null {
  // 标题中 ' — ' 之后或整段，按 ',' / ' and ' / ';' / '+' 切，
  // 若 ≥3 段且每段都含至少一个大写专名 → padded
  const tail = title.includes('—') ? title.split('—').slice(1).join('—') : title;
  const segments = tail.split(/,| and |;|\+/).map(s => s.trim()).filter(Boolean);
  if (segments.length < 3) return null;
  const segmentsWithProper = segments.filter(s => /\b[A-Z][a-zA-Z]+/.test(s));
  if (segmentsWithProper.length >= 3) {
    return `title splits into ${segmentsWithProper.length} segments each with a proper noun: ${segmentsWithProper.slice(0, 3).join(' / ')}...`;
  }
  return null;
}

function detectLowSupport(story: Story): string | null {
  if (story.articleIds.length < 3) {
    return `only ${story.articleIds.length} article(s) — below the "same event, multiple outlets" threshold`;
  }
  return null;
}

function detectGeoStuffing(title: string): string | null {
  // 用 word-boundary 匹配（避免 'AI' 命中 'sp**ai**n'）。
  // 长度降序避免嵌套双计（'Latin America' 命中后不再单算 'America'）。
  // Pain 4: 连字符 / 斜杠连接的复合地名（"Ukraine-Russia"、"Caribbean/Latin America"）
  // 当一个完整复合实体记 1 次，不分裂成两个独立 token。
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sorted = [...REGION_DOMAIN_TOKENS].sort((a, b) => b.length - a.length);
  const tokenAlt = sorted.map(escape).join('|');
  const coveredRanges: Array<[number, number]> = [];
  const hits = new Set<string>();
  const usedInCompound = new Set<string>();

  // Pre-pass: 找 X-Y / X/Y 复合
  const compoundPattern = new RegExp(`\\b(${tokenAlt})[-/](${tokenAlt})\\b`, 'gi');
  let cm: RegExpExecArray | null;
  while ((cm = compoundPattern.exec(title)) !== null) {
    const compoundLabel = `${cm[1]}-${cm[2]}`;
    hits.add(compoundLabel);
    coveredRanges.push([cm.index, cm.index + cm[0].length]);
    usedInCompound.add(cm[1].toLowerCase());
    usedInCompound.add(cm[2].toLowerCase());
  }

  for (const token of sorted) {
    if (usedInCompound.has(token.toLowerCase())) continue;
    const pattern = new RegExp(`\\b${escape(token)}\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(title)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const overlaps = coveredRanges.some(([s, e]) => start < e && end > s);
      if (!overlaps) {
        hits.add(token);
        coveredRanges.push([start, end]);
        break;
      }
    }
  }

  if (hits.size >= 2) {
    return `title mentions ${hits.size} distinct region/domain tokens: ${[...hits].join(', ')}`;
  }
  return null;
}

// split_overlap 需要跨 story 的视图
export function detectSplitOverlap(stories: Story[]): Map<number, Set<number>> {
  const idToStoryIdx = new Map<number, Set<number>>();
  stories.forEach((story, idx) => {
    for (const aid of story.articleIds) {
      if (!idToStoryIdx.has(aid)) idToStoryIdx.set(aid, new Set());
      idToStoryIdx.get(aid)!.add(idx);
    }
  });
  const overlap = new Map<number, Set<number>>();
  for (const [aid, idxs] of idToStoryIdx) {
    if (idxs.size >= 2) overlap.set(aid, idxs);
  }
  return overlap;
}

export function runHeuristics(
  story: Story,
  _storyIdx: number,
  overlapMap: Map<number, Set<number>>
): HeuristicResult {
  const flags: HeuristicFlag[] = [];
  const details: HeuristicResult['details'] = {};

  const padded = detectPaddedTitle(story.title);
  if (padded) { flags.push('padded_title'); details.padded_title = padded; }

  const lowSup = detectLowSupport(story);
  if (lowSup) { flags.push('low_support'); details.low_support = lowSup; }

  const geo = detectGeoStuffing(story.title);
  if (geo) { flags.push('geo_stuffing'); details.geo_stuffing = geo; }

  const overlappingIds = story.articleIds.filter(aid => {
    const idxs = overlapMap.get(aid);
    return idxs && idxs.size >= 2;
  });
  if (overlappingIds.length > 0) {
    flags.push('split_overlap');
    details.split_overlap = `${overlappingIds.length} articleId(s) shared with other stories: ${overlappingIds.slice(0, 3).join(', ')}`;
  }

  return { flags, details };
}
