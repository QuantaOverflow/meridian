/**
 * 块间数值一致性传感器（确定性，零 LLM）。**只报不改。**
 *
 * 这是分段写（b′）自己制造出来的新缺陷类：每个块是一次独立调用，没有跨块仲裁者，
 * 于是同一件事在两个块里可能给出两个数（实测第 75 期 3 处：$17.1B vs $18B、
 * magnitude 4.4 vs 5.2、644 vs 1,000 失踪）。
 *
 * 为什么判官抓不到：忠实度判官逐 claim 对**源**判。$17.1B 和 $18B 各自都能在源里找到
 * → 都判 supported。「整篇自己跟自己打架」不在判官的问题形式里，它结构上看不见。
 *
 * 做法：抽正文里的量化表达（金额/伤亡/百分比/震级），按「同一主题 + 同一量纲」配对，
 * 值不同即报。纯字符串处理，不判谁对谁错。
 *
 * ⚠️ 已知局限，别当成准确率：
 *   · 只覆盖四类量纲，漏检不代表没冲突
 *   · 精度实测 3/4（第 75 期一天的数据，n 很小）
 *   · PLACES 是在那一天的数据上调出来的固定词表，换一天会漂——地点消歧靠它，
 *     词表没覆盖的辖区会退化成误报（不是漏检）。mark-only 下误报只是噪声。
 *
 * 调这把尺时的教训：加块标题进主题键后召回涨、精度从 2/2 掉到 3/6，补地点消歧才回到 3/4。
 * **召回涨了就收工是错的。**
 */

export interface ConsistencyFinding {
  kind: 'money' | 'killed' | 'missing' | 'injured' | 'rescued' | 'percent' | 'magnitude';
  a: { block: string; raw: string; context: string };
  b: { block: string; raw: string; context: string };
  sharedTopic: string[];
}

interface Block {
  title: string;
  text: string;
}

// people 必须按具体量再分：死亡/失踪/受伤/获救是四个量，混成一类会把
// 「558 失踪」和「1,545 受伤」报成冲突（首轮实测的唯一误报正是这条）。
type Kind = ConsistencyFinding['kind'];

interface Quantity {
  kind: Kind;
  value: number;
  raw: string;
  blk: number;
  ctx: string;
  topic: string;
}

const MULT: Record<string, number> = {
  bn: 1e9, billion: 1e9, b: 1e9,
  m: 1e6, million: 1e6,
  k: 1e3, thousand: 1e3,
};

const PEOPLE: Record<string, Kind> = {
  killed: 'killed', dead: 'killed', deaths: 'killed',
  missing: 'missing', unaccounted: 'missing',
  injured: 'injured', rescued: 'rescued',
};

