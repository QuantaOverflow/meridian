/**
 * 【扔掉型原型】A4：两段式 storyline —— 先命名主线，再逐条独立归类。
 *
 * 为什么是这个形式（A2/A3 负结果推出来的，见 FINDINGS.md）：
 *   A2 逐对问「同段？」→「同段」不是等价关系，全链强行要传递性 → 碎成 9 块、错配 10/21，
 *      还把标题逐字相同的重复对判成不同段（Karnataka 2626×2627）。
 *   A3 一次全局划分 → glm/qwen3-30b/llama-70b 共 9 轮，7 轮划分非法（id 重复或遗漏），
 *      合法的错配 8-10/21，9 轮全部违反明写的「一块 ≤30 篇」。但**块名三个模型都说对了**。
 *   → 说得出角度、分不好配 ⇒ 把两件事拆开：1 次调用只命名，N 次调用逐条独立选。
 *     合法划分变成构造保证（每条恰好一个标签），传递性问题消失。
 *
 * 输入是**去重后的单元**（现行 0.94 全链的产物），不是原始 story——生产接法就是接在去重后。
 * ⚠️ 已知上限：去重层自己就跨主线合了 2 个单元（U0 跨 codex 组0+1、U4 跨组0+3），
 * 这两个无论分到哪都有一半错。所以错配的理论下界不是 0。
 *
 * 跑法：npx tsx storyline-arm.ts [--repeats 2] [--model ...] [--conc 6]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const WORKER = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian/chat';
const args = process.argv.slice(2);
const argOf = (f: string, d: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const REPEATS = Number(argOf('--repeats', '2'));
const MODEL = argOf('--model', '@cf/zai-org/glm-4.7-flash');
const CONC = Number(argOf('--conc', '6'));
const CAP = 30;

interface Unit { u: number; storyIds: number[]; articleIds: number[]; titles: string[]; codex: number[] }
const units: Unit[] = JSON.parse(readFileSync('/tmp/units.json', 'utf-8'));
if (units.length !== 11) throw new Error(`卫生断言失败：期望 11 个单元，拿到 ${units.length}；先跑 prep-units.ts`);

const DB = readFileSync(new URL('../../../frontend/.env', import.meta.url).pathname, 'utf-8')
  .split('\n').find((l) => l.startsWith('NUXT_DATABASE_URL='))!.slice(18).replace(/"/g, '');
const psql = (q: string) => execFileSync('psql', [DB, '-At', '-F', '\t', '-c', q],
  { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }).trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
const artTitle = new Map<number, string>();
for (const r of psql(`SELECT id, coalesce(title,'') FROM articles WHERE id IN (${[...new Set(units.flatMap((u) => u.articleIds))].join(',')})`))
  artTitle.set(Number(r[0]), r[1]);
const heads = (u: Unit) => u.articleIds.map((a) => artTitle.get(a) ?? '').filter(Boolean);
const label = (u: Unit) => u.titles[0];

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

// 第一段：只命名主线，不分配。每条给前 3 个成员标题，够看出角度且省 token
const overview = units.map((u) =>
  `[U${u.u}] ${label(u)} (${u.articleIds.length} reports)\n${heads(u).slice(0, 3).map((t) => `    - ${t}`).join('\n')}`).join('\n\n');
const LABEL_PROMPT = `Below are ${units.length} auto-generated stories, nearly all from ONE news event.
A daily brief cannot spend ${units.length} blocks on one event — it needs 3-5.

Propose 3-5 STORYLINES the brief should use. A storyline is one continuous piece of prose the
reader can read without feeling anything repeats. Name it by what it covers, not by the event.
Do NOT assign the stories yet.

${overview}

Output ONLY JSON:
{"storylines": [{"name": "<short name>", "covers": "<one clause: what belongs here>"}, ...]}`;

// 第二段：逐条独立归类。0 = 不属于这个事件（聚类误入的用它兜，别硬塞）
const pickPrompt = (u: Unit, sl: any[]) => `A daily brief covers one big news event using these storylines:

${sl.map((a, i) => `[${i + 1}] ${a.name} — ${a.covers}`).join('\n')}

Which ONE storyline does the story below belong to? Judge by its member report headlines,
not by its auto-generated title. If the story is about a completely different event that
does not belong in any of these storylines, answer 0.

Story: ${label(u)}
${heads(u).map((t) => `    - ${t}`).join('\n')}

Output ONLY JSON: {"storyline": <0-${sl.length}>, "reason": "<one clause>"}`;

const artsOf = (us: Unit[]) => new Set(us.flatMap((u) => u.articleIds)).size;
/** 参照：单元的 codex 主线。跨主线的单元（U0/U4）算「命中任一即可」，已知上限见文件头 */
function score(blocks: Unit[][]): { wrong: number; wrongArts: number } {
  const ov: Array<[number, number, number]> = [];
  blocks.forEach((g, gi) => [0, 1, 2, 3].forEach((ci) => {
    const n = g.filter((u) => u.codex.includes(ci)).length; if (n) ov.push([n, gi, ci]);
  }));
  ov.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const ug = new Set<number>(), uc = new Set<number>(); const map = new Map<number, number>();
  for (const [n, gi, ci] of ov) { if (ug.has(gi) || uc.has(ci)) continue; ug.add(gi); uc.add(ci); map.set(gi, ci); }
  let wrong = 0, wrongArts = 0;
  blocks.forEach((g, gi) => g.forEach((u) => {
    const ok = u.codex.length === 0 ? false : u.codex.includes(map.get(gi) ?? -1);
    if (!ok) { wrong++; wrongArts += u.articleIds.length; }
  }));
  return { wrong, wrongArts };
}

