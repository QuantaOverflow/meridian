#!/usr/bin/env node
// 断言从零部署的指南（docs/self-hosting.md）没有落后于配置。挂在 `pnpm typecheck` 里。
//
// 别人照着指南部署时，漏掉一个要建的资源、要放的 secret 或要改的账号专属字段，就会卡在一条看不懂的 wrangler 报错上。
// 所以：三个 Worker 与 Pages 的生产配置里出现的每个资源名、必填 secret、账号专属字段，指南里都得提到它的名字。
// 配置由 wrangler 自己读（与 check-staging-isolation.mjs 同一做法），只看顶层（生产）环境；staging 是可选的，指南不逐项列。
//
// 账号专属字段的判定：变量的值里带 32 位十六进制 id、workers.dev 子域或 AI Gateway 地址；Hyperdrive 的 id。
// 退出码：0 = 通过，1 = 指南漏了东西（逐条打印）。

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const { unstable_readConfig: readConfig } = createRequire(path.join(ROOT, 'apps/backend/package.json'))('wrangler');
const guide = fs.readFileSync(path.join(ROOT, 'docs/self-hosting.md'), 'utf8');

const CONFIGS = [
  'apps/backend/wrangler.jsonc',
  'services/meridian-ai-worker/wrangler.toml',
  'services/meridian-ml-service/cf-worker/wrangler.jsonc',
];
const ACCOUNT_SPECIFIC = /\b[0-9a-f]{32}\b|\.workers\.dev|gateway\.ai\.cloudflare\.com/;

/** [指南里必须出现的字样, 它是什么] */
const needed = [];
for (const file of CONFIGS) {
  const config = readConfig({ config: path.join(ROOT, file) }, { hideWarnings: true });
  const need = (text, what) => typeof text === 'string' && text && needed.push([text, `${file} 的${what}`]);
  need(path.dirname(file), '目录');
  for (const name of config.secrets?.required ?? []) need(name, '必填 secret');
  for (const [key, value] of Object.entries(config.vars ?? {})) {
    if (typeof value === 'string' && ACCOUNT_SPECIFIC.test(value)) need(key, '账号专属变量');
  }
  if ((config.hyperdrive ?? []).length > 0) need('hyperdrive create', ' Hyperdrive（要建并换 id）');
  for (const b of config.r2_buckets ?? []) need(b.bucket_name, ' R2 bucket');
  for (const p of config.queues?.producers ?? []) need(p.queue, '队列');
  for (const c of config.queues?.consumers ?? []) need(c.dead_letter_queue, ' DLQ');
  if ((config.containers ?? []).length > 0) {
    need('Docker', '容器镜像（本机要有 Docker）');
    need('model-cache', '容器镜像（要先下模型）');
    need('Workers Paid', '容器（要付费计划）');
  }
}

// 前端 Pages 的配置在根 wrangler.toml：项目名与指向 backend 的地址
const pages = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
const project = pages.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
if (project) needed.push([`pages project create ${project}`, '根 wrangler.toml 的 Pages 项目']);
for (const m of pages.matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"/gm)) {
  if (ACCOUNT_SPECIFIC.test(m[2])) needed.push([m[1], '根 wrangler.toml 的账号专属变量']);
}

const missing = needed.filter(([text]) => !guide.includes(text));
if (missing.length > 0) {
  console.log('docs/self-hosting.md 没提到下面这些（配置里有，照指南部署的人会漏）：');
  for (const [text, what] of missing) console.log(`  - ${text}（${what}）`);
  process.exit(1);
}
