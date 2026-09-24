import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from './build.ts';
import { checkStop, fingerprint } from './stop-hook.ts';

const project = resolve(import.meta.dirname, '../..');
const source = resolve(project, 'docs/knowledge');
function fixture() {
  const dir = mkdtempSync(resolve(tmpdir(), 'knowledge-stop-test-'));
  const root = resolve(dir, 'knowledge');
  cpSync(source, root, { recursive: true });
  return { dir, root, cache: resolve(dir, 'cache') };
}
const stop = { hook_event_name: 'Stop' };
// 知识库只留本地（不入 git）；新克隆里没有它时跳过依赖真实记录的测试。
const t = existsSync(resolve(source, 'nodes')) ? test : test.skip;

test('missing local knowledge base is not an error', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'knowledge-stop-test-'));
  try { assert.deepEqual(checkStop(stop, resolve(dir, 'knowledge'), resolve(dir, 'cache')), {}); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

t('first Stop validates; unchanged snapshot reuses success without rewriting cache', () => {
  const { dir, root, cache } = fixture();
  try {
    const before = fingerprint(root);
    assert.deepEqual(checkStop(stop, root, cache), {});
    const file = resolve(cache, readdirSync(cache)[0]);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.marker = 'must survive cache hit';
    writeFileSync(file, JSON.stringify(saved));
    assert.deepEqual(checkStop(stop, root, cache), {});
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).marker, saved.marker);
    assert.equal(fingerprint(root), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

t('source change triggers check; failure is not cached; rebuild permits success', () => {
  const { dir, root, cache } = fixture();
  try {
    checkStop(stop, root, cache);
    const file = resolve(root, 'nodes', readdirSync(resolve(root, 'nodes'))[0]);
    writeFileSync(file, readFileSync(file, 'utf8').replace('"title": "', '"title": "改标题 '));
    const result = checkStop(stop, root, cache);
    assert.equal(result.decision, 'block');
    assert.match(result.reason!, /过期/);
    assert.equal(checkStop(stop, root, cache).decision, 'block');
    const retry = checkStop({ ...stop, stop_hook_active: true }, root, cache);
    assert.equal(retry.decision, undefined);
    assert.match(retry.systemMessage!, /不再次自动续跑/);
    build(root);
    assert.deepEqual(checkStop({ ...stop, stop_hook_active: true }, root, cache), {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

t('generated corruption/deletion and node deletion bypass cached success', () => {
  for (const target of ['INDEX.md', 'node']) {
    const { dir, root, cache } = fixture();
    try {
      checkStop(stop, root, cache);
      const file = target === 'node' ? resolve(root, 'nodes', readdirSync(resolve(root, 'nodes'))[0]) : resolve(root, target);
      if (target === 'INDEX.md') writeFileSync(file, 'corrupted');
      else rmSync(file);
      assert.equal(checkStop(stop, root, cache).decision, 'block');
      if (target === 'INDEX.md') assert.equal(readFileSync(file, 'utf8'), 'corrupted');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

t('invalid record blocks; irrelevant events do nothing; corrupt cache is rebuilt', () => {
  const { dir, root, cache } = fixture();
  try {
    assert.deepEqual(checkStop({ hook_event_name: 'PostToolUse' }, root, cache), {});
    checkStop(stop, root, cache);
    const cacheFile = resolve(cache, readdirSync(cache)[0]);
    writeFileSync(cacheFile, 'not JSON');
    assert.deepEqual(checkStop(stop, root, cache), {});
    assert.ok(JSON.parse(readFileSync(cacheFile, 'utf8')).fingerprint);
    const file = resolve(root, 'nodes', readdirSync(resolve(root, 'nodes'))[0]);
    writeFileSync(file, readFileSync(file, 'utf8').replace('"kind": "', '"kind": "bogus-'));
    assert.equal(checkStop(stop, root, cache).decision, 'block');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('actual configured command emits JSON from root and nested cwd; malformed input warns', () => {
  const config = JSON.parse(readFileSync(resolve(project, '.codex/hooks.json'), 'utf8'));
  const command = config.hooks.Stop[0].hooks[0].command;
  for (const cwd of [project, resolve(project, 'scripts/knowledge')]) {
    const result = spawnSync('/bin/sh', ['-c', command], { cwd, input: JSON.stringify(stop), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {});
  }
  const bad = spawnSync('/bin/sh', ['-c', command], { cwd: project, input: '{', encoding: 'utf8' });
  assert.match(JSON.parse(bad.stdout).systemMessage, /输入异常/);
});
