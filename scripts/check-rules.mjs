#!/usr/bin/env node
// 校验 .claude/rules/*.md 的 frontmatter paths 是否匹配到文件，以及规则/CLAUDE.md/AGENTS.md
// 里反引号包起来、形似仓库路径的片段是否真的存在。零依赖，只用 node 内置模块。
// 用法：node scripts/check-rules.mjs（须从仓库根运行）
// 退出码：0 = 通过，1 = 有问题（逐条打印到 stdout）。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const PATH_PREFIXES = [
  'apps/',
  'services/',
  'packages/',
  'eval/',
  'docs/',
  'scripts/',
  '.claude/',
  '.agents/',
  '.codex/',
];
const FORBIDDEN_CHARS = ['*', '<', '>', '{', ' '];

const problems = [];

function report(file, message) {
  problems.push(`${file}: ${message}`);
}

// ---- git 数据 ----

function gitLsFiles() {
  // -z：NUL 分隔、禁用非 ASCII 文件名的 C 风格转义（否则含中文的路径在
  // trackedSet 里会是 "docs/3_\346\231..." 之类的转义字符串，永远匹配不上）
  // -co --exclude-standard：已追踪 + 未追踪但没被忽略的新文件（还没 git add 的新规则也算存在）
  const out = execFileSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function gitCheckIgnored(relPath) {
  // 目录型 gitignore 规则（以 / 结尾）在目标目录不存在于磁盘时，
  // 只有查询路径本身带尾部 / 才会被 git 判定命中，所以两种都试一次。
  for (const candidate of [relPath, relPath + '/']) {
    try {
      execFileSync('git', ['check-ignore', '-q', '--', candidate], { cwd: ROOT });
      return true;
    } catch (err) {
      // exit 1 = 不被忽略，继续试下一种；其它非 0 也当作不忽略处理
    }
  }
  return false;
}

const trackedFiles = gitLsFiles();
const trackedSet = new Set(trackedFiles);

function pathExists(relPath) {
  if (trackedSet.has(relPath)) return true;
  const prefix = relPath.endsWith('/') ? relPath : relPath + '/';
  if (trackedFiles.some((f) => f.startsWith(prefix))) return true;
  if (gitCheckIgnored(relPath)) return true;
  return false;
}

// ---- 规则 1：frontmatter paths 是否匹配到文件 ----

function parseFrontmatterPaths(content) {
  const lines = content.split('\n');
  if (lines[0].trim() !== '---') return [];
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return [];

  const fmLines = lines.slice(1, end);
  const globs = [];
  let inPaths = false;
  for (const line of fmLines) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths) {
      const item = line.match(/^\s*-\s*(.+?)\s*$/);
      if (item) {
        let val = item[1].trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        globs.push(val);
        continue;
      }
      if (line.trim() === '') continue;
      // 非列表项、非空行：paths 列表结束
      inPaths = false;
    }
  }
  return globs;
}

function checkRulesFrontmatter() {
  const rulesDir = path.join(ROOT, '.claude/rules');
  if (!fs.existsSync(rulesDir)) return;
  const files = fs
    .readdirSync(rulesDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  for (const f of files) {
    const rel = path.posix.join('.claude/rules', f);
    const content = fs.readFileSync(path.join(rulesDir, f), 'utf8');
    const globs = parseFrontmatterPaths(content);
    for (const glob of globs) {
      // 指向被 gitignore 的只留本地目录（如 */prototypes/**）也算有效：把通配段替换成占位名问 git 是否忽略
      const matched =
        trackedFiles.some((tf) => path.matchesGlob(tf, glob)) ||
        gitCheckIgnored(glob.replace(/\*\*/g, 'x').replace(/\*/g, 'x'));
      if (!matched) {
        report(rel, `paths 不匹配任何文件：${glob}`);
      }
    }
  }
}

// ---- 规则 2：反引号片段里形似仓库路径的片段是否存在 ----

function looksLikePath(token) {
  if (!PATH_PREFIXES.some((p) => token.startsWith(p))) return false;
  if (FORBIDDEN_CHARS.some((c) => token.includes(c))) return false;
  return true;
}

function normalizeCandidate(token) {
  let p = token;
  const hashIdx = p.indexOf('#');
  if (hashIdx !== -1) p = p.slice(0, hashIdx);
  p = p.replace(/:\d+$/, '');
  p = p.replace(/\/+$/, '');
  return p;
}

// 从文本里收集候选片段：
// 1) 单反引号 `...` 内联片段——若整段含空格/禁止字符则跳过整段（不拆词）
// 2) 三反引号围栏代码块内容——按行按空白拆词，逐词判定（围栏本身也是“反引号包起来”）
function collectCandidates(content) {
  const candidates = new Set();

  // 围栏代码块（```lang\n...\n```），先摘出去，避免其内部的单反引号被重复当内联片段处理
  const fencedRe = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  const fencedRanges = [];
  while ((m = fencedRe.exec(content)) !== null) {
    fencedRanges.push([m.index, fencedRe.lastIndex]);
    const block = m[1];
    for (const line of block.split('\n')) {
      for (const tok of line.split(/\s+/)) {
        const t = tok.trim();
        if (t && looksLikePath(t)) candidates.add(normalizeCandidate(t));
      }
    }
  }

  function insideFence(idx) {
    return fencedRanges.some(([s, e]) => idx >= s && idx < e);
  }

  // 单反引号内联片段
  const inlineRe = /`([^`\n]+)`/g;
  while ((m = inlineRe.exec(content)) !== null) {
    if (insideFence(m.index)) continue;
    const span = m[1].trim();
    if (span && looksLikePath(span)) candidates.add(normalizeCandidate(span));
  }

  return candidates;
}

function checkPathReferences() {
  const targets = [];
  const rulesDir = path.join(ROOT, '.claude/rules');
  if (fs.existsSync(rulesDir)) {
    for (const f of fs.readdirSync(rulesDir).filter((f) => f.endsWith('.md')).sort()) {
      targets.push(path.posix.join('.claude/rules', f));
    }
  }
  for (const f of ['CLAUDE.md', 'AGENTS.md']) {
    if (fs.existsSync(path.join(ROOT, f))) targets.push(f);
  }

  for (const rel of targets) {
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const candidates = collectCandidates(content);
    for (const candidate of [...candidates].sort()) {
      if (!pathExists(candidate)) {
        report(rel, `路径不存在：${candidate}`);
      }
    }
  }
}

checkRulesFrontmatter();
checkPathReferences();

if (problems.length > 0) {
  for (const p of problems) console.log(p);
  process.exit(1);
} else {
  process.exit(0);
}
