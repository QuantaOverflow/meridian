/**
 * 整篇 RARR 探针：草稿 = b′ 全文，oracle = 全量 25 份报告（与生产 verifyAndCorrect 同构）。
 *
 * 为什么回到整篇：分块 RARR 实测 39 条删除里 26 条（67%）删的是「在源里、只是在别的
 * 报告里」的内容——窄 oracle 让校验器把跨报告事实一律当成无据。写作阶段窄 oracle 是
 * 解药（防串源），校验阶段是毒药。
 *
 * 要测的就一件事：37k 草稿的编辑表会不会撞 maxTokens。逐档加预算看 finish_reason。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { here, AI } from './shared.ts';
import { getBriefVerificationPrompt } from '../../src/prompts/briefGeneration.ts';

const run = JSON.parse(readFileSync(join(here, 'bprime-result.json'), 'utf8')).find((x: any) => x.run === 1);
const source = readFileSync(join(here, 'source-oracle.md'), 'utf8');
const armA = readFileSync(join(here, 'armA-brief.md'), 'utf8');

/** 直连而不用 shared.chat：这里必须看见 finish_reason，截断与否是本次唯一要测的东西 */
async function raw(prompt: string, maxTokens: number) {
  const res = await fetch(`${AI}/meridian/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      options: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, max_tokens: maxTokens, skipCache: true },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const j: any = await res.json();
  if (!res.ok || j?.success === false) throw new Error(j?.error ?? `HTTP ${res.status}`);
  const ch = j?.data?.choices?.[0];
  return { content: ch?.message?.content ?? '', finish: ch?.finish_reason ?? '?', usage: j?.data?.usage };
}

function parseEdits(s: string): any[] | null {
  for (const c of [s.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], s.match(/\{[\s\S]*\}/)?.[0], s]) {
    if (!c) continue;
    try { const o = JSON.parse(c.replace(/,\s*([}\]])/g, '$1')); if (Array.isArray(o?.edits)) return o.edits; } catch {}
  }
  return null;
}

const PROBES = [
  { name: '① Høiby「国王的儿子」', bad: /king.{0,3}s son,?\s*marius/i },
  { name: '① Høiby「他父亲的床边」', bad: /his father'?s bedside/i },
  { name: '② 夏尔马致电莫迪', bad: /balendra shah[^.]{0,60}spoke with[^.]{0,30}modi/i },
];

for (const [label, draft] of [['A 臂 (15k, 生产同量级)', armA], ["b′ (37k)", run.brief]] as const) {
  console.log(`\n════ ${label} ════`);
  for (const budget of [4000, 12000]) {
    const prompt = getBriefVerificationPrompt(draft, source);
    try {
      const r = await raw(prompt, budget);
      const edits = parseEdits(r.content);
      const truncated = r.finish === 'length' || r.finish === 'max_tokens';
      console.log(`  maxTokens ${String(budget).padStart(5)}: finish=${r.finish}${truncated ? ' ⚠截断' : ''}  输出 ${r.content.length} 字符  edits=${edits === null ? '解析失败' : edits.length}  in/out=${r.usage?.prompt_tokens ?? '?'}/${r.usage?.completion_tokens ?? '?'}`);
      if (edits && draft === run.brief && budget === 12000) {
        let after = draft, applied = 0;
        for (const e of edits) {
          if (typeof e?.brief_span !== 'string' || !e.brief_span) continue;
          const rep = typeof e.replacement === 'string' ? e.replacement : '';
          if (after.includes(e.brief_span)) { after = after.replace(e.brief_span, rep); applied++; }
        }
        console.log(`    applied ${applied}/${edits.length}`);
        console.log(`    地面真值探针：`);
        PROBES.forEach((p) => console.log(`      ${p.bad.test(draft) ? (p.bad.test(after) ? '✗ 没收' : '✓ 收了') : '⚠ 探针没匹配上原文'}  ${p.name}`));
        const dels = edits.filter((e: any) => e?.replacement === '' && typeof e.brief_span === 'string');
        console.log(`    删除型 edit ${dels.length} 条（分块版是 39 条、其中 67% 误删）`);
      }
    } catch (e) {
      console.log(`  maxTokens ${String(budget).padStart(5)}: ✗ ${e instanceof Error ? e.message.slice(0, 100) : e}`);
    }
  }
}
