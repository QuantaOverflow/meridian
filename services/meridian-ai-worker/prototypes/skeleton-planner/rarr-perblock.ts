/**
 * 分块 RARR 探针：草稿按块切，**源材料的宽窄可切换**。
 *
 * 三档 oracle 各有各的病，实测：
 *   own     只给本块自己那份报告  → 真误删 10 条（跨报告的正确内容被当成无据）
 *   full    给全部 25 份          → 真误删 3 条，但**把别的报告的实体嫁接过来**
 *                                  （rob bonta → Jay Jones，两个州的总检察长混成一个）
 *   section 给本块所在**因果主线**那一节的报告 ← 本轮要测的
 *
 * section 档的依据（离线用现有数据反事实算过）：own 档那 11 条真误删，内容 11/11 都在同节
 * 其他报告里，所以同节源能全部救回；同时源比 full 窄，嫁接面也小。
 * 关联关系是免费的——规划步已经按因果主线分好节，不需要检索。
 *
 * 假设：短草稿 → 编辑表只有几条 → 没有长列表可卡 → 不复读；
 *       全量源 → 跨报告事实仍能找到依据 → 不误删。
 * 两个已知失败模式各自的成因不同，理论上可以同时避开。
 *
 * 跑：pnpm -F meridian-ai-worker prototype:rarr [own|full]   默认 full
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { here, reports, body, pool, AI } from './shared.ts';
import { getBriefVerificationPrompt } from '../../src/prompts/briefGeneration.ts';

const MODE = (process.argv[2] ?? 'section') as 'own' | 'full' | 'section';
const TAG = process.argv[3] ?? '';   // 同档多轮时区分文件名，用来量方差
const run = JSON.parse(readFileSync(join(here, 'bprime-result.json'), 'utf8')).find((x: any) => x.run === 1);
const fullSource = readFileSync(join(here, 'source-oracle.md'), 'utf8');

const titleToIdx = new Map<string, number>();
for (const r of [...run.plan.main.flatMap((s: any) => s.reports), ...run.plan.isolated]) titleToIdx.set(r.title.trim(), r.i);

/** story i → 同节的 story 集合。独立事态各自成节（只有自己）。 */
const sectionOf = new Map<number, number[]>();
for (const sec of run.plan.main) {
  const ids = sec.reports.map((r: any) => r.i);
  for (const i of ids) sectionOf.set(i, ids);
}
for (const r of run.plan.isolated) sectionOf.set(r.i, [r.i]);

