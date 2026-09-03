/**
 * 【扔掉型原型】第 2 步稳定性：固定主线，跑 5 轮，看每条 story 的票分布。
 *
 * 为什么固定主线：第 1 步已在 `storyline-assign.ts --label-only` 收敛（补上「不许按属性拆」
 * 那条约束后 6/6 次都给出同一组 4 条角度）。要量第 2 步自己的稳定性，就不能让主线跟着抖。
 * 用的是那 6 次里 covers 最干净的一组（国际援助线不提失踪者，四条互不侵犯）。
 *
 * 为什么看票分布而不是「两轮稳定性 %」：后者是压缩数字，看不出是「少数几条来回跳」
 * 还是「普遍不稳」。前者能直接定位到 story。
 *
 * 每条 story 看到的主线顺序按 id 确定性置换（实测位置偏置：第 1 位被超选 1.6-2.5×）。
 *
 * 跑法：npx tsx storyline-vote.ts [--rounds 5] [--conc 6]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const WORKER = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian/chat';
const WF = 'admin-brief-1788058777778';
const MODEL = '@cf/zai-org/glm-4.7-flash';
const args = process.argv.slice(2);
const argOf = (f: string, d: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const ROUNDS = Number(argOf('--rounds', '5'));
const CONC = Number(argOf('--conc', '6'));

// 固定主线：加上「恰好一条总述线」约束后第 5 次的产出（五条互不侵犯）。
// 上一版四条缺总述线，导致 2637/2642/2651/2639 这些「整体进展」报道无处可去，
// 散落进救援与国际援助线 → 37 篇巨块。根因是我把约束写成 At most ONE，模型理解成一条都别有。
const SL = [
  { name: "Nepal-Tibet floods overview", covers: "Death toll surpasses 600 and nearly 3,000 remain missing as rescuers struggle with terrain and weather" },
  { name: "Rescue operations", covers: "Nepal army and international teams race to save workers trapped in hydropower tunnels and reach remote border areas" },
  { name: "Missing foreigners", covers: "Families of missing Australians, Americans, Britons, and Indians wait for news as rescue teams focus on the border region" },
  { name: "Geological causes and risks", covers: "A melting glacier triggered the disaster and a newly formed barrier lake now threatens to cause a second flood" },
  { name: "International response", covers: "Nepal initially declined foreign aid but later accepted assistance from India, China, and the UN amid mounting pressure" },
];
const CODEX: number[][] = [ // 参照，不是金标；只作旁注
  [2642, 2651, 2637], [2653, 2652, 2650, 2644, 2645],
  [2635, 2636, 2640, 2641, 2639, 2647, 2648], [2643, 2634, 2646, 2654, 2655, 2638]];
const INTRUDER = 2649;

const DB = readFileSync('/Users/shiwenjie/Desktop/playground/projects/meridian/apps/frontend/.env', 'utf-8')
  .split('\n').find((l) => l.startsWith('NUXT_DATABASE_URL='))!.slice(18).replace(/"/g, '');
const psql = (q: string) => execFileSync('psql', [DB, '-At', '-F', '\t', '-c', q],
  { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }).trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
const st = psql(`SELECT id, coalesce(article_ids::text,'[]') FROM brief_stories
  WHERE workflow_id='${WF}' AND cluster_id=47 AND centroid IS NOT NULL ORDER BY id`)
  .map((r) => ({ id: Number(r[0]), arts: JSON.parse(r[1]) as number[] }));
if (st.length !== 22) throw new Error(`卫生断言失败：期望 22 条 story，拿到 ${st.length}`);
const title = new Map<number, string>();
for (const r of psql(`SELECT id, coalesce(title,'') FROM articles WHERE id IN (${[...new Set(st.flatMap((s) => s.arts))].join(',')})`))
  title.set(Number(r[0]), r[1]);
const heads = (s: typeof st[0]) => s.arts.map((a) => title.get(a) ?? '').filter(Boolean);
const artsOf = (ids: number[]) => new Set(ids.flatMap((i) => st.find((s) => s.id === i)!.arts)).size;
const stTitle = new Map(psql(`SELECT id, coalesce(title,'') FROM brief_stories WHERE id IN (${st.map((s) => s.id).join(',')})`)
  .map((r) => [Number(r[0]), r[1]] as [number, string]));

/**
 * 种子 = (story id, 轮次)。带轮次是关键：只用 id 的话 5 轮看到的顺序完全相同，
 * 多数票等于把同一个位置偏置投 5 遍——实测总述线排第 1 位时 5/8 条选它、
 * 不在第 1 位时只有 3/14，差 3 倍，而投票一点没消掉。轮次是已知量，仍然可重放。
 */
function permuteFor(id: number, n: number, round = 0): number[] {
  const ord = Array.from({ length: n }, (_, i) => i);
  let h = (id * 2654435761 + round * 40503) >>> 0;
  for (let i = n - 1; i > 0; i--) { h = (h * 1664525 + 1013904223) >>> 0; const j = h % (i + 1); [ord[i], ord[j]] = [ord[j], ord[i]]; }
  return ord;
}
const pickPrompt = (s: typeof st[0], shown: typeof SL) => `A daily brief covers one big news event using these storylines:

${shown.map((a, i) => `[${i + 1}] ${a.name} — ${a.covers}`).join('\n')}

Which ONE storyline do the reports below belong to? Judge by the headlines themselves.
You must pick exactly one — answer with its number.

Pick the MOST SPECIFIC storyline that fits. Every report mentions the event itself — that is
what they all have in common, not what tells them apart. Choose a general-overview storyline
only when the reports add nothing beyond the event's overall scale or progress; if they answer
a narrower question that another storyline names, choose that one.

Reports:
${heads(s).map((t) => `  - ${t}`).join('\n')}

Output ONLY JSON: {"storyline": <1-${shown.length}>, "reason": "<one clause>"}`;

