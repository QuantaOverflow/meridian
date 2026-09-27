#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook：碰 CLAUDE.md「禁区」里的路径时，交给用户确认（permissionDecision: ask）。
 *
 * 禁区：历史 migration 不可变；model-cache 是 470MB 的本地模型文件。
 * 用 ask 而不是 deny：禁区的原意是「未明确要求不要碰」，用户明确要求时要能放行，而放行权只在用户手里。
 *
 * 覆盖：Edit / Write / MultiEdit / NotebookEdit 的目标路径；Bash 命令里同时出现禁区路径和改写类操作（rm、mv、cp、sed -i、重定向、tee 等）。
 * 不拦：只读（cat、ls、grep）；`pnpm -F @meridian/database generate` 生成新 migration（命令里不出现禁区路径）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ZONES = [
  { dir: 'packages/database/migrations/', why: '历史 migration 不可变；改 schema 走 schema.ts → drizzle-kit generate' },
  { dir: 'services/meridian-ml-service/model-cache/', why: '470MB 本地模型文件（gitignored），按 ml-service README 手动下载' },
];

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const tool = input.tool_name ?? '';
const ti = input.tool_input ?? {};

const rel = (p) => path.relative(root, path.resolve(input.cwd || root, p));
let hit = null;
if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
  const file = ti.file_path ?? ti.notebook_path;
  if (file) hit = ZONES.find((z) => (rel(file) + '/').startsWith(z.dir));
} else if (tool === 'Bash') {
  const cmd = String(ti.command ?? '');
  const writes = /(^|[\s;&|(])(rm|mv|cp|rsync|truncate|tee|touch|ln|chmod|git\s+(rm|mv|checkout|restore))\b|\bsed\s+(-[a-zA-Z]*i|--in-place)/;
  // 重定向只看目标：`ls migrations 2>/dev/null` 不算写，`echo x > migrations/a.sql` 算
  const redirectTargets = [...cmd.matchAll(/>>?\s*['"]?([^\s'";&|]+)/g)].map((m) => m[1]);
  hit = ZONES.find(
    (z) =>
      (writes.test(cmd) && cmd.includes(z.dir.slice(0, -1))) ||
      redirectTargets.some((t) => (rel(t) + '/').startsWith(z.dir))
  );
}
if (!hit) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: `禁区 ${hit.dir}：${hit.why}。只有用户明确要求时才改。`,
    },
  })
);
