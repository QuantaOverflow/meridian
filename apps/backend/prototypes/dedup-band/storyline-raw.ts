/**
 * 【扔掉型原型】A5：两段式 storyline 吃**去重前的原始 22 条 story**。
 *
 * A4（storyline-arm.ts）验证了形式合法且稳定（96%），但输入接在去重之后，
 * 去重层按「同一发生」把不同主线粘死（U0 跨 codex 组0+1、U4 跨组0+3），
 * 叠出 52 篇的巨块，错配下界不是 0。这一轮换成原始 22 条，并对比第 2 步喂不喂
 * event_summary_points：
 *   B1 = story 标题 + 全部成员文章标题
 *   B2 = B1 + 全部成员文章的 event_summary_points
 * 同一轮内两臂共用同一份第 1 步主线列表。
 *
 * 跑法：npx tsx storyline-raw.ts [--repeats 2] [--model ...] [--conc 6] > storyline-raw.log 2>&1
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
const WF = 'admin-brief-1788058777778';

/** codex 读者评审的人裁划分（参照，不是金标）。2649 = 聚类误入，正确答案是 0，不参与错配 */
const CODEX_4: number[][] = [
  [2642, 2651, 2637],
  [2653, 2652, 2650, 2644, 2645],
  [2635, 2636, 2640, 2641, 2639, 2647, 2648],
  [2643, 2634, 2646, 2654, 2655, 2638],
];
const INTRUDER = 2649;

// ---------- 数据 ----------
const DB = readFileSync(new URL('../../../frontend/.env', import.meta.url).pathname, 'utf-8')
  .split('\n').find((l) => l.startsWith('NUXT_DATABASE_URL='))!.slice(18).replace(/"/g, '');
const psql1 = (q: string) => execFileSync('psql', [DB, '-At', '-c', q],
  { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }).trim();

interface Story { id: number; title: string; articleIds: number[]; codex: number }
const stories: Story[] = (JSON.parse(psql1(
  `SELECT json_agg(json_build_object('id',id,'title',coalesce(title,''),'articleIds',coalesce(article_ids,'[]'::jsonb)) ORDER BY id)
   FROM brief_stories WHERE workflow_id='${WF}' AND cluster_id=47 AND centroid IS NOT NULL`)) as any[])
  .map((s) => ({ ...s, codex: CODEX_4.findIndex((g) => g.includes(s.id)) }));

const allArtIds = [...new Set(stories.flatMap((s) => s.articleIds))];
interface Art { id: number; title: string; esp: string[] }
const arts = new Map<number, Art>((JSON.parse(psql1(
  `SELECT json_agg(json_build_object('id',id,'title',coalesce(title,''),'esp',coalesce(event_summary_points,'[]'::jsonb)))
   FROM articles WHERE id IN (${allArtIds.join(',')})`)) as Art[]).map((a) => [a.id, a]));

// ---------- 卫生断言（不达成就 throw，不许 warn 后继续）----------
if (stories.length !== 22) throw new Error(`断言1失败：期望 22 条 story，拿到 ${stories.length}`);
const codexIds = new Set(CODEX_4.flat());
if (codexIds.size !== 21) throw new Error(`断言2失败：codex 参照应为 21 个 id，拿到 ${codexIds.size}`);
const inCodex = stories.filter((s) => codexIds.has(s.id));
const notInCodex = stories.filter((s) => !codexIds.has(s.id));
if (inCodex.length !== 21) throw new Error(`断言2失败：落在 codex 21 个 id 内的是 ${inCodex.length} 条`);
if (notInCodex.length !== 1 || notInCodex[0].id !== INTRUDER)
  throw new Error(`断言2失败：不在 codex 里的应恰好是 ${INTRUDER}，实际 ${notInCodex.map((s) => s.id).join(',')}`);
const missArt = allArtIds.filter((i) => !arts.has(i));
if (missArt.length) throw new Error(`断言3失败：${missArt.length} 篇文章没取到：${missArt.slice(0, 5)}`);
const noEsp = allArtIds.filter((i) => !(arts.get(i)!.esp?.length > 0));
if (noEsp.length) throw new Error(`断言3失败：event_summary_points 覆盖率 ${(100 * (1 - noEsp.length / allArtIds.length)).toFixed(1)}% ≠ 100%，缺 ${noEsp.length} 篇`);
const noTitle = allArtIds.filter((i) => !arts.get(i)!.title);
if (noTitle.length) throw new Error(`断言：${noTitle.length} 篇文章无标题`);
const TOTAL_ARTS = allArtIds.length;
const SCORED_ARTS = TOTAL_ARTS - stories.find((s) => s.id === INTRUDER)!.articleIds.length;

// ---------- LLM ----------
async function chat(prompt: string, maxTokens: number): Promise<any> {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }],
          options: { provider: 'workers-ai', model: MODEL, temperature: 0, max_tokens: maxTokens, skipCache: true } }) });
      const j: any = await r.json();
      const raw = j?.data?.choices?.[0]?.message?.content ?? '';
      const o = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
      if (Object.keys(o).length) return o;
    } catch {}
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

