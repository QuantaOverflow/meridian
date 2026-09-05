/**
 * 块间一致性检查（确定性通道，零 LLM）。
 *
 * 为什么需要它：判官逐 claim 对源判。$17.1B 和 $18B 各自都能在源里找到 → 都判 supported。
 * 「同一件事在两个块里给了两个数」这类错**不在判官的问题形式里**，它结构上看不见。
 * 分段写恰好制造的就是这类错（每块独立调用，没有跨块仲裁者），所以必须另开一条通道。
 *
 * 做法：抽出正文里的数量表达（金额/伤亡/百分比/震级），按「同一实体 + 同一量纲」分组，
 * 组内出现多个不同值就报冲突。纯字符串处理，不判对错——只指出「整篇自己跟自己打架」。
 *
 * 跑：npx tsx consistency-check.ts <brief.md 或 bprime-result.json 的 run 号>
 */
import { readFileSync } from 'node:fs';

const PROTO = '/Users/shiwenjie/Desktop/playground/projects/meridian/services/meridian-ai-worker/prototypes/skeleton-planner';

function loadBrief(arg: string): { label: string; md: string } {
  if (/^\d+$/.test(arg)) {
    const r = JSON.parse(readFileSync(`${PROTO}/bprime-result.json`, 'utf8')).find((x: any) => x.run === Number(arg));
    if (!r) throw new Error(`bprime-result.json 里没有 run ${arg}`);
    return { label: `b′ run ${arg}`, md: r.brief };
  }
  return { label: arg, md: readFileSync(arg.startsWith('/') ? arg : `${PROTO}/${arg}`, 'utf8') };
}

interface Blk { i: number; title: string; text: string }
function blocks(md: string): Blk[] {
  const out: Blk[] = [];
  for (const chunk of md.split(/^\s*<u>/m).slice(1)) {
    const m = chunk.match(/^\*{0,2}(.*?)\*{0,2}<\/u>\s*([\s\S]*?)(?=\n## |$)/);
    if (m) out.push({ i: out.length, title: m[1].trim(), text: m[2].trim() });
  }
  return out;
}

/** 量纲：同量纲内的不同值才算冲突（$17.1bn vs $18bn 冲突；$17bn vs 538 人不冲突） */
// people 必须按具体量再分：死亡/失踪/受伤/获救是四个量，混成一类会把
// 「558 失踪」和「1,545 受伤」报成冲突（首轮实测的唯一误报正是这条）。
type Kind = 'money' | 'killed' | 'missing' | 'injured' | 'rescued' | 'percent' | 'magnitude';
interface Num { kind: Kind; value: number; raw: string; blk: number; ctx: string; topic: string }

const MULT: Record<string, number> = { bn: 1e9, billion: 1e9, b: 1e9, m: 1e6, million: 1e6, k: 1e3, thousand: 1e3 };

function extract(b: Blk): Num[] {
  const out: Num[] = [];
  const txt = b.text.replace(/\*\*/g, '').replace(/\*/g, '');
  // 主题键要带上块标题：只看数字前后 100 字符的话，「Meta Settles with States for $17.1bn」
  // 和「Settlement Requires Time Limits」两处凑不够 3 个共同词，$17.1B vs $18B 这对真冲突
  // 就被滤掉了（首轮实测的漏检）。标题本来就说明这块讲什么，是最便宜的主题信号。
  const push = (kind: Kind, value: number, raw: string, at: number) =>
    out.push({
      kind, value, raw, blk: b.i,
      ctx: txt.slice(Math.max(0, at - 60), at + 40).replace(/\s+/g, ' '),
      topic: b.title + ' ' + txt.slice(Math.max(0, at - 100), at + 80),
    });

  for (const m of txt.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s?(bn|billion|b|million|m|k|thousand)?\b/gi)) {
    const n = Number(m[1].replace(/,/g, '')) * (m[2] ? MULT[m[2].toLowerCase()] ?? 1 : 1);
    if (Number.isFinite(n)) push('money', n, m[0], m.index ?? 0);
  }
  const PEOPLE: Record<string, Kind> = { killed: 'killed', dead: 'killed', deaths: 'killed', missing: 'missing', unaccounted: 'missing', injured: 'injured', rescued: 'rescued' };
  for (const m of txt.matchAll(/\b([\d,]+)\s+(?:people\s+)?(?:were\s+|remain\s+)?(killed|dead|deaths|missing|unaccounted|injured|rescued)\b/gi)) {
    const n = Number(m[1].replace(/,/g, ''));
    const kind = PEOPLE[m[2].toLowerCase()];
    if (Number.isFinite(n) && kind) push(kind, n, m[0], m.index ?? 0);
  }
  for (const m of txt.matchAll(/\b(\d+(?:\.\d+)?)\s?%/g)) push('percent', Number(m[1]), m[0], m.index ?? 0);
  for (const m of txt.matchAll(/\bmagnitude\s+(\d+(?:\.\d+)?)/gi)) push('magnitude', Number(m[1]), m[0], m.index ?? 0);
  return out;
}

/** 主题键：取上下文里的专名（大写开头词 + 已知小写实体），用来判断两个数说的是不是同一件事 */
const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'to', 'and', 'for', 'on', 'at', 'by', 'up', 'with', 'from', 'is', 'was', 'has', 'have']);
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
const PLACES = ['nepal', 'tibet', 'china', 'chinese', 'india', 'indian', 'iran', 'israel', 'syria', 'venezuela', 'russia', 'ukraine', 'norway', 'pakistan', 'rwanda', 'gyirong', 'rasuwa', 'langtang'];
const placesIn = (t: string) => new Set(PLACES.filter((p) => t.toLowerCase().includes(p)));
function differentPlaces(a: string, b: string): boolean {
  const pa = placesIn(a), pb = placesIn(b);
  if (!pa.size || !pb.size) return false;
  return ![...pa].some((p) => pb.has(p));
}