interface Blk { i: number; title: string; text: string; src: number | null }
const blocks: Blk[] = [];
for (const chunk of run.brief.split(/^\s*<u>/m).slice(1)) {
  const m = chunk.match(/^\*{0,2}(.*?)\*{0,2}<\/u>\s*([\s\S]*?)(?=\n## |$)/);
  if (!m) continue;
  const title = m[1].trim();
  blocks.push({ i: blocks.length, title, text: m[2].trim(), src: titleToIdx.get(title) ?? null });
}

/** 直连：必须看得见 finish_reason，截断与否是要测的东西之一 */
async function raw(prompt: string, maxTokens: number) {
  const res = await fetch(`${AI}/meridian/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }],
      options: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, max_tokens: maxTokens, skipCache: true } }),
    signal: AbortSignal.timeout(300_000),
  });
  const j: any = await res.json();
  if (!res.ok || j?.success === false) throw new Error(j?.error ?? `HTTP ${res.status}`);
  const ch = j?.data?.choices?.[0];
  return { content: ch?.message?.content ?? '', finish: ch?.finish_reason ?? '?' };
}


/**
 * 代码守卫：拒绝「专名嫁接」型 edit。
 *
 * 实测 oracle=full 时 RARR 把 `rob bonta` 改成 `Jay Jones`——它在别的报告里看见另一个州的
 * 总检察长，就覆盖掉了本块里正确的加州总检察长。**把对的改成了错的**，比漏改严重。
 *
 * 判据：被替换的片段像专名（有字母、无数字/货币符号、≤4 词）、替换文本也像专名、
 * 且**原文在源里逐字存在**——RARR 的职责是修「源里没有的东西」，原名源里明明有还要换掉，
 * 基本都是跨报告实体混淆。
 *
 * ⚠️ 必须限定在专名上。第一版把数字也管了，会拦掉 RARR 正在**正确修复**的跨块金额冲突
 * （$18 billion → $17.1 billion）。数字需要归一，人名只有一个正确指称，两者不能一刀切。
 */
/** 词边界匹配：`'op'` 用子串匹配会在源里恒真，必须按词界找，且太短的片段不判 */
function inSource(s: string, source: string): boolean {
  const t = s.trim().toLowerCase();
  if (t.length < 4) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(source.toLowerCase());
}

const nameish = (s: string) =>
  /[a-z]/i.test(s) && !/[\d$%]/.test(s) && s.trim().split(/\s+/).length <= 4;

/** G1 专名嫁接：源里明明有这个名字，却要换成另一个名字 —— 多是跨报告实体混淆 */
function isGraft(span: string, replacement: string, source: string): boolean {
  if (!replacement || replacement.toLowerCase() === span.toLowerCase()) return false;
  if (!(nameish(span) && nameish(replacement))) return false;
  if (span.trim().split(/\s+/).length < 2 && span.trim().length < 6) return false;
  return inSource(span, source);
}

/** G2 误删：要删掉的内容在源里逐字存在 —— 这正是「误删」的定义 */
function isBadDelete(span: string, replacement: string, source: string): boolean {
  return replacement === '' && inSource(span, source);
}

/**
 * G4 膨胀：替换文本比原文长出一半以上 —— 这是在补充信息而不是修错。
 * 实测这类 edit 的内容全是「补上草稿没写的细节」（"setting opening proceedings…"、
 * "choosing not to destroy its…"），不是修正。RARR 原论文把「最小编辑」当核心约束，
 * 保留原意 >90% 是它的评测指标之一；我们此前的实现丢了这条。
 */
function isBloat(span: string, replacement: string): boolean {
  return replacement.trim().length > 1.5 * span.trim().length;
}

/** G3 空转：替换文本与原文逐字相同，模型在输出「确认」而不是「修改」 */
function isNoop(span: string, replacement: string): boolean {
  return replacement.trim().toLowerCase() === span.trim().toLowerCase();
}

function parseEdits(s: string): any[] | null {
  for (const c of [s.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], s.match(/\{[\s\S]*\}/)?.[0], s]) {
    if (!c) continue;
    try { const o = JSON.parse(c.replace(/,\s*([}\]])/g, '$1')); if (Array.isArray(o?.edits)) return o.edits; } catch {}
  }
  return null;
}

console.log(`模式 oracle=${MODE}${TAG ? ' 轮次' + TAG : ''}  ${blocks.length} 块  源=${MODE === 'full' ? fullSource.length + ' 字符(全量)' : MODE === 'section' ? '同节报告' : '各块自己那份'}\n`);

const out = await pool(blocks, 4, async (b) => {
  if (!b.src) return null;
  const one = (n: number) => `# [story ${n}] ${reports[n - 1].executiveSummary}\n\n` + body(reports[n - 1]);
  const oracle =
    MODE === 'full' ? fullSource
    : MODE === 'section' ? (sectionOf.get(b.src) ?? [b.src]).map(one).join('\n---\n\n')
    : one(b.src);
  const r = await raw(getBriefVerificationPrompt(b.text, oracle), 4000);
  const spans = [...r.content.matchAll(/"brief_span"\s*:\s*"(.*?)"/g)].map((m) => m[1]);
  const uniq = new Set(spans).size;
  const looped = spans.length > 0 && uniq > 0 && spans.length / uniq >= 2;
  const edits = parseEdits(r.content);
  let text = b.text, applied = 0, skipped = 0;
  const graftEdits: any[] = [], badDeleteEdits: any[] = [], noopEdits: any[] = [];
  const bloatEdits: any[] = [];
  for (const e of edits ?? []) {
    if (typeof e?.brief_span !== 'string' || !e.brief_span) continue;
    const rep = typeof e.replacement === 'string' ? e.replacement : '';
    // 守卫查全量源：原名只要在**任何一份**报告里存在，就不该被替换/删掉；顺序：空转→误删→嫁接
    if (isNoop(e.brief_span, rep)) { noopEdits.push(e); continue; }
    if (isBadDelete(e.brief_span, rep, fullSource)) { badDeleteEdits.push(e); continue; }
    if (isGraft(e.brief_span, rep, fullSource)) { graftEdits.push(e); continue; }
    if (rep && isBloat(e.brief_span, rep)) { bloatEdits.push(e); continue; }
    if (text.includes(e.brief_span)) { text = text.replace(e.brief_span, rep); applied++; } else skipped++;
  }
  const blocked = graftEdits.length + badDeleteEdits.length + noopEdits.length + bloatEdits.length;
  return { b, edits, applied, skipped, blocked, graftEdits, badDeleteEdits, noopEdits, bloatEdits, text, looped, truncated: r.finish === 'length' || r.finish === 'max_tokens', parsed: edits !== null, nSpan: spans.length, uniq };
});

const ok = out.filter(Boolean) as NonNullable<(typeof out)[number]>[];
const looped = ok.filter((r) => r.looped).length;
const trunc = ok.filter((r) => r.truncated).length;
const unparsed = ok.filter((r) => !r.parsed).length;
console.log(`调用成功 ${ok.length}/${blocks.length}`);
console.log(`🔴 复读 ${looped} 块   截断 ${trunc} 块   解析失败 ${unparsed} 块`);
console.log(`edits ${ok.reduce((a, r) => a + (r.edits?.length ?? 0), 0)}，applied ${ok.reduce((a, r) => a + r.applied, 0)}，skipped ${ok.reduce((a, r) => a + r.skipped, 0)}`);
const graftAll = ok.flatMap((r) => r.graftEdits.map((e: any) => ({ t: r.b.title, e })));
const badDeleteAll = ok.flatMap((r) => r.badDeleteEdits.map((e: any) => ({ t: r.b.title, e })));
const noopAll = ok.flatMap((r) => r.noopEdits.map((e: any) => ({ t: r.b.title, e })));
const bloatAll = ok.flatMap((r) => r.bloatEdits.map((e: any) => ({ t: r.b.title, e })));
console.log(`守卫拦下：G1 专名嫁接 ${graftAll.length} / G2 误删 ${badDeleteAll.length} / G3 空转 ${noopAll.length} / G4 膨胀 ${bloatAll.length}`);
bloatAll.forEach(({ t, e }) => console.log(`  [G4] 《${t.slice(0, 28)}》 ${String(e.brief_span).length}→${String(e.replacement).length} 字符「${String(e.brief_span).slice(0, 55)}」`));
graftAll.forEach(({ t, e }) => console.log(`  [G1] 《${t.slice(0, 30)}》「${e.brief_span}」→「${e.replacement}」 ${String(e.reason).slice(0, 70)}`));
noopAll.forEach(({ t, e }) => console.log(`  [G3] 《${t.slice(0, 30)}》「${e.brief_span}」 ${String(e.reason).slice(0, 70)}`));
// 最小编辑幅度：真替换的改写程度。RARR 原论文把「保留原意」当核心指标，
// 之前实测 58% 的替换相似度 <0.9（同量重写），这一轮看 prompt 约束有没有把分布拉回去。
const sim = (a: string, b: string) => {
  const A = a.toLowerCase(), B = b.toLowerCase();
  if (!A.length || !B.length) return 0;
  const grams = (x: string) => { const g = new Set<string>(); for (let i = 0; i < x.length - 2; i++) g.add(x.slice(i, i + 3)); return g; };
  const ga = grams(A), gb = grams(B);
  if (!ga.size || !gb.size) return A === B ? 1 : 0;
  let inter = 0; ga.forEach((g) => { if (gb.has(g)) inter++; });
  return (2 * inter) / (ga.size + gb.size);
};
const subs = ok.flatMap((r) => (r.edits ?? []).filter((e: any) => typeof e?.replacement === 'string' && e.replacement.trim() && e.replacement.trim().toLowerCase() !== String(e.brief_span).trim().toLowerCase()));
const sims = subs.map((e: any) => sim(String(e.brief_span), e.replacement)).sort((a, b) => a - b);
if (sims.length) {
  const med = sims[Math.floor(sims.length / 2)];
  const lt = (t: number) => sims.filter((x) => x < t).length;
  console.log(`\n最小编辑幅度：真替换 ${sims.length} 条，相似度中位 ${med.toFixed(2)}；<0.9 有 ${lt(0.9)} 条(${(lt(0.9) / sims.length * 100).toFixed(0)}%)、<0.5 有 ${lt(0.5)} 条`);
  console.log(`  （加约束前实测：中位 0.85，<0.9 占 58%，<0.5 占 13%）`);
}

console.log(`\n[G2 误删] ${badDeleteAll.length} 条 —— 完整打印，逐条人工裁定：`);
badDeleteAll.forEach(({ t, e }, idx) => {
  console.log(`  ${idx + 1}. 《${t}》`);
  console.log(`     brief_span: ${e.brief_span}`);
  console.log(`     reason: ${e.reason}`);
});

// ── 误删率：被删的内容能不能在**全量源**里找到（能找到 = 误删）────────────────────
const fullLower = fullSource.toLowerCase();
let del = 0, wrongDel = 0;
const wrongSamples: string[] = [];
for (const r of ok) for (const e of r.edits ?? []) {
  if (e?.replacement !== '' || typeof e.brief_span !== 'string' || !r.b.text.includes(e.brief_span)) continue;
  del++;
  const key = e.brief_span.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w: string) => w.length > 4);
  if (key.length >= 2 && key.filter((w: string) => fullLower.includes(w)).length / key.length >= 0.8) {
    wrongDel++;
    if (wrongSamples.length < 4) wrongSamples.push(`《${r.b.title.slice(0, 30)}》 删「${e.brief_span.slice(0, 64)}」`);
  }
}
console.log(`\n删除型 edit ${del} 条，其中内容能在全量源里找到（=误删）${wrongDel} 条 = ${del ? (wrongDel / del * 100).toFixed(0) : 0}%`);
console.log(`  （oracle=own 那轮实测是 39 条删除 / 67% 误删）`);
wrongSamples.forEach((s) => console.log(`    ${s}`));

