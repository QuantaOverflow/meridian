/**
 * 【扔掉型原型】去重层的候选带该不该放宽？≥3 条的组该不该也问 LLM？
 *
 * 现状（story-dedup.ts + ai-worker /meridian/story/merge-check）：
 *   ① 同簇内 cos ≥ 0.94 的配对进入候选
 *   ② 单链聚合成组
 *   ③ 两条一组 → 问 LLM「是不是同一个发生」，能否决
 *      ≥3 条一组 → 只起标题，判定恒 true，**不能否决**
 *
 * 两个疑问：
 *   Q1「≥3 条边互相印证所以不用问」这个前提成立吗？单链有传递性，A↔B、B↔C 过线
 *      而 A↮C 也会成一组。已知发作过（中东伞：霍尔木兹谈判/卡塔尔斡旋/六个月盘点）。
 *   Q2 候选带 0.94 太紧吗？Modi 中亚行那组卡在 0.907-0.935，从没被问过，
 *      结果简报里两块讲同一趟出访。
 *
 * 无金标（2026-08-30 那 94 条人工标注没留下文件），所以**不报准确率**，只报：
 *   · 链式诊断（零 LLM，跨多期）：≥3 组的最小边 vs 组内全对最小，看组大是不是靠链
 *   · 决策差异（LLM）：现状会合的组里 LLM 否几个 / 新进候选带的组里 LLM 认几个
 * 翻转的组逐条打印标题，由人裁。
 *
 * 跑法：
 *   cd apps/backend/prototypes/dedup-band
 *   pnpm i --ignore-workspace
 *   pnpm probe                       # 只做链式诊断，零 LLM，跨多期
 *   pnpm probe --llm --wf <id>       # 加 LLM 臂（默认 2 轮）
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildMergeGroups, type CosinePair, type DedupStory } from '../../src/lib/core/story-dedup.js';
import { getStoryMergeConfirmPrompt } from '../../../../services/meridian-ai-worker/src/prompts/storyMerge.js';

const WORKER = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian/chat';
const CACHE = new URL('./.cache/', import.meta.url).pathname;
const args = process.argv.slice(2);
const argOf = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const USE_LLM = args.includes('--llm');
const REPEATS = Number(argOf('--repeats') ?? '2');
const CONC = Number(argOf('--conc') ?? '4');
const NRUNS = Number(argOf('--runs') ?? '6');
const ONE_WF = argOf('--wf');
const BANDS = [0.94, 0.92, 0.9];

mkdirSync(CACHE, { recursive: true });
const DB = readFileSync(new URL('../../../frontend/.env', import.meta.url).pathname, 'utf-8')
  .split('\n').find((l) => l.startsWith('NUXT_DATABASE_URL='))!.slice('NUXT_DATABASE_URL='.length).replace(/"/g, '');

const psql = (sql: string) =>
  execFileSync('psql', [DB, '-At', '-F', '\t', '-c', sql], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
    .trim().split('\n').filter(Boolean).map((l) => l.split('\t'));

interface Run { wf: string; stories: DedupStory[]; pairs: CosinePair[]; titles: string[]; artTitles: string[][] }

function loadRun(wf: string): Run {
  const f = `${CACHE}${wf}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf-8'));
  const rows = psql(`SELECT id, cluster_id, coalesce(importance,0), coalesce(title,''), coalesce(article_ids::text,'[]')
    FROM brief_stories WHERE workflow_id='${wf}' AND centroid IS NOT NULL ORDER BY id`);
  const idToIdx = new Map(rows.map((r, i) => [Number(r[0]), i]));
  const stories: DedupStory[] = rows.map((r, i) => ({
    index: i, clusterId: Number(r[1]), importance: Number(r[2]),
    articleIds: JSON.parse(r[4]) as number[], title: r[3],
  }));
  // 同簇内**全部**配对（不筛 cos）：链式诊断要看组内那些没过线的边
  const pr = psql(`SELECT a.id, b.id, (1-(a.centroid<=>b.centroid))
    FROM brief_stories a JOIN brief_stories b
      ON b.workflow_id=a.workflow_id AND b.cluster_id=a.cluster_id AND a.id<b.id
    WHERE a.workflow_id='${wf}' AND a.centroid IS NOT NULL AND b.centroid IS NOT NULL`);
  const pairs: CosinePair[] = pr.map((r) => ({ a: idToIdx.get(Number(r[0]))!, b: idToIdx.get(Number(r[1]))!, cos: Number(r[2]) }));
  // 成员报道标题：LLM 判「同一个发生」靠它，不是靠 story 标题
  const arts = new Map<number, string>();
  const ids = [...new Set(stories.flatMap((s) => s.articleIds))];
  for (let i = 0; i < ids.length; i += 500) {
    for (const r of psql(`SELECT id, coalesce(title,'') FROM articles WHERE id IN (${ids.slice(i, i + 500).join(',') || '0'})`))
      arts.set(Number(r[0]), r[1]);
  }
  const run: Run = {
    wf, stories, pairs, titles: stories.map((s) => s.title),
    artTitles: stories.map((s) => s.articleIds.map((id) => arts.get(id) ?? '').filter(Boolean).slice(0, 4)),
  };
  writeFileSync(f, JSON.stringify(run));
  return run;
}

/** 组内全部成员两两余弦的最小值——单链只保证「链上每条边」过线，管不到这个。 */
function allPairMin(g: number[], pairs: CosinePair[]): number {
  const inside = new Set(g);
  const m = new Map<string, number>();
  for (const p of pairs) if (inside.has(p.a) && inside.has(p.b)) m.set(`${p.a}-${p.b}`, p.cos);
  let min = 1;
  for (let i = 0; i < g.length; i++)
    for (let j = i + 1; j < g.length; j++)
      min = Math.min(min, m.get(`${Math.min(g[i], g[j])}-${Math.max(g[i], g[j])}`) ?? 0);
  return min;
}

