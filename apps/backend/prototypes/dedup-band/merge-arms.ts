/**
 * 【扔掉型原型】⑤′ 在最坏样本上的三臂对照。
 *
 * 样本 report 76 (admin-brief-1788058777778)：尼泊尔碎成 20 条 story 那期。
 * 现行去重（cos ≥0.94 直接决定合并）只能把 20 条压到 10 条 —— 照样吃 10 个名额。
 *
 * ⑤′ 假设：cos 降级为提名（0.90），合不合由 LLM 逐对判，聚合另选。三件事分开量：
 *   ① 提名   0.90 带把该合的捞进候选没有（几何，零 LLM）
 *   ② 判决   LLM 逐对判的边对不对（落盘，统计，最终要人裁）
 *   ③ 聚合   同一批边跑三臂，看谁压得最对
 *
 * **判决落盘缓存**（key = 两条 story 的文章集）。改聚合、加臂、调阈值全部零 LLM
 * —— RARR 那轮吃过亏：改一次指标口径就要重跑几十分钟 LLM。
 *
 * 跑法：npx tsx merge-arms.ts [--wf <id>] [--band 0.90] [--conc 8] [--repeats 1]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getStoryMergeConfirmPrompt } from '../../../../services/meridian-ai-worker/src/prompts/storyMerge.js';

const WORKER = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian/chat';
const CACHE = new URL('./.cache/', import.meta.url).pathname;
const args = process.argv.slice(2);
const argOf = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const WF = argOf('--wf') ?? 'admin-brief-1788058777778';
const BAND = Number(argOf('--band') ?? '0.90');
const CONC = Number(argOf('--conc') ?? '8');
const REPEATS = Number(argOf('--repeats') ?? '1');
// 生产 collapseGroup 的文章上限（DEFAULT_ARTICLE_CAP=30，实测定的：91 篇 300 秒硬超时）
const CAP = Number(argOf('--cap') ?? '30');
mkdirSync(CACHE, { recursive: true });

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

interface Story { i: number; id: number; clusterId: number; imp: number; title: string; arts: number[] }
const rows = psql(`SELECT id, cluster_id, coalesce(importance,0), coalesce(title,''), coalesce(article_ids::text,'[]')
  FROM brief_stories WHERE workflow_id='${WF}' AND centroid IS NOT NULL ORDER BY id`);
const st: Story[] = rows.map((r, i) => ({ i, id: Number(r[0]), clusterId: Number(r[1]),
  imp: Number(r[2]), title: r[3], arts: JSON.parse(r[4]) as number[] }));
const byId = new Map(st.map((s) => [s.id, s]));

const allArts = [...new Set(st.flatMap((s) => s.arts))];
const artTitle = new Map<number, string>();
for (let i = 0; i < allArts.length; i += 400)
  for (const r of psql(`SELECT id, coalesce(title,'') FROM articles WHERE id IN (${allArts.slice(i, i + 400).join(',')})`))
    artTitle.set(Number(r[0]), r[1]);

const pr = psql(`SELECT a.id, b.id, (1-(a.centroid<=>b.centroid)) FROM brief_stories a
  JOIN brief_stories b ON b.workflow_id=a.workflow_id AND b.cluster_id=a.cluster_id AND a.id<b.id
  WHERE a.workflow_id='${WF}' AND a.centroid IS NOT NULL AND b.centroid IS NOT NULL
    AND (1-(a.centroid<=>b.centroid)) >= ${BAND}`);
const nominated = pr.map((r) => ({ a: byId.get(Number(r[0]))!.i, b: byId.get(Number(r[1]))!.i, cos: Number(r[2]) }));

const NEPAL = /nepal|himalay|glacial|trishuli|tibet|bhotekoshi|rasuwagadhi/i;
const nepal = st.filter((s) => NEPAL.test(s.title));
console.log(`${WF}\n${st.length} 条 story，尼泊尔相关 ${nepal.length} 条`);
console.log(`提名带 ≥${BAND}：${nominated.length} 对候选（同簇内）`);
{ // 卫生：0.90 带必须覆盖 0.94 带（超集），否则 SQL 写错了
  const n94 = nominated.filter((p) => p.cos >= 0.94).length;
  if (BAND <= 0.94 && n94 === 0) throw new Error('0.94 以上一对都没有，提名 SQL 可疑');
  console.log(`  其中 ≥0.94（现行带）${n94} 对，0.90-0.94 新增 ${nominated.length - n94} 对\n`);
}

const key = (p: { a: number; b: number }) =>
  `${[...st[p.a].arts].sort().join(',')}|${[...st[p.b].arts].sort().join(',')}`;
const CACHE_FILE = `${CACHE}verdicts_${WF}_b${BAND}.json`;
const cache: Record<string, { yes: number; n: number }> = existsSync(CACHE_FILE)
  ? JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) : {};

async function chat(prompt: string): Promise<any> {
  const r = await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }],
      options: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, max_tokens: 300, skipCache: true } }) });
  const j: any = await r.json();
  try { return JSON.parse((j?.data?.choices?.[0]?.message?.content ?? '').match(/\{[\s\S]*\}/)?.[0] ?? '{}'); }
  catch { return {}; }
}
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let cur = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (cur < items.length) {
      await fn(items[cur++]);
      if (++done % 20 === 0) process.stderr.write(`  ${done}/${items.length}\n`);
    }
  }));
}

const todo = nominated.filter((p) => !cache[key(p)] || cache[key(p)].n < REPEATS);
console.log(`判决：${nominated.length} 对，缓存命中 ${nominated.length - todo.length}，待打 ${todo.length}`);
if (todo.length) {
  await pool(todo, CONC, async (p) => {
    const cands = [p.a, p.b].map((i) => ({ title: st[i].title,
      articleTitles: st[i].arts.map((id) => artTitle.get(id) ?? '').filter(Boolean).slice(0, 4) }));
    let yes = 0;
    for (let k = 0; k < REPEATS; k++) if ((await chat(getStoryMergeConfirmPrompt(cands))).same_occurrence === true) yes++;
    cache[key(p)] = { yes, n: REPEATS };
  });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
}
const yesEdge = new Set(nominated.filter((p) => cache[key(p)].yes > REPEATS / 2).map((p) => `${Math.min(p.a,p.b)}-${Math.max(p.a,p.b)}`));
console.log(`LLM 判「同一发生」：${yesEdge.size}/${nominated.length} 对\n`);

const linked = (a: number, b: number) => yesEdge.has(`${Math.min(a, b)}-${Math.max(a, b)}`);
const cosOf = new Map(nominated.map((p) => [`${Math.min(p.a,p.b)}-${Math.max(p.a,p.b)}`, p.cos]));
const cosine = (a: number, b: number) => cosOf.get(`${Math.min(a, b)}-${Math.max(a, b)}`) ?? 0;

// yes 边的连通分量：三臂各自在分量内划分（分量之间本来就没边，不必比较）
const comps = (() => {
  const par = new Map(st.map((s) => [s.i, s.i]));
  const find = (x: number): number => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x)!)!); x = par.get(x)!; } return x; };
  for (const p of nominated) if (linked(p.a, p.b)) par.set(find(p.a), find(p.b));
  const g = new Map<number, number[]>();
  for (const s of st) { const r = find(s.i); (g.get(r) ?? g.set(r, []).get(r)!).push(s.i); }
  return [...g.values()].filter((c) => c.length > 1);
})();
console.log(`yes 边连通分量：${comps.length} 个，最大 ${Math.max(...comps.map((c) => c.length), 0)} 条\n`);

// ── 容量约束 ─────────────────────────────────────────────────────────────────
// 生产 collapseGroup 把合并后的文章按时间均匀抽到 30 篇，超出的**直接丢**。抽样对题材是盲的：
// "death toll rises" 有几十篇，抽掉一批主干还在；"两份报告几个月前就预警过" 只有 2 篇，
// 可能一篇不剩。所以「合并不丢内容」不成立。三臂原本都没有这个约束，这里补上。
// 组的篇数按**文章 id 并集**算，不是各成员篇数相加（成员间理论上不重叠，但别靠假设）。
const artsOf = (g: number[]) => new Set(g.flatMap((i) => st[i].arts));
const sizeOf = (g: number[]) => artsOf(g).size;
/** 生产口径的抽样损失：只有合并组过 collapseGroup，单条 story 不截 */
const dropOf = (gs: number[][]) => gs.filter((g) => g.length > 1).reduce((n, g) => n + Math.max(0, sizeOf(g) - CAP), 0);

