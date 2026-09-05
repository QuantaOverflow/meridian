/**
 * 第五臂 b′：因果主线章节 + 一个「独立事态」章节，**分段写**。
 * 由用户在 2026-08-29 拍板（a/b/c 三选一里选 b′，写法选分段）。
 *
 * ── v2 的关键改动：结构不再交给模型 ────────────────────────────────────────────
 * v1 让每次调用写「一整个章节，节内自己分块、自己打 <u> 标记」，实测崩在两处：
 *   · 整节忘打 <u>（run2 的 us-iran 节写了 2347 字符、0 个标记）→ 前端靠数 <u> 认故事，等于丢整节
 *   · covered 度量数的是「计划里的报告数」而非产出的块，两轮都虚报 25/25
 * v2 改成 **一份报告 = 一次调用 = 一个块**：模型只写标题和正文，<u> 包装与章节归属由代码拼。
 * 于是块数、覆盖率都是 by construction，不用求模型自觉，也不用事后判官对账。
 * 代价：节内不再由模型合并「同一事件的不同侧面」——但规划步已经把它们分到同一节了，
 * 节内再判一次是重复劳动，且 arm B 已证明脏合并有害。改用「同节兄弟摘要」提示防重复。
 *
 * 跑：pnpm -F meridian-ai-worker prototype:bprime [repeats]
 *
 * ⚠️ 必须走 workers-ai/glm-4.7-flash（与生产 PHASE_DEFAULTS.brief_generation 同款）。
 * /meridian/chat 默认的 dashscope key 已 401 失效。skipCache 在 shared.chat 里恒为 true。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { here, reports, body, groundingRules, chat, pool, measure } from './shared.ts';

const REPEATS = Number(process.argv[2] ?? 1);
const N = reports.length;
const RULES = groundingRules();

// ── 规划步：从 25 条摘要里推因果主线（与 arm C 同一份 prompt，已实测能推出 13-15 条）────
function planPrompt(): string {
  const list = reports.map((r, i) => `[${i + 1}] ${r.executiveSummary}`).join('\n\n');
  return `below are ${N} intelligence reports from today. decide the SECTION
structure of the brief. do not write the brief.

${list}

a section is a real through-line: several reports that genuinely belong together through a
shared conflict, a shared mechanism, or a shared consequence. it is NOT a topic bucket.

- if two reports share only a country or a topic word but nothing causal, they belong in
  DIFFERENT sections.
- a heading that could sit on any day's brief ("technology", "world news", "geopolitics")
  is a failed heading. name the section after what actually happened.
- some reports describe the same single event from different angles — put those together.
- there is no target number of sections. derive it from the material.
- a report that shares no causal link with any other report is fine on its own — give it a
  section of exactly one report. do NOT force it into a neighbouring section to look tidy.
- for each section, state the causal link in one clause: what makes these one story.

also give every report a block title: a short phrase naming what that specific development is.
titles sit next to each other in a table of contents, so make each one distinguishable — two
reports in the same section must not get near-identical titles.
**write titles in lowercase**, including proper nouns — that is this brief's house style
(e.g. "the six-month stalemate in the persian gulf", "from treaty partner to 51st state").
do NOT use Title Case.

output json only:
{"sections":[{"heading":"...","causalLink":"...","reports":[{"i":1,"title":"..."},{"i":4,"title":"..."}]}]}
every report index 1-${N} must appear exactly once.`;
}

function parsePlan(raw: string): any {
  for (const c of [raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], raw.match(/\{[\s\S]*\}/)?.[0], raw]) {
    if (!c) continue;
    try { const o = JSON.parse(c.replace(/,\s*([}\]])/g, '$1')); if (Array.isArray(o?.sections)) return o; } catch {}
  }
  return null;
}

interface Ref { i: number; title: string }
interface Section { heading: string; causalLink: string; reports: Ref[] }

/**
 * 整成 b′ 形态并**程序化补齐覆盖**：去掉非法/重复索引 → 多报告的成主线、单报告的进「独立事态」
 * → 规划漏掉的索引也归进独立事态。返回结果里 1..N 恰好各出现一次，由代码保证，不问模型。
 */
