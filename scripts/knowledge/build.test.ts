import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { build, parseEntry, validate, type Entry } from './build.ts';

const root = resolve(import.meta.dirname, '../../docs/knowledge');
// 知识库只留本地（不入 git）；新克隆里没有它时跳过依赖真实记录的测试。
const local = existsSync(resolve(root, 'nodes'));
const t = local ? test : test.skip;
const entries = (local ? readdirSync(resolve(root, 'nodes')) : [])
  .filter(f => f.endsWith('.md'))
  .sort()
  .map(f => parseEntry(f, readFileSync(resolve(root, 'nodes', f), 'utf8')));
const clone = () => structuredClone(entries);

function fixture(es: Entry[]) {
  const dir = mkdtempSync(resolve(tmpdir(), 'meridian-knowledge-test-'));
  mkdirSync(resolve(dir, 'nodes'));
  for (const { file, content, ...metadata } of es)
    writeFileSync(resolve(dir, 'nodes', file), `---\n${JSON.stringify(metadata)}\n---\n${content}\n`);
  return dir;
}

t('current records are valid', () => {
  validate(entries);
});

t('closed vocabularies, duplicate ids, dangling links and superseded pairing fail', () => {
  let es = clone();
  es[0].kind = 'attempt';
  assert.throws(() => validate(es), /kind 必须为/);
  es = clone();
  es[0].kind = 'approach';
  delete es[0].verdict;
  assert.throws(() => validate(es), /verdict/);
  es = clone();
  es[0].kind = 'fact';
  es[0].verdict = 'works';
  assert.throws(() => validate(es), /verdict/);
  es = clone();
  es[0].status = 'live';
  assert.throws(() => validate(es), /status 必须为/);
  es = clone();
  es.push(structuredClone(es[0]));
  assert.throws(() => validate(es), /重复 id/);
  es = clone();
  es[0].content += '\n- 相关 [[missing-record]]';
  assert.throws(() => validate(es), /不存在的记录/);
  es = clone();
  es[0].status = 'superseded';
  assert.throws(() => validate(es), /superseded_by/);
  es = clone();
  es[0].source = '';
  assert.throws(() => validate(es), /source/);
});

test('malformed frontmatter is rejected', () => {
  assert.throws(() => parseEntry('bad.md', '---\nid: bad\n---\ntext'), /JSON/);
  assert.throws(() => parseEntry('bad.md', '---\n[]\n---\ntext'), /对象/);
});

t('generation is deterministic and lists superseded records separately', () => {
  const dir = fixture(entries);
  build(dir);
  const index = readFileSync(resolve(dir, 'INDEX.md'), 'utf8');
  build(dir);
  assert.equal(readFileSync(resolve(dir, 'INDEX.md'), 'utf8'), index);
  if (entries.some(e => e.status === 'superseded')) assert.match(index, /## 已被取代/);
});

t('failed validation and check-only leave INDEX.md untouched', () => {
  const dir = fixture(entries);
  writeFileSync(resolve(dir, 'INDEX.md'), 'sentinel');
  build(dir, true);
  assert.equal(readFileSync(resolve(dir, 'INDEX.md'), 'utf8'), 'sentinel');
  const [first] = clone();
  first.content += '\n[[missing-record]]';
  const { file, content, ...metadata } = first;
  writeFileSync(resolve(dir, 'nodes', file), `---\n${JSON.stringify(metadata)}\n---\n${content}\n`);
  assert.throws(() => build(dir), /不存在的记录/);
  assert.equal(readFileSync(resolve(dir, 'INDEX.md'), 'utf8'), 'sentinel');
});
