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

// 允许 staging 与生产共用的 service binding
const SHARED_SERVICE_BINDINGS = new Set(['ML_SERVICE']);

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

function parseTomlValue(raw) {
  const v = raw.trim();
  if (v.startsWith('"')) return JSON.parse(v.slice(0, v.lastIndexOf('"') + 1));
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('[')) {
    const body = v.replace(/#.*$/, '').trim();
    return JSON.parse(body.replace(/'([^']*)'/g, '"$1"'));
  }
  const n = Number(v.replace(/#.*$/, '').trim());
  return Number.isNaN(n) ? v : n;
}

// 只覆盖这份 wrangler.toml 用到的子集：[a.b] / [[a.b]] 表头、key = 单行值
function parseToml(text) {
  const root = {};
  let cur = root;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const arr = t.match(/^\[\[([^\]]+)\]\]/);
    const tbl = !arr && t.match(/^\[([^\]]+)\]/);
    if (arr || tbl) {
      const keys = (arr || tbl)[1].split('.').map((k) => k.trim());
      let node = root;
      keys.forEach((k, idx) => {
        const last = idx === keys.length - 1;
        if (last && arr) {
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
      continue;
    }
    const eq = t.indexOf('=');
    if (eq > 0) cur[t.slice(0, eq).trim()] = parseTomlValue(t.slice(eq + 1));
  }
  return root;
}

// ---------- 提取与比较 ----------

// 一个环境段里「带资源名的」项：{ 类别: [{ id, label }] }
function resources(c) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const r = { Hyperdrive: [], 'R2 bucket': [], 队列: [], DLQ: [], workflow: [], service: [] };
  for (const h of list(c.hyperdrive)) r.Hyperdrive.push({ id: h.id, label: h.binding });
  for (const b of list(c.r2_buckets)) r['R2 bucket'].push({ id: b.bucket_name, label: b.binding });
  for (const p of list(c.queues?.producers)) r.队列.push({ id: p.queue, label: `producer ${p.binding}` });
  for (const q of list(c.queues?.consumers)) {
    r.队列.push({ id: q.queue, label: 'consumer' });
    if (q.dead_letter_queue) r.DLQ.push({ id: q.dead_letter_queue, label: 'consumer' });
  }
  for (const w of list(c.workflows)) r.workflow.push({ id: w.name, label: w.binding });
  for (const s of list(c.services)) r.service.push({ id: s.service, label: s.binding });
  return r;
}

function check(file, label, top, { requireCrons }) {
  const problems = [];
  const bad = (msg) => problems.push(`${label} (${file}): ${msg}`);
  const stg = top.env?.staging;
  if (!stg || typeof stg !== 'object') {
    bad('缺少 staging 段（env.staging）');
    return problems;
  }

  const prod = resources(top);
  const staging = resources(stg);
  for (const [kind, items] of Object.entries(staging)) {
    const prodIds = new Set(prod[kind].map((x) => x.id));
    for (const it of items) {
      if (kind === 'service' && SHARED_SERVICE_BINDINGS.has(it.label)) continue;
      if (prodIds.has(it.id)) bad(`staging 的 ${kind}（${it.label}）与生产相同：${it.id}`);
    }
  }

  const crons = stg.triggers?.crons;
  if (requireCrons && !Array.isArray(crons)) bad('staging 缺少 triggers.crons（必须显式写成空数组）');
  else if (Array.isArray(crons) && crons.length > 0) bad(`staging 的 triggers.crons 必须为空，现为 ${JSON.stringify(crons)}`);

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

problems.push(...check(BACKEND, 'backend', backend, { requireCrons: true }));
const aiProblems = check(AI_WORKER, 'ai-worker', ai, { requireCrons: false });
problems.push(...aiProblems);
const stgUrl = ai.env?.staging?.vars?.DASHSCOPE_BASE_URL;
if (ai.env?.staging) {
  if (!stgUrl) problems.push(`ai-worker (${AI_WORKER}): staging 缺少 DASHSCOPE_BASE_URL`);
  else if (stgUrl === ai.vars?.DASHSCOPE_BASE_URL) problems.push(`ai-worker (${AI_WORKER}): staging 的 DASHSCOPE_BASE_URL 与生产相同`);
}

if (problems.length) {
  console.log('staging 隔离检查未通过：');
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('staging 隔离检查通过');
