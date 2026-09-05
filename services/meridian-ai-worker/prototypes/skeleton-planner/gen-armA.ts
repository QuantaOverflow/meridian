/**
 * 生成 A 臂（生产现状：扁平输入 + 生产 prompt + 一次写完）作为忠实度对照组。
 *
 * 为什么不直接拿生产第 75 期简报当对照：它跑过 RARR 接地校正（verifyAndCorrect），
 * 而 b′ 没有。拿它比就是在比「A+RARR vs b′裸」，混淆变量。这里生成的是**裸 A**。
 *
 * 顺带把两臂共用的 source（喂给判官的 oracle）也落盘——判官必须对着同一份源判两臂。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { here, reports, body, chat, measure } from './shared.ts';
import { getBriefGenerationPrompt } from '../../src/prompts/briefGeneration.ts';

const N = reports.length;
const flat = reports.map((r, i) => (i ? '\n---\n\n' : '') + `# [story ${i + 1}/${N}] ${r.executiveSummary}\n\n` + body(reports[i])).join('');

let raw = await chat(getBriefGenerationPrompt(flat, ''), 0.7, 16000);
if (raw.includes('<final_brief>')) raw = raw.split('<final_brief>')[1]?.split('</final_brief>')[0]?.trim() || raw;

const m = measure(raw);
console.log(`A 臂：章节 ${m.sections} / 块 ${m.blocks} / ${m.chars} 字符`);
console.log(`  ${m.headings.join(' | ')}`);
writeFileSync(join(here, 'armA-brief.md'), raw);
writeFileSync(join(here, 'source-oracle.md'), flat);
console.log(`源 oracle ${flat.length} 字符 → source-oracle.md`);
