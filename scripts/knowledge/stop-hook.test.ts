import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
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

test('first Stop validates; unchanged snapshot reuses success without writing cache or graph', () => {
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

test('source change triggers check; failure is not cached; rebuild permits success', () => {
  const { dir, root, cache } = fixture();
  try {
    checkStop(stop, root, cache);
    const file = resolve(root, 'nodes', readdirSync(resolve(root, 'nodes'))[0]);
    writeFileSync(file, readFileSync(file, 'utf8') + '\n新增证据说明\n');
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

test('generated corruption/deletion and node deletion bypass cached success', () => {
  for (const target of ['INDEX.md', 'graph.json', 'node']) {
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

test('invalid graph blocks; irrelevant events do nothing; corrupt cache is rebuilt', () => {
  const { dir, root, cache } = fixture();
  try {
    assert.deepEqual(checkStop({ hook_event_name: 'PostToolUse' }, root, cache), {});
    checkStop(stop, root, cache);
    const cacheFile = resolve(cache, readdirSync(cache)[0]);
    writeFileSync(cacheFile, 'not JSON');
    assert.deepEqual(checkStop(stop, root, cache), {});
    assert.ok(JSON.parse(readFileSync(cacheFile, 'utf8')).fingerprint);
    const file = resolve(root, 'nodes', readdirSync(resolve(root, 'nodes'))[0]);
    writeFileSync(file, readFileSync(file, 'utf8').replace('"relations": [', '"relations": [{"type":"addresses","to":"missing"},'));
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
