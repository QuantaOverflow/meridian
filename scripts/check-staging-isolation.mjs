#!/usr/bin/env node
// 断言两个 worker 的 staging 配置与生产不共用资源（ADR 0013）。零依赖。
// 用法：node scripts/check-staging-isolation.mjs [--backend <wrangler.jsonc>] [--ai-worker <wrangler.toml>]
// 退出码：0 = 通过，1 = 有问题（逐条打印到 stdout）。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const BACKEND = opt('--backend', path.join(ROOT, 'apps/backend/wrangler.jsonc'));
const AI_WORKER = opt('--ai-worker', path.join(ROOT, 'services/meridian-ai-worker/wrangler.toml'));

// 允许 staging 与生产共用的 service：binding 名 → 它必须指向的生产 service（ml-service 不存数据，ADR 0013 决定 3）
const SHARED_SERVICES = { ML_SERVICE: 'meridian-ml-service' };

// ---------- 解析 ----------

function parseJsonc(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  // 尾逗号（字符串已原样保留，这里只会命中结构位置的 `,` + 空白 + 括号）
  out = out.replace(/"(?:[^"\\]|\\.)*"|,(\s*[}\]])/g, (m, tail) => (tail !== undefined ? tail : m));
  return JSON.parse(out);
}

// 只认这份 wrangler.toml 用到的写法：[a.b] / [[a.b]] 表头（裸 key）、`裸key = 值`，值是双引号字符串、true/false、数字、
// 双引号字符串的单行数组。别的写法（单引号字符串、带引号的 key 或表头、点分 key、多行值、行内表）一律报错而不是跳过：
// 这是道闸，看不懂的行里可能正写着生产的资源名。
const TOML_HEADER = /^(\[\[?)([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)(\]\]?)\s*(?:#.*)?$/;
const TOML_STRING = String.raw`"(?:[^"\\]|\\.)*"`;
const TOML_PAIR = new RegExp(
  String.raw`^([A-Za-z0-9_-]+)\s*=\s*(${TOML_STRING}|true|false|[+-]?\d+(?:\.\d+)?|\[\s*(?:${TOML_STRING}\s*(?:,\s*${TOML_STRING}\s*)*,?\s*)?\])\s*(?:#.*)?$`
);

function parseToml(text) {
  const root = {};
  let cur = root;
  text.split('\n').forEach((line, idx) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const h = t.match(TOML_HEADER);
    if (h && h[1].length === h[3].length) {
      const isArray = h[1] === '[[';
      const keys = h[2].split('.');
      let node = root;
      keys.forEach((k, i) => {
        if (i === keys.length - 1 && isArray) {
          node[k] ??= [];
          const item = {};
          node[k].push(item);
          node = item;
        } else {
          node[k] ??= {};
          node = Array.isArray(node[k]) ? node[k][node[k].length - 1] : node[k];
        }
      });
      cur = node;
      return;
    }
    const kv = t.match(TOML_PAIR);
    if (!kv) throw new Error(`第 ${idx + 1} 行是这个检查不认识的 TOML 写法：${t}（改成双引号字符串 / 裸 key 的写法，或扩展 scripts/check-staging-isolation.mjs）`);
    cur[kv[1]] = JSON.parse(kv[2].replace(/,\s*\]$/, ']').replace(/^[+]/, ''));
  });
  return root;
}

// ---------- 提取与比较 ----------

const norm = (v) => String(v).trim().toLowerCase().replace(/\/+$/, '');

// 生产（顶层）的资源标识：worker 名与每个带资源名的 binding。比较时不分类别——
// 把生产的队列名填进 staging 的 DLQ、把生产的 worker 名填进 staging 的 script_name，同样是写到生产。
function productionIds(top) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const ids = new Map(); // 归一化后的值 → 它在生产里是什么
  const add = (v, what) => {
    if (typeof v === 'string' && v.trim()) ids.set(norm(v), what);
  };
  add(top.name, 'worker 名');
  for (const h of list(top.hyperdrive)) add(h.id, `Hyperdrive（${h.binding}）`);
  for (const b of list(top.r2_buckets)) add(b.bucket_name, `R2 bucket（${b.binding}）`);
  for (const p of list(top.queues?.producers)) add(p.queue, `队列（producer ${p.binding}）`);
  for (const q of list(top.queues?.consumers)) {
    add(q.queue, '队列（consumer）');
    add(q.dead_letter_queue, 'DLQ');
  }
  for (const w of list(top.workflows)) add(w.name, `workflow 名（${w.binding}）`);
  for (const s of list(top.services)) add(s.service, `service（${s.binding}）`);
  return ids;
}

