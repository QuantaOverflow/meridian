#!/usr/bin/env node
// 跑一次 Staging 运行（ADR 0013）：reset Neon 分支 → migrate → 拷正文 → 触发 → 轮询到终态 → 判定 → 记录 → 打印地址。
// 拷正文：简报 workflow 严格从 R2 取文章正文，而 staging 的 bucket 是自己的一份；重置后把近两天文章的正文
// 从生产 bucket 拷到 staging bucket（经 Cloudflare REST，只读生产、只写 staging；已有的跳过）。要本机有 psql。
// 零依赖。配置读仓库根 .staging.env（KEY=VALUE），同名环境变量优先；模板见 .staging.env.example。
//
// 用法：node scripts/staging-run.mjs [--no-reset] [--poll-interval-ms 30000] [--timeout-min 60]
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
// cron 的窗口是 1 天（CRON_BRIEF_PARAMS.TIME_RANGE_DAYS）；多拷一天，窗口以后放宽到 2 天也够
const BODY_COPY_DAYS = 2;
const BODY_COPY_CONCURRENCY = 4;
const R2_MAX_ATTEMPTS = 20;

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
      `select content_file_key from articles where content_file_key is not null and status = 'PROCESSED' and publish_date >= now() - interval '${BODY_COPY_DAYS} days'`],
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
  console.log('[1/7] neonctl branches reset staging --parent');
  run('neonctl', ['branches', 'reset', 'staging', '--parent', '--project-id', cfg.NEON_PROJECT_ID]);
  console.log('[2/7] migrate');
  run('pnpm', ['-F', '@meridian/database', 'migrate'], { DATABASE_URL: cfg.STAGING_DATABASE_URL });
}

// 拷正文（跟着 reset 走：--no-reset 时数据没变，不用再拷）
if (opts.reset) {
  console.log('[2b] 拷正文 生产 bucket → staging bucket');
  await copyBodies();
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
