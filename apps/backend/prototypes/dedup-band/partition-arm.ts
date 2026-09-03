/**
 * 【扔掉型原型】A3：一次性全局划分，不逐对判。
 *
 * 为什么（A2 负结果推出来的）：「该不该写进同一段」**不是等价关系**——伤亡数字↔搜救进展
 * 同段、搜救进展↔隧道救援同段，但首尾两个未必同段。逐对问 + 全链聚合强行要传递性，
 * 结果 A2 把 21 条碎成 9 块、错配 10/21，还把标题逐字相同的 Karnataka 重复对判成不同段。
 * codex 分对的真正原因是它**一次读完全部 21 条做全局划分**，不是逐对。
 *
 * 跑 REPEATS 次看稳定性（temperature 0 也未必确定，判官非确定性是老问题）。
 *
 * 跑法：npx tsx partition-arm.ts [--repeats 3] [--model @cf/zai-org/glm-4.7-flash]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const WORKER = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian/chat';
const WF = 'admin-brief-1788058777778';
const args = process.argv.slice(2);
const argOf = (f: string, d: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const REPEATS = Number(argOf('--repeats', '3'));
const MODEL = argOf('--model', '@cf/zai-org/glm-4.7-flash');

const CODEX_4: number[][] = [
  [2642, 2651, 2637], [2653, 2652, 2650, 2644, 2645],
  [2635, 2636, 2640, 2641, 2639, 2647, 2648], [2643, 2634, 2646, 2654, 2655, 2638],
];
const IDS = CODEX_4.flat();

const DB = readFileSync(new URL('../../../frontend/.env', import.meta.url).pathname, 'utf-8')
  .split('\n').find((l) => l.startsWith('NUXT_DATABASE_URL='))!.slice(18).replace(/"/g, '');
const psql = (q: string) => execFileSync('psql', [DB, '-At', '-F', '\t', '-c', q],
  { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }).trim().split('\n').filter(Boolean).map((l) => l.split('\t'));

const st = psql(`SELECT id, coalesce(title,''), coalesce(article_ids::text,'[]') FROM brief_stories
  WHERE workflow_id='${WF}' AND id IN (${IDS.join(',')}) ORDER BY id`)
  .map((r) => ({ id: Number(r[0]), title: r[1], arts: JSON.parse(r[2]) as number[] }));
if (st.length !== IDS.length) throw new Error(`卫生断言失败：取到 ${st.length} 条，期望 ${IDS.length}`);

const artTitle = new Map<number, string>();
for (const r of psql(`SELECT id, coalesce(title,'') FROM articles WHERE id IN (${[...new Set(st.flatMap((s) => s.arts))].join(',')})`))
  artTitle.set(Number(r[0]), r[1]);

const block = st.map((s) =>
  `[${s.id}] ${s.title}  (${s.arts.length} reports)\n${s.arts.map((a) => `    - ${artTitle.get(a) ?? ''}`).filter((l) => l.trim() !== '-').join('\n')}`
).join('\n\n');

const PROMPT = `Below are ${st.length} auto-generated stories, all from ONE news event. They over-split
it: a daily brief cannot spend ${st.length} blocks on one event.

Group them into 3-5 blocks for the brief. Each block becomes one continuous piece of prose
with ONE angle, so a reader can read the blocks in sequence without feeling anything repeats.

Rules:
- Every story id must appear in exactly one block. Do not drop or duplicate any.
- Judge by the member report headlines, NOT the story titles — the titles are
  auto-generated and often mislabel the angle.
- A block must be under 30 reports total (the count is in parentheses).
- Name each block by its angle, not by the event.

${block}

Output ONLY JSON:
{"blocks": [{"name": "<angle>", "ids": [<story ids>]}, ...]}`;

async function chat(): Promise<any> {
  const r = await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: PROMPT }],
      options: { provider: 'workers-ai', model: MODEL, temperature: 0, max_tokens: 1500, skipCache: true } }) });
  const j: any = await r.json();
  const raw = j?.data?.choices?.[0]?.message?.content ?? '';
  try { return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}'); } catch { return { _raw: raw.slice(0, 400) }; }
}

const grp = new Map<number, number>(CODEX_4.flatMap((g, gi) => g.map((id) => [id, gi] as [number, number])));
const artsOf = (ids: number[]) => new Set(ids.flatMap((id) => st.find((s) => s.id === id)!.arts)).size;
function misassign(blocks: number[][]): number {
  const ov: Array<[number, number, number]> = [];
  blocks.forEach((g, gi) => CODEX_4.forEach((c, ci) => { const n = g.filter((i) => c.includes(i)).length; if (n) ov.push([n, gi, ci]); }));
  ov.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const ug = new Set<number>(), uc = new Set<number>(); let hit = 0;
  for (const [n, gi, ci] of ov) { if (ug.has(gi) || uc.has(ci)) continue; ug.add(gi); uc.add(ci); hit += n; }
  return IDS.length - hit;
}

console.log(`模型 ${MODEL}，${REPEATS} 轮，prompt ${PROMPT.length} 字符\n`);
const runs: any[] = [];
for (let k = 0; k < REPEATS; k++) {
  const o = await chat();
  const blocks: number[][] = (o?.blocks ?? []).map((b: any) => (b.ids ?? []).map(Number).filter((x: number) => IDS.includes(x)));
  const names: string[] = (o?.blocks ?? []).map((b: any) => String(b.name ?? ''));
  const flat = blocks.flat();
  // 划分合法性：每个 id 恰好一次。不合法就如实报，别悄悄修
  const dup = flat.filter((x, i) => flat.indexOf(x) !== i);
  const miss = IDS.filter((x) => !flat.includes(x));
  const legal = dup.length === 0 && miss.length === 0;
  console.log(`--- 第 ${k + 1} 轮：${blocks.length} 块 ${legal ? '' : `⚠️ 非法划分（重复 ${dup.length}，遗漏 ${miss.length}${miss.length ? ' → ' + miss : ''}）`}`);
  if (o?._raw) { console.log(`  ⚠️ JSON 解析失败：${o._raw}`); continue; }
  blocks.forEach((g, i) => console.log(`  ${String(artsOf(g)).padStart(2)}篇  ${(names[i] ?? '').slice(0, 34).padEnd(34)} ${g.join(' ')}`));
  const over = blocks.filter((g) => artsOf(g) > 30).length;
  console.log(`  错配 ${legal ? misassign(blocks) : '—'}/${IDS.length}   超 30 篇的块 ${over}`);
  runs.push({ blocks, names, legal, misassign: legal ? misassign(blocks) : null });
}
// 轮间稳定性：同一对 story 是否每轮都同块
if (runs.filter((r) => r.legal).length >= 2) {
  const ok = runs.filter((r) => r.legal);
  const same = (r: any, a: number, b: number) => r.blocks.some((g: number[]) => g.includes(a) && g.includes(b));
  let agree = 0, tot = 0;
  for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) {
    tot++; const v = ok.map((r) => same(r, IDS[i], IDS[j]));
    if (v.every((x) => x === v[0])) agree++;
  }
  console.log(`\n轮间稳定性：${ok.length} 轮合法，${agree}/${tot} 对每轮归属一致 = ${(agree / tot * 100).toFixed(0)}%`);
}
console.log(`\ncodex 人裁 4 组（对照）：${CODEX_4.map((g) => artsOf(g)).join(' ')} 篇`);
writeFileSync('partition-arm-out.json', JSON.stringify({ wf: WF, model: MODEL, runs }, null, 1));
