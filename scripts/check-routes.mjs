#!/usr/bin/env node
// 跨服务路由对账：ai-worker 开的每条路由，backend 生产代码里必须有真实调用方；
// backend 调的每条路由，ai-worker 必须开着。
// knip 只看 import 图，看不见 HTTP 调用：backend 删掉最后一个调用点后，ai-worker 的路由
// 仍被自己的入口 import，整条旧链路（路由 → service → prompt）会一直算活的。
//
// 怎么算「有真实调用方」（两步）：
//   1. 在 backend 源码里找 new Request(...) / fetch(...) 实参中的 ai-worker 路径，记下所在函数/方法
//      （如 /meridian/cluster/judge → AIWorkerService.judgeCluster）
//   2. 对该函数做 find-all-references；引用方只剩测试 / debug 路由 / 原型的不算
//      （ed043a8 删掉 workflow 里的 validateStory 调用后，它只剩 debug.ts 与测试在用，
//      /meridian/story/validate 连同背后的 service、prompt 因此留了 17 天）
//
// 用法：node scripts/check-routes.mjs（须从仓库根运行）
// 退出码：0 = 通过，1 = 有问题（逐条打印到 stdout）。

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const AI_WORKER_SRC = 'services/meridian-ai-worker/src';
const BACKEND = 'apps/backend';

// 调用方不在 backend 生产代码里、有意保留的路由
const ALLOWED_WITHOUT_CALLER = {
  '/meridian/chat': 'eval 透传口（eval/cluster-to-brief 直接调）',
  '/health': '健康检查',
};

// 引用出现在这些文件里不算「真实调用方」
const NON_PRODUCTION = [/\/test\//, /\/prototypes\//, /\/routers\/debug\.ts$/, /\.(spec|test)\.ts$/];

const problems = [];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

function parse(file) {
  return ts.createSourceFile(file, fs.readFileSync(path.join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true);
}

function visit(node, fn) {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
}

// ---- ai-worker 开了哪些路由：app.get/post/...('/path', ...) ----

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all']);
const routes = new Map(); // path → 'file:line'
for (const file of walk(AI_WORKER_SRC)) {
  const sf = parse(file);
  visit(sf, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (!HTTP_METHODS.has(node.expression.name.text)) return;
    const [first] = node.arguments;
    if (!first || !ts.isStringLiteralLike(first) || !first.text.startsWith('/')) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    routes.set(first.text, `${file}:${line}`);
  });
}

// ---- backend 调了哪些路由，以及发请求的函数 ----

function literalText(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => s.literal.text).join('');
  return null;
}

// 路由路径出现在请求 URL 的尾部（前面是 baseUrl 插值），按最长匹配取
function matchRoute(url) {
  let best = null;
  for (const route of routes.keys()) {
    if ((url === route || url.endsWith(route)) && (!best || route.length > best.length)) best = route;
  }
  return best;
}

// 发请求代码所在的函数：返回可以做 find-references 的名字节点
function enclosingFunctionName(node) {
  for (let n = node.parent; n; n = n.parent) {
    if ((ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name) return n.name;
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent)) return n.parent.name;
  }
  return null;
}

const configPath = path.join(ROOT, BACKEND, 'tsconfig.json');
const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
// test/ 与 debug 路由也要进程序，否则 find-references 看不到它们，也就分不出「只剩测试在用」
const testFiles = fs.existsSync(path.join(ROOT, BACKEND, 'test')) ? walk(`${BACKEND}/test`).map((f) => path.join(ROOT, f)) : [];
const fileNames = [...new Set([...config.fileNames, ...testFiles])];
const service = ts.createLanguageService(
  {
    getCompilationSettings: () => config.options,
    getScriptFileNames: () => fileNames,
    getScriptVersion: () => '1',
    getScriptSnapshot: (f) => (fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, 'utf8')) : undefined),
    getCurrentDirectory: () => ROOT,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
  },
  ts.createDocumentRegistry(),
);
const program = service.getProgram();

const rel = (f) => path.relative(ROOT, f);
const isProduction = (f) => !NON_PRODUCTION.some((re) => re.test(rel(f)));

const callers = new Map(); // route → [{ fn, where, prodRefs, otherRefs }]
for (const fileName of config.fileNames) {
  if (!isProduction(fileName)) continue;
  const sf = program.getSourceFile(fileName);
  if (!sf) continue;
  visit(sf, (node) => {
    const isRequest = ts.isNewExpression(node) && node.expression.getText(sf) === 'Request';
    const isFetch = ts.isCallExpression(node) && /(^|\.)fetch$/.test(node.expression.getText(sf));
    if (!isRequest && !isFetch) return;
    const [first] = node.arguments ?? [];
    const url = first && literalText(first);
    if (!url || !url.includes('/meridian/')) return;
    const where = `${rel(fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const route = matchRoute(url);
    if (!route) {
      problems.push(`${where}: 调了 ${url.slice(url.indexOf('/meridian/'))}，但 ai-worker 没开这条路由（线上会 404）`);
      return;
    }
    const nameNode = enclosingFunctionName(node);
    const prodRefs = [];
    const otherRefs = [];
    if (nameNode) {
      for (const group of service.findReferences(fileName, nameNode.getStart()) ?? []) {
        for (const ref of group.references) {
          if (ref.isDefinition) continue;
          const line = program.getSourceFile(ref.fileName).getLineAndCharacterOfPosition(ref.textSpan.start).line + 1;
          (isProduction(ref.fileName) ? prodRefs : otherRefs).push(`${rel(ref.fileName)}:${line}`);
        }
      }
    }
    const entry = { fn: nameNode ? nameNode.getText(sf) : null, where, prodRefs, otherRefs };
    callers.set(route, [...(callers.get(route) ?? []), entry]);
  });
}

// ---- 对账 ----

for (const [route, defined] of routes) {
  if (ALLOWED_WITHOUT_CALLER[route]) continue;
  const entries = callers.get(route) ?? [];
  // 发请求的代码不在具名函数里（如顶层直接 fetch），当作生产调用
  if (entries.some((e) => !e.fn || e.prodRefs.length > 0)) continue;
  if (entries.length === 0) {
    problems.push(`${defined}: ${route} 在 backend 生产代码里没有任何调用`);
  } else {
    const detail = entries
      .map((e) => `${e.fn}（${e.where}）只被 ${e.otherRefs.length ? e.otherRefs.join('、') : '零处'} 引用`)
      .join('；');
    problems.push(`${defined}: ${route} 没有生产调用方：${detail}`);
  }
}

if (problems.length) {
  console.log(problems.join('\n'));
  console.log(`\n${problems.length} 条。没人调的路由连同背后的 service / prompt 一起删；有意保留的写进 scripts/check-routes.mjs 的 ALLOWED_WITHOUT_CALLER 并注明原因。`);
  process.exit(1);
}