// staging 段里所有字符串值，连同它的位置（不管挂在哪个 key 下）
function* stringLeaves(node, at) {
  if (typeof node === 'string') yield { value: node, at };
  else if (Array.isArray(node)) for (let i = 0; i < node.length; i++) yield* stringLeaves(node[i], `${at}[${i}]`);
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) yield* stringLeaves(v, at ? `${at}.${k}` : k);
}

// AI Gateway 地址里的网关名：…/v1/<account>/<gateway>/…
const gatewayOf = (url) => (typeof url === 'string' ? url.match(/\/v1\/[^/]+\/([^/]+)\//)?.[1]?.toLowerCase() : undefined);

function check(file, label, top, { requireCrons, hasEnvironmentVar }) {
  const problems = [];
  const bad = (msg) => problems.push(`${label} (${file}): ${msg}`);
  const stg = top.env?.staging;
  if (!stg || typeof stg !== 'object') {
    bad('缺少 staging 段（env.staging）');
    return problems;
  }

  // 共用的 service：只放行「这个 binding 指向这个生产 service」这一种写法
  const shared = new Set();
  (Array.isArray(stg.services) ? stg.services : []).forEach((s, i) => {
    if (SHARED_SERVICES[s?.binding] !== undefined && s.service === SHARED_SERVICES[s.binding]) shared.add(`services[${i}].service`);
  });

  const prod = productionIds(top);
  for (const { value, at } of stringLeaves(stg, '')) {
    const what = prod.get(norm(value));
    if (what && !shared.has(at)) bad(`staging 的 ${at} 用了生产的${what}：${value}`);
  }

  const crons = stg.triggers?.crons;
  if (requireCrons && !Array.isArray(crons)) bad('staging 缺少 triggers.crons（必须显式写成空数组）');
  else if (stg.triggers !== undefined && !(Array.isArray(crons) && crons.length === 0)) bad(`staging 的 triggers.crons 必须为空数组，现为 ${JSON.stringify(crons)}`);

  // ENVIRONMENT 只有 backend 有（它的代码按这个变量决定 Staging 运行的触发入口存不存在）；ai-worker 没有代码读它，不设
  if (!hasEnvironmentVar) return problems;
  if (top.vars?.ENVIRONMENT !== 'production') bad(`顶层 ENVIRONMENT 必须是 "production"，现为 ${JSON.stringify(top.vars?.ENVIRONMENT)}`);
  if (stg.vars?.ENVIRONMENT !== 'staging') bad(`staging 段 ENVIRONMENT 必须是 "staging"，现为 ${JSON.stringify(stg.vars?.ENVIRONMENT)}`);
  return problems;
}

const problems = [];
let backend;
let ai;
try {
  backend = parseJsonc(fs.readFileSync(BACKEND, 'utf8'));
  ai = parseToml(fs.readFileSync(AI_WORKER, 'utf8'));
} catch (e) {
  console.log(`读取或解析配置失败：${e.message}`);
  process.exit(1);
}

problems.push(...check(BACKEND, 'backend', backend, { requireCrons: true, hasEnvironmentVar: true }));
const aiProblems = check(AI_WORKER, 'ai-worker', ai, { requireCrons: false, hasEnvironmentVar: false });
problems.push(...aiProblems);
const stgUrl = ai.env?.staging?.vars?.DASHSCOPE_BASE_URL;
if (ai.env?.staging) {
  const prodUrl = ai.vars?.DASHSCOPE_BASE_URL;
  if (!stgUrl) problems.push(`ai-worker (${AI_WORKER}): staging 缺少 DASHSCOPE_BASE_URL`);
  else if (norm(stgUrl) === norm(prodUrl ?? '')) problems.push(`ai-worker (${AI_WORKER}): staging 的 DASHSCOPE_BASE_URL 与生产相同`);
  // 地址不逐字相同也可能是同一个网关（多个斜杠、换了后半段）：按网关名再比一次
  else if (gatewayOf(stgUrl) && gatewayOf(stgUrl) === gatewayOf(prodUrl)) problems.push(`ai-worker (${AI_WORKER}): staging 的 DASHSCOPE_BASE_URL 走的是生产的 AI Gateway（${gatewayOf(prodUrl)}）`);
}

if (problems.length) {
  console.log('staging 隔离检查未通过：');
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('staging 隔离检查通过');
