/**
 * 【扔掉型原型】换判据：从「是不是同一件事」改问「该不该写进简报的同一段」。
 *
 * 为什么要换（2026-09-03 实测，见 FINDINGS.md）：
 *   · 现行判准 CRITERIA 白纸黑字写着 "A disaster, then the rescue, then the aid, then the
 *     updated death toll — one occurrence."，所以判官对尼泊尔 210 对里 202 对答 yes。
 *     它不是失灵，是按指令办事。
 *   · cos 也不带题材信号（组内 vs 跨组 AUC 0.601）。两个输入都不带 → 聚合层再调也切不出主线。
 *   → 唯一没试过的杠杆是**问什么**。顺带把 articleTitles 的 slice(0,4) 去掉（18 篇的故事
 *     只让判官看前 4 篇，且那 4 篇碰巧全是伤亡+搜救，等于拿删节版去比）。
 *
 * 两臂共用**同一个配对集**（0.90 提名带），A0 读 merge-arms 落的缓存，零增量成本。
 *   A0  现行判据 same_occurrence + 前 4 篇标题
 *   A2  新判据   same_section    + 全部成员标题
 *
 * 成功标准（跑之前定死）：yes 边密度 55-75%；组内 yes >90% 且跨组 yes <40%；
 * 对 codex 4 组错配 ≤2/21；尼泊尔压成 3-5 块。任一不达标即负结果。
 *
 * 跑法：npx tsx thread-edges.ts [--conc 8]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const WORKER = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian/chat';
const CACHE = new URL('./.cache/', import.meta.url).pathname;
const WF = 'admin-brief-1788058777778';
const BAND = 0.9;
const args = process.argv.slice(2);
const CONC = Number(args.indexOf('--conc') >= 0 ? args[args.indexOf('--conc') + 1] : '8');
mkdirSync(CACHE, { recursive: true });

// codex 读者评审（2026-09-02）的 4 组人裁划分。⚠️ 对照不是金标：一人一次裁定。
const CODEX_4: number[][] = [
  [2642, 2651, 2637],                                     // 灾情总述与进展
  [2653, 2652, 2650, 2644, 2645],                         // 成因、堰塞湖与复盘
  [2635, 2636, 2640, 2641, 2639, 2647, 2648],             // 救援、基础设施与援助
  [2643, 2634, 2646, 2654, 2655, 2638],                   // 跨国失踪者与家属
];

// ── 新判据 ───────────────────────────────────────────────────────────────────
// 与生产 storyMerge.ts 的 CRITERIA 正交：那条问「底层发生是否同一」（管去重），
// 这条问「读者读起来是否同一条主线」（管分块）。故意不复用，避免两个目标缠在一个 yes/no 里。
const SECTION_CRITERIA = `A brief section is one continuous piece of prose with ONE angle.
Two stories belong in the same section when a single paragraph could cover both without
changing subject.

- SAME section — same angle on the event:
  both tracking the death toll and search progress;
  both about the tunnel/hydropower rescue operation;
  both about foreign nationals missing and their families.
- DIFFERENT sections — different angle, even though it is the same event:
  what happened and how bad it is  vs  why it happened and which warnings were missed;
  the rescue operation  vs  the families waiting for news;
  overall casualty figures  vs  the dispute over accepting foreign aid.
- If both stories report the same narrow happening in near-identical terms, they are the
  SAME section (they are plain duplicates).

Judge by the member headlines, NOT by the story titles — the titles are auto-generated
and often mislabel the angle.`;

function getSectionPrompt(c: Array<{ title: string; articleTitles: string[] }>): string {
  const block = c.map((x, i) => `[${i + 1}] ${x.title}\n${x.articleTitles.map((t) => `    - ${t}`).join('\n')}`).join('\n\n');
  return `Two news stories below came from the same article cluster — they concern the same
broad event. Decide whether they belong in the SAME SECTION of a daily news brief.

${SECTION_CRITERIA}

${block}

Output ONLY JSON:
{"same_section": true|false, "reason": "<one clause naming each story's angle>"}`;
}

// ── 数据 ─────────────────────────────────────────────────────────────────────
const DB = readFileSync(new URL('../../../frontend/.env', import.meta.url).pathname, 'utf-8')
  .split('\n').find((l) => l.startsWith('NUXT_DATABASE_URL='))!.slice(18).replace(/"/g, '');
function psql(sql: string): string[][] {
  for (let k = 0; ; k++) {
    try {
      return execFileSync('psql', [DB, '-At', '-F', '\t', '-c', sql],
        { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }).trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
    } catch (e) { if (k >= 3) throw e; execFileSync('sleep', ['2']); }
  }
}
interface Story { i: number; id: number; clusterId: number; title: string; arts: number[] }
const st: Story[] = psql(`SELECT id, cluster_id, coalesce(title,''), coalesce(article_ids::text,'[]')
  FROM brief_stories WHERE workflow_id='${WF}' AND centroid IS NOT NULL ORDER BY id`)
  .map((r, i) => ({ i, id: Number(r[0]), clusterId: Number(r[1]), title: r[2], arts: JSON.parse(r[3]) as number[] }));
const byId = new Map(st.map((s) => [s.id, s]));

const artTitle = new Map<number, string>();
const allArts = [...new Set(st.flatMap((s) => s.arts))];
for (let i = 0; i < allArts.length; i += 400)
  for (const r of psql(`SELECT id, coalesce(title,'') FROM articles WHERE id IN (${allArts.slice(i, i + 400).join(',')})`))
    artTitle.set(Number(r[0]), r[1]);
const titlesOf = (s: Story, cap = Infinity) =>
  s.arts.map((id) => artTitle.get(id) ?? '').filter(Boolean).slice(0, cap === Infinity ? undefined : cap);

const nominated = psql(`SELECT a.id, b.id, (1-(a.centroid<=>b.centroid)) FROM brief_stories a
  JOIN brief_stories b ON b.workflow_id=a.workflow_id AND b.cluster_id=a.cluster_id AND a.id<b.id
  WHERE a.workflow_id='${WF}' AND a.centroid IS NOT NULL AND b.centroid IS NOT NULL
    AND (1-(a.centroid<=>b.centroid)) >= ${BAND}`)
  .map((r) => ({ a: byId.get(Number(r[0]))!.i, b: byId.get(Number(r[1]))!.i, cos: Number(r[2]) }));

const codexIdx = CODEX_4.map((g) => g.map((id) => {
  const s = byId.get(id); if (!s) throw new Error(`卫生断言失败：codex 的 story ${id} 不在本期`); return s.i;
}));
const nIdx = new Set(codexIdx.flat());
const pk = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
const codexPairs = new Set(codexIdx.flatMap((g) => g.flatMap((x, i) => g.slice(i + 1).map((y) => pk(x, y)))));
const isNepal = (p: { a: number; b: number }) => nIdx.has(p.a) && nIdx.has(p.b);

// ── 判决 ─────────────────────────────────────────────────────────────────────
async function chat(prompt: string): Promise<any> {
  for (let k = 0; k < 3; k++) {
    const r = await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }],
        options: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, max_tokens: 300, skipCache: true } }) });
    const j: any = await r.json();
    const raw = j?.data?.choices?.[0]?.message?.content ?? '';
    try { const o = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}'); if (typeof o.same_section === 'boolean') return o; } catch {}
  }
  return null; // 三次都拿不到布尔值 → 记为缺失，不静默当 false
}
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let cur = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (cur < items.length) { await fn(items[cur++]); if (++done % 25 === 0) process.stderr.write(`  ${done}/${items.length}\n`); }
  }));
}

// A0 缓存 key = 两条 story 的文章集（merge-arms.ts 落的，判据/截断都是旧的）
const a0key = (p: { a: number; b: number }) => `${[...st[p.a].arts].sort().join(',')}|${[...st[p.b].arts].sort().join(',')}`;
const A0_FILE = `${CACHE}verdicts_${WF}_b${BAND}.json`;
if (!existsSync(A0_FILE)) throw new Error(`卫生断言失败：A0 基线缓存不在 ${A0_FILE}，先跑 merge-arms.ts`);
const a0: Record<string, { yes: number; n: number }> = JSON.parse(readFileSync(A0_FILE, 'utf-8'));

// A2 单独一个缓存文件——**判据变了就不能复用 A0 的答案**，同名会静默串味
const A2_FILE = `${CACHE}verdicts_section_${WF}_b${BAND}.json`;
const a2: Record<string, boolean | null> = existsSync(A2_FILE) ? JSON.parse(readFileSync(A2_FILE, 'utf-8')) : {};

const todo = nominated.filter((p) => !(a0key(p) in a2));
console.log(`提名带 ≥${BAND}：${nominated.length} 对（尼泊尔 ${nominated.filter(isNepal).length} 对）`);
console.log(`A2 判决：缓存命中 ${nominated.length - todo.length}，待打 ${todo.length}\n`);
if (todo.length) {
  await pool(todo, CONC, async (p) => {
    const cands = [p.a, p.b].map((i) => ({ title: st[i].title, articleTitles: titlesOf(st[i]) })); // 全部标题，不截
    const o = await chat(getSectionPrompt(cands));
    a2[a0key(p)] = o === null ? null : o.same_section;
  });
  writeFileSync(A2_FILE, JSON.stringify(a2, null, 1));
}
const missing = nominated.filter((p) => a2[a0key(p)] === null).length;
if (missing) console.log(`⚠️ ${missing} 对三次都没拿到布尔值，按「无边」处理\n`);
{ // 卫生：两臂必须覆盖同一个配对集，否则密度不可比
  const miss0 = nominated.filter((p) => !(a0key(p) in a0)).length;
  if (miss0) throw new Error(`卫生断言失败：A0 缺 ${miss0} 对判决，两臂配对集不同集`);
}

// ── 读数 ─────────────────────────────────────────────────────────────────────
const yesA0 = (p: { a: number; b: number }) => a0[a0key(p)].yes > a0[a0key(p)].n / 2;
const yesA2 = (p: { a: number; b: number }) => a2[a0key(p)] === true;
const nepalPairs = nominated.filter(isNepal);

console.log('臂                              yes 边密度       组内 yes      跨组 yes');
for (const [name, fn] of [['A0 同一发生 + 前4篇', yesA0], ['A2 同一主线 + 全部标题', yesA2]] as const) {
  const ins = nepalPairs.filter((p) => codexPairs.has(pk(p.a, p.b)));
  const crs = nepalPairs.filter((p) => !codexPairs.has(pk(p.a, p.b)));
  const y = (l: typeof nepalPairs) => l.filter(fn).length;
  console.log(`${name.padEnd(30)} ${String(y(nepalPairs)).padStart(3)}/${nepalPairs.length} = ${(y(nepalPairs) / nepalPairs.length * 100).toFixed(0).padStart(3)}%` +
    `   ${String(y(ins)).padStart(2)}/${ins.length} = ${(y(ins) / ins.length * 100).toFixed(0).padStart(3)}%` +
    `   ${String(y(crs)).padStart(3)}/${crs.length} = ${(y(crs) / crs.length * 100).toFixed(0).padStart(3)}%`);
}

// 全链在各自的边上划分尼泊尔那 21 条
function complete(comp: number[], linked: (a: number, b: number) => boolean, cosine: (a: number, b: number) => number): number[][] {
  let gs = comp.map((i) => [i]);
  for (;;) {
    let best: [number, number] | null = null, bestV = -1;
    for (let a = 0; a < gs.length; a++) for (let b = a + 1; b < gs.length; b++) {
      let ok = true, mn = 1;
      outer: for (const x of gs[a]) for (const y of gs[b]) { if (!linked(x, y)) { ok = false; break outer; } mn = Math.min(mn, cosine(x, y)); }
      if (ok && mn > bestV) { bestV = mn; best = [a, b]; }
    }
    if (!best) break;
    gs[best[0]] = gs[best[0]].concat(gs[best[1]]); gs.splice(best[1], 1);
  }
  return gs;
}
const cosOf = new Map(nominated.map((p) => [pk(p.a, p.b), p.cos]));
function misassign(part: number[][]): number {
  const gs = part.map((g) => g.filter((i) => nIdx.has(i))).filter((g) => g.length);
  const ov: Array<[number, number, number]> = [];
  gs.forEach((g, gi) => codexIdx.forEach((c, ci) => { const n = g.filter((i) => c.includes(i)).length; if (n) ov.push([n, gi, ci]); }));
  ov.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const ug = new Set<number>(), uc = new Set<number>(); let hit = 0;
  for (const [n, gi, ci] of ov) { if (ug.has(gi) || uc.has(ci)) continue; ug.add(gi); uc.add(ci); hit += n; }
  return nIdx.size - hit;
}

console.log('\n臂                              尼泊尔块数  最大块(条/篇)  错配条  各块篇数');
const parts: Record<string, number[][]> = {};
for (const [name, fn] of [['A0 同一发生 + 前4篇', yesA0], ['A2 同一主线 + 全部标题', yesA2]] as const) {
  const edge = new Set(nepalPairs.filter(fn).map((p) => pk(p.a, p.b)));
  const part = complete([...nIdx], (a, b) => edge.has(pk(a, b)), (a, b) => cosOf.get(pk(a, b)) ?? 0);
  parts[name] = part;
  const sz = (g: number[]) => new Set(g.flatMap((i) => st[i].arts)).size;
  console.log(`${name.padEnd(30)} ${String(part.length).padStart(9)} ` +
    `${String(Math.max(...part.map((g) => g.length))).padStart(9)}/${String(Math.max(...part.map(sz))).padEnd(3)} ` +
    `${String(misassign(part)).padStart(6)}  ${part.map(sz).sort((a, b) => b - a).join(' ')}`);
}
{
  const sz = (g: number[]) => new Set(g.flatMap((i) => st[i].arts)).size;
  console.log(`${'codex 人裁 4 组'.padEnd(30)} ${String(4).padStart(9)} ${String(Math.max(...codexIdx.map((g) => g.length))).padStart(9)}/${String(Math.max(...codexIdx.map(sz))).padEnd(3)} ` +
    `${String(0).padStart(6)}  ${codexIdx.map(sz).sort((a, b) => b - a).join(' ')}`);
}

// 非尼泊尔对照：新判据会不会把本来该合的普通重复也拆了
const other = nominated.filter((p) => !isNepal(p));
const flipped = other.filter((p) => yesA0(p) && !yesA2(p));
console.log(`\n非尼泊尔对照：${other.length} 对，A0 判 yes ${other.filter(yesA0).length}，A2 判 yes ${other.filter(yesA2).length}` +
  `，A0 yes → A2 no 有 ${flipped.length} 对`);
for (const p of flipped.slice(0, 10))
  console.log(`   cos=${p.cos.toFixed(4)}  ${st[p.a].title.slice(0, 38)} × ${st[p.b].title.slice(0, 38)}`);

console.log(`\n=== A2 的尼泊尔划分 ===`);
parts['A2 同一主线 + 全部标题'].forEach((g, k) => {
  console.log(`  块${k + 1}（${g.length} 条 / ${new Set(g.flatMap((i) => st[i].arts)).size} 篇）`);
  g.forEach((i) => console.log(`     ${String(st[i].arts.length).padStart(2)}篇 [${st[i].id}] ${st[i].title.slice(0, 52)}`));
});
