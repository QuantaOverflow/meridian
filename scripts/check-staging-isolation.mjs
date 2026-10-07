#!/usr/bin/env node
// 断言两个 worker 的 staging 环境与生产不共用资源（ADR 0013）。挂在 `pnpm typecheck` 里。
//
// 配置不自己解析：让 wrangler 把同一份文件按「生产（顶层）」和「staging」各读一遍，比的是它真正会部署出去的两份结果，
// 继承、TOML / JSONC 的各种写法都由它处理。
//
// 用法：node scripts/check-staging-isolation.mjs [--backend <wrangler.jsonc>] [--ai-worker <wrangler.toml>]
// 退出码：0 = 通过，1 = 有问题（逐条打印到 stdout）。

import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

// wrangler 装在各 worker 包里，从 backend 那份借
const { unstable_readConfig: readConfig } = createRequire(path.join(ROOT, 'apps/backend/package.json'))('wrangler');

const WORKERS = [
  { label: 'backend', file: arg('--backend', path.join(ROOT, 'apps/backend/wrangler.jsonc')) },
  { label: 'ai-worker', file: arg('--ai-worker', path.join(ROOT, 'services/meridian-ai-worker/wrangler.toml')) },
];

// staging 唯一允许指向生产的地方：ml-service 不存数据，两边共用（ADR 0013 决定 3）
const SHARED = { binding: 'ML_SERVICE', service: 'meridian-ml-service' };

const norm = (v) => String(v).trim().toLowerCase().replace(/\/+$/, '');

/** 生产的 worker 名与每个资源标识 → 它是什么。不分类别：把生产队列名填进 staging 的 DLQ 同样是写到生产 */
function productionIds(prod) {
  const ids = new Map();
  const add = (value, what) => typeof value === 'string' && value.trim() && ids.set(norm(value), what);
  add(prod.name, 'worker 名');
  for (const h of prod.hyperdrive ?? []) add(h.id, 'Hyperdrive');
  for (const b of prod.r2_buckets ?? []) add(b.bucket_name, 'R2 bucket');
  for (const p of prod.queues?.producers ?? []) add(p.queue, '队列');
  for (const c of prod.queues?.consumers ?? []) {
    add(c.queue, '队列');
    add(c.dead_letter_queue, 'DLQ');
  }
  for (const w of prod.workflows ?? []) add(w.name, 'workflow 名');
  for (const s of prod.services ?? []) add(s.service, 'service');
  return ids;
}

/** 配置里所有的字符串值，连同位置 */
function* strings(node, at = '') {
  if (typeof node === 'string') yield { value: node, at };
  else if (Array.isArray(node)) for (const [i, v] of node.entries()) yield* strings(v, `${at}[${i}]`);
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) yield* strings(v, at ? `${at}.${k}` : k);
}

// AI Gateway 地址里的网关名：…/v1/<account>/<gateway>/…
const gateway = (url) => (typeof url === 'string' ? url.match(/\/v1\/[^/]+\/([^/]+)\//)?.[1]?.toLowerCase() : undefined);

function check({ label, file }) {
  const prod = readConfig({ config: file });
  const staging = readConfig({ config: file, env: 'staging' });
  const problems = [];
  const bad = (msg) => problems.push(`${label} (${file}): ${msg}`);

  // 1. staging 里任何位置都不出现生产的资源标识
  const ids = productionIds(prod);
  const sharedAt = (staging.services ?? []).findIndex((s) => s.binding === SHARED.binding && s.service === SHARED.service);
  for (const { value, at } of strings(staging)) {
    // topLevelName 是 wrangler 自己记的「这份配置顶层叫什么」，不是 staging 用到的名字
    if (at === 'topLevelName') continue;
    const what = ids.get(norm(value));
    if (what && at !== `services[${sharedAt}].service`) bad(`staging 的 ${at} 用了生产的${what}：${value}`);
  }

  // 2. staging 不定时触发
  const crons = staging.triggers?.crons ?? [];
  if (crons.length > 0) bad(`staging 的 triggers.crons 必须为空（没写会继承生产的），现为 ${JSON.stringify(crons)}`);

  // 3. backend 靠 ENVIRONMENT 决定 Staging 运行的触发入口存不存在
  if (label === 'backend') {
    if (prod.vars?.ENVIRONMENT !== 'production') bad(`生产的 ENVIRONMENT 必须是 "production"，现为 ${JSON.stringify(prod.vars?.ENVIRONMENT)}`);
    if (staging.vars?.ENVIRONMENT !== 'staging') bad(`staging 的 ENVIRONMENT 必须是 "staging"，现为 ${JSON.stringify(staging.vars?.ENVIRONMENT)}`);
  }

  // 4. ai-worker 的 staging 不走生产的 AI Gateway
  if (label === 'ai-worker') {
    const [p, s] = [prod.vars?.DASHSCOPE_BASE_URL, staging.vars?.DASHSCOPE_BASE_URL];
    if (!s) bad('staging 缺少 DASHSCOPE_BASE_URL');
    else if (norm(s) === norm(p ?? '') || (gateway(s) && gateway(s) === gateway(p))) bad(`staging 的 DASHSCOPE_BASE_URL 走的是生产的 AI Gateway：${s}`);
  }
  return problems;
}

let problems;
try {
  problems = WORKERS.flatMap(check);
} catch (e) {
  console.log(`读取配置失败：${e.message}`);
  process.exit(1);
}
if (problems.length) {
  console.log('staging 隔离检查未通过：');
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('staging 隔离检查通过');
