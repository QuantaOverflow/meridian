#!/usr/bin/env node
// pre-commit 的 eslint：有 error 就失败；通过时只打出「落在本次提交改动行上」的警告。
// 为什么只看改动行：按文件挑的话，改一行注释也会翻出整个文件的旧账，agent 会习惯性当成别人的问题跳过。
// 警告的范围取整个节点（line..endLine），所以往一个旧 catch 里加代码也算碰到它。
// 暂存区用 git diff --cached（git commit -- <paths> 时 git 会设好 GIT_INDEX_FILE，这里照用）。
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const r = spawnSync('pnpm', ['-s', 'lint', '--format', 'json'], { cwd: root, encoding: 'utf8', maxBuffer: 256 << 20 });
let results;
try {
  results = JSON.parse(r.stdout);
} catch {
  process.stdout.write(`${r.stdout}${r.stderr}`);
  process.exit(r.status || 1);
}

const rel = (f) => path.relative(root, f);
const errors = [];
const warnings = [];
for (const file of results) {
  for (const m of file.messages) (m.severity === 2 ? errors : warnings).push({ file: rel(file.filePath), ...m });
}
const fmt = (m) => `${m.file}:${m.line}:${m.column}  ${m.message}  (${m.ruleId ?? 'eslint'})`;
if (errors.length) {
  for (const m of errors) console.log(`error ${fmt(m)}`);
  process.exit(1);
}

// 本次提交每个文件新增 / 改动的行（-U0 下每个 hunk 头 @@ -a,b +c,d @@ 给出新文件里的 c..c+d-1）
const changed = new Map();
const diff = execFileSync('git', ['diff', '--cached', '-U0', '--no-color'], { cwd: root, encoding: 'utf8', maxBuffer: 256 << 20 });
let current = null;
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ ')) {
    current = line === '+++ /dev/null' ? null : line.slice(6);
    if (current) changed.set(current, []);
  } else if (current && line.startsWith('@@')) {
    const m = line.match(/\+(\d+)(?:,(\d+))?/);
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count > 0) changed.get(current).push([start, start + count - 1]);
  }
}
const touches = (m) =>
  (changed.get(m.file) ?? []).some(([a, b]) => a <= (m.endLine ?? m.line) && m.line <= b);
for (const m of warnings.filter(touches)) console.log(`⚠ ${fmt(m)}`);