// ===========================================================================
// ① 链式诊断（零 LLM）
// ===========================================================================
const wfs = ONE_WF ? [ONE_WF] : psql(
  `SELECT workflow_id FROM brief_stories GROUP BY 1 HAVING count(centroid)>0 ORDER BY 1 DESC LIMIT ${NRUNS}`
).map((r) => r[0]);

const runs = wfs.map(loadRun);
console.log(`\n=== ① 链式诊断（${runs.length} 期，零 LLM）===`);
console.log('阈值  期  配对  组数  其中≥3  ≥3组里"全对最小<阈值"的  最糟一组(链上最小 → 全对最小)');
for (const band of BANDS) {
  let np = 0, ng = 0, nBig = 0, nChained = 0, worst = { d: 0, s: '' };
  for (const r of runs) {
    const kept = r.pairs.filter((p) => p.cos >= band);
    np += kept.length;
    const gs = buildMergeGroups(r.stories, kept, band);
    ng += gs.length;
    for (const g of gs) {
      if (g.indices.length < 3) continue;
      nBig++;
      const apm = allPairMin(g.indices, r.pairs);
      if (apm < band) nChained++;
      if (g.minCos - apm > worst.d)
        worst = { d: g.minCos - apm, s: `${g.indices.length}条 ${g.minCos.toFixed(4)} → ${apm.toFixed(4)}` };
    }
  }
  console.log(
    `${band.toFixed(2)}  ${String(runs.length).padStart(2)} ${String(np).padStart(6)} ${String(ng).padStart(5)} ` +
    `${String(nBig).padStart(7)} ${String(nChained).padStart(24)}   ${worst.s}`
  );
}

if (!USE_LLM) { console.log('\n（加 --llm 跑决策差异臂）'); process.exit(0); }