/** 把成品简报切回块：`<u>**title**</u>` 独占一行，其后段落属于该块 */
export function splitBriefBlocks(brief: string): Block[] {
  const out: Block[] = [];
  for (const chunk of brief.split(/^\s*<u>/m).slice(1)) {
    const m = chunk.match(/^\*{0,2}(.*?)\*{0,2}<\/u>\s*([\s\S]*?)(?=\n## |$)/);
    if (m) out.push({ title: m[1].trim(), text: m[2].trim() });
  }
  return out;
}

function extract(b: Block, blk: number): Quantity[] {
  const out: Quantity[] = [];
  const txt = b.text.replace(/\*\*/g, '').replace(/\*/g, '');
  // 主题键要带上块标题：只看数字前后 100 字符的话，「meta settles with states for $17.1bn」
  // 和「settlement requires time limits」两处凑不够 3 个共同词，那对真冲突就被滤掉了
  // （首轮实测的漏检）。标题本来就说明这块讲什么，是最便宜的主题信号。
  const push = (kind: Kind, value: number, raw: string, at: number) =>
    out.push({
      kind, value, raw, blk,
      ctx: txt.slice(Math.max(0, at - 60), at + 40).replace(/\s+/g, ' '),
      topic: b.title + ' ' + txt.slice(Math.max(0, at - 100), at + 80),
    });

  for (const m of txt.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s?(bn|billion|b|million|m|k|thousand)?\b/gi)) {
    const n = Number(m[1].replace(/,/g, '')) * (m[2] ? MULT[m[2].toLowerCase()] ?? 1 : 1);
    if (Number.isFinite(n)) push('money', n, m[0], m.index ?? 0);
  }
  for (const m of txt.matchAll(
    /\b([\d,]+)\s+(?:people\s+)?(?:were\s+|remain\s+)?(killed|dead|deaths|missing|unaccounted|injured|rescued)\b/gi
  )) {
    const n = Number(m[1].replace(/,/g, ''));
    const kind = PEOPLE[m[2].toLowerCase()];
    if (Number.isFinite(n) && kind) push(kind, n, m[0], m.index ?? 0);
  }
  for (const m of txt.matchAll(/\b(\d+(?:\.\d+)?)\s?%/g)) push('percent', Number(m[1]), m[0], m.index ?? 0);
  for (const m of txt.matchAll(/\bmagnitude\s+(\d+(?:\.\d+)?)/gi)) push('magnitude', Number(m[1]), m[0], m.index ?? 0);
  return out;
}

const STOP = new Set([
  'the', 'a', 'an', 'of', 'in', 'to', 'and', 'for', 'on', 'at', 'by', 'up', 'with',
  'from', 'is', 'was', 'has', 'have',
]);

function topicKey(ctx: string): Set<string> {
  return new Set(
    ctx.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w))
  );
}

/**
 * 地点消歧：同一场灾害跨越两个辖区时，两边各报各的数字**不是**冲突。
 * 首轮实测 6 处检出里 3 处误报，全是这一个根因（尼泊尔 644 失踪 vs 西藏 558 失踪）。
 * 判据：两处上下文各自提到的地点集合都非空、且完全不相交 → 说的不是同一个量，放行。
 */
const PLACES = [
  'nepal', 'tibet', 'china', 'chinese', 'india', 'indian', 'iran', 'israel', 'syria',
  'venezuela', 'russia', 'ukraine', 'norway', 'pakistan', 'rwanda', 'gyirong', 'rasuwa', 'langtang',
];

function differentPlaces(a: string, b: string): boolean {
  const pa = new Set(PLACES.filter((p) => a.toLowerCase().includes(p)));
  const pb = new Set(PLACES.filter((p) => b.toLowerCase().includes(p)));
  if (!pa.size || !pb.size) return false;
  return ![...pa].some((p) => pb.has(p));
}

export function checkBlockConsistency(brief: string): ConsistencyFinding[] {
  const blocks = splitBriefBlocks(brief);
  const nums = blocks.flatMap((b, i) => extract(b, i));

  const findings: ConsistencyFinding[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      const x = nums[i], y = nums[j];
      if (x.kind !== y.kind || x.blk === y.blk || x.value === y.value) continue;
      // 数量级差太远的多半不是同一个量（$17bn vs $500）
      const ratio = Math.max(x.value, y.value) / Math.max(1, Math.min(x.value, y.value));
      if (ratio > 5) continue;
      if (differentPlaces(x.ctx, y.ctx)) continue;
      const ky = topicKey(y.topic);
      const shared = [...topicKey(x.topic)].filter((t) => ky.has(t));
      if (shared.length < 3) continue;
      // 同一对块 + 同一量纲 + 同一对取值只报一次
      const dedupe = `${x.blk}-${y.blk}-${x.kind}-${x.raw}-${y.raw}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      findings.push({
        kind: x.kind,
        a: { block: blocks[x.blk].title, raw: x.raw, context: x.ctx },
        b: { block: blocks[y.blk].title, raw: y.raw, context: y.ctx },
        sharedTopic: shared.slice(0, 6),
      });
    }
  }
  return findings;
}
