#!/usr/bin/env node
/**
 * 取回不入库的证据文件。
 *
 * 有两份金标的证据是别家媒体的整篇正文（scrape-quality-v1 的 content.jsonl、intel-grounding-v1 的 sources.jsonl）。
 * 公开仓库里不放整篇正文，所以它们存在私有 R2 bucket `meridian-eval-data` 里，仓库只留标注、判据与这里的取法。
 * 每份的位置与 sha256 写在它的 manifest.json 的 evidence.remote 里；取回后核对 sha256，对不上就删掉并报错
 * （标注是相对那一份快照成立的，换了内容等于证据没了）。
 *
 * 要有这个 Cloudflare 账号的 R2 读权限（wrangler 已登录）。没有权限的人取不到，这是有意的。
 *
 * 跑法（仓库根）：
 *   node eval/_data/fetch-evidence.mjs            取回全部
 *   node eval/_data/fetch-evidence.mjs <set> …    只取指定的金标包
 * 已在本地且 sha256 对得上的跳过。退出码：0 = 都在且核对通过；1 = 有取不回或对不上的。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// wrangler 装在各 worker 包里，从 backend 那份借
const WRANGLER = join(HERE, '../../apps/backend/node_modules/.bin/wrangler');

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

const wanted = process.argv.slice(2);
const sets = readdirSync(HERE).filter(n => statSync(join(HERE, n)).isDirectory() && (wanted.length === 0 || wanted.includes(n)));
const unknown = wanted.filter(n => !sets.includes(n));
if (unknown.length > 0) {
  console.error(`没有这个金标包：${unknown.join('、')}`);
  process.exit(1);
}

let failed = 0;
for (const set of sets) {
  const manifestPath = join(HERE, set, 'manifest.json');
  if (!existsSync(manifestPath)) continue;
  const { evidence } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const remote = evidence?.remote;
  if (!remote) continue;
  const target = join(HERE, set, evidence.file);
  if (existsSync(target) && sha256(target) === remote.sha256) {
    console.log(`✓ ${set}/${evidence.file} 已在本地`);
    continue;
  }
  try {
    execFileSync(WRANGLER, ['r2', 'object', 'get', `${remote.bucket}/${remote.key}`, '--file', target, '--remote'], { stdio: 'pipe' });
  } catch (error) {
    console.error(`✗ ${set}/${evidence.file} 取不回（${remote.bucket}/${remote.key}）：${String(error.stderr || error.message).trim().split('\n').pop()}`);
    failed++;
    continue;
  }
  const got = sha256(target);
  if (got !== remote.sha256) {
    rmSync(target);
    console.error(`✗ ${set}/${evidence.file} 的 sha256 对不上：manifest ${remote.sha256}，取回 ${got}（已删）`);
    failed++;
    continue;
  }
  console.log(`✓ ${set}/${evidence.file} 已取回`);
}
process.exit(failed > 0 ? 1 : 0);