// ── 地面真值：三处人工确认的真错 ───────────────────────────────────────────────
const before = run.brief, after = ok.map((r) => r.text).join('\n\n');
const PROBES = [
  { n: '① Høiby「国王的儿子」', re: /king.{0,3}s son,?\s*marius/i },
  { n: '① Høiby「他父亲的床边」', re: /his father'?s bedside/i },
  { n: '② 夏尔马致电莫迪', re: /balendra shah[^.]{0,60}spoke with[^.]{0,30}modi/i },
];
console.log('\n地面真值探针（判官 0/3、oracle=own 的 RARR 也 0/3）：');
PROBES.forEach((p) => console.log(`  ${p.re.test(before) ? (p.re.test(after) ? '✗ 没收' : '✓ 收了') : '⚠ 探针没匹配上原文'}  ${p.n}`));

writeFileSync(join(here, `rarr-perblock-${MODE}${TAG}.json`), JSON.stringify({
  mode: MODE, looped, trunc, unparsed, del, wrongDel,
  graftBlocked: graftAll.length, badDeleteBlocked: badDeleteAll.length, noopBlocked: noopAll.length,
  blocks: ok.map((r) => ({
    title: r.b.title, edits: r.edits, applied: r.applied, blocked: r.blocked,
    graftEdits: r.graftEdits, badDeleteEdits: r.badDeleteEdits, noopEdits: r.noopEdits,
    looped: r.looped, before: r.b.text, after: r.text,
  })),
}, null, 2));
console.log(`\n明细 → rarr-perblock-${MODE}.json`);
