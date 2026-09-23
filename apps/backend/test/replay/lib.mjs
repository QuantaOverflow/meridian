// 录制重放测试的共享工具：路径、凭据、DB 连接、JSONC、请求归一化与差异。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.resolve(HERE, '../..');
export const REPO_ROOT = path.resolve(BACKEND_DIR, '../..');
export const AI_WORKER_DIR = path.join(REPO_ROOT, 'services/meridian-ai-worker');
export const ML_DIR = path.join(REPO_ROOT, 'services/meridian-ml-service');
export const DATA_DIR = path.join(HERE, 'data');
export const PROD_BACKEND = 'https://meridian-backend.swj299792458.workers.dev';
export const CF_ACCOUNT_ID = 'c8317cfcb330d45b37b00ccd7e8a9936';
export const PROD_BUCKET = 'meridian-articles-prod';
export const WRANGLER = ['--yes', 'wrangler@4.120.0'];

/** worktree 里没有 .dev.vars / .venv / model-cache 这些 gitignored 的东西，回落到主 checkout 找。 */
export function mainCheckoutRoot() {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: REPO_ROOT })
      .toString().trim();
    return path.dirname(common);
  } catch {
    return REPO_ROOT;
  }
}

/** 先找本 checkout，再找主 checkout。 */
export function resolveLocalOnly(rel) {
  for (const root of [REPO_ROOT, mainCheckoutRoot()]) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function readDotEnv(file) {
  const out = {};
  if (!file || !fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/** 凭据：环境变量优先，其次 test/replay/.replay.env，再其次 backend 的 .dev.vars。永不打印。 */
export function credentials() {
  const replayEnv = readDotEnv(path.join(HERE, '.replay.env'));
  const devVars = readDotEnv(resolveLocalOnly('apps/backend/.dev.vars'));
  const pick = (k) => process.env[k] || replayEnv[k] || devVars[k] || '';
  return {
    databaseUrl: pick('REPLAY_DATABASE_URL'),
    prodApiToken: process.env.MERIDIAN_API_TOKEN || replayEnv.MERIDIAN_API_TOKEN || devVars.API_TOKEN || '',
    cfApiToken: pick('CLOUDFLARE_API_TOKEN'),
  };
}

export function pg(url) {
  // postgres 是 @meridian/database 的依赖；借它的解析上下文，不给 backend 新增依赖。
  const require = createRequire(path.join(REPO_ROOT, 'packages/database/package.json'));
  const postgres = require('postgres');
  return postgres(url, { max: 4, connect_timeout: 15, onnotice: () => {} });
}

/** 去注释与尾逗号的 JSONC 解析（字符串感知，URL 里的 // 不受影响）。 */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += text[i + 1]; i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 2; continue; }
    out += c;
    i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

export function runDir(wf) {
  return path.join(DATA_DIR, wf);
}

// ── 请求归一化 ──────────────────────────────────────────────────────────────
// 录像里记的是 loggedChat 看到的请求（messages / temperature / max_tokens / 解码参数），
// 替身收到的是 ai-gateway 发给 binding 的 inputs。两边取同一组字段比对。
// chat_template_kwargs（关思维链）不在录像里，所以不进 key——这是已知盲区，见 README。
//
// 录像里的 prompt 没有逐次变化的字段（查过：没有注入日期 / workflowId / 随机数；
// story_rank 的洗牌是按轮次定种子的），所以这里**不做任何文本归一化**：
// 发给模型的字节变了就该 miss。
const KEY_FIELDS = ['temperature', 'max_tokens', 'frequency_penalty', 'presence_penalty', 'seed', 'response_format'];

export function requestKey(model, req) {
  const o = { model, messages: req.messages };
  for (const k of KEY_FIELDS) if (req[k] !== undefined && req[k] !== null) o[k] = req[k];
  return crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
}

export function renderRequest(model, req) {
  const head = [`model: ${model}`];
  for (const k of KEY_FIELDS) if (req[k] !== undefined && req[k] !== null) head.push(`${k}: ${JSON.stringify(req[k])}`);
  const msgs = (req.messages || []).map((m, i) => `--- message[${i}] role=${m.role} ---\n${m.content}`);
  return [...head, ...msgs].join('\n') + '\n';
}

/** 两段文本的 unified diff（用系统 diff；相同则返回空串）。 */
export function unifiedDiff(a, b, labelA, labelB) {
  const tmp = fs.mkdtempSync(path.join(DATA_DIR, '.diff-'));
  const fa = path.join(tmp, 'a');
  const fb = path.join(tmp, 'b');
  fs.writeFileSync(fa, a);
  fs.writeFileSync(fb, b);
  try {
    execFileSync('diff', ['-u', '--label', labelA, '--label', labelB, fa, fb]);
    return '';
  } catch (e) {
    if (e.status === 1) return e.stdout.toString();
    throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** 粗相似度：公共前缀 + 公共后缀长度占比。只用来挑「最接近的录像」给人看 diff。 */
export function similarity(a, b) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return (p + s) / Math.max(a.length, b.length, 1);
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}
