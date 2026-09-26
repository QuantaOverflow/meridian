#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook（Bash）：git push 前，按入口可达性复查本次新增的东西。
 *
 * 为什么是 Claude Code hook 而不是 git pre-push：pre-push（.githooks/pre-push）只能跑能变成退出码的
 * 检查（typecheck / knip / ruff），而「这段代码从入口追不追得到」要读代码判断——knip 看不见 HTTP 路由、
 * wrangler binding、DB 列。所以这里把**能机械算的部分**（本次 push 新增了哪些文件、路由、配置）算出来，
 * 拦下 push 并把清单交给模型；**判断**（每项有没有真实调用方）留给模型按全局 CLAUDE.md「Cleanup / purify」做。
 *
 * 流程：
 *   - 不是 git push、或没有要推的新 commit、或清单为空 → 放行（exit 0）
 *   - 清单非空且当前 HEAD 没复查过 → exit 2（拦下；stderr 交给模型）
 *   - 复查完：`node .claude/hooks/push-reachability.mjs --mark` 把 HEAD 记进 .git/claude-reachability-reviewed，再 push
 *
 * 测试时可用环境变量 REACHABILITY_BASE 指定比较起点（默认：上游分支与 HEAD 的 merge-base）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const marker = path.join(git('rev-parse', '--absolute-git-dir'), 'claude-reachability-reviewed');
const head = git('rev-parse', 'HEAD');

if (process.argv.includes('--mark')) {
  writeFileSync(marker, head + '\n');
  console.log(`已记录：${head.slice(0, 7)} 的入口可达性复查完成，可以 push。`);
  process.exit(0);
}

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}
const command = String(input?.tool_input?.command ?? '');
if (!/\bgit\s+(?:-C\s+\S+\s+)?push\b/.test(command) || /--dry-run\b/.test(command)) process.exit(0);

function baseRef() {
  if (process.env.REACHABILITY_BASE) return process.env.REACHABILITY_BASE;
  for (const upstream of ['@{u}', 'origin/meridian-dev']) {
    try {
      return git('merge-base', upstream, 'HEAD');
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}
const base = baseRef();
if (!base || git('rev-parse', base) === head) process.exit(0);
if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === head) process.exit(0);

// :(glob) 让 * 只匹配一层、** 递归；不加的话 git 把 apps/*/src 当成要整段匹配的路径，下面的文件一个也匹配不到
const SRC = [':(glob)apps/*/src/**', ':(glob)services/*/src/**', ':(glob)services/meridian-ml-service/cf-worker/src/**', ':(glob)packages/*/src/**'];
const lines = (out) => out.split('\n').filter(Boolean);

// 1. 新增的源码文件
const addedFiles = lines(git('diff', '--name-only', '--diff-filter=A', `${base}..HEAD`, '--', ...SRC));

// 2. 新增的路由：backend / ai-worker 的 Hono 路由定义 + 前端新增的 server/api 文件（Nuxt 按文件名成路由）
const routeDiff = git('diff', '-U0', `${base}..HEAD`, '--', 'apps/backend/src/routers', 'apps/backend/src/app.ts', 'services/meridian-ai-worker/src/index.ts', 'services/meridian-ml-service/src/main.py');
const addedRoutes = [];
let file = '';
for (const l of routeDiff.split('\n')) {
  if (l.startsWith('+++ b/')) file = l.slice(6);
  const m = l.match(/^\+(?!\+).*?\.(get|post|put|delete|patch|route)\(\s*['"`]([^'"`]+)/) ?? l.match(/^\+@app\.(get|post|put|delete)\(\s*["']([^"']+)/);
  if (m) addedRoutes.push(`${m[1].toUpperCase()} ${m[2]}  (${file})`);
}
const addedFrontendApi = addedFiles.filter((f) => f.startsWith('apps/frontend/src/server/api/'));

// 3. 配置与数据：binding / vars / Env 类型 / DB schema 有改动
const configFiles = lines(
  git('diff', '--name-only', `${base}..HEAD`, '--',
    'apps/backend/wrangler.jsonc', 'services/meridian-ai-worker/wrangler.toml',
    'services/meridian-ml-service/cf-worker/wrangler.jsonc', 'wrangler.toml',
    'apps/backend/src/index.ts', 'services/meridian-ai-worker/src/types.ts',
    'apps/frontend/nuxt.config.ts', 'packages/database/src/schema.ts')
);

if (addedFiles.length + addedRoutes.length + configFiles.length === 0) process.exit(0);

const section = (title, items) => (items.length ? `\n${title}\n${items.map((x) => `  - ${x}`).join('\n')}` : '');
process.stderr.write(
  `push 前的入口可达性复查（${base.slice(0, 7)}..${head.slice(0, 7)}）：本次新增了下面这些，knip 看不见其中的路由、binding、配置和 DB 列。` +
    section('新增的源码文件：', addedFiles) +
    section('新增的路由：', [...addedRoutes, ...addedFrontendApi.map((f) => `${f}（Nuxt 文件路由）`)]) +
    section('改动过的 binding / 配置 / Env / DB schema 文件：', configFiles) +
    `\n\n按全局 CLAUDE.md「Cleanup / purify」从入口往下追：每条新路由要有真实调用方或文档化的维护入口；` +
    `新文件里的导出、类方法、按名查的注册项要追得到入口；新 binding / 变量 / 列要有代码读；只被测试引用的算死。` +
    `\n复查完（有死代码先删、commit），运行 \`node .claude/hooks/push-reachability.mjs --mark\` 记录，再重新 push。\n`
);
process.exit(2);