console.log(`模型 ${MODEL}，${REPEATS} 轮，输入 ${units.length} 个去重后单元\n`);
const runs: any[] = [];
for (let k = 0; k < REPEATS; k++) {
  const lo = await chat(LABEL_PROMPT, 800);
  const sl: any[] = (lo?.storylines ?? []).filter((a: any) => a?.name);
  if (sl.length < 2) { console.log(`--- 第 ${k + 1} 轮：⚠️ 主线生成失败`); continue; }
  console.log(`--- 第 ${k + 1} 轮：${sl.length} 条主线`);
  sl.forEach((a, i) => console.log(`  [${i + 1}] ${a.name} — ${String(a.covers).slice(0, 58)}`));

  const picks = await pool(units, CONC, async (u) => {
    const o = await chat(pickPrompt(u, sl), 200);
    const n = Number(o?.storyline);
    return Number.isInteger(n) && n >= 0 && n <= sl.length ? n : null; // 越界/失败记 null，不静默塞第 1 类
  });
  const failed = picks.filter((p) => p === null).length;
  if (failed) console.log(`  ⚠️ ${failed}/${units.length} 条归类失败（三次重试后）`);

  const rejected = units.filter((_, i) => picks[i] === 0);
  const blocks: Unit[][] = sl.map(() => []);
  units.forEach((u, i) => { if (picks[i] && picks[i]! > 0) blocks[picks[i]! - 1].push(u); });
  const used = blocks.filter((b) => b.length);
  const s = score(used);
  console.log(`  划分：${used.length} 块  ${used.map((b) => artsOf(b) + '篇').join(' ')}   超 ${CAP} 篇 ${used.filter((b) => artsOf(b) > CAP).length} 块`);
  used.forEach((b, i) => console.log(`     ${String(artsOf(b)).padStart(2)}篇  ${b.map((u) => 'U' + u.u).join(' ')}`));
  console.log(`  判「不属于本事件」：${rejected.length ? rejected.map((u) => `U${u.u}(${u.titles[0].slice(0, 30)})`).join(' ') : '无'}`);
  console.log(`  错配 ${s.wrong}/${units.length} 单元，${s.wrongArts} 篇文章`);
  runs.push({ storylines: sl, blocks: used.map((b) => b.map((u) => u.u)), rejected: rejected.map((u) => u.u), ...s });
}
if (runs.length >= 2) {
  const same = (r: any, a: number, b: number) => r.blocks.some((g: number[]) => g.includes(a) && g.includes(b));
  let agree = 0, tot = 0;
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    tot++; const v = runs.map((r) => same(r, units[i].u, units[j].u));
    if (v.every((x) => x === v[0])) agree++;
  }
  console.log(`\n轮间稳定性：${agree}/${tot} 对每轮归属一致 = ${(agree / tot * 100).toFixed(0)}%`);
}
console.log(`\n参照 codex 4 组（映射到去重后单元）：${[0,1,2,3].map((c) => artsOf(units.filter((u) => u.codex.includes(c)))).join(' ')} 篇`);
console.log(`⚠️ 上限：U0(42篇) 跨组0+1、U4(6篇) 跨组0+3，去重层已经跨主线合掉了，错配下界不是 0`);
writeFileSync('storyline-arm-out.json', JSON.stringify({ model: MODEL, units, runs }, null, 1));
