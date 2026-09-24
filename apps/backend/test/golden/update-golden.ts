/**
 * 重新生成 golden 快照。**只在确认行为变化是有意的时候跑**：
 *
 *   cd apps/backend && UPDATE_GOLDEN=1 npx tsx test/golden/update-golden.ts [case ...]
 *
 * 不带 UPDATE_GOLDEN=1 直接拒绝（退出码 2），防止顺手把回归写进 oracle。
 * 放在 node 里跑而不是 spec 里：vitest 走 workers pool（workerd），测试进程里没有可写的文件系统。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOLDEN_CASES, toJson } from './cases';

if (process.env.UPDATE_GOLDEN !== '1') {
  console.error('拒绝写 golden：需显式设置 UPDATE_GOLDEN=1');
  process.exit(2);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), '__golden__');
const wanted = process.argv.slice(2);
const unknown = wanted.filter((n) => !(n in GOLDEN_CASES));
if (unknown.length) {
  console.error(`未知 case：${unknown.join(', ')}；可选：${Object.keys(GOLDEN_CASES).join(', ')}`);
  process.exit(2);
}
for (const name of wanted.length ? wanted : Object.keys(GOLDEN_CASES)) {
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(toJson(GOLDEN_CASES[name]()), null, 2) + '\n');
  console.log(`wrote ${file}`);
}