const arg = process.argv[2] ?? '1';
const { label, md } = loadBrief(arg);
const bs = blocks(md);
const nums = bs.flatMap(extract);
console.log(`${label}: ${bs.length} 块，抽出 ${nums.length} 个量化表达\n`);

// 同量纲、跨块、主题词重叠 ≥3 且值不同 → 疑似冲突
const conflicts: { a: Num; b: Num; shared: string[] }[] = [];
for (let i = 0; i < nums.length; i++) {
  for (let j = i + 1; j < nums.length; j++) {
    const x = nums[i], y = nums[j];
    if (x.kind !== y.kind || x.blk === y.blk || x.value === y.value) continue;
    // 数量级差太远的多半不是同一个量（$17bn vs $500）
    const ratio = Math.max(x.value, y.value) / Math.max(1, Math.min(x.value, y.value));
    if (ratio > 5) continue;
    if (differentPlaces(x.ctx, y.ctx)) continue;
    const shared = [...topicKey(x.topic)].filter((t) => topicKey(y.topic).has(t));
    if (shared.length >= 3) conflicts.push({ a: x, b: y, shared });
  }
}

// 同一对块 + 同一量纲只报一次
const seen = new Set<string>();
const uniq = conflicts.filter((c) => {
  const k = `${c.a.blk}-${c.b.blk}-${c.a.kind}-${c.a.raw}-${c.b.raw}`;
  return seen.has(k) ? false : (seen.add(k), true);
});

if (!uniq.length) {
  console.log('✓ 没有检出跨块数值冲突');
} else {
  console.log(`⚠ 检出 ${uniq.length} 处疑似跨块冲突：\n`);
  uniq.forEach((c, n) => {
    console.log(`[${n + 1}] ${c.a.kind}  「${c.a.raw}」 vs 「${c.b.raw}」`);
    console.log(`    块 ${c.a.blk} 《${bs[c.a.blk].title.slice(0, 40)}》: …${c.a.ctx}…`);
    console.log(`    块 ${c.b.blk} 《${bs[c.b.blk].title.slice(0, 40)}》: …${c.b.ctx}…`);
    console.log(`    共同主题词: ${c.shared.slice(0, 6).join(', ')}\n`);
  });
}
console.log('注：这是启发式检出，需人工确认。漏检不代表没有冲突（只覆盖金额/伤亡/百分比/震级四类）。');
