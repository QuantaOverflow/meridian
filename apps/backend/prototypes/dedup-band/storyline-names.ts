/**
 * 【扔掉型原型】只测第 1 步：主线命名。不接第 2 步。
 *
 * 为什么只测这一步（A4/A4′ 负结果定位出来的）：
 *   四轮实验的巨块全落在同一条自发生成的万能主线 `Nepal-Tibet flash floods and missing persons`
 *   上——它把 codex 判为不同主线的「灾情总述」和「失踪者家属」揉成一条。第 2 步稳定性
 *   89-96% 不算差，是第 1 步给的筐就错了，归类再准也只能往错筐里放。
 *
 * 假设：不是上下文不足，是**布局把噪声放在最显眼位置** + 少了两条约束。实测依据：
 *   · codex 组3 六条 story 的前 3 篇 headline 全都明写 missing/families/search —— 信号在
 *   · 21/21 条 story 标题全是「flash floods / glacial collapse」通用描述（2646 与 2647 逐字相同），
 *     而 overview 把 story 标题放在**第一行**，headline 缩进在下面
 *   · 「别信 story 标题」这句只写进了第 2 步的 pickPrompt，第 1 步完全没有
 *
 * 三臂阶梯，每步只加一个改动，便于归因：
 *   N0  基线：story 标题在前 + 3 条 headline，无额外约束（= storyline-raw.ts 的 LABEL_PROMPT）
 *   N1  N0 去掉 story 标题（只留 headline）+ 明写「标题是自动生成的，不可信」
 *   N2  N1 再加互斥约束：主线之间不许重叠，不许出现总述型
 *
 * 判据（自动，关键词表跑前定死，两臂同表）：一条主线若命中 ≥2 个 codex 角度即判「融合型」；
 * 覆盖 = codex 四个角度里有几个被至少一条主线命中。原始名字全部打印，人可复核。
 *
 * 跑法：npx tsx storyline-names.ts [--runs 5]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const WORKER = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian/chat';
const WF = 'admin-brief-1788058777778';
const MODEL = '@cf/zai-org/glm-4.7-flash';
const args = process.argv.slice(2);
const RUNS = Number(args.indexOf('--runs') >= 0 ? args[args.indexOf('--runs') + 1] : '5');

const DB = readFileSync(new URL('../../../frontend/.env', import.meta.url).pathname, 'utf-8')
  .split('\n').find((l) => l.startsWith('NUXT_DATABASE_URL='))!.slice(18).replace(/"/g, '');
const psql = (q: string) => execFileSync('psql', [DB, '-At', '-F', '\t', '-c', q],
  { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }).trim().split('\n').filter(Boolean).map((l) => l.split('\t'));

const st = psql(`SELECT id, coalesce(title,''), coalesce(article_ids::text,'[]') FROM brief_stories
  WHERE workflow_id='${WF}' AND cluster_id=47 AND centroid IS NOT NULL ORDER BY id`)
  .map((r) => ({ id: Number(r[0]), title: r[1], arts: JSON.parse(r[2]) as number[] }));
if (st.length !== 22) throw new Error(`卫生断言失败：期望 22 条 story，拿到 ${st.length}`);
const artTitle = new Map<number, string>();
for (const r of psql(`SELECT id, coalesce(title,'') FROM articles WHERE id IN (${[...new Set(st.flatMap((s) => s.arts))].join(',')})`))
  artTitle.set(Number(r[0]), r[1]);
const heads = (s: typeof st[0], k: number) => s.arts.map((a) => artTitle.get(a) ?? '').filter(Boolean).slice(0, k);

// 三臂的 overview 与约束
const ovA = st.map((s) => `[S${s.id}] ${s.title} (${s.arts.length} reports)\n${heads(s, 3).map((t) => `    - ${t}`).join('\n')}`).join('\n\n');
const ovB = st.map((s) => `[S${s.id}] (${s.arts.length} reports)\n${heads(s, 3).map((t) => `    - ${t}`).join('\n')}`).join('\n\n');
const HEAD = `Below are ${st.length} auto-generated stories, nearly all from ONE news event.
A daily brief cannot spend ${st.length} blocks on one event — it needs 3-5.

Propose 3-5 STORYLINES the brief should use. A storyline is one continuous piece of prose the
reader can read without feeling anything repeats. Name it by what it covers, not by the event.
Do NOT assign the stories yet.`;
const NO_TITLE = `\nEach story below is shown ONLY by its member report headlines. Judge the angles from
those headlines. (The stories' own titles are auto-generated and were withheld because they
are all near-identical boilerplate about the same disaster — they carry no angle.)`;
const EXCLUSIVE = `\nHard constraints on the storylines you propose:
- They must be mutually exclusive. No two storylines may cover the same material.
- NONE of them may be a general overview or catch-all of the event. Every storyline must be
  a specific angle that excludes what the others cover.
- Do not join two different angles with "and" into one storyline. If two angles exist,
  they are two storylines.`;
const TAIL = `\n\nOutput ONLY JSON:
{"storylines": [{"name": "<short name>", "covers": "<one clause: what belongs here>"}, ...]}`;
const ARMS = [
  ['N0 基线', HEAD + '\n\n' + ovA + TAIL],
  ['N1 去标题', HEAD + NO_TITLE + '\n\n' + ovB + TAIL],
  ['N2 +互斥禁总述', HEAD + NO_TITLE + EXCLUSIVE + '\n\n' + ovB + TAIL],
] as const;

// codex 四个角度的关键词表。跑前定死，三臂同表；原始名字全打印供人复核
const ANGLES: Array<[string, RegExp]> = [
  ['0 灾情总述', /death toll|casualt|devastat|impact|damage|destruction|overview|latest update|scale of/i],
  ['1 成因气候', /glacial|glacier|climate|barrier lake|outburst|cause|warning|lesson|why/i],
  ['2 救援援助', /rescue|aid |relief|hydropower|tunnel|infrastructur|humanitarian|evacuat|response/i],
  ['3 失踪家属', /missing|famil|search for|foreign national|pilgrim|tourist|diaspora/i],
];
const hits = (name: string, covers: string) =>
  ANGLES.map(([, re], i) => (re.test(name) ? i : -1)).filter((i) => i >= 0); // 只看 name，covers 太长会全命中

async function chat(prompt: string): Promise<any> {
  for (let k = 0; k < 3; k++) {
    const r = await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }],
        options: { provider: 'workers-ai', model: MODEL, temperature: 0, max_tokens: 800, skipCache: true } }) });
    const j: any = await r.json();
    const raw = j?.data?.choices?.[0]?.message?.content ?? '';
    try { const o = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}'); if (o.storylines?.length) return o; } catch {}
  }
  return null;
}

console.log(`模型 ${MODEL}，temperature 0，每臂 ${RUNS} 轮，${st.length} 条 story\n`);
const out: any = {};
for (const [name, prompt] of ARMS) {
  console.log(`════ ${name}（prompt ${prompt.length} 字符）`);
  const rows: any[] = [];
  for (let k = 0; k < RUNS; k++) {
    const o = await chat(prompt);
    if (!o) { console.log(`  轮${k + 1}: ⚠️ 三次都没拿到 JSON`); rows.push(null); continue; }
    const sl = o.storylines.filter((x: any) => x?.name);
    const per = sl.map((x: any) => ({ name: String(x.name), covers: String(x.covers ?? ''), a: hits(String(x.name), String(x.covers ?? '')) }));
    const fused = per.filter((p: any) => p.a.length >= 2);
    const cov = new Set(per.flatMap((p: any) => p.a));
    console.log(`  轮${k + 1}: ${sl.length} 条  融合型 ${fused.length}  覆盖 ${cov.size}/4 角度 [${[...cov].sort().join(',')}]`);
    per.forEach((p: any) => console.log(`      ${p.a.length >= 2 ? '⚠️融合' : '     '} [${p.a.join(',') || '-'}] ${p.name.slice(0, 56)}`));
    rows.push({ n: sl.length, fused: fused.length, coverage: cov.size, storylines: per });
  }
  const ok = rows.filter(Boolean);
  const avg = (f: (r: any) => number) => (ok.reduce((s, r) => s + f(r), 0) / ok.length).toFixed(1);
  console.log(`  ── ${name}：平均 ${avg((r) => r.n)} 条／融合型 ${avg((r) => r.fused)} 条／覆盖 ${avg((r) => r.coverage)}/4` +
    `　零融合的轮次 ${ok.filter((r) => r.fused === 0).length}/${ok.length}　四角全覆盖 ${ok.filter((r) => r.coverage === 4).length}/${ok.length}\n`);
  out[name] = rows;
}
writeFileSync('storyline-names-out.json', JSON.stringify({ model: MODEL, runs: RUNS, out }, null, 1));