/** 全链：组内每对都 yes 才合，且并起来不超 cap。以组间最小 cos 作优先级，确定性 */
function complete(comp: number[], cap: number): number[][] {
  let gs = comp.map((i) => [i]);
  for (;;) {
    let best: [number, number] | null = null, bestV = -1;
    for (let a = 0; a < gs.length; a++) for (let b = a + 1; b < gs.length; b++) {
      if (sizeOf(gs[a].concat(gs[b])) > cap) continue; // 容量约束
      let ok = true, mn = 1;
      outer: for (const x of gs[a]) for (const y of gs[b]) {
        if (!linked(x, y)) { ok = false; break outer; }
        mn = Math.min(mn, cosine(x, y));
      }
      if (ok && mn > bestV) { bestV = mn; best = [a, b]; }
    }
    if (!best) break;
    gs[best[0]] = gs[best[0]].concat(gs[best[1]]); gs.splice(best[1], 1);
  }
  return gs;
}
/** star/CENTER：yes 度数最高者当中心，直连的按 cos 降序并入，装不下的留给下一轮 */
function star(comp: number[], cap: number): number[][] {
  const left = new Set(comp); const out: number[][] = [];
  while (left.size) {
    let hub = -1, deg = -1;
    for (const x of [...left].sort((p, q) => p - q)) {
      const d = [...left].filter((y) => y !== x && linked(x, y)).length;
      if (d > deg) { deg = d; hub = x; }
    }
    const nbrs = [...left].filter((y) => y !== hub && linked(hub, y))
      .sort((p, q) => cosine(hub, q) - cosine(hub, p) || p - q);
    const g = [hub];
    for (const y of nbrs) if (sizeOf(g.concat(y)) <= cap) g.push(y);
    g.sort((a, b) => a - b);
    g.forEach((x) => left.delete(x)); out.push(g);
  }
  return out;
}
/** quorum：分量内 yes 率 ≥2/3 且装得下则整体合并，否则退 star */
function quorum(comp: number[], cap: number): number[][] {
  let tot = 0, yes = 0;
  for (let i = 0; i < comp.length; i++) for (let j = i + 1; j < comp.length; j++) { tot++; if (linked(comp[i], comp[j])) yes++; }
  return tot && yes / tot >= 2 / 3 && sizeOf(comp) <= cap ? [comp.slice().sort((a, b) => a - b)] : star(comp, cap);
}