// ===========================================================================
// ② LLM 臂：对 0.90 候选带下的**每个**组问一次（含 ≥3）
// ===========================================================================
/**
 * ≥3 条的组生产里没有确认 prompt（只有起标题的）。这里对生产的两条版做最小字面改写，
 * 不复制判准正文——判准跟着生产走，改了这边自动跟。
 */
function confirmPromptN(cands: Array<{ title: string; articleTitles: string[] }>): string {
  const base = getStoryMergeConfirmPrompt(cands);
  if (cands.length === 2) return base;
  const out = base
    .replace('Two news stories below were produced', `${cands.length} news stories below were produced`)
    .replace('Decide whether they report the SAME occurrence.', 'Decide whether they ALL report the SAME occurrence.')
    .replace('give ONE title covering both', 'give ONE title covering all of them');
  if (out === base) throw new Error('≥3 prompt 改写没生效——生产 prompt 措辞变了');
  return out;
}

async function chat(prompt: string): Promise<any> {
  const r = await fetch(WORKER, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      options: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, max_tokens: 300, skipCache: true },
    }),
  });
  const j: any = await r.json();
  const c = j?.data?.choices?.[0]?.message?.content ?? '';
  try { return JSON.parse(c.match(/\{[\s\S]*\}/)?.[0] ?? '{}'); } catch { return {}; }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cur = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (cur < items.length) { const i = cur++; out[i] = await fn(items[i]); }
  }));
  return out;
}

for (const r of runs) {
  const wide = buildMergeGroups(r.stories, r.pairs.filter((p) => p.cos >= 0.9), 0.9);
  const nowKeys = new Set(
    buildMergeGroups(r.stories, r.pairs.filter((p) => p.cos >= 0.94), 0.94).map((g) => g.indices.join(','))
  );
  console.log(`\n=== ② 决策差异 · ${r.wf} ===`);
  console.log(`0.94 候选带 ${nowKeys.size} 组 → 0.90 候选带 ${wide.length} 组，逐组问 LLM ×${REPEATS}\n`);

  const verdicts = await pool(wide, CONC, async (g) => {
    const cands = g.indices.map((i) => ({ title: r.titles[i], articleTitles: r.artTitles[i] }));
    const votes: boolean[] = [];
    for (let k = 0; k < REPEATS; k++) votes.push((await chat(confirmPromptN(cands))).same_occurrence === true);
    return { g, yes: votes.filter(Boolean).length };
  });

  const isNow = (g: { indices: number[] }) => nowKeys.has(g.indices.join(','));
  const rows = verdicts.map((v) => ({
    ...v,
    now: isNow(v.g) ? (v.g.indices.length >= 3 ? '现状:自动合(不问)' : '现状:问过') : '现状:不在候选',
    nowMerge: isNow(v.g),           // 现状会不会合（≥3 恒合；2 条组现状也问，结论同 LLM）
    newMerge: v.yes > REPEATS / 2,  // 新方案：多数票
  }));

  const silentBad = rows.filter((x) => x.g.indices.length >= 3 && isNow(x.g) && !x.newMerge);
  const newlyOk = rows.filter((x) => !isNow(x.g) && x.newMerge);
  console.log(`≥3 组现状自动合、问了 LLM 却说不该合： ${silentBad.length} 组   ← 现在在静默合错`);
  console.log(`新进候选带且 LLM 说该合：            ${newlyOk.length} 组   ← 现在在漏合`);
  for (const x of [...silentBad, ...newlyOk]) {
    console.log(`\n  [${x.now}] ${x.g.indices.length} 条 · 链上最小 ${x.g.minCos.toFixed(4)} · 全对最小 ${allPairMin(x.g.indices, r.pairs).toFixed(4)} · 赞成 ${x.yes}/${REPEATS}`);
    x.g.indices.forEach((i) => console.log(`      ${r.titles[i]}`));
  }
}

