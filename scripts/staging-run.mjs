#!/usr/bin/env node
// 跑一次 Staging 运行（ADR 0013）：reset Neon 分支 → migrate → 拷正文 → 触发 → 轮询到终态 → 判定 → 记录 → 打印地址。
// 拷正文：简报 workflow 严格从 R2 取文章正文，而 staging 的 bucket 是自己的一份；重置后把近两天文章的正文
// 从生产 bucket 拷到 staging bucket（经 Cloudflare REST，只读生产、只写 staging；已有的跳过）。要本机有 psql。
// 零依赖。配置读仓库根 .staging.env（KEY=VALUE），同名环境变量优先；模板见 .staging.env.example。
//
// 用法：node scripts/staging-run.mjs [--no-reset] [--attach <运行 id>] [--body-days 2] [--poll-interval-ms 30000] [--timeout-min 60]
//   --no-reset   不 reset、不 migrate、不拷正文，在现有数据上再跑一次（调试）
//   --attach     不触发，接上一次已经在跑（或已跑完）的运行，等到终态后判定并记录——轮询中途断了用它
//   --body-days  拷最近几天文章的正文（默认 2；手动运行要用更早的文章时调大）
// 退出码：0 = green 或 yellow；1 = red / 失败 / 409；2 = 用法或配置错；3 = 超时。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = [
  'STAGING_BACKEND_URL', 'STAGING_API_TOKEN', 'STAGING_DATABASE_URL', 'STAGING_READER_URL', 'NEON_PROJECT_ID',
  'CF_ACCOUNT_ID', 'CF_R2_API_TOKEN',
];
const PROD_BUCKET = 'meridian-articles-prod';
const STAGING_BUCKET = 'meridian-articles-staging';
// 默认拷 2 天（--body-days）：cron 的窗口是 1 天（CRON_BRIEF_PARAMS.TIME_RANGE_DAYS），多拷一天留余量
// 轮询连续这么多次拿不到回答（网络断、5xx）才放弃；偶尔一次抖动不该丢掉一次三十分钟的运行
const POLL_MAX_CONSECUTIVE_ERRORS = 5;
// 终态先写、运行汇总后写（workflow 里隔几十秒）：贵不贵要看汇总，等它最多这么久（--summary-wait-ms）
const SUMMARY_WAIT_MS = 5 * 60_000;
const BODY_COPY_CONCURRENCY = 4;
const R2_MAX_ATTEMPTS = 20;

function die(code, msg) {
  console.error(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { reset: true, pollMs: 30000, timeoutMin: 60, bodyDays: 2, attach: '', summaryWaitMs: SUMMARY_WAIT_MS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-reset') opts.reset = false;
    else if (a === '--attach') {
      opts.attach = argv[++i] ?? '';
      if (!opts.attach) die(2, '--attach 需要一个运行 id');
      opts.reset = false;
    } else if (a === '--poll-interval-ms' || a === '--timeout-min' || a === '--body-days' || a === '--summary-wait-ms') {
      const n = Number(argv[++i]);
      if (!(n > 0)) die(2, `${a} 需要一个正数`);
      if (a === '--poll-interval-ms') opts.pollMs = n;
      else if (a === '--body-days') opts.bodyDays = n;
      else if (a === '--summary-wait-ms') opts.summaryWaitMs = n;
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

// 网络错误不抛：status 0，由调用方决定是重试还是放弃
async function call(method, urlPath) {
  try {
    const res = await fetch(backend + urlPath, { method, headers });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: null, error: e.message };
  }
}

// Cloudflare REST 对每个账户限速（约 1200 次 / 5 分钟），一篇正文读写各一次：被限速（429）就按 retry-after 等了再试，
// 所以头一次拷一两千篇会花几分钟；之后每次只拷新增的
async function r2(method, bucket, suffix, body) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfg.CF_ACCOUNT_ID}/r2/buckets/${bucket}/objects${suffix}`;
  const init = { method, headers: { Authorization: `Bearer ${cfg.CF_R2_API_TOKEN}` }, body };
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if (attempt >= R2_MAX_ATTEMPTS) throw e;
    }
    if (res && (res.ok || res.status === 404 || attempt >= R2_MAX_ATTEMPTS)) return res;
    const retryAfter = Number(res?.headers.get('retry-after'));
    const waitMs = res?.status === 429 ? (retryAfter > 0 ? retryAfter * 1000 : 30_000) : 2_000;
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function listKeys(bucket, prefix) {
  const keys = new Set();
  let cursor = '';
  do {
    const res = await r2('GET', bucket, `?per_page=1000&prefix=${encodeURIComponent(prefix)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!res.ok) die(1, `列 ${bucket} 的对象失败：HTTP ${res.status}`);
    const json = await res.json();
    for (const o of json.result ?? []) keys.add(o.key);
    cursor = json.result_info?.is_truncated ? json.result_info.cursor : '';
  } while (cursor);
  return keys;
}

