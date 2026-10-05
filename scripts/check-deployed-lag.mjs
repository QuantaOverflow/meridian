#!/usr/bin/env node
// push 前的提醒：线上哪个服务跑的提交比本地 HEAD 旧，而且这之间它的代码改过。
// 只提醒，不拦：永远退出 0；问不到线上（没网、没 token、超时）就什么都不说。
//
// 版本从 backend 的 GET /observability/ops/services 问（三个服务各自报的提交，由 scripts/deploy.sh 部署时带上去）。
// 注意：这个接口会去问 ml-service 的健康，睡着的容器会被叫醒约 10 分钟。
//
// 用法：node scripts/check-deployed-lag.mjs（须从仓库根运行；pre-push 钩子最后调它）
// 环境变量：MERIDIAN_BACKEND_URL（默认线上 backend）、MERIDIAN_API_TOKEN（默认读 apps/backend/.dev.vars 的 API_TOKEN）

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BACKEND = process.env.MERIDIAN_BACKEND_URL ?? 'https://meridian-backend.swj299792458.workers.dev';
const TIMEOUT_MS = 20_000;

// 每个服务的代码在哪：这些路径在「线上那个提交」和 HEAD 之间有改动，才算落后
const SERVICE_PATHS = {
  backend: ['apps/backend', 'packages'],
  'ai-worker': ['services/meridian-ai-worker', 'packages/contracts'],
  'ml-service': ['services/meridian-ml-service'],
};

function apiToken() {
  if (process.env.MERIDIAN_API_TOKEN) return process.env.MERIDIAN_API_TOKEN;
  try {
    const line = fs.readFileSync('apps/backend/.dev.vars', 'utf8').split('\n').find((l) => l.startsWith('API_TOKEN='));
    return line?.slice('API_TOKEN='.length).trim().replace(/^"|"$/g, '') || null;
  } catch {
    return null;
  }
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const gitOk = (...args) => {
  try {
    execFileSync('git', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

async function deployedVersions() {
  const token = apiToken();
  if (!token) return null;
  try {
    const res = await fetch(`${BACKEND}/observability/ops/services`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

const versions = await deployedVersions();
if (versions) {
  const lines = [];
  for (const v of versions) {
    const paths = SERVICE_PATHS[v?.service];
    // 没报提交 = 不是经 scripts/deploy.sh 部署的，或够不着；本地没有这个提交（别的机器部署的）也没法比
    if (!paths || typeof v.commit !== 'string' || !gitOk('cat-file', '-e', `${v.commit}^{commit}`)) continue;
    if (gitOk('diff', '--quiet', v.commit, 'HEAD', '--', ...paths)) continue;
    const behind = git('rev-list', '--count', `${v.commit}..HEAD`, '--', ...paths);
    const dirty = v.dirty === true ? '（部署时工作区有未提交的改动）' : '';
    lines.push(`  ${v.service}：线上是 ${v.commit}${dirty}，本地 HEAD 之后有 ${behind} 个提交改了它的代码`);
  }
  if (lines.length > 0) {
    console.log('提醒：线上版本落后于本地（不拦 push；要上线进对应 service 目录跑 scripts/deploy.sh）');
    for (const line of lines) console.log(line);
  }
}