// ===========================================================================
// ③ --pairwise：整组一问 vs 两两问
//
// ② 的结果是「≥3 组问了也全说同意」，包括明显不该合的（关税 × 湖改名）。
// 两种解释：判官在多条组上就是橡皮图章 / 还是我那份 N 条改写太弱。
// 分辨办法：对同一批组的**每一对**用**生产原版两条 prompt** 问一遍。
// 两条 prompt 若能说 no，问题在 N 条通道；若也说 yes，问题在判官本身。
// ===========================================================================
if (args.includes('--pairwise')) {
  for (const r of runs) {
    const wide = buildMergeGroups(r.stories, r.pairs.filter((p) => p.cos >= 0.9), 0.9)
      .filter((g) => g.indices.length >= 3);
    const cosOf = new Map(r.pairs.map((p) => [`${p.a}-${p.b}`, p.cos]));
    console.log(`\n=== ③ 两两确认 · ${r.wf} · ${wide.length} 组 ===`);
    for (const g of wide) {
      const ps: Array<[number, number]> = [];
      for (let i = 0; i < g.indices.length; i++)
        for (let j = i + 1; j < g.indices.length; j++) ps.push([g.indices[i], g.indices[j]]);
      const vf = `${CACHE}pairs_${r.wf}_${g.indices.join('-')}_x${REPEATS}.json`;
      const res: Array<{ a: number; b: number; yes: number }> = existsSync(vf)
        ? JSON.parse(readFileSync(vf, 'utf-8'))
        : await pool(ps, CONC, async ([a, b]) => {
            const cands = [a, b].map((i) => ({ title: r.titles[i], articleTitles: r.artTitles[i] }));
            let yes = 0;
            for (let k = 0; k < REPEATS; k++) if ((await chat(getStoryMergeConfirmPrompt(cands))).same_occurrence === true) yes++;
            return { a, b, yes };
          });
      if (!existsSync(vf)) writeFileSync(vf, JSON.stringify(res));
      const agree = res.filter((x) => x.yes > REPEATS / 2).length;
      console.log(`\n  ${g.indices.length} 条组 · ${ps.length} 对 · 两两判"同一发生" ${agree}/${ps.length} · 整组一问的结论见 ②`);
      for (const x of res.slice().sort((p, q) => p.yes - q.yes).slice(0, 4)) {
        const c = cosOf.get(`${Math.min(x.a, x.b)}-${Math.max(x.a, x.b)}`) ?? 0;
        console.log(`     ${x.yes}/${REPEATS} cos=${c.toFixed(4)}  ${r.titles[x.a].slice(0, 44)}  ×  ${r.titles[x.b].slice(0, 44)}`);
      }
      // 把 LLM 的两两判决当作边，重新聚合：cos 只决定"问哪些对"，聚合完全交给判决。
      // 全链 = 组内每一对都得同意，才是一个组（现状是 cos 单链，链上过线即可）。
      const yesEdge = new Set(res.filter((x) => x.yes > REPEATS / 2).map((x) => `${x.a}-${x.b}`));
      const linked = (a: number, b: number) => yesEdge.has(`${Math.min(a, b)}-${Math.max(a, b)}`);
      const remaining = [...g.indices];
      const cliques: number[][] = [];
      while (remaining.length) {
        const seed = remaining.shift()!;
        const cl = [seed];
        for (let i = remaining.length - 1; i >= 0; i--)
          if (cl.every((m) => linked(m, remaining[i]))) { cl.push(remaining[i]); remaining.splice(i, 1); }
        cliques.push(cl.sort((a, b) => a - b));
      }
      console.log(`     → LLM 边 + 全链聚合：${g.indices.length} 条 拆成 ${cliques.length} 组 ` +
        `[${cliques.map((c) => c.length).join('+')}]`);
      for (const c of cliques) console.log(`         {${c.map((i) => r.titles[i].slice(0, 40)).join(' | ')}}`);
    }
  }
}