// ---------- prompt ----------
const heads = (s: Story) => s.articleIds.map((a) => arts.get(a)!.title);
const overview = stories.map((s) =>
  `[S${s.id}] ${s.title} (${s.articleIds.length} reports)\n${heads(s).slice(0, 3).map((t) => `    - ${t}`).join('\n')}`).join('\n\n');
const LABEL_PROMPT = `Below are ${stories.length} auto-generated stories, nearly all from ONE news event.
A daily brief cannot spend ${stories.length} blocks on one event — it needs 3-5.

Propose 3-5 STORYLINES the brief should use. A storyline is one continuous piece of prose the
reader can read without feeling anything repeats. Name it by what it covers, not by the event.
Do NOT assign the stories yet.

${overview}

Output ONLY JSON:
{"storylines": [{"name": "<short name>", "covers": "<one clause: what belongs here>"}, ...]}`;

const bodyB1 = (s: Story) => heads(s).map((t) => `    - ${t}`).join('\n');
const bodyB2 = (s: Story) => s.articleIds.map((a) => {
  const art = arts.get(a)!;
  return `    - ${art.title}\n${art.esp.map((p) => `        · ${p}`).join('\n')}`;
}).join('\n');

const pickPrompt = (s: Story, sl: any[], body: string) => `A daily brief covers one big news event using these storylines:

${sl.map((a, i) => `[${i + 1}] ${a.name} — ${a.covers}`).join('\n')}

Which ONE storyline does the story below belong to? Judge by its member report headlines,
not by its auto-generated title. If the story is about a completely different event that
does not belong in any of these storylines, answer 0.

Story: ${s.title}
${body}

Output ONLY JSON: {"storyline": <0-${sl.length}>, "reason": "<one clause>"}`;

// ---------- 评分 ----------
const artsOf = (ss: Story[]) => new Set(ss.flatMap((s) => s.articleIds)).size;
/** 贪心最大重叠匹配，每个 codex 组只配一个块。2649（codex=-1）不参与 */
function score(blocks: Story[][]): { wrong: number; wrongArts: number; wrongIds: number[] } {
  const ov: Array<[number, number, number]> = [];
  blocks.forEach((g, gi) => [0, 1, 2, 3].forEach((ci) => {
    const n = g.filter((s) => s.codex === ci).length; if (n) ov.push([n, gi, ci]);
  }));
  ov.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const ug = new Set<number>(), uc = new Set<number>(); const map = new Map<number, number>();
  for (const [, gi, ci] of ov) { if (ug.has(gi) || uc.has(ci)) continue; ug.add(gi); uc.add(ci); map.set(gi, ci); }
  let wrong = 0, wrongArts = 0; const wrongIds: number[] = [];
  blocks.forEach((g, gi) => g.forEach((s) => {
    if (s.codex < 0) return;                       // 2649 不参与错配计算
    if (s.codex !== (map.get(gi) ?? -1)) { wrong++; wrongArts += s.articleIds.length; wrongIds.push(s.id); }
  }));
  return { wrong, wrongArts, wrongIds };
}

interface ArmRun { arm: string; round: number; picks: (number | null)[]; blocks: number[][];
  rejected: number[]; failed: number; nBlocks: number; blockArts: number[]; over: number;
  wrong: number; wrongArts: number; wrongIds: number[]; intruderRejected: boolean; reasons: Record<number, string> }

