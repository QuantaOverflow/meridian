#!/usr/bin/env node
// 跨服务路由对账：被调方开的每条路由，调用方的生产代码里必须有真实调用；调用方调的每条路由，被调方必须开着。
// knip 只看 import 图，看不见 HTTP 调用：调用方删掉最后一个调用点后，被调方的路由仍被自己的入口
// import，整条旧链路（路由 → service → prompt）会一直算活的。
//
// 对账的服务对：
//   backend  → ai-worker：backend 里 new Request(...) / fetch(...) 的 URL
//   frontend → backend  ：frontend 里 readFromBackend / forwardToBackend 的 path 参数，以及拼了 WORKER_API 的 URL；
//                         另外 apps/backend/docs/API_GUIDE.md 路由表里「调用方」标「运维」的行算人手调用（curl 触发简报、
//                         查观测等），与全局约定「文档化的运维入口算活」一致；标「前端」的必须在前端代码里找到调用。
//                         文档列了、backend 没开的也报（文档过时）
//
// 怎么算「有真实调用方」（两步）：
//   1. 找到发请求的代码，记下所在函数/方法（如 /meridian/cluster/judge → AIWorkerService.judgeCluster）
//   2. 对该函数做 find-all-references；引用方只剩测试 / debug 路由 / 原型的不算
//      （ed043a8 删掉 workflow 里的 validateStory 调用后，它只剩 debug.ts 与测试在用，
//      /meridian/story/validate 连同背后的 service、prompt 因此留了 17 天）
//   发请求的代码不在具名函数里（如 Nuxt 的 defineEventHandler 箭头函数）时，所在文件就是入口，直接算生产调用。
//
// 用法：node scripts/check-routes.mjs（须从仓库根运行）
// 退出码：0 = 通过，1 = 有问题（逐条打印到 stdout）。

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();

// 引用出现在这些文件里不算「真实调用方」
const NON_PRODUCTION = [/\/test\//, /\/prototypes\//, /\/routers\/debug\.ts$/, /\.(spec|test)\.ts$/];

const problems = [];

// ---- 通用工具 ----

function walk(dir, exts = ['.ts']) {
  const out = [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel, exts));
    else if (exts.some((e) => entry.name.endsWith(e)) && !entry.name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

function visit(node, fn) {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
}

const rel = (f) => path.relative(ROOT, path.resolve(ROOT, f));
const isProduction = (f) => !NON_PRODUCTION.some((re) => re.test(rel(f)));
const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

function languageService(fileNames, options) {
  const service = ts.createLanguageService(
    {
      getCompilationSettings: () => options,
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
  return { service, program: service.getProgram() };
}

// 字面量 → 带占位符的文本：模板插值记成 \0，后面按「任意一段」匹配
function literalText(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => '\0' + s.literal.text).join('');
  return null;
}

// ---- 路由与调用的路径匹配 ----

// 调用方的 URL → 路径段：截掉查询串；末段尾部的插值（拼查询串用的）去掉；整段是插值的记成通配
function callSegments(url) {
  const segs = url.split('?')[0].split('/').filter(Boolean);
  if (segs.length) {
    const last = segs[segs.length - 1];
    if (last.endsWith('\0') && last !== '\0') segs[segs.length - 1] = last.replace(/\0+$/, '');
  }
  return segs.map((s) => (s.includes('\0') ? null : s));
}

function routeMatches(routePath, segs) {
  const route = routePath.split('/').filter(Boolean);
  for (let i = 0; i < route.length; i++) {
    if (route[i] === '*' && i === route.length - 1) return segs.length >= i;
    if (i >= segs.length) return false;
    if (route[i].startsWith(':') || segs[i] === null) continue;
    if (route[i] !== segs[i]) return false;
  }
  return route.length === segs.length;
}

// ---- 被调方：Hono 路由表 ----

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all']);

// 收集一个文件里 xxx.get/post/...('/path', ...) 的路由，加上挂载前缀
function honoRoutesIn(file, prefix) {
  const sf = ts.createSourceFile(file, fs.readFileSync(path.join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const out = [];
  visit(sf, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const method = node.expression.name.text;
    if (!HTTP_METHODS.has(method)) return;
    const [first] = node.arguments;
    if (!first || !ts.isStringLiteralLike(first) || !first.text.startsWith('/')) return;
    const full = (prefix + first.text).replace(/(.)\/$/, '$1');
    // 行号取方法名处：链式写法 new Hono().get(...).post(...) 的整条调用都从链头开始
    out.push({ method: method.toUpperCase(), path: full, where: `${file}:${lineOf(sf, node.expression.name.getStart())}` });
  });
  return out;
}

// app.ts 里的 .route('/prefix', router)：顺着 import 找到 router 文件
function mountedHonoRoutes(appFile) {
  const sf = ts.createSourceFile(appFile, fs.readFileSync(path.join(ROOT, appFile), 'utf8'), ts.ScriptTarget.Latest, true);
  const imports = new Map();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause?.name) {
      imports.set(stmt.importClause.name.text, stmt.moduleSpecifier.text);
    }
  }
  const routes = honoRoutesIn(appFile, '');
  visit(sf, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (node.expression.name.text !== 'route') return;
    const [prefix, router] = node.arguments;
    if (!prefix || !ts.isStringLiteralLike(prefix) || !router || !ts.isIdentifier(router)) return;
    const spec = imports.get(router.text);
    if (!spec) return problems.push(`${appFile}: 挂载的 ${router.text} 找不到 import，脚本没法读它的路由`);
    routes.push(...honoRoutesIn(rel(path.join(path.dirname(appFile), spec) + '.ts'), prefix.text));
  });
  return routes;
}

// ---- 调用方：找发请求的代码，再查所在函数的引用 ----

function enclosingFunctionName(node) {
  for (let n = node.parent; n; n = n.parent) {
    if ((ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name) return n.name;
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent)) return n.parent.name;
  }
  return null;
}