async function chat(prompt: string): Promise<any> {
  for (let k = 0; k < 3; k++) {
    const r = await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }],
        options: { provider: 'workers-ai', model: MODEL, temperature: 0, max_tokens: 200, skipCache: true } }) });
    const j: any = await r.json();
    const raw = j?.data?.choices?.[0]?.message?.content ?? '';
    try { const o = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}'); if (Object.keys(o).length) return o; } catch {}
  }
  return null;
}
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let cur = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (cur < items.length) { const i = cur++; out[i] = await fn(items[i]); }
  }));
  return out;
}

console.log(`模型 ${MODEL}｜${ROUNDS} 轮｜主线固定 4 条｜每条 story 顺序按 id 置换\n`);
SL.forEach((x, i) => console.log(`  [${i + 1}] ${x.name}`));
console.log('');

const votes = new Map<number, number[]>(st.map((s) => [s.id, []]));
const posHits: number[] = new Array(SL.length + 1).fill(0);
for (let k = 0; k < ROUNDS; k++) {
  const res = await pool(st, CONC, async (s) => {
    const ord = permuteFor(s.id, SL.length, k);
    const o = await chat(pickPrompt(s, ord.map((i) => SL[i])));
    const n = Number(o?.storyline);
    const ok = Number.isInteger(n) && n >= 1 && n <= SL.length;
    return { id: s.id, pick: ok ? ord[n - 1] + 1 : null, at: ok ? n : null };
  });
  const fail = res.filter((r) => r.pick === null);
  res.forEach((r) => { if (r.pick) { votes.get(r.id)!.push(r.pick); if (r.at) posHits[r.at]++; } });
  console.log(`轮${k + 1} 完成${fail.length ? `（${fail.length} 条归类失败：${fail.map((f) => f.id)}）` : ''}`);
}

console.log(`\n展示位次被选分布：${posHits.slice(1).map((v, i) => `第${i + 1}位 ${v}`).join('｜')}` +
  `（均匀应各 ~${(st.length * ROUNDS / SL.length).toFixed(0)}）`);
{ // 偏置直读：总述线（原始第 1 条）排在展示第 1 位 vs 其他位时，被选中的比率
  let a = [0, 0], b = [0, 0];
  for (let k = 0; k < ROUNDS; k++) for (const s of st) {
    const ord = permuteFor(s.id, SL.length, k);
    const bucket = ord[0] === 0 ? a : b;   // 总述线是否被排在第 1 位
    bucket[1]++;
    if (votes.get(s.id)![k] === 1) bucket[0]++;
  }
  console.log(`总述线排第1位时被选 ${a[0]}/${a[1]}｜排其他位时被选 ${b[0]}/${b[1]}` +
    `（两者接近 = 偏置已被置换消掉）`);
}

console.log(`\n═══ 每条 story 的票分布（${ROUNDS} 票）`);
let unanimous = 0, split = 0;
const majority = new Map<number, number>();
for (const s of st) {
  const v = votes.get(s.id)!;
  const cnt = new Map<number, number>();
  v.forEach((x) => cnt.set(x, (cnt.get(x) ?? 0) + 1));
  const top = [...cnt.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  majority.set(s.id, top[0]);
  if (top[1] === v.length) unanimous++; else split++;
  const mark = top[1] === v.length ? '  ' : top[1] >= Math.ceil(v.length * 0.8) ? '· ' : '⚠️';
  console.log(`${mark}[${s.id}] ${String(s.arts.length).padStart(2)}篇 ${top[1]}/${v.length}→主线${top[0]}` +
    `  票 ${[...cnt.entries()].sort((a, b) => a[0] - b[0]).map(([k2, n]) => `${k2}×${n}`).join(' ')}` +
    `   ${(stTitle.get(s.id) ?? '').slice(0, 46)}`);
}
console.log(`\n全票一致 ${unanimous}/${st.length}，有分歧 ${split}/${st.length}`);

const blocks: number[][] = SL.map(() => []);
st.forEach((s) => blocks[majority.get(s.id)! - 1].push(s.id));
console.log(`\n═══ 多数票划分`);
blocks.forEach((b, i) => {
  if (!b.length) { console.log(`  [${i + 1}] ${SL[i].name}：空`); return; }
  console.log(`  ${String(artsOf(b)).padStart(2)}篇  [${SL[i].name}]  ${b.join(' ')}`);
  b.forEach((id) => console.log(`        ${String(st.find((s) => s.id === id)!.arts.length).padStart(2)}篇 ${(stTitle.get(id) ?? '').slice(0, 58)}`));
});
const grp = new Map<number, number>(CODEX.flatMap((g, gi) => g.map((id) => [id, gi] as [number, number])));
console.log(`\n（旁注，codex 非金标）各块的 codex 组成分：`);
blocks.forEach((b, i) => {
  const c = new Map<number, number[]>();
  b.filter((x) => x !== INTRUDER).forEach((x) => c.set(grp.get(x)!, [...(c.get(grp.get(x)!) ?? []), x]));
  console.log(`  [${i + 1}] ` + [...c.entries()].sort().map(([g, v]) => `组${g}:${v.length}条`).join(' | '));
});
writeFileSync('storyline-vote-out.json', JSON.stringify({ SL, rounds: ROUNDS,
  votes: Object.fromEntries([...votes]), majority: Object.fromEntries([...majority]) }, null, 1));
