/**
 * 【扔掉型原型】用**生产在跑的 b′ 路径**做简报层对照。
 *
 * ⚠️ 前两次简报层实验都用错了端点：打的是 `/generate-final-brief`（整篇合成，旧路径），
 * 而生产跑的是 b′（`plan-brief-skeleton` → `write-brief-block` ×N → `assemble-brief`）。
 * b′ 的关键性质：**一份报告 = 一块**，章节归属由规划步定，结构由代码保证，不让模型自由分组。
 * 证据：report 79/80/81 都带 `standalone developments` 节，那是 b′ 的 ISOLATED_HEADING。
 *
 * 两臂共用同样 14 份非尼泊尔报告（生产 R2 原样），差异只在尼泊尔部分：
 *   PROD  + 11 份生产尼泊尔报告   （25 份）
 *   NEW   +  5 份 storyline 报告   （19 份）
 *
 * 编排逐字照抄 auto-brief-generation.ts 5a/5b/5c：规划 → 逐块写作（含 siblingTitles）→ 拼装。
 *
 * 跑法：npx tsx bprime-ab.ts
 */
import { writeFileSync } from 'node:fs';

const BASE = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian';
const WF = 'admin-brief-1788058777778';
const NEPAL_IDX = [1, 3, 4, 5, 8, 10, 11, 15, 16, 21, 22];
const prodKey = (i: number) => `intel-reports/${WF}/${i}.json`;
const otherKeys = Array.from({ length: 25 }, (_, i) => i).filter((i) => !NEPAL_IDX.includes(i)).map(prodKey);
const prodNepalKeys = NEPAL_IDX.map(prodKey);
const newNepalKeys = [0, 1, 2, 3, 4].map((i) => `intel-reports/proto-storyline/${i}.json`);
if (otherKeys.length !== 14) throw new Error(`卫生断言失败：非尼泊尔应 14 份，拿到 ${otherKeys.length}`);

async function post(path: string, body: any): Promise<any> {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j: any = await r.json();
  if (j?.success === false) throw new Error(`${path}: ${j?.error}${j?.metadata?.details ? ' / ' + j.metadata.details : ''}`);
  return j?.data ?? j;
}
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let cur = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (cur < items.length) { const i = cur++; out[i] = await fn(items[i]); }
  }));
  return out;
}

async function runArm(tag: string, reportKeys: string[]) {
  console.log(`\n══════ ${tag}：${reportKeys.length} 份报告`);
  const sk = await post('/plan-brief-skeleton', { reportKeys });
  console.log(`  骨架：主线 ${sk.main.length} 节 / 独立事态 ${sk.isolated.length} 条` +
    (sk.repaired?.length ? `（规划漏掉 ${sk.repaired.join(',')}，代码已补）` : ''));
  for (const s of sk.main) console.log(`     ${String(s.reports.length).padStart(2)} 块  ${s.heading}`);
  console.log(`     ${String(sk.isolated.length).padStart(2)} 块  standalone developments`);

  // 逐块写作，jobs 构造逐字照抄 backend（含同节兄弟的块标题）
  type Job = { i: number; title: string; section?: { heading: string; causalLink: string; siblingTitles: string[] } };
  const jobs: Job[] = [
    ...sk.main.flatMap((s: any) => s.reports.map((r: any) => ({
      i: r.i, title: r.title,
      section: { heading: s.heading, causalLink: s.causalLink,
        siblingTitles: s.reports.filter((x: any) => x.i !== r.i).map((x: any) => x.title) },
    }))),
    ...sk.isolated.map((r: any) => ({ i: r.i, title: r.title })),
  ];
  let done = 0;
  const blocks = await pool(jobs, 6, async (job) => {
    const b = await post('/write-brief-block', { reportKeys, index: job.i - 1, title: job.title, section: job.section });
    if (++done % 6 === 0) process.stderr.write(`    块 ${done}/${jobs.length}\n`);
    return { index: b.index, title: b.title, text: b.text, verified: b.verified };
  });
  const unver = blocks.filter((b) => !b.verified).length;
  const brief = await post('/assemble-brief', { reportKeys, skeleton: sk, blocks });
  console.log(`  写作 ${blocks.length}/${jobs.length} 块（未经 RARR 核验 ${unver}）｜简报 ${brief.content.length} 字符`);
  return { skeleton: sk, blocks, brief };
}

const NEP = /nepal|tibet|glacier|glacial|himalay|trishuli|bhotekoshi|gyirong|kathmandu/i;
function report(tag: string, r: any) {
  const md = r.brief.content;
  const secs = md.split(/^## /m).slice(1);
  let nb = 0, ob = 0, nc = 0, oc = 0;
  console.log(`\n── ${tag} 结构`);
  for (const s of secs) {
    const t = s.split('\n')[0].trim();
    const blocks = s.split(/<u>\*\*|\*\*<u>/).slice(1);
    console.log(`   ${String(blocks.length).padStart(2)} 块 / ${String(s.length).padStart(5)} 字  ${t.slice(0, 56)}`);
    for (const b of blocks) { if (NEP.test(b)) { nb++; nc += b.length; } else { ob++; oc += b.length; } }
  }
  console.log(`   ── 尼泊尔 ${nb} 块 / ${nc} 字｜其他 ${ob} 块 / ${oc} 字｜尼泊尔占版面 ${(nb / (nb + ob) * 100).toFixed(0)}%`);
  return { nb, ob, nc, oc, chars: md.length };
}

const A = await runArm('PROD  14 + 11 份生产尼泊尔', [...otherKeys, ...prodNepalKeys]);
const B = await runArm('NEW   14 +  5 份 storyline', [...otherKeys, ...newNepalKeys]);
writeFileSync('bprime-prod.md', A.brief.content);
writeFileSync('bprime-new.md', B.brief.content);
const sa = report('PROD', A), sb = report('NEW', B);
console.log(`\n══ 对照`);
console.log(`  尼泊尔块数     ${sa.nb} → ${sb.nb}`);
console.log(`  尼泊尔字数     ${sa.nc} → ${sb.nc}`);
console.log(`  其他事件块数   ${sa.ob} → ${sb.ob}`);
console.log(`  其他事件字数   ${sa.oc} → ${sb.oc}`);
console.log(`  尼泊尔占版面   ${(sa.nb / (sa.nb + sa.ob) * 100).toFixed(0)}% → ${(sb.nb / (sb.nb + sb.ob) * 100).toFixed(0)}%`);
writeFileSync('bprime-ab-out.json', JSON.stringify({ prod: A, next: B }, null, 1));
console.log('\n落盘：bprime-prod.md / bprime-new.md');
