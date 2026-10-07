#!/usr/bin/env node
// 跑一次 Staging 运行（ADR 0013）。下面 main() 从上往下就是全部步骤。
//
// 用法：node scripts/staging-run.mjs [选项]
//   --no-reset            不刷新数据（不 reset、不 migrate、不拷正文），在现有数据上再跑一次——调试用
//   --attach <运行 id>    不触发，接上一次已经在跑或已跑完的运行，判定并记录——轮询中途断了用它
//   --body-days <n>       拷最近几天文章的正文（默认 2；cron 的窗口是 1 天。手动运行要用更早的文章时调大）
//   --poll-interval-ms、--timeout-min、--summary-wait-ms   默认 30000、60、300000
//
// 配置：仓库根 .staging.env（KEY=VALUE，gitignored；模板 .staging.env.example），同名环境变量优先。
// 本机要有 neonctl、pnpm、psql（--no-reset / --attach 时都不用）。
// 退出码：0 = 绿或黄；1 = 红 / 某一步失败 / 已有运行在飞；2 = 用法或配置错；3 = 等到超时。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyBodies } from './staging-copy-bodies.mjs';
import { judge, record } from './staging-verdicts.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// 轮询连续这么多次拿不到回答（网络断、5xx）才放弃：偶尔一次抖动不该丢掉一次十几分钟的运行
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

const opts = parseArgs(process.argv.slice(2));
const cfg = loadConfig(opts.refresh
  ? ['STAGING_BACKEND_URL', 'STAGING_API_TOKEN', 'STAGING_READER_URL', 'STAGING_DATABASE_URL', 'NEON_PROJECT_ID', 'CF_ACCOUNT_ID', 'CF_R2_API_TOKEN']
  : ['STAGING_BACKEND_URL', 'STAGING_API_TOKEN', 'STAGING_READER_URL']);
const backendUrl = cfg.STAGING_BACKEND_URL.replace(/\/+$/, '');
const readerUrl = cfg.STAGING_READER_URL.replace(/\/+$/, '');

await main();

async function main() {
  if (opts.refresh) await refreshData();
  const id = opts.attach || (await trigger());
  console.log(`运行 id：${id}`);
  const detail = await waitUntilDone(id);

  const flags = detail.run.flags ?? [];
  const verdict = judge(flags);
  record({ workflowId: id, verdict, flags, services: await deployedCommits() });

  const usd = detail.run.usd == null ? '未记' : '$' + detail.run.usd.toFixed(2);
  console.log(`判定：${verdict}（状态 ${detail.run.status}，花费 ${usd}）`);
  if (verdict !== 'green') console.log(`${verdict === 'red' ? '红' : '黄'}的 flag：${flags.filter((f) => f !== 'late').join(', ')}`);
  console.log(`运行详情：${readerUrl}/admin/runs/${id}`);
  console.log(`读者页：${readerUrl}`);
  process.exit(verdict === 'red' ? 1 : 0);
}

// ---------- 步骤 ----------

/** staging 的库重置成生产的最新副本，跑被测分支的 migration，再把近几天的正文拷进 staging 的 bucket */
async function refreshData() {
  console.log('刷新数据 1/3：neonctl branches reset staging --parent');
  run('neonctl', ['branches', 'reset', 'staging', '--parent', '--project-id', cfg.NEON_PROJECT_ID]);
  console.log('刷新数据 2/3：migrate');
  run('pnpm', ['-F', '@meridian/database', 'migrate'], { DATABASE_URL: cfg.STAGING_DATABASE_URL });
  console.log('刷新数据 3/3：拷正文 生产 bucket → staging bucket');
  const r = await copyBodies({ accountId: cfg.CF_ACCOUNT_ID, token: cfg.CF_R2_API_TOKEN, databaseUrl: cfg.STAGING_DATABASE_URL, days: opts.bodyDays })
    .catch((e) => die(1, e.message));
  console.log(`正文：窗口内 ${r.wanted}，已有 ${r.alreadyThere}，拷了 ${r.copied}，生产也没有 ${r.missingInProd}，失败 ${r.failed.length}`);
  if (r.failed.length) die(1, `拷正文失败 ${r.failed.length} 个，前几个：${r.failed.slice(0, 5).join('; ')}`);
}