async function runArm(armName: string, sl: any[], body: (s: Story) => string, round: number): Promise<ArmRun> {
  const reasons: Record<number, string> = {};
  const picks = await pool(stories, CONC, async (s) => {
    const o = await chat(pickPrompt(s, sl, body(s)), 200);
    const n = Number(o?.storyline);
    const ok = Number.isInteger(n) && n >= 0 && n <= sl.length;
    if (ok) reasons[s.id] = String(o?.reason ?? '').slice(0, 120);
    return ok ? n : null;                          // 越界/失败记 null，绝不静默塞进第 1 类
  });
  const failed = picks.filter((p) => p === null).length;
  const rejected = stories.filter((_, i) => picks[i] === 0).map((s) => s.id);
  const raw: Story[][] = sl.map(() => []);
  stories.forEach((s, i) => { if (picks[i] && picks[i]! > 0) raw[picks[i]! - 1].push(s); });
  const used = raw.filter((b) => b.length);
  const sc = score(used);
  return { arm: armName, round, picks, blocks: used.map((b) => b.map((s) => s.id)), rejected, failed,
    nBlocks: used.length, blockArts: used.map((b) => artsOf(b)), over: used.filter((b) => artsOf(b) > CAP).length,
    ...sc, intruderRejected: rejected.includes(INTRUDER), reasons };
}

// ---------- 主流程 ----------
console.log(`模型 ${MODEL}，${REPEATS} 轮，输入 ${stories.length} 条**去重前**原始 story，${TOTAL_ARTS} 篇文章`);
console.log(`卫生断言全过：22 条 / codex 覆盖 21 条 / 误入项 ${INTRUDER} / esp 覆盖 ${allArtIds.length}/${allArtIds.length} = 100%`);
console.log(`错配分母：21 条 story，${SCORED_ARTS} 篇文章（${INTRUDER} 的 ${TOTAL_ARTS - SCORED_ARTS} 篇不计）\n`);

const rounds: any[] = [];
for (let k = 0; k < REPEATS; k++) {
  const lo = await chat(LABEL_PROMPT, 800);
  const sl: any[] = (lo?.storylines ?? []).filter((a: any) => a?.name);
  if (sl.length < 2) { console.log(`--- 第 ${k + 1} 轮：⚠️ 主线生成失败，跳过`); continue; }
  console.log(`--- 第 ${k + 1} 轮：${sl.length} 条主线（两臂共用）`);
  sl.forEach((a, i) => console.log(`  [${i + 1}] ${a.name} — ${String(a.covers).slice(0, 70)}`));

  const slB1 = sl, slB2 = sl;
  // 断言4：同一轮内两臂主线列表逐字相同
  const f1 = sl.map((a, i) => `[${i + 1}] ${a.name} — ${a.covers}`).join('\n');
  const f2 = slB2.map((a: any, i: number) => `[${i + 1}] ${a.name} — ${a.covers}`).join('\n');
  if (f1 !== f2) throw new Error('断言4失败：同一轮内两臂主线列表不同');

  const b1 = await runArm('B1', slB1, bodyB1, k + 1);
  const b2 = await runArm('B2', slB2, bodyB2, k + 1);
  // 断言6：两臂跑在完全相同的 22 条 story 上
  const set1 = [...b1.blocks.flat(), ...b1.rejected, ...stories.filter((_, i) => b1.picks[i] === null).map((s) => s.id)].sort().join(',');
  const set2 = [...b2.blocks.flat(), ...b2.rejected, ...stories.filter((_, i) => b2.picks[i] === null).map((s) => s.id)].sort().join(',');
  const expect = stories.map((s) => s.id).sort((a, b) => a - b).join(',');
  if (set1 !== [...stories].map((s) => s.id).sort((a, b) => a - b).join(',')) throw new Error(`断言6失败：B1 覆盖的 story 集合 ≠ 22 条全集`);
  if (set2 !== expect) throw new Error('断言6失败：B2 覆盖的 story 集合 ≠ 22 条全集');
  if (set1 !== set2) throw new Error('断言6失败：两臂 story 集合不同');

  for (const r of [b1, b2]) {
    console.log(`  ${r.arm}: ${r.nBlocks} 块  ${r.blockArts.map((n) => n + '篇').join(' ')}   超${CAP}篇 ${r.over} 块   错配 ${r.wrong}/21 story, ${r.wrongArts}/${SCORED_ARTS} 篇   ${INTRUDER}判0=${r.intruderRejected ? '✅' : '❌'}   失败 ${r.failed}`);
    r.blocks.forEach((b, i) => console.log(`      ${String(r.blockArts[i]).padStart(2)}篇  ${b.join(' ')}`));
    console.log(`      判「不属于本事件」：${r.rejected.length ? r.rejected.join(' ') : '无'}${r.wrongIds.length ? `   错配 id: ${r.wrongIds.join(' ')}` : ''}`);
  }
  rounds.push({ round: k + 1, storylines: sl, B1: b1, B2: b2 });
}

