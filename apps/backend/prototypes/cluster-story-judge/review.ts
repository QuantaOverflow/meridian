/**
 * 逐簇看判官到底说了什么（读 out/ 里的缓存，不再打 LLM）。**用完即弃**。
 *   pnpm run review          [n]/[b] 翻簇  [p] 看 prompt  [q] 退出
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2).filter(a => a !== '--');
const WIN = args[0] ?? 'F2';
const THR = args[1] ?? '0.10';
const HERE = new URL('.', import.meta.url).pathname;
const data = JSON.parse(readFileSync(join(HERE, 'out', `judge-${WIN}-t${THR}-result.json`), 'utf-8'));

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;

let i = 0;
let showPrompt = false;

function render() {
  const r = data.rows[i];
  const t = data.sample.find((s: any) => s.clusterId === r.clusterId);
  console.clear();
  console.log(B(`${i + 1}/${data.rows.length}  簇 ${r.clusterId}  字段档 ${r.mode}  ${t.articleIds.length} 篇  ${r.ms}ms`));
  console.log(D(`金标：${t.dominantEvent ?? '（题材袋：没有任何 ≥2 篇的金标事件）'}`));
  if (t.impureIds.length) console.log(D(`金标判为杂质的篇：${t.impureIds.join(', ')}`));
  console.log('');
  const o = r.out;
  console.log(B('判官：') + (o ? (r.pocketCorrect ? G(o.verdict) : R(o.verdict)) : R('解析失败')));
  if (o) {
    console.log(`  事件：${o.event}`);
    console.log(
      `  排除：${o.excluded_ids.join(', ') || '（无）'}  ` +
        D(`命中 ${r.excludedHit} / 误排 ${r.excludedFalse} / 漏 ${r.excludedMiss}`)
    );
    console.log(`  理由：${o.reason}`);
  } else {
    console.log(D('  原始输出：' + String(r.raw).slice(0, 400)));
  }
  console.log('');
  console.log(showPrompt ? D(r.prompt.slice(0, 2400)) : D('（按 [p] 看喂进去的 prompt）'));
  console.log('\n' + D('[n]/[b] 翻簇  [p] prompt  [q] 退出'));
}

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (raw: string) => {
  for (const k of raw.toString()) {
    if (k === 'q' || k === '') {
      console.clear();
      process.exit(0);
    }
    if (k === 'n') i = Math.min(i + 1, data.rows.length - 1);
    if (k === 'b') i = Math.max(0, i - 1);
    if (k === 'p') showPrompt = !showPrompt;
  }
  render();
});
render();