/** 走 cron 用的同一个触发函数（只在 staging 存在的入口） */
async function trigger() {
  console.log('触发 POST /admin/briefs/run-scheduled');
  const res = await backend('POST', '/admin/briefs/run-scheduled');
  if (res.status === 409) {
    die(1, `已有运行在飞，挡着的运行 id：${res.body?.blockingWorkflowId ?? '（未知）'}\n` +
      '（是 staging 自己的运行就用 --attach <id> 接上；是 reset 时从生产库带过来的 RUNNING 行，等它在生产跑完后重新 reset）');
  }
  if (res.status !== 202 || !res.body?.data?.workflowId) die(1, `触发失败：HTTP ${res.status} ${res.body?.error ?? res.error ?? ''}`);
  return res.body.data.workflowId;
}

/**
 * 轮询运行详情到终态。跑完的运行再等它的汇总：workflow 先写终态、隔几十秒才写汇总，而「贵」这个标记要看汇总。
 * 刚触发时详情可能还是 404，照常等。
 */
async function waitUntilDone(id) {
  const deadline = Date.now() + opts.timeoutMin * 60_000;
  let errors = 0;
  let summaryDeadline = 0;
  for (;;) {
    const res = await backend('GET', `/observability/ops/runs/${encodeURIComponent(id)}`);
    if (res.status === 200 || res.status === 404) errors = 0;
    else if (++errors >= MAX_CONSECUTIVE_POLL_ERRORS) {
      die(1, `查运行详情连续 ${errors} 次失败（最后一次：${res.status ? `HTTP ${res.status}` : res.error}）。运行可能仍在跑，稍后用 --attach ${id} 接上`);
    }

    const status = res.status === 200 ? res.body?.run?.status : undefined;
    if (status && status !== 'RUNNING') {
      const ranToTheEnd = status === 'COMPLETED' || status === 'DEGRADED';
      if (!ranToTheEnd || res.body.summary) return res.body;
      summaryDeadline ||= Date.now() + opts.summaryWaitMs;
      if (Date.now() + opts.pollMs > summaryDeadline) {
        console.log('运行汇总一直没写出来：花费未记，「贵」判不了');
        return res.body;
      }
    } else if (Date.now() + opts.pollMs > deadline) {
      die(3, `超时（${opts.timeoutMin} 分钟）仍未到终态，运行 id：${id}（稍后可用 --attach ${id} 接上）`);
    }
    await new Promise((r) => setTimeout(r, opts.pollMs));
  }
}

/** staging 上两个 worker 现在部署的提交，记进判定记录（部署生产前的提醒按它对提交） */
async function deployedCommits() {
  const res = await backend('GET', '/observability/ops/services');
  if (res.status !== 200 || !Array.isArray(res.body)) die(1, `读服务版本失败：HTTP ${res.status}`);
  const of = (name) => res.body.find((s) => s.service === name);
  return Object.fromEntries(['backend', 'ai-worker'].map((name) => [name, { commit: of(name)?.commit ?? null, dirty: of(name)?.dirty ?? null }]));
}

// ---------- 工具 ----------

/** 调 staging backend。网络错误不抛：status 0，由调用方决定重试还是放弃 */
async function backend(method, urlPath) {
  try {
    const res = await fetch(backendUrl + urlPath, { method, headers: { Authorization: `Bearer ${cfg.STAGING_API_TOKEN}` } });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    return { status: 0, body: null, error: e.message };
  }
}

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...env } });
  if (r.status !== 0) die(1, `命令失败（${cmd} ${args[0] ?? ''}），退出码 ${r.status ?? r.signal ?? r.error?.message}`);
}

function die(code, msg) {
  console.error(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const o = { refresh: true, attach: '', bodyDays: 2, pollMs: 30_000, timeoutMin: 60, summaryWaitMs: 5 * 60_000 };
  const numeric = { '--body-days': 'bodyDays', '--poll-interval-ms': 'pollMs', '--timeout-min': 'timeoutMin', '--summary-wait-ms': 'summaryWaitMs' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-reset') o.refresh = false;
    else if (a === '--attach') {
      o.attach = argv[++i] ?? '';
      if (!o.attach) die(2, '--attach 需要一个运行 id');
      o.refresh = false;
    } else if (numeric[a]) {
      const n = Number(argv[++i]);
      if (!(n > 0)) die(2, `${a} 需要一个正数`);
      o[numeric[a]] = n;
    } else die(2, `不认识的参数：${a}`);
  }
  return o;
}

function loadConfig(required) {
  const file = process.env.STAGING_ENV_FILE ?? path.join(ROOT, '.staging.env');
  const fromFile = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) fromFile[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const values = Object.fromEntries(required.map((k) => [k, process.env[k] || fromFile[k] || '']));
  const missing = required.filter((k) => !values[k]);
  if (missing.length) die(2, `缺配置：${missing.join(', ')}（写进 .staging.env 或环境变量，见 .staging.env.example）`);
  return values;
}