function shape(plan: any): { main: Section[]; isolated: Ref[]; repaired: number[] } {
  const seen = new Set<number>();
  const clean: Section[] = [];
  for (const s of (plan.sections ?? []) as any[]) {
    const refs: Ref[] = (s.reports ?? [])
      .map((r: any) => (typeof r === 'number' ? { i: r, title: '' } : { i: Number(r?.i), title: String(r?.title ?? '').trim() }))
      .filter((r: Ref) => Number.isInteger(r.i) && r.i >= 1 && r.i <= N && !seen.has(r.i));
    refs.forEach((r) => seen.add(r.i));
    if (refs.length) clean.push({ heading: String(s.heading ?? '').trim(), causalLink: String(s.causalLink ?? '').trim(), reports: refs });
  }
  const repaired = Array.from({ length: N }, (_, i) => i + 1).filter((n) => !seen.has(n));
  const main = clean.filter((s) => s.reports.length >= 2);
  const isolated: Ref[] = [
    ...clean.filter((s) => s.reports.length === 1).flatMap((s) => s.reports),
    ...repaired.map((i) => ({ i, title: '' })),
  ].sort((a, b) => a.i - b.i);
  return { main, isolated, repaired };
}

// ── 写作步：一份报告一次调用，只要标题和正文 ──────────────────────────────────────
// ⚠️ 这里原来有一句「use **bold** for key specifics」。实测 b′ 粗体密度 2.63 条每千字，
// 而生产第 68-75 期是 0.00-0.81（69、71 两期全篇零粗体）。那句是写这个原型时自己加的，
// 不是从生产 prompt 继承来的——凭空把简报的视觉密度改成了另一个东西。砍掉。
const VOICE = `write in lowercase by default, conversational and direct, complete sentences.
blend facts and analysis in flowing paragraphs — what happened, why it matters strategically,
the likely motivations, second-order effects, and what most people are missing.
use markdown emphasis sparingly, only where a specific genuinely carries the paragraph.`;

/**
 * v3 的输出契约：**只有散文**。
 * v2 要「首行标题、空行、正文」，实测约 30% 的调用直接从正文写起、不给标题行——一整块作废
 * （诊断轮 8/25 全是这一种）。标题也是结构，一并从写作调用里拿走：由规划步产（它读过全部
 * 25 条摘要，标题之间更不容易撞），写作调用只剩「写好这几段」，非空即成功，没有格式可违反。
 */
const SHAPE = `write flowing paragraphs and nothing else.
no title line, no \`##\` heading, no \`<u>\` tags, no bullet list, no preamble, no sign-off —
the title is supplied elsewhere, do not write one.
do not let the \`[story k]\` tag appear in your output.`;

function blockPrompt(n: number, title: string, sec?: { heading: string; causalLink: string; siblings: number[] }): string {
  const src = `# [story ${n}] ${reports[n - 1].executiveSummary}\n\n` + body(reports[n - 1]);
  const ctx = sec
    ? `this block belongs to the section **${sec.heading}** — what makes that section one story:
${sec.causalLink}

the same section also covers the developments below, each written up separately by someone
else. do NOT re-tell them; assume the reader has them. you may refer to the through-line, but
your paragraphs must be about YOUR story only:
${sec.siblings.map((s) => `  · ${reports[s - 1].executiveSummary}`).join('\n')}`
    : `this development stands on its own — it shares no causal line with the rest of today's
news. cover it on its own terms and do NOT reach for connections to stories you don't have.
be substantive but tight: this is a standalone item, not a headline act.`;

  return `you are writing ONE analysis block of today's intelligence brief.
the block already has its title: **${title}** — write the paragraphs that sit under it.

${ctx}

<curated_news_data>

${src}

</curated_news_data>

**CRITICAL: FACTUAL GROUNDING RULES (these outrank everything below)**
${RULES}

${VOICE}

${SHAPE}`;
}

