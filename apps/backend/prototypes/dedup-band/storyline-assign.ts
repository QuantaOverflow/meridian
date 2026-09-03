/**
 * 【扔掉型原型】第 2 步：拿 P3 的主线，把 22 条 story 逐条归类。
 *
 * 前情：第 1 步已在 `storyline-input.ts` 修通——真实报道标题全量 + 分组 + 互斥约束（P3），
 * 万能筐 5/5 → 0/5，codex 四角全覆盖 0/5 → 3/5。这里验下游。
 *
 * 两处按上一轮的教训改掉：
 *   · **去掉 `0`（不属于本事件）选项**。上一轮它被当垃圾桶，扔掉 44% 文章的那轮读数最好看
 *     （错配只罚「放错筐」不罚「不放筐」）。聚类误入（2649 津巴布韦车祸）是上游的锅，
 *     这里强制归类，单独看它落在哪。
 *   · 输入不给机器标题，只给真实成员报道标题——与第 1 步同源。
 *
 * 指标给两个，因为贪心匹配对「细分」不公平：模型若把救援拆成「救援」+「国际援助」，
 * 两块都对应 codex 组2 但只有一块能被匹配上，另一块整块算错。
 *   · 错配/21：贪心最大重叠匹配，块数 >4 时偏悲观
 *   · pairwise P/R/F1：细分只压 recall，不冤枉 precision
 *
 * 验收（跑前定死）：错配 ≤2/21、各块 ≤30 篇、轮间稳定性 ≥90%。
 *
 * 跑法：npx tsx storyline-assign.ts [--rounds 2] [--conc 6]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const WORKER = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian/chat';
const WF = 'admin-brief-1788058777778';
const MODEL = '@cf/zai-org/glm-4.7-flash';
const CAP = 30;
const args = process.argv.slice(2);
const argOf = (f: string, d: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const ROUNDS = Number(argOf('--rounds', '2'));
const CONC = Number(argOf('--conc', '6'));

const CODEX: number[][] = [
  [2642, 2651, 2637], [2653, 2652, 2650, 2644, 2645],
  [2635, 2636, 2640, 2641, 2639, 2647, 2648], [2643, 2634, 2646, 2654, 2655, 2638],
];
const INTRUDER = 2649; // 聚类误入，无正确答案，不计错配

const DB = readFileSync('/Users/shiwenjie/Desktop/playground/projects/meridian/apps/frontend/.env', 'utf-8')
  .split('\n').find((l) => l.startsWith('NUXT_DATABASE_URL='))!.slice(18).replace(/"/g, '');
const psql = (q: string) => execFileSync('psql', [DB, '-At', '-F', '\t', '-c', q],
  { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }).trim().split('\n').filter(Boolean).map((l) => l.split('\t'));

const st = psql(`SELECT id, coalesce(article_ids::text,'[]') FROM brief_stories
  WHERE workflow_id='${WF}' AND cluster_id=47 AND centroid IS NOT NULL ORDER BY id`)
  .map((r) => ({ id: Number(r[0]), arts: JSON.parse(r[1]) as number[] }));
if (st.length !== 22) throw new Error(`卫生断言失败：期望 22 条 story，拿到 ${st.length}`);
const codexIds = new Set(CODEX.flat());
if (st.filter((s) => codexIds.has(s.id)).length !== 21 || st.some((s) => !codexIds.has(s.id) && s.id !== INTRUDER))
  throw new Error('卫生断言失败：22 条里应恰好 21 条在 codex 划分内，另一条是 2649');
const title = new Map<number, string>();
for (const r of psql(`SELECT id, coalesce(title,'') FROM articles WHERE id IN (${[...new Set(st.flatMap((s) => s.arts))].join(',')})`))
  title.set(Number(r[0]), r[1]);
const heads = (s: typeof st[0]) => s.arts.map((a) => title.get(a) ?? '').filter(Boolean);
const artsOf = (ids: number[]) => new Set(ids.flatMap((i) => st.find((s) => s.id === i)!.arts)).size;

// ── 第 1 步：P3（逐字取自 storyline-input.ts 的胜出臂）─────────────────────────
const grouped = st.map((s, i) => `[Group ${i + 1}] (${s.arts.length} reports)\n${heads(s).map((t) => `  - ${t}`).join('\n')}`).join('\n\n');
const LABEL_PROMPT = `Below are 91 news reports, nearly all from ONE news event.
A daily brief cannot spend many blocks on one event — it needs 3-5.

Propose 3-5 STORYLINES the brief should use. A storyline is one continuous piece of prose the
reader can read without feeling anything repeats. Name it by what it covers, not by the event.
Do NOT assign the reports yet.

Hard constraints:
- The storylines must be mutually exclusive. No two may cover the same material.
- Exactly ONE storyline must be a general overview of the event as a whole — its overall
  scale and progress. Reports that add nothing beyond that belong there. It is limited to
  what none of the other storylines cover, and may not restate their material.
- Every other storyline must be a specific angle: a question a reader would ask about this
  event that the overview does not answer.
- Do not join two different angles with "and" into one storyline. Two angles = two storylines.
- Do not split one angle into several storylines by an attribute of the people or places
  involved (nationality, region, organisation, age). If two storylines answer the same
  question about different subsets of actors, they are ONE storyline.

${grouped}

Output ONLY JSON:
{"storylines": [{"name": "<short name>", "covers": "<one clause: what belongs here>"}, ...]}`;

// ── 第 2 步：逐条归类，无 0 选项 ──────────────────────────────────────────────
/**
 * 每条 story 看到的主线顺序按其 id 确定性打乱。
 * 依据：泄漏版与泛化版共 4 轮，**巨块 4/4 次落在列表第 [1] 条**，与那条叫什么无关
 * （「总述」和「救援」都当过），是位置偏置不是语义。置换不含任何本案信息，天然泛化；
 * 用 id 做种子而非随机数，工作流重放仍确定。
 */