// ---------- 对照表 ----------
const pad = (s: any, n: number) => String(s).padEnd(n);
console.log(`\n===== 对照表 =====`);
console.log(`${pad('臂/轮', 8)}${pad('块数', 6)}${pad('各块篇数', 24)}${pad('>30块', 7)}${pad('错配story/21', 14)}${pad('错配篇/' + SCORED_ARTS, 12)}${pad(INTRUDER + '判0', 9)}归类失败`);
for (const r of rounds) for (const a of ['B1', 'B2'] as const) {
  const x = r[a];
  console.log(`${pad(a + ' r' + r.round, 8)}${pad(x.nBlocks, 6)}${pad(x.blockArts.join('/'), 24)}${pad(x.over, 7)}${pad(x.wrong, 14)}${pad(x.wrongArts, 12)}${pad(x.intruderRejected ? '✅' : '❌', 9)}${x.failed}`);
}

// ---------- 轮间稳定性 ----------
console.log(`\n===== 轮间稳定性（story 两两归属一致占比，${stories.length} 条全参与）=====`);
const stab: Record<string, string> = {};
for (const a of ['B1', 'B2'] as const) {
  const rs = rounds.map((r) => r[a]).filter(Boolean);
  if (rs.length < 2) { console.log(`  ${a}: 轮次不足`); continue; }
  const same = (r: any, x: number, y: number) => r.blocks.some((g: number[]) => g.includes(x) && g.includes(y));
  let agree = 0, tot = 0;
  for (let i = 0; i < stories.length; i++) for (let j = i + 1; j < stories.length; j++) {
    tot++; const v = rs.map((r) => same(r, stories[i].id, stories[j].id));
    if (v.every((z) => z === v[0])) agree++;
  }
  stab[a] = `${agree}/${tot} = ${(agree / tot * 100).toFixed(0)}%`;
  console.log(`  ${a}: ${stab[a]}`);
}

// ---------- B1 vs B2 差异 ----------
console.log(`\n===== B1 与 B2 判得不同的 story（归因用）=====`);
const diffs: any[] = [];
for (const r of rounds) {
  const nm = (p: number | null, sl: any[]) => p === null ? 'FAIL' : p === 0 ? '0=不属于本事件' : `${p}. ${sl[p - 1].name}`;
  stories.forEach((s, i) => {
    const p1 = r.B1.picks[i], p2 = r.B2.picks[i];
    if (p1 === p2) return;
    const rec = { round: r.round, id: s.id, title: s.title, codex: s.codex,
      B1: nm(p1, r.storylines), B1reason: r.B1.reasons[s.id] ?? '',
      B2: nm(p2, r.storylines), B2reason: r.B2.reasons[s.id] ?? '' };
    diffs.push(rec);
    console.log(`  r${r.round} [${s.id}] (codex组${s.codex < 0 ? '误入' : s.codex}) ${s.title}`);
    console.log(`        B1 → ${rec.B1}   «${rec.B1reason}»`);
    console.log(`        B2 → ${rec.B2}   «${rec.B2reason}»`);
  });
}
if (!diffs.length) console.log('  两臂逐条判得完全相同');

console.log(`\n参照 codex 4 组篇数：${[0, 1, 2, 3].map((c) => artsOf(stories.filter((s) => s.codex === c))).join(' ')} 篇（合计 ${SCORED_ARTS}）`);
writeFileSync('storyline-raw-out.json', JSON.stringify({ model: MODEL, repeats: REPEATS,
  stories: stories.map((s) => ({ id: s.id, title: s.title, n: s.articleIds.length, codex: s.codex })),
  rounds, stability: stab, diffs }, null, 1));
console.log('\n结果已落 storyline-raw-out.json');
