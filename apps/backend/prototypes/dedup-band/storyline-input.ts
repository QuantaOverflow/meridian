/**
 * 【扔掉型原型】第 1 步（主线命名）换输入：四臂。不接第 2 步。
 *
 * 前情（FINDINGS.md 2026-09-03 各节）：六轮实验的病灶收敛到第 1 步——它每轮都揉出一条
 * 万能主线 `Nepal-Tibet flash floods and missing persons`，把 codex 判为不同线的
 * 「灾情总述」和「失踪者家属」并成一条，第 2 步再准也只能往错筐里放。
 *
 * 现行第 1 步的输入被实测出两个毛病：
 *   · 每条 story 的**机器标题**排在第一行最显眼处，而 21/21 条都是「flash floods /
 *     glacial collapse」通用词（2646 与 2647 逐字相同），2654 讲弗吉尼亚徒步者失踪、
 *     标题里一个字没提 —— 噪声在最显眼位置
 *   · headline 按 `slice(0,3)` 每条截 3 篇 → 只送 56/91 = 62%，且**大 story 被砍得最狠**
 *     （18 篇的只露 3 篇），恰恰是最需要判断归属的那些
 *
 * 四臂只改**输入**，指令与已跑的 N0 基线逐字相同（P3 除外，它额外加约束），
 * 这样差异能归因到输入：
 *   P1   91 条真实报道标题，平铺，不分组，不给机器标题
 *   P1g  91 条真实报道标题，按 story 分组（只给「第 N 组 / k 篇」，不给机器标题）
 *   P2   P1g + 每篇前 3 条 event_summary_points
 *   P3   P1g + 互斥约束（允许至多一条总述线，但不得覆盖其他线）
 *
 * 验收**人读**，不再造自动判据 —— 上一轮的关键词检测器漏掉了它要检测的那个万能筐
 * （"flash floods" 不在组0 的关键词表里），15 条结果人读一遍比造个坏尺子可靠。
 *
 * 跑法：npx tsx storyline-input.ts [--runs 5]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const WORKER = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian/chat';
const WF = 'admin-brief-1788058777778';
const MODEL = '@cf/zai-org/glm-4.7-flash';
const args = process.argv.slice(2);
const RUNS = Number(args.indexOf('--runs') >= 0 ? args[args.indexOf('--runs') + 1] : '5');

const DB = readFileSync('/Users/shiwenjie/Desktop/playground/projects/meridian/apps/frontend/.env', 'utf-8')
  .split('\n').find((l) => l.startsWith('NUXT_DATABASE_URL='))!.slice(18).replace(/"/g, '');
const psql = (q: string) => execFileSync('psql', [DB, '-At', '-F', '\t', '-c', q],
  { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }).trim().split('\n').filter(Boolean).map((l) => l.split('\t'));

const st = psql(`SELECT id, coalesce(article_ids::text,'[]') FROM brief_stories
  WHERE workflow_id='${WF}' AND cluster_id=47 AND centroid IS NOT NULL ORDER BY id`)
  .map((r) => ({ id: Number(r[0]), arts: JSON.parse(r[1]) as number[] }));
if (st.length !== 22) throw new Error(`卫生断言失败：期望 22 条 story，拿到 ${st.length}`);
const allArts = [...new Set(st.flatMap((s) => s.arts))];
const art = new Map<number, { t: string; esp: string[] }>();
for (const r of psql(`SELECT id, coalesce(title,''), coalesce(event_summary_points::text,'[]')
  FROM articles WHERE id IN (${allArts.join(',')})`))
  art.set(Number(r[0]), { t: r[1], esp: JSON.parse(r[2]) as string[] });
if (allArts.length !== 91) throw new Error(`卫生断言失败：期望 91 篇文章，拿到 ${allArts.length}`);
if ([...art.values()].some((a) => !a.t)) throw new Error('卫生断言失败：有文章没有标题');
if ([...art.values()].filter((a) => a.esp.length).length !== 91)
  throw new Error('卫生断言失败：event_summary_points 未 100% 覆盖，P2 前提不成立');

// ── 四臂的数据部分 ───────────────────────────────────────────────────────────
const flat = st.flatMap((s) => s.arts).map((a) => `  - ${art.get(a)!.t}`).join('\n');
const grouped = st.map((s, i) =>
  `[Group ${i + 1}] (${s.arts.length} reports)\n${s.arts.map((a) => `  - ${art.get(a)!.t}`).join('\n')}`).join('\n\n');
const groupedEsp = st.map((s, i) =>
  `[Group ${i + 1}] (${s.arts.length} reports)\n${s.arts.map((a) =>
    `  - ${art.get(a)!.t}\n${art.get(a)!.esp.slice(0, 3).map((p) => `      · ${p}`).join('\n')}`).join('\n')}`).join('\n\n');

const HEAD = (n: number) => `Below are ${n} news reports, nearly all from ONE news event.
A daily brief cannot spend many blocks on one event — it needs 3-5.

Propose 3-5 STORYLINES the brief should use. A storyline is one continuous piece of prose the
reader can read without feeling anything repeats. Name it by what it covers, not by the event.
Do NOT assign the reports yet.`;
const EXCL = `\nHard constraints:
- The storylines must be mutually exclusive. No two may cover the same material.
- At most ONE storyline may be a general overview (casualties, area affected, overall
  progress). That one must NOT absorb what the other storylines cover — in particular it
  must not swallow the missing-people angle, the causes angle or the rescue angle.
- Do not join two different angles with "and" into one storyline. Two angles = two storylines.`;
const TAIL = `\n\nOutput ONLY JSON:
{"storylines": [{"name": "<short name>", "covers": "<one clause: what belongs here>"}, ...]}`;

const ARMS: Array<[string, string]> = [
  ['P1  平铺真实标题', HEAD(91) + '\n\n' + flat + TAIL],
  ['P1g 分组真实标题', HEAD(91) + '\n\n' + grouped + TAIL],
  ['P2  分组+摘要要点', HEAD(91) + '\n\n' + groupedEsp + TAIL],
  ['P3  分组+互斥约束', HEAD(91) + EXCL + '\n\n' + grouped + TAIL],
];

async function chat(prompt: string): Promise<any> {
  for (let k = 0; k < 3; k++) {
    const r = await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }],
        options: { provider: 'workers-ai', model: MODEL, temperature: 0, max_tokens: 900, skipCache: true } }) });
    const j: any = await r.json();
    const raw = j?.data?.choices?.[0]?.message?.content ?? '';
    try { const o = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}'); if (o.storylines?.length) return o; } catch {}
  }
  return null;
}

console.log(`模型 ${MODEL}｜temperature 0｜每臂 ${RUNS} 轮｜22 条 story / 91 篇文章`);
console.log(`对照：已跑的 N0 基线（22 个机器标题 + 56/91 headline，7134 字符）每轮都揉出`);
console.log(`      "Nepal-Tibet flash floods and missing persons" 这条万能主线\n`);
const out: any = {};
for (const [name, prompt] of ARMS) {
  console.log(`════════ ${name}（${prompt.length} 字符）`);
  const rows: any[] = [];
  for (let k = 0; k < RUNS; k++) {
    const o = await chat(prompt);
    if (!o) { console.log(`  轮${k + 1}: ⚠️ 三次都没拿到 JSON`); rows.push(null); continue; }
    const sl = o.storylines.filter((x: any) => x?.name);
    console.log(`  轮${k + 1}（${sl.length} 条）`);
    sl.forEach((x: any) => console.log(`      ${String(x.name).slice(0, 48).padEnd(50)} ← ${String(x.covers ?? '').slice(0, 62)}`));
    rows.push(sl.map((x: any) => ({ name: String(x.name), covers: String(x.covers ?? '') })));
  }
  const ok = rows.filter(Boolean);
  console.log(`  ── ${name}：${ok.length}/${RUNS} 轮拿到结果，平均 ${(ok.reduce((s, r) => s + r.length, 0) / Math.max(ok.length,1)).toFixed(1)} 条主线\n`);
  out[name] = rows;
}
writeFileSync('storyline-input-out.json', JSON.stringify({ model: MODEL, runs: RUNS, out }, null, 1));