// ── 人裁对照 ─────────────────────────────────────────────────────────────────
// codex 读者评审（2026-09-02）在读完**全部成员报道标题**后给出的 4 组划分，按 brief_stories.id。
// ⚠️ 对照，不是金标：一个读者一次裁定，没有第二人复核，别拿它当真值报精度。
const CODEX_4: number[][] = [
  [2642, 2651, 2637],                                     // 灾情总述与进展
  [2653, 2652, 2650, 2644, 2645],                         // 成因、堰塞湖与复盘
  [2635, 2636, 2640, 2641, 2639, 2647, 2648],             // 救援、基础设施与援助
  [2643, 2634, 2646, 2654, 2655, 2638],                   // 跨国失踪者与家属
];
const codexIdx = CODEX_4.map((g) => g.map((id) => {
  const s = byId.get(id);
  if (!s) throw new Error(`卫生断言失败：codex 划分里的 story ${id} 不在本期数据里`);
  return s.i;
}));
const nIdx = new Set(codexIdx.flat());                   // 尼泊尔全集 = codex 覆盖的 21 条
{ // 卫生：标题正则命中的应当是 codex 全集的子集，否则两边口径对不上
  const missed = nepal.filter((s) => !nIdx.has(s.i)).map((s) => s.id);
  if (missed.length) throw new Error(`卫生断言失败：正则命中但不在 codex 划分里 ${missed}`);
  console.log(`尼泊尔全集取 codex 覆盖的 ${nIdx.size} 条（标题正则只认出 ${nepal.length} 条，差额已核对为子集）\n`);
}

const pairKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
const pairsOf = (part: number[][]) => new Set(part.flatMap((g) =>
  g.flatMap((x, i) => g.slice(i + 1).map((y) => pairKey(x, y)))));
const codexPairs = pairsOf(codexIdx);

// 可达性上界：三臂只能在 yes 边的连通分量内部划分，所以 codex 组内的对必须是 yes 边才合得出来。
{
  const inside = [...codexPairs];
  const nom = inside.filter((k) => cosOf.has(k)).length;
  const yes = inside.filter((k) => yesEdge.has(k)).length;
  const cross: string[] = [];
  const all = [...nIdx];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const k = pairKey(all[i], all[j]);
    if (!codexPairs.has(k) && yesEdge.has(k)) cross.push(k);
  }
  console.log('=== 可达性上界（三臂能不能走到 codex 那个划分）===');
  console.log(`  codex 组内对 ${inside.length}：提名带覆盖 ${nom}，判 yes ${yes}（缺一条边，全链就合不出那组）`);
  console.log(`  codex 跨组对判 yes ${cross.length}（这些是把 codex 的组黏回去的力量，只能靠 cap 或阈值挡）`);
  const blocked = inside.filter((k) => !yesEdge.has(k));
  if (blocked.length) {
    console.log(`  ↓ 卡住全链的 ${blocked.length} 条组内非 yes 边：`);
    for (const k of blocked.slice(0, 12)) {
      const [a, b] = k.split('-').map(Number);
      const c = cosOf.get(k);
      console.log(`    cos=${c === undefined ? ' 未提名' : c.toFixed(4)}  ${st[a].title.slice(0, 40)} × ${st[b].title.slice(0, 40)}`);
    }
  }
  console.log('');
}

/**
 * 逐条错配数：每个臂的组贪心匹配到重叠最大的 codex 组（每组只配一次），没被匹配上的条数。
 * pairwise F1 对大组过于敏感（一个 9 条的组贡献 36 对），这个指标直接回答「差在哪几条」。
 */
function misassign(part: number[][]): number {
  const gs = part.map((g) => g.filter((i) => nIdx.has(i))).filter((g) => g.length);
  const ov: Array<[number, number, number]> = [];
  gs.forEach((g, gi) => codexIdx.forEach((c, ci) => {
    const n = g.filter((i) => c.includes(i)).length;
    if (n) ov.push([n, gi, ci]);
  }));
  ov.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]); // 并列按下标，确定性
  const ug = new Set<number>(), uc = new Set<number>();
  let hit = 0;
  for (const [n, gi, ci] of ov) { if (ug.has(gi) || uc.has(ci)) continue; ug.add(gi); uc.add(ci); hit += n; }
  return nIdx.size - hit;
}

const ARMS = [['全链', complete], ['star', star], ['quorum', quorum]] as const;
const singles = st.filter((s) => !comps.some((c) => c.includes(s.i))).map((s) => [s.i]);
/** 一个臂在给定 cap 下的**全期完整划分**（含单条），拿它算指标才不会漏掉被拆成单条的 story */
const partOf = (fn: (c: number[], cap: number) => number[][], cap: number) => [...comps.flatMap((c) => fn(c, cap)), ...singles];

