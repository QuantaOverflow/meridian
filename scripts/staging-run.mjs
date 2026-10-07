#!/usr/bin/env node
// 跑一次 Staging 运行（ADR 0013）：reset Neon 分支 → migrate → 触发 → 轮询到终态 → 判定 → 记录 → 打印地址。
// 零依赖。配置读仓库根 .staging.env（KEY=VALUE），同名环境变量优先；模板见 .staging.env.example。
//
// 用法：node scripts/staging-run.mjs [--no-reset] [--poll-interval-ms 30000] [--timeout-min 60]
// 退出码：0 = green 或 yellow；1 = red / 失败 / 409；2 = 用法或配置错；3 = 超时。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['STAGING_BACKEND_URL', 'STAGING_API_TOKEN', 'STAGING_DATABASE_URL', 'STAGING_READER_URL', 'NEON_PROJECT_ID'];

function die(code, msg) {
  console.error(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { reset: true, pollMs: 30000, timeoutMin: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-reset') opts.reset = false;
    else if (a === '--poll-interval-ms' || a === '--timeout-min') {
      const n = Number(argv[++i]);
      if (!(n > 0)) die(2, `${a} 需要一个正数`);
      if (a === '--poll-interval-ms') opts.pollMs = n;
      else opts.timeoutMin = n;
    } else die(2, `不认识的参数：${a}`);
  }
  return opts;
}

function loadConfig() {
  const file = process.env.STAGING_ENV_FILE ?? path.join(ROOT, '.staging.env');
  const fromFile = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      fromFile[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const cfg = {};
  for (const k of KEYS) cfg[k] = process.env[k] || fromFile[k] || '';
  return cfg;
}

function verdictOf(flags) {
  if (flags.includes('failed') || flags.includes('no_stories')) return 'red';
  return flags.some((f) => f !== 'late') ? 'yellow' : 'green';
}

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...env } });
  if (r.status !== 0) die(1, `命令失败（${cmd} ${args[0] ?? ''}），退出码 ${r.status ?? r.signal ?? r.error?.message}`);
}

const opts = parseArgs(process.argv.slice(2));
const cfg = loadConfig();
const needed = opts.reset ? KEYS : ['STAGING_BACKEND_URL', 'STAGING_API_TOKEN', 'STAGING_READER_URL'];
const missing = needed.filter((k) => !cfg[k]);
if (missing.length) die(2, `缺配置：${missing.join(', ')}（写进 .staging.env 或环境变量，见 .staging.env.example）`);

const backend = cfg.STAGING_BACKEND_URL.replace(/\/+$/, '');
const reader = cfg.STAGING_READER_URL.replace(/\/+$/, '');
const headers = { Authorization: `Bearer ${cfg.STAGING_API_TOKEN}` };

async function call(method, urlPath) {
  try {
    const res = await fetch(backend + urlPath, { method, headers });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (e) {
    return die(1, `请求 ${method} ${urlPath} 失败：${e.message}`);
  }
}

// ① ② 刷新数据并迁移
if (opts.reset) {
  console.log('[1/7] neonctl branches reset staging --parent');
  run('neonctl', ['branches', 'reset', 'staging', '--parent', '--project-id', cfg.NEON_PROJECT_ID]);
  console.log('[2/7] migrate');
  run('pnpm', ['-F', '@meridian/database', 'migrate'], { DATABASE_URL: cfg.STAGING_DATABASE_URL });
}

// ③ 触发
console.log('[3/7] 触发 POST /admin/briefs/run-scheduled');
const trig = await call('POST', '/admin/briefs/run-scheduled');
if (trig.status === 409) die(1, `已有运行在飞，挡着的运行 id：${trig.body?.blockingWorkflowId ?? '（未知）'}`);
if (trig.status !== 202 || !trig.body?.data?.workflowId) {
  die(1, `触发失败：HTTP ${trig.status} ${trig.body?.error ?? ''}`);
}
const id = trig.body.data.workflowId;
console.log(`运行 id：${id}`);

// ④ 轮询
const deadline = Date.now() + opts.timeoutMin * 60_000;
let detail;
for (;;) {
  const r = await call('GET', `/observability/ops/runs/${encodeURIComponent(id)}`);
  if (r.status === 200 && r.body?.run?.status && r.body.run.status !== 'RUNNING') {
    detail = r.body;
    break;
  }
  if (r.status !== 200 && r.status !== 404) die(1, `查运行详情失败：HTTP ${r.status}`);
  if (Date.now() + opts.pollMs > deadline) die(3, `超时（${opts.timeoutMin} 分钟）仍未到终态，运行 id：${id}`);
  await new Promise((res) => setTimeout(res, opts.pollMs));
}

// ⑤ 判定
const flags = detail.run.flags ?? [];
const verdict = verdictOf(flags);

// ⑥ 服务版本并追加判定记录
const svc = await call('GET', '/observability/ops/services');
if (svc.status !== 200 || !Array.isArray(svc.body)) die(1, `读服务版本失败：HTTP ${svc.status}`);
const services = {};
for (const name of ['backend', 'ai-worker']) {
  const s = svc.body.find((x) => x.service === name);
  services[name] = { commit: s?.commit ?? null, dirty: s?.dirty ?? null };
}
const verdictsFile = process.env.STAGING_VERDICTS_FILE || path.join(ROOT, '.staging-verdicts.jsonl');
fs.appendFileSync(verdictsFile, JSON.stringify({ at: new Date().toISOString(), workflowId: id, verdict, flags, services }) + '\n');

// ⑦ 打印
console.log(`判定：${verdict}（状态 ${detail.run.status}，花费 ${detail.run.usd == null ? '未记' : '$' + detail.run.usd.toFixed(2)}）`);
const shown = flags.filter((f) => f !== 'late');
if (verdict !== 'green') console.log(`${verdict === 'red' ? '红' : '黄'}的 flag：${shown.join(', ')}`);
console.log(`运行详情：${reader}/admin/runs/${id}`);
console.log(`读者页：${reader}`);
process.exit(verdict === 'red' ? 1 : 0);
