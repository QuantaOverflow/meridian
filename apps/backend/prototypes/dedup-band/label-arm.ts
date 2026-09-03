/**
 * 【扔掉型原型】A4：两段式——先命名角度，再逐条独立归类。
 *
 * 为什么（A2/A3 负结果推出来的）：
 *   A2 逐对问「同段？」→ 不是等价关系，全链强行要传递性，碎成 9 块、错配 10/21，
 *      还把标题逐字相同的重复对判成不同段。
 *   A3 一次全局划分 → 三个模型 9 轮里 7 轮划分非法（id 重复/遗漏），合法的错配 8-10/21。
 *      但**块名三个模型都说对了**（Rescue Efforts / Causes and Aftermath / Missing Persons）。
 *   → 说得出角度、分不好配。那就把两件事拆开：一次调用只命名角度，再 N 次独立分类。
 *      合法划分变成构造保证（每条恰好选一个），传递性问题消失。
 *
 * 跑法：npx tsx label-arm.ts [--repeats 2] [--model ...] [--conc 8]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const WORKER = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian/chat';
const WF = 'admin-brief-1788058777778';
const args = process.argv.slice(2);
const argOf = (f: string, d: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const REPEATS = Number(argOf('--repeats', '2'));
const MODEL = argOf('--model', '@cf/zai-org/glm-4.7-flash');
const CONC = Number(argOf('--conc', '8'));
const CAP = 30;

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
const heads = (s: typeof st[0]) => s.arts.map((a) => artTitle.get(a) ?? '').filter(Boolean);
const byId = new Map(st.map((s) => [s.id, s]));

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

// ── 第一段：命名角度（一次调用，只出标签，不分配） ──────────────────────────
const overview = st.map((s) => `[${s.id}] ${s.title} (${s.arts.length} reports)\n${heads(s).slice(0, 3).map((t) => `    - ${t}`).join('\n')}`).join('\n\n');
const LABEL_PROMPT = `Below are ${st.length} auto-generated stories, all from ONE news event. A daily brief
cannot spend ${st.length} blocks on one event — it needs 3-5.

Propose 3-5 ANGLES the brief should use. An angle is one continuous piece of prose the
reader can read without feeling anything repeats. Name the angle by what it covers, not
by the event. Do NOT assign the stories yet.

${overview}

Output ONLY JSON:
{"angles": [{"name": "<short angle name>", "covers": "<one clause: what belongs here>"}, ...]}`;

// ── 第二段：逐条独立归类（并行；合法划分是构造保证的） ────────────────────────
const pickPrompt = (s: typeof st[0], angles: any[]) => `A daily brief covers one big news event using these angles:

${angles.map((a, i) => `[${i + 1}] ${a.name} — ${a.covers}`).join('\n')}

Which ONE angle does the story below belong to? Judge by its member report headlines,
not by its auto-generated title.

Story: ${s.title}
${heads(s).map((t) => `    - ${t}`).join('\n')}

Output ONLY JSON: {"angle": <number 1-${angles.length}>, "reason": "<one clause>"}`;

function misassign(blocks: number[][]): number {
  const ov: Array<[number, number, number]> = [];
  blocks.forEach((g, gi) => CODEX_4.forEach((c, ci) => { const n = g.filter((i) => c.includes(i)).length; if (n) ov.push([n, gi, ci]); }));
  ov.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const ug = new Set<number>(), uc = new Set<number>(); let hit = 0;
  for (const [n, gi, ci] of ov) { if (ug.has(gi) || uc.has(ci)) continue; ug.add(gi); uc.add(ci); hit += n; }
  return IDS.length - hit;
}
const artsOf = (ids: number[]) => new Set(ids.flatMap((id) => byId.get(id)!.arts)).size;

console.log(`模型 ${MODEL}，${REPEATS} 轮\n`);
const runs: any[] = [];
for (let k = 0; k < REPEATS; k++) {
  const lo = await chat(LABEL_PROMPT, 700);
  const angles: any[] = (lo?.angles ?? []).filter((a: any) => a?.name);
  if (angles.length < 2) { console.log(`--- 第 ${k + 1} 轮：⚠️ 角度生成失败`); continue; }
  console.log(`--- 第 ${k + 1} 轮：${angles.length} 个角度`);
  angles.forEach((a, i) => console.log(`  [${i + 1}] ${a.name} — ${String(a.covers).slice(0, 60)}`));

  const picks = await pool(st, CONC, async (s) => {
    const o = await chat(pickPrompt(s, angles), 200);
    const n = Number(o?.angle);
    return Number.isInteger(n) && n >= 1 && n <= angles.length ? n - 1 : null; // 越界/失败记 null，不静默塞第 1 类
  });
  const failed = picks.filter((p) => p === null).length;
  if (failed) console.log(`  ⚠️ ${failed}/${st.length} 条归类失败（三次重试后），从划分中剔除`);

  const blocks: number[][] = angles.map(() => []);
  st.forEach((s, i) => { if (picks[i] !== null) blocks[picks[i]!].push(s.id); });
  const used = blocks.filter((b) => b.length);
  console.log(`  划分：${used.length} 块（${angles.length} 个角度里 ${angles.length - used.length} 个没人选）`);
  used.forEach((b, i) => console.log(`    ${String(artsOf(b)).padStart(2)}篇  ${b.join(' ')}`));
  const legal = failed === 0;
  console.log(`  错配 ${legal ? misassign(used) : '—'}/${IDS.length}   超 ${CAP} 篇的块 ${used.filter((b) => artsOf(b) > CAP).length}`);
  runs.push({ angles, blocks: used, legal, misassign: legal ? misassign(used) : null });
}
if (runs.length >= 2) {
  const same = (r: any, a: number, b: number) => r.blocks.some((g: number[]) => g.includes(a) && g.includes(b));
  let agree = 0, tot = 0;
  for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) {
    tot++; const v = runs.map((r) => same(r, IDS[i], IDS[j]));
    if (v.every((x) => x === v[0])) agree++;
  }
  console.log(`\n轮间稳定性：${agree}/${tot} 对每轮归属一致 = ${(agree / tot * 100).toFixed(0)}%`);
}
console.log(`\ncodex 人裁 4 组（对照）：${CODEX_4.map(artsOf).join(' ')} 篇，错配 0`);
writeFileSync('label-arm-out.json', JSON.stringify({ wf: WF, model: MODEL, runs }, null, 1));