console.log('臂        cap    合并组  全期故事    尼泊尔    最大组(条/篇)   抽样丢弃篇  vs codex P/R/F1   错配条');
for (const cap of [Infinity, CAP]) {
  for (const [name, fn] of ARMS) {
    const part = partOf(fn, cap);
    const merged = part.filter((g) => g.length > 1);
    const nParts = part.filter((g) => g.some((i) => nIdx.has(i)));
    const armPairs = pairsOf(part.map((g) => g.filter((i) => nIdx.has(i))));
    const tp = [...armPairs].filter((k) => codexPairs.has(k)).length;
    const p = armPairs.size ? tp / armPairs.size : 1;
    const r = tp / codexPairs.size;
    const f1 = p + r ? (2 * p * r) / (p + r) : 0;
    const mostSt = Math.max(...merged.map((g) => g.length), 0);
    const mostArt = Math.max(...merged.map(sizeOf), 0);
    console.log(`${name.padEnd(8)} ${(cap === Infinity ? '无' : String(cap)).padStart(4)} ` +
      `${String(merged.length).padStart(6)} ${String(st.length).padStart(6)} → ${String(part.length).padStart(3)} ` +
      `${String(nIdx.size).padStart(7)} → ${String(nParts.length).padStart(2)} ` +
      `${String(mostSt).padStart(9)}/${String(mostArt).padEnd(3)} ` +
      `${String(dropOf(part)).padStart(9)}   ` +
      `${p.toFixed(2)}/${r.toFixed(2)}/${f1.toFixed(2)}` +
      `   ${String(misassign(part)).padStart(2)}/${nIdx.size}`);
  }
}
console.log(`\ncodex 人裁 4 组本身：尼泊尔 ${nIdx.size} → 4，最大组 ${Math.max(...codexIdx.map(sizeOf))} 篇，抽样丢弃 ${dropOf(codexIdx)} 篇`);

console.log(`\n=== 尼泊尔划分明细（cap=${CAP}）===`);
for (const [name, fn] of ARMS) {
  console.log(`\n--- ${name} ---`);
  partOf(fn, CAP).filter((g) => g.some((i) => nIdx.has(i)))
    .forEach((g, k) => {
      console.log(`  组${k + 1}（${g.length} 条 / ${sizeOf(g)} 篇）`);
      g.forEach((i) => console.log(`     ${String(st[i].arts.length).padStart(2)}篇 [${st[i].id}] ${st[i].title.slice(0, 52)}`));
    });
}
console.log('\n--- codex 人裁 4 组 ---');
codexIdx.forEach((g, k) => {
  console.log(`  组${k + 1}（${g.length} 条 / ${sizeOf(g)} 篇）`);
  g.forEach((i) => console.log(`     ${String(st[i].arts.length).padStart(2)}篇 [${st[i].id}] ${st[i].title.slice(0, 52)}`));
});

writeFileSync('merge-arms-out.json', JSON.stringify({
  wf: WF, band: BAND, cap: CAP, nominated: nominated.length, yesEdges: yesEdge.size,
  arms: Object.fromEntries([Infinity, CAP].flatMap((cap) => ARMS.map(([n, fn]) =>
    [`${n}_cap${cap === Infinity ? 'none' : cap}`, partOf(fn, cap).filter((g) => g.length > 1)
      .map((g) => ({ arts: sizeOf(g), members: g.map((i) => ({ id: st[i].id, t: st[i].title, arts: st[i].arts.length })) }))]))),
  codex4: codexIdx.map((g) => ({ arts: sizeOf(g), members: g.map((i) => ({ id: st[i].id, t: st[i].title, arts: st[i].arts.length })) })),
}, null, 1));