// calls: [{ url, method | null, node, sf, fileName }]
// vueFiles：TS 程序里没有 .vue，这些文件里按名字出现 `name(` 的也算引用
function resolveCallers({ service, program }, calls, vueFiles = []) {
  const vueTexts = vueFiles.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
  return calls.map((call) => {
    const nameNode = enclosingFunctionName(call.node);
    const prodRefs = [];
    const otherRefs = [];
    if (nameNode) {
      for (const group of service.findReferences(call.fileName, nameNode.getStart()) ?? []) {
        for (const ref of group.references) {
          if (ref.isDefinition) continue;
          const where = `${rel(ref.fileName)}:${lineOf(program.getSourceFile(ref.fileName), ref.textSpan.start)}`;
          (isProduction(ref.fileName) ? prodRefs : otherRefs).push(where);
        }
      }
      const name = nameNode.getText(call.sf);
      for (const [f, text] of vueTexts) {
        if (new RegExp(`\\b${name}\\(`).test(text)) (isProduction(f) ? prodRefs : otherRefs).push(f);
      }
    }
    return {
      ...call,
      fn: nameNode ? nameNode.getText(call.sf) : null,
      where: `${rel(call.fileName)}:${lineOf(call.sf, call.node.getStart())}`,
      prodRefs,
      otherRefs,
    };
  });
}

// ---- 对账 ----

function reconcile({ callee, caller, routes, calls, allowed }) {
  const matched = new Map(routes.map((r) => [r, []]));
  for (const call of calls) {
    const segs = callSegments(call.url);
    const hits = routes.filter((r) => (r.method === 'ALL' || !call.method || r.method === call.method) && routeMatches(r.path, segs));
    if (hits.length === 0) {
      const shown = `${call.method ?? ''} ${call.url.replace(/\0/g, '${…}')}`;
      problems.push(
        call.doc
          ? `${call.where}: 文档列了 ${shown}，但 ${callee} 没开这条路由（文档过时）`
          : `${call.where}: 调了 ${shown}，但 ${callee} 没开这条路由（线上会 404）`,
      );
    }
    for (const r of hits) matched.get(r).push(call);
  }
  for (const [route, hits] of matched) {
    const key = `${route.method} ${route.path}`;
    if (allowed[key] || allowed[route.path]) continue;
    if (hits.some((c) => !c.fn || c.prodRefs.length > 0)) continue;
    if (hits.length === 0) {
      problems.push(`${route.where}: ${key} 在 ${caller} 里没有任何调用`);
    } else {
      const detail = hits
        .map((c) => `${c.fn}（${c.where}）只被 ${c.otherRefs.length ? c.otherRefs.join('、') : '零处'} 引用`)
        .join('；');
      problems.push(`${route.where}: ${key} 没有生产调用方：${detail}`);
    }
  }
}

// ==== backend → ai-worker ====

{
  const routes = walk('services/meridian-ai-worker/src').flatMap((f) => honoRoutesIn(f, ''));
  const configPath = path.join(ROOT, 'apps/backend/tsconfig.json');
  const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  // test/ 也要进程序，否则 find-references 看不到它们，也就分不出「只剩测试在用」
  const fileNames = [...new Set([...config.fileNames, ...walk('apps/backend/test').map((f) => path.join(ROOT, f))])];
  const ls = languageService(fileNames, config.options);

  const calls = [];
  for (const fileName of config.fileNames) {
    if (!isProduction(fileName)) continue;
    const sf = ls.program.getSourceFile(fileName);
    if (!sf) continue;
    visit(sf, (node) => {
      const isRequest = ts.isNewExpression(node) && node.expression.getText(sf) === 'Request';
      const isFetch = ts.isCallExpression(node) && /(^|\.)fetch$/.test(node.expression.getText(sf));
      if (!isRequest && !isFetch) return;
      const [first] = node.arguments ?? [];
      const text = first && literalText(first);
      if (!text || !text.includes('/meridian/')) return;
      calls.push({ url: text.slice(text.indexOf('/meridian/')), method: null, node, sf, fileName });
    });
  }

  reconcile({
    callee: 'ai-worker',
    caller: 'backend 生产代码',
    routes,
    calls: resolveCallers(ls, calls),
    allowed: {
      '/meridian/chat': 'eval 透传口（eval/cluster-to-brief 直接调）',
      '/health': '健康检查',
    },
  });
}