async function copyBodies() {
  const q = spawnSync(
    'psql',
    [cfg.STAGING_DATABASE_URL, '-At', '-c',
      `select content_file_key from articles where content_file_key is not null and status = 'PROCESSED' and publish_date >= now() - interval '${opts.bodyDays} days'`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  if (q.status !== 0) die(1, `查要拷的正文清单失败（psql 退出码 ${q.status ?? q.error?.message}）`);
  const wanted = q.stdout.split('\n').map((l) => l.trim()).filter(Boolean);

  // 正文的 key 是 年/月/日/id.txt：按日前缀列 staging 已有的，只拷缺的
  const prefixes = [...new Set(wanted.map((k) => k.slice(0, k.lastIndexOf('/') + 1)))];
  const have = new Set();
  for (const p of prefixes) for (const k of await listKeys(STAGING_BUCKET, p)) have.add(k);
  const todo = wanted.filter((k) => !have.has(k));

  let missingInProd = 0;
  const failed = [];
  let next = 0;
  await Promise.all(Array.from({ length: BODY_COPY_CONCURRENCY }, async () => {
    while (next < todo.length) {
      const key = todo[next++];
      const path = '/' + encodeURIComponent(key);
      try {
        const got = await r2('GET', PROD_BUCKET, path);
        if (got.status === 404) { missingInProd++; continue; }
        if (!got.ok) { failed.push(`${key}（读 ${got.status}）`); continue; }
        const put = await r2('PUT', STAGING_BUCKET, path, await got.arrayBuffer());
        if (!put.ok) failed.push(`${key}（写 ${put.status}）`);
      } catch (e) {
        failed.push(`${key}（${e.message}）`);
      }
    }
  }));
  console.log(`正文：窗口内 ${wanted.length}，已有 ${wanted.length - todo.length}，拷了 ${todo.length - missingInProd - failed.length}，生产也没有 ${missingInProd}，失败 ${failed.length}`);
  if (failed.length) die(1, `拷正文失败 ${failed.length} 个，前几个：${failed.slice(0, 5).join('; ')}`);
}

// ① ② 刷新数据并迁移
if (opts.reset) {
  console.log('[1/8] neonctl branches reset staging --parent');
  run('neonctl', ['branches', 'reset', 'staging', '--parent', '--project-id', cfg.NEON_PROJECT_ID]);
  console.log('[2/8] migrate');
  run('pnpm', ['-F', '@meridian/database', 'migrate'], { DATABASE_URL: cfg.STAGING_DATABASE_URL });
}

// 拷正文（跟着 reset 走：--no-reset 时库没变，不用再拷）
if (opts.reset) {
  console.log('[3/8] 拷正文 生产 bucket → staging bucket');
  await copyBodies();
}

// 触发（--attach 时接已有的运行）
let id = opts.attach;
if (!id) {
  console.log('[4/8] 触发 POST /admin/briefs/run-scheduled');
  const trig = await call('POST', '/admin/briefs/run-scheduled');
  if (trig.status === 409) {
    die(1, `已有运行在飞，挡着的运行 id：${trig.body?.blockingWorkflowId ?? '（未知）'}\n` +
      '（是 staging 自己的运行就用 --attach <id> 接上；是 reset 时从生产库带过来的 RUNNING 行，等它在生产跑完后重新 reset）');
  }
  if (trig.status !== 202 || !trig.body?.data?.workflowId) {
    die(1, `触发失败：HTTP ${trig.status} ${trig.body?.error ?? trig.error ?? ''}`);
  }
  id = trig.body.data.workflowId;
}
console.log(`运行 id：${id}`);

// 轮询到终态；终态之后再等运行汇总写完
console.log('[5/8] 等运行到终态');
const deadline = Date.now() + opts.timeoutMin * 60_000;
let detail;
let errors = 0;
let summaryDeadline = 0;
for (;;) {
  const r = await call('GET', `/observability/ops/runs/${encodeURIComponent(id)}`);
  if (r.status === 200 || r.status === 404) errors = 0;
  else if (++errors >= POLL_MAX_CONSECUTIVE_ERRORS) {
    die(1, `查运行详情连续 ${errors} 次失败（最后一次：${r.status ? `HTTP ${r.status}` : r.error}）。运行可能仍在跑，稍后用 --attach ${id} 接上`);
  }
  const status = r.status === 200 ? r.body?.run?.status : undefined;
  if (status && status !== 'RUNNING') {
    detail = r.body;
    const finished = status === 'COMPLETED' || status === 'DEGRADED';
    if (!finished || detail.summary) break;
    summaryDeadline ||= Date.now() + opts.summaryWaitMs;
    if (Date.now() + opts.pollMs > summaryDeadline) {
      console.log('运行汇总一直没写出来：花费未记，「贵」判不了');
      break;
    }
  } else if (Date.now() + opts.pollMs > deadline) {
    die(3, `超时（${opts.timeoutMin} 分钟）仍未到终态，运行 id：${id}（稍后可用 --attach ${id} 接上）`);
  }
  await new Promise((res) => setTimeout(res, opts.pollMs));
}

// 判定
const flags = detail.run.flags ?? [];
const verdict = verdictOf(flags);

// 服务版本并追加判定记录
const svc = await call('GET', '/observability/ops/services');
if (svc.status !== 200 || !Array.isArray(svc.body)) die(1, `读服务版本失败：HTTP ${svc.status}`);
const services = {};
for (const name of ['backend', 'ai-worker']) {
  const s = svc.body.find((x) => x.service === name);
  services[name] = { commit: s?.commit ?? null, dirty: s?.dirty ?? null };
}
const verdictsFile = process.env.STAGING_VERDICTS_FILE || path.join(ROOT, '.staging-verdicts.jsonl');
fs.appendFileSync(verdictsFile, JSON.stringify({ at: new Date().toISOString(), workflowId: id, verdict, flags, services }) + '\n');

// 打印
console.log(`判定：${verdict}（状态 ${detail.run.status}，花费 ${detail.run.usd == null ? '未记' : '$' + detail.run.usd.toFixed(2)}）`);
const shown = flags.filter((f) => f !== 'late');
if (verdict !== 'green') console.log(`${verdict === 'red' ? '红' : '黄'}的 flag：${shown.join(', ')}`);
console.log(`运行详情：${reader}/admin/runs/${id}`);
console.log(`读者页：${reader}`);
process.exit(verdict === 'red' ? 1 : 0);
