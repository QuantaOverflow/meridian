/**
 * 批量跑：每天 × 每个温度 × N 次重复，统计粒度与跨次方差。
 * TUI 用来手感，这个用来出数据。逻辑同样全在 skeleton.ts。
 *
 * 跑：pnpm -F meridian-ai-worker prototype:skeleton:batch [repeats]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt, parseSkeleton, validate, stats, SYSTEM, type DayInput } from './skeleton.ts';

const here = dirname(fileURLToPath(import.meta.url));
const AI_WORKER = process.env.AI_WORKER_URL ?? 'https://meridian-ai-worker.swj299792458.workers.dev';
const REPEATS = Number(process.argv[2] ?? 3);
const TEMPS = [0, 0.7];
const CONC = 4;

const days: DayInput[] = readdirSync(join(here, 'fixtures'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(here, 'fixtures', f), 'utf8')))
  .sort((a, b) => a.reportId - b.reportId);

async function callLLM(prompt: string, temperature: number): Promise<string> {
  const res = await fetch(`${AI_WORKER}/meridian/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
      options: {
        provider: 'workers-ai',
        model: '@cf/zai-org/glm-4.7-flash',
        temperature,
        max_tokens: 4000,
        skipCache: true, // 不跳缓存会把「稳定」测成假象
      },
    }),
  });
  const j: any = await res.json();
  if (!res.ok || j?.success === false) throw new Error(j?.error ?? `HTTP ${res.status}`);
  return j?.data?.choices?.[0]?.message?.content ?? '';
}

interface Row {
  reportId: number; temp: number; run: number;
  ok: boolean; sections?: number; blocks?: number; events: number;
  ratio?: number; folded?: number; noteworthy?: number;
  errors: number; warns: number; errorMsgs: string[]; ms: number;
  headings?: string[];
}

const jobs: { day: DayInput; temp: number; run: number }[] = [];
for (const day of days) for (const temp of TEMPS) for (let r = 1; r <= REPEATS; r++) jobs.push({ day, temp, run: r });

const rows: Row[] = [];
let done = 0;

async function work(j: (typeof jobs)[number]): Promise<void> {
  const t0 = Date.now();
  try {
    const raw = await callLLM(buildPrompt(j.day), j.temp);
    const sk = parseSkeleton(raw);
    if (!sk) {
      rows.push({ reportId: j.day.reportId, temp: j.temp, run: j.run, ok: false, events: j.day.events.length, errors: 1, warns: 0, errorMsgs: ['JSON 解析失败'], ms: Date.now() - t0 });
    } else {
      const st = stats(sk, j.day);
      const iss = validate(sk, j.day);
      rows.push({
        reportId: j.day.reportId, temp: j.temp, run: j.run, ok: true,
        sections: st.sections, blocks: st.blocks, events: st.events, ratio: st.blockRatio,
        folded: st.folded, noteworthy: st.noteworthy,
        errors: iss.filter((i) => i.level === 'error').length,
        warns: iss.filter((i) => i.level === 'warn').length,
        errorMsgs: iss.filter((i) => i.level === 'error').map((i) => i.message),
        ms: Date.now() - t0,
        headings: sk.sections.map((s) => s.heading),
      });
    }
  } catch (e) {
    rows.push({ reportId: j.day.reportId, temp: j.temp, run: j.run, ok: false, events: j.day.events.length, errors: 1, warns: 0, errorMsgs: [`调用失败: ${e instanceof Error ? e.message : String(e)}`], ms: Date.now() - t0 });
  }
  done++;
  process.stderr.write(`\r进度 ${done}/${jobs.length}`);
}

// 简单并发池
const queue = [...jobs];
await Promise.all(
  Array.from({ length: CONC }, async () => {
    for (;;) {
      const j = queue.shift();
      if (!j) return;
      await work(j);
    }
  })
);
process.stderr.write('\n\n');

// ── 汇总 ────────────────────────────────────────────────────────────────
const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;

console.log(B('每天 × 每温度：块数分布'));
console.log(D('期  事件  生产实际  温度   块数(各次)          比值范围        错误'));
for (const day of days) {
  for (const temp of TEMPS) {
    const rs = rows.filter((r) => r.reportId === day.reportId && r.temp === temp);
    const okr = rs.filter((r) => r.ok);
    const blocks = okr.map((r) => r.blocks!);
    const ratios = okr.map((r) => r.ratio!);
    const errs = rs.reduce((a, r) => a + r.errors, 0);
    const rng = ratios.length ? `${Math.min(...ratios).toFixed(2)}–${Math.max(...ratios).toFixed(2)}` : '-';
    console.log(
      `${String(day.reportId).padEnd(4)}${String(day.events.length).padEnd(6)}` +
      `${String(day.actualBlocksInBrief).padEnd(10)}${String(temp).padEnd(7)}` +
      `${blocks.join(',').padEnd(20)}${rng.padEnd(16)}${errs}`
    );
  }
}

console.log('');
console.log(B('校验错误汇总') + D('（代码查出来的，零 LLM）'));
const msgs = new Map<string, number>();
for (const r of rows) for (const m of r.errorMsgs) {
  const key = m.replace(/cluster \d+/, 'cluster N');
  msgs.set(key, (msgs.get(key) ?? 0) + 1);
}
if (msgs.size === 0) console.log(D('  无'));
for (const [m, n] of [...msgs.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}×  ${m}`);

console.log('');
console.log(B('对照：生产 vs 原型（温度 0）'));
console.log(D('期    事件  生产块数/比值      原型块数中位/比值'));
for (const day of days) {
  const okr = rows.filter((r) => r.reportId === day.reportId && r.temp === 0 && r.ok);
  const bs = okr.map((r) => r.blocks!).sort((a, b) => a - b);
  const med = bs.length ? bs[Math.floor(bs.length / 2)] : NaN;
  const prodRatio = day.actualBlocksInBrief / day.events.length;
  console.log(
    `${String(day.reportId).padEnd(6)}${String(day.events.length).padEnd(6)}` +
    `${String(day.actualBlocksInBrief).padEnd(6)}${prodRatio.toFixed(2).padEnd(12)}` +
    `${String(Number.isNaN(med) ? '-' : med).padEnd(12)}${Number.isNaN(med) ? '-' : (med / day.events.length).toFixed(2)}`
  );
}

writeFileSync(join(here, 'batch-result.json'), JSON.stringify(rows, null, 2));
console.log('');
console.log(D(`明细已写入 prototypes/skeleton-planner/batch-result.json（${rows.length} 行）`));