// ==== frontend → backend ====

{
  const routes = mountedHonoRoutes('apps/backend/src/app.ts');
  const src = 'apps/frontend/src';
  const tsFiles = [...walk(src), ...walk('apps/frontend/test')].map((f) => path.join(ROOT, f));
  const ls = languageService(tsFiles, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: path.join(ROOT, 'apps/frontend'),
    paths: { '~/*': ['src/*'] },
    allowJs: false,
    noEmit: true,
  });

  // 调 backend 的写法：两个封装函数的 path 参数（GET / init.method），和直接拼 WORKER_API 的 URL（GET）
  const WRAPPERS = { readFromBackend: 'GET', forwardToBackend: null };
  const calls = [];
  for (const fileName of tsFiles) {
    if (!isProduction(fileName)) continue;
    const sf = ls.program.getSourceFile(fileName);
    if (!sf) continue;
    visit(sf, (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text in WRAPPERS) {
        const [first, init] = node.arguments;
        const url = first && literalText(first);
        if (!url || !url.replace(/\0/g, '')) return; // 封装函数自己转发 path 的那一处
        let method = WRAPPERS[node.expression.text];
        if (!method && init && ts.isObjectLiteralExpression(init)) {
          const prop = init.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'method');
          if (prop && ts.isStringLiteralLike(prop.initializer)) method = prop.initializer.text.toUpperCase();
        }
        calls.push({ url, method, node, sf, fileName });
      } else if (ts.isTemplateExpression(node) && /WORKER_API$/.test(node.templateSpans[0]?.expression.getText(sf) ?? '')) {
        const url = literalText(node).slice(1); // 去掉开头的 WORKER_API 插值
        if (!url.replace(/\0/g, '')) return; // `${WORKER_API}${path}`：封装函数内部
        calls.push({ url, method: 'GET', node, sf, fileName });
      }
    });
  }

  // API_GUIDE.md 路由表：| `GET /ping` | 鉴权 | 调用方 | 说明 |，首列也可能是 `GET\|POST /do/source/:sourceKey/*`、
  // `GET /observability/llm-calls/<key>`、一格里两条路由
  const guide = 'apps/backend/docs/API_GUIDE.md';
  const opsCalls = [];
  const frontendRows = [];
  fs.readFileSync(path.join(ROOT, guide), 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (!line.startsWith('| `')) return;
      const where = `${guide}:${i + 1}`;
      const [first, , who] = line.split(' | ');
      if (who !== '前端' && who !== '运维') return problems.push(`${where}: 「调用方」一列须是「前端」或「运维」，现在是「${who}」`);
      for (const [, methods, url] of first.matchAll(/`([A-Z\\|]+) (\/[^`]*)`/g)) {
        const pathOnly = url.split('?')[0].replace(/\/(:[^/]+|<[^>]+>)/g, '/\0');
        for (const method of methods.split(/\\?\|/).filter(Boolean)) {
          (who === '运维' ? opsCalls : frontendRows).push({ url: pathOnly, method, fn: null, doc: true, where });
        }
      }
    });
  // 标「前端」的行不算调用方，只查它对应的路由还在
  for (const row of frontendRows) {
    if (!routes.some((r) => r.method === row.method && routeMatches(r.path, callSegments(row.url)))) {
      problems.push(`${row.where}: 文档列了 ${row.method} ${row.url.replace(/\0/g, ':…')}，但 backend 没开这条路由（文档过时）`);
    }
  }

  reconcile({
    callee: 'backend',
    caller: `frontend 生产代码和 ${guide} 的「运维」行`,
    routes,
    calls: [...resolveCallers(ls, calls, walk(src, ['.vue'])), ...opsCalls],
    allowed: {
      'GET /favicon.ico': '禁用 favicon 的桩，直接回 404',
    },
  });
}

if (problems.length) {
  console.log(problems.join('\n'));
  console.log(`\n${problems.length} 条。没人调的路由连同背后的代码一起删；有意保留的写进 scripts/check-routes.mjs 对应服务对的 allowed 并注明原因。`);
  process.exit(1);
}