/** 只剥模型可能自作主张加的标记；正文非空即成功 */
function toProse(raw: string): string | null {
  const text = raw.trim()
    .replace(/^#+\s.*$/gm, '')                 // 自作主张的 ## 标题
    .replace(/^\s*<u>.*?<\/u>\s*$/gm, '')      // 自作主张的 <u> 标题行
    .replace(/\[story \d+(\/\d+)?\]/g, '')
    .trim();
  return text ? text : null;
}
const render = (title: string, text: string) => `<u>**${title}**</u>\n${text}`;

async function runOnce(run: number) {
  const plan = parsePlan(await chat(planPrompt(), 0, 4000));
  if (!plan?.sections?.length) throw new Error('规划解析失败');
  const { main, isolated, repaired } = shape(plan);

  // 规划没给标题的（含被程序补回的索引）单独补一次，20 token 的小调用
  const untitled = [...main.flatMap((s) => s.reports), ...isolated].filter((r) => !r.title);
  if (untitled.length) {
    const got = await pool(untitled, 4, (r) =>
      chat(`give a short plain-text title (a phrase, under 10 words) for this news development.
write it in lowercase, including proper nouns. output the title and nothing else.\n\n${reports[r.i - 1].executiveSummary}`, 0, 60));
    got.forEach((t, k) => { untitled[k].title = (t ?? '').trim().split('\n')[0].replace(/^[#*"'\s]+|[*"'\s]+$/g, '') || `story ${untitled[k].i}`; });
  }

  type Job = { r: Ref; sec?: { heading: string; causalLink: string; siblings: number[] } };
  const jobs: Job[] = [
    ...main.flatMap((s) => s.reports.map((r) => ({ r, sec: { heading: s.heading, causalLink: s.causalLink, siblings: s.reports.filter((x) => x.i !== r.i).map((x) => x.i) } }))),
    ...isolated.map((r) => ({ r })),
  ];
  const raws = await pool(jobs, 4, (j) => chat(blockPrompt(j.r.i, j.r.title, j.sec), 0.7, 2500));
  const blocks = new Map<number, string>();
  // 失败必须分得清是「调用没回来」还是「回来了但内容为空」——两者的修法完全不同
  const failures: { n: number; kind: 'call' | 'parse'; raw: string }[] = [];
  raws.forEach((r, i) => {
    const n = jobs[i].r.i;
    if (r === null) { failures.push({ n, kind: 'call', raw: '' }); return; }
    const t = toProse(r);
    if (t) blocks.set(n, t); else failures.push({ n, kind: 'parse', raw: r });
  });
  const missing = jobs.map((j) => j.r.i).filter((n) => !blocks.has(n));

  const parts: string[] = [];
  for (const s of main) {
    const bs = s.reports.filter((r) => blocks.has(r.i)).map((r) => render(r.title, blocks.get(r.i)!));
    if (bs.length) parts.push(`## ${s.heading.toLowerCase()}\n\n${bs.join('\n\n')}`);
  }
  const iso = isolated.filter((r) => blocks.has(r.i)).map((r) => render(r.title, blocks.get(r.i)!));
  if (iso.length) parts.push(`## 独立事态\n\n${iso.join('\n\n')}`);
  const brief = parts.join('\n\n');
  const m = measure(brief);

  // ── 卫生断言：度量必须直接数产出，且互相对得上。对不上就报，不许静默通过 ──────────
  const perSection = brief.split(/^## /m).filter(Boolean).map((s) => ({ h: s.split('\n')[0].trim(), u: (s.match(/<u>/g) ?? []).length, chars: s.length }));
  const violations: string[] = [];
  if (m.blocks !== blocks.size) violations.push(`正文 <u> 数 ${m.blocks} ≠ 成功块数 ${blocks.size}`);
  // ⚠️ 这里原来写的是 `blocks.size + missing.length !== N`——同义反复：missing 就是 blocks 的
  // 补集，两者之和恒等于 N，哪怕 0/25 全失败也不会报警。「覆盖由代码保证」要成立，必须直接
  // 要求一个都不许缺，而不是要求两个数加起来对得上。
  if (missing.length) violations.push(`${missing.length} 个 story 没有块: ${missing.join(',')}`);
  if (perSection.some((s) => s.u === 0)) violations.push(`有 0 块的章节: ${perSection.filter((s) => !s.u).map((s) => s.h).join(', ')}`);
  if (new Set([...main.flatMap((s) => s.reports), ...isolated].map((r) => r.i)).size !== N) violations.push('分节后索引不是恰好覆盖 1..N');
  const rawTitles = [...main.flatMap((s) => s.reports), ...isolated].map((r) => r.title);
  const titles = rawTitles.map((t) => t.toLowerCase());
  if (new Set(titles).size !== titles.length) violations.push('有重复标题');
  const upper = rawTitles.filter((t) => t !== t.toLowerCase());
  if (upper.length) violations.push(`${upper.length} 个标题不是全小写（生产文风是全小写）: ${upper.slice(0, 3).join(' / ')}`);
  // 粗体密度：生产第 68-75 期实测 0.00-0.81 条每千字，超 1.5 就是漂了
  const boldPerK = ((brief.match(/\*\*[^*]+\*\*/g) ?? []).length - m.blocks) * 1000 / Math.max(brief.length, 1);
  if (boldPerK > 1.5) violations.push(`正文粗体密度 ${boldPerK.toFixed(2)} 条每千字，生产基线 0.00-0.81`);

  return {
    run, planSections: plan.sections.length, mainSections: main.length, isolatedCount: isolated.length,
    repaired, missing, failures, covered: blocks.size, ...m, perSection, violations,
    plan: { main, isolated }, brief,
  };
}

console.log(`输入：${N} 份情报报告（第 75 期）；接地规则切片 ${RULES.length} 字符`);
console.log(`生产第 75 期实际：1 个主线章节 / 3 个块\n`);

const results: any[] = [];
for (let r = 1; r <= REPEATS; r++) {
  process.stderr.write(`run ${r}/${REPEATS} …\n`);
  try { results.push(await runOnce(r)); }
  catch (e) { results.push({ run: r, err: e instanceof Error ? e.message : String(e) }); }
}

for (const r of results) {
  if (r.err) { console.log(`\x1b[31mrun ${r.run} 失败: ${r.err}\x1b[0m`); continue; }
  console.log(`\x1b[1mrun ${r.run}\x1b[0m  规划 ${r.planSections} 节 → 主线 ${r.mainSections} + 独立 ${r.isolatedCount}${r.repaired.length ? `（规划漏掉 ${r.repaired.join(',')}，已补进独立）` : ''}`);
  console.log(`  章节 ${r.sections}  块 ${r.blocks}  正文 ${r.chars} 字符  每块均 ${Math.round(r.chars / Math.max(r.blocks, 1))}`);
  const byKind = (k: string) => r.failures.filter((f: any) => f.kind === k).map((f: any) => f.n);
  console.log(`  覆盖 ${r.covered}/${N}${r.missing.length ? `  \x1b[31m失败: 调用 [${byKind('call').join(',')}] 解析 [${byKind('parse').join(',')}]\x1b[0m` : ''}`);
  r.failures.filter((f: any) => f.kind === 'parse').forEach((f: any) =>
    console.log(`    \x1b[31m story ${f.n} 解析失败，原始 ${f.raw.length} 字符: ${JSON.stringify(f.raw.slice(0, 160))}\x1b[0m`));
  r.perSection.forEach((s: any) => console.log(`    \x1b[2m## ${s.h.slice(0, 44).padEnd(44)} ${String(s.u).padStart(2)} 块  ${s.chars} 字符\x1b[0m`));
  console.log(r.violations.length ? `  \x1b[31m⚠ 卫生断言不过: ${r.violations.join('; ')}\x1b[0m\n` : `  \x1b[32m✓ 卫生断言全过\x1b[0m\n`);
}

const out = join(here, 'bprime-result.json');
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`明细（含全文）→ ${out}`);