function permuteFor(id: number, n: number): number[] {
  const ord = Array.from({ length: n }, (_, i) => i);
  let h = id >>> 0;
  for (let i = n - 1; i > 0; i--) { // Fisher-Yates，种子 = story id 的 LCG
    h = (h * 1664525 + 1013904223) >>> 0;
    const j = h % (i + 1);
    [ord[i], ord[j]] = [ord[j], ord[i]];
  }
  return ord; // ord[展示位] = 原始下标
}

const pickPrompt = (s: typeof st[0], sl: any[]) => `A daily brief covers one big news event using these storylines:

${sl.map((a, i) => `[${i + 1}] ${a.name} — ${a.covers}`).join('\n')}

Which ONE storyline do the reports below belong to? Judge by the headlines themselves.
You must pick exactly one — answer with its number.

Pick the MOST SPECIFIC storyline that fits. Every report mentions the event itself — that is
what they all have in common, not what tells them apart. Choose a general-overview storyline
only when the reports add nothing beyond the event's overall scale or progress; if they answer
a narrower question that another storyline names, choose that one.

Reports:
${heads(s).map((t) => `  - ${t}`).join('\n')}

Output ONLY JSON: {"storyline": <1-${sl.length}>, "reason": "<one clause>"}`;

async function chat(prompt: string, maxTokens: number): Promise<any> {
  for (let k = 0; k < 3; k++) {
    const r = await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }],
        options: { provider: 'workers-ai', model: MODEL, temperature: 0, max_tokens: maxTokens, skipCache: true } }) });
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

const pk = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
const pairsOf = (part: number[][]) => new Set(part.flatMap((g) => g.flatMap((x, i) => g.slice(i + 1).map((y) => pk(x, y)))));
const codexPairs = pairsOf(CODEX);
/** 贪心最大重叠匹配的错配数（不含 2649）。块数 >4 时偏悲观，配 pairwise 一起看 */
function misassign(blocks: number[][]): number {
  const ov: Array<[number, number, number]> = [];
  blocks.forEach((g, gi) => CODEX.forEach((c, ci) => { const n = g.filter((i) => c.includes(i)).length; if (n) ov.push([n, gi, ci]); }));
  ov.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const ug = new Set<number>(), uc = new Set<number>(); let hit = 0;
  for (const [n, gi, ci] of ov) { if (ug.has(gi) || uc.has(ci)) continue; ug.add(gi); uc.add(ci); hit += n; }
  return 21 - hit;
}


{ // 卫生：prompt 不得含本案专有角度词——写死答案会让「四角全覆盖」这个指标自动变好
  const LEAK = /missing[- ]people|missing persons|rescue|casualt|glacier|glacial|flood|Nepal|Tibet|diaspora/i;
  const probe = LABEL_PROMPT.slice(0, LABEL_PROMPT.indexOf('[Group 1]'));
  const probe2 = pickPrompt(st[0], [{ name: 'X', covers: 'Y' }]).replace(/Reports:[\s\S]*/, '');
  for (const [tag, text] of [['第1步指令', probe], ['第2步指令', probe2]] as const) {
    const m = text.match(LEAK);
    if (m) throw new Error(`卫生断言失败：${tag}含本案专有词「${m[0]}」，指标会被泄漏污染`);
  }
}
// --label-only N：只跑第 1 步 N 次，人读挑一组主线；泛化后第 1 步只跑过 4 次，样本不够
const LABEL_ONLY = args.indexOf('--label-only') >= 0 ? Number(args[args.indexOf('--label-only') + 1]) : 0;
if (LABEL_ONLY) {
  const all: any[] = [];
  for (let k = 0; k < LABEL_ONLY; k++) {
    const o = await chat(LABEL_PROMPT, 900);
    const sl = (o?.storylines ?? []).filter((x: any) => x?.name);
    console.log(`── 第 ${k + 1} 次（${sl.length} 条）`);
    sl.forEach((x: any, i: number) => console.log(`   [${i + 1}] ${String(x.name).slice(0, 44).padEnd(46)} ← ${String(x.covers).slice(0, 70)}`));
    all.push(sl);
  }
  writeFileSync('storyline-labels-out.json', JSON.stringify(all, null, 1));
  process.exit(0);
}

