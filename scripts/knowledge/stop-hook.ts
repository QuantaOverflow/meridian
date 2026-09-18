/** Codex Stop hook: deterministic, read-only, at most one continuation per turn. */
import { readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.ts';

export type StopInput = { hook_event_name?: string; stop_hook_active?: boolean };
export type StopOutput = { decision?: 'block'; reason?: string; systemMessage?: string };

const HERE = resolve(fileURLToPath(import.meta.url), '..');

// Content hashes include generated files and validator code, not just git status or mtimes.
export function fingerprint(root: string): string {
  const hash = createHash('sha256');
  const files = [
    ...readdirSync(resolve(root, 'nodes')).filter(f => f.endsWith('.md')).sort().map(f => resolve(root, 'nodes', f)),
    ...['INDEX.md', 'graph.json'].map(f => resolve(root, f)),
    ...['schema.json', 'build.ts', 'stop-hook.ts'].map(f => resolve(HERE, f)),
  ];
  for (const file of files) {
    hash.update(JSON.stringify(file));
    try { hash.update(readFileSync(file)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      hash.update('missing');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function checkStop(
  input: StopInput,
  root = resolve(HERE, '../../docs/knowledge'),
  cacheDir = resolve(tmpdir(), 'meridian-knowledge-stop'),
): StopOutput {
  if (input.hook_event_name !== 'Stop') return {};
  try {
    const cacheFile = resolve(cacheDir, createHash('sha256').update(resolve(root)).digest('hex') + '.json');
    const current = fingerprint(root);
    try {
      if (JSON.parse(readFileSync(cacheFile, 'utf8')).fingerprint === current) return {};
    } catch { /* Missing or corrupt cache requires full validation. */ }
    build(root, true, true);
    // Cache only successful, unchanged snapshots. Cache errors never block a valid graph.
    if (fingerprint(root) === current) {
      try {
        mkdirSync(cacheDir, { recursive: true });
        const temporary = cacheFile + '.' + randomUUID();
        writeFileSync(temporary, JSON.stringify({ fingerprint: current }));
        renameSync(temporary, cacheFile);
      } catch { /* Next Stop will validate again if the cache is unavailable. */ }
    }
    return {};
  } catch (error) {
    const details = (error instanceof Error ? error.message : String(error)).slice(0, 3500);
    if (input.stop_hook_active) {
      return { systemMessage: `知识库仍未通过校验；不再次自动续跑。请在最终回复中说明未解决项。\n${details}` };
    }
    return {
      decision: 'block',
      reason: `本轮结束前知识库检查失败。按 AGENTS.md 修复节点或运行 pnpm -s knowledge 更新索引，再完成只读校验。不要调用 LLM 来生成经验，也不要为通过检查删除实验历史；若受环境阻碍则明确说明。\n${details}`,
    };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let output: StopOutput;
  try {
    const input: unknown = JSON.parse(readFileSync(0, 'utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('hook 输入必须为 JSON 对象');
    output = checkStop(input as StopInput);
  } catch (error) {
    output = { systemMessage: `知识库 Stop hook 输入异常，未完成检查：${error instanceof Error ? error.message : String(error)}` };
  }
  // Stop requires JSON stdout. Success stays silent in the conversation; diagnostics never touch stdout.
  process.stdout.write(JSON.stringify(output) + '\n');
}