console.log(`模型 ${MODEL}｜${ROUNDS} 轮｜第 1 步 P3 + 第 2 步逐条归类（无 0 选项）\n`);
const runs: any[] = [];
for (let k = 0; k < ROUNDS; k++) {
  const lo = await chat(LABEL_PROMPT, 900);
  const sl = (lo?.storylines ?? []).filter((x: any) => x?.name);
  if (sl.length < 2) { console.log(`--- 第 ${k + 1} 轮：⚠️ 主线生成失败`); continue; }
  console.log(`═══ 第 ${k + 1} 轮：${sl.length} 条主线`);
  sl.forEach((x: any, i: number) => console.log(`  [${i + 1}] ${String(x.name).slice(0, 44).padEnd(46)} ← ${String(x.covers).slice(0, 56)}`));

  const picks = await pool(st, CONC, async (s) => {
    const ord = permuteFor(s.id, sl.length);
    const shown = ord.map((i) => sl[i]);
    const o = await chat(pickPrompt(s, shown), 200);
    const n = Number(o?.storyline);
    const ok = Number.isInteger(n) && n >= 1 && n <= sl.length;
    return { id: s.id, pick: ok ? ord[n - 1] + 1 : null, shownAt: ok ? n : null, order: ord,
      reason: String(o?.reason ?? '') };
  });
  const failed = picks.filter((p) => p.pick === null);
  if (failed.length) console.log(`  ⚠️ ${failed.length}/22 条归类失败（三次重试后）：${failed.map((f) => f.id)}`);

  const blocks: number[][] = sl.map(() => []);
  picks.forEach((p) => { if (p.pick) blocks[p.pick - 1].push(p.id); });
  const used = blocks.filter((b) => b.length);
  const scored = used.map((b) => b.filter((x) => x !== INTRUDER)); // 指标不含误入者
  const mis = misassign(scored);
  const ap = pairsOf(scored);
  const tp = [...ap].filter((x) => codexPairs.has(x)).length;
  const P = ap.size ? tp / ap.size : 1, R = tp / codexPairs.size, F1 = P + R ? 2 * P * R / (P + R) : 0;
  const sizes = used.map(artsOf);
  console.log(`  划分 ${used.length} 块｜篇数 ${sizes.join(' ')}｜超 ${CAP} 篇 ${sizes.filter((x) => x > CAP).length} 块`);
  used.forEach((b, i) => console.log(`     ${String(artsOf(b)).padStart(2)}篇 [${String(sl[blocks.indexOf(b)]?.name ?? '').slice(0, 30)}] ${b.join(' ')}`));
  console.log(`  错配 ${mis}/21｜pairwise P/R/F1 = ${P.toFixed(2)}/${R.toFixed(2)}/${F1.toFixed(2)}` +
    `${used.length > 4 ? '（块数 >4，错配偏悲观）' : ''}`);
  { // 位置偏置读数：选中项在**展示列表**里的位次分布。均匀 = 无偏置
    const at = new Map<number, number>();
    picks.forEach((p) => { if (p.shownAt) at.set(p.shownAt, (at.get(p.shownAt) ?? 0) + 1); });
    console.log(`  被选中的展示位次：${[...at.entries()].sort((a, b) => a[0] - b[0])
      .map(([k, v]) => `第${k}位 ${v}条`).join('｜')}（均匀应各 ~${(22 / sl.length).toFixed(1)} 条）`);
  }
  const intr = picks.find((p) => p.id === INTRUDER)!;
  console.log(`  聚类误入 2649 落在：主线 ${intr.pick}「${String(sl[(intr.pick ?? 1) - 1]?.name ?? '').slice(0, 34)}」`);
  runs.push({ storylines: sl, picks, blocks: used, mis, P, R, F1, sizes });
  console.log('');
}
if (runs.length >= 2) {
  const same = (r: any, a: number, b: number) => r.blocks.some((g: number[]) => g.includes(a) && g.includes(b));
  const ids = st.map((s) => s.id).filter((x) => x !== INTRUDER);
  let agree = 0, tot = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    tot++; const v = runs.map((r) => same(r, ids[i], ids[j]));
    if (v.every((x) => x === v[0])) agree++;
  }
  console.log(`轮间稳定性：${agree}/${tot} = ${(agree / tot * 100).toFixed(0)}%`);
}
console.log(`\ncodex 人裁 4 组：${CODEX.map(artsOf).join(' ')} 篇，错配 0，超 ${CAP} 篇 0 块`);
console.log(`验收标准：错配 ≤2/21｜各块 ≤${CAP} 篇｜稳定性 ≥90%`);
writeFileSync('storyline-assign-out.json', JSON.stringify({ model: MODEL, rounds: ROUNDS, runs }, null, 1));
