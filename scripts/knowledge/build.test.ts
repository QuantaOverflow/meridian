import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { build, parseEntity, validateGraph, type Entity } from './build.ts';

const root = resolve(import.meta.dirname, '../../docs/knowledge');
const nodes = readdirSync(resolve(root, 'nodes'))
  .filter(f => f.endsWith('.md'))
  .sort()
  .map(f => parseEntity(f, readFileSync(resolve(root, 'nodes', f), 'utf8')));
const clone = () => structuredClone(nodes);
const get = (ns: Entity[], id: string) => ns.find(n => n.id === id)!;

function fixture(ns: Entity[]) {
  const dir = mkdtempSync(resolve(tmpdir(), 'meridian-knowledge-test-'));
  mkdirSync(resolve(dir, 'nodes'));
  for (const { file, content, ...metadata } of ns)
    writeFileSync(resolve(dir, 'nodes', file), `---\n${JSON.stringify(metadata)}\n---\n${content}\n`);
  return dir;
}

test('current six-entity graph has valid typed endpoints and scoped relations', () => {
  validateGraph(nodes);
  assert.equal(new Set(nodes.map(n => n.type)).size, 6);
  const warning = get(nodes, 'falsified-minimal-unit-compression');
  assert.ok(warning.relations.some(r => r.type === 'cautions' && r.attributes?.scope));
  assert.ok(!warning.relations.some(r => r.type === 'refutes'));
  assert.ok(!get(nodes, 'claim-anchor-not-rewrite').relations.some(r => r.type === 'evaluated_by'));
});

test('early pass and later failures remain separate evidence', () => {
  const attempt = get(nodes, 'attempt-evidence-isolation');
  const outcomes = attempt.relations.filter(r => r.type === 'evaluated_by').map(r => get(nodes, r.to).outcome);
  assert.deepEqual(outcomes, ['passed', 'failed', 'failed']);
  assert.equal(get(nodes, 'attempt-constrained-risk-slots').verification, 'proposed');
  assert.equal(get(nodes, 'attempt-plan-verify-backfill').verification, 'proposed');
});

test('unknown entity/relationship, duplicate IDs, dangling and incorrect endpoints fail', () => {
  let ns = clone();
  ns[0].type = 'falsified';
  assert.throws(() => validateGraph(ns), /未知实体类型/);
  ns = clone();
  ns.push(structuredClone(ns[0]));
  assert.throws(() => validateGraph(ns), /重复 id/);
  ns = clone();
  ns[0].relations.push({ type: 'addresses', to: 'missing-node' });
  assert.throws(() => validateGraph(ns), /悬空引用/);
  ns = clone();
  get(ns, 'attempt-direct-raw').relations.push({ type: 'addresses', to: 'lesson-three-arm-tradeoff' });
  assert.throws(() => validateGraph(ns), /不合法的实体类型组合/);
  ns = clone();
  ns[0].relations.push({ type: 'measured_by', to: 'goal-cluster-to-brief' });
  assert.throws(() => validateGraph(ns), /未知关系/);
});

test('changes, fusion adaptations, source and type-specific fields are mandatory', () => {
  let ns = clone();
  get(ns, 'attempt-auto-risk-question').relations.find(r => r.type === 'varies_from')!.attributes = {};
  assert.throws(() => validateGraph(ns), /缺少关系属性 changed/);
  ns = clone();
  get(ns, 'attempt-plan-verify-backfill').relations.find(r => r.type === 'incorporates')!.attributes = {};
  assert.throws(() => validateGraph(ns), /缺少关系属性 adaptation/);
  ns = clone();
  ns[0].source = '';
  assert.throws(() => validateGraph(ns), /source/);
  ns = clone();
  get(ns, 'attempt-direct-raw').hypothesis = '';
  assert.throws(() => validateGraph(ns), /hypothesis/);
});

test('proposal cannot masquerade as tested; replacement cannot cross entity types', () => {
  let ns = clone();
  get(ns, 'attempt-constrained-risk-slots').relations.push({ type: 'evaluated_by', to: 'experiment-auto-risk-four' });
  assert.throws(() => validateGraph(ns), /proposed/);
  ns = clone();
  get(ns, 'decision-hold-auto-risk-integration').relations.push({
    type: 'supersedes',
    to: 'measure-auto-risk-question-drift',
  });
  assert.throws(() => validateGraph(ns), /同类实体/);
});

test('supersedes target must carry status superseded', () => {
  const ns = clone();
  get(ns, 'claim-output-bound-cost').status = 'recorded';
  assert.throws(() => validateGraph(ns), /被取代节点 status 应为 superseded/);
});

test('JSON metadata preserves punctuation in conditions and rejects malformed frontmatter', () => {
  const n = get(nodes, 'falsified-one-source-per-sentence');
  assert.ok(n.conditions.includes('头条目标 1,200–2,000 字符'));
  assert.throws(() => parseEntity('bad.md', '---\nid: bad\n---\ntext'), /JSON/);
  assert.throws(() => parseEntity('bad.md', '---\n[]\n---\ntext'), /对象/);
});

test('generation is deterministic, exports attributes and produces reverse links', () => {
  const dir = fixture(nodes);
  const counts = build(dir);
  const index = readFileSync(resolve(dir, 'INDEX.md'), 'utf8');
  const graph = readFileSync(resolve(dir, 'graph.json'), 'utf8');
  build(dir);
  assert.equal(readFileSync(resolve(dir, 'INDEX.md'), 'utf8'), index);
  assert.equal(readFileSync(resolve(dir, 'graph.json'), 'utf8'), graph);
  const data = JSON.parse(graph);
  assert.equal(data.entities.length, counts.nodes);
  assert.equal(data.relations.length, counts.edges);
  assert.ok(
    data.relations.some(
      (r: { type: string; attributes?: { changed?: string } }) => r.type === 'varies_from' && r.attributes?.changed
    )
  );
  assert.match(index, /入边 `varies_from`/);
  assert.match(index, /历史摘要，运行细节不完整/);
});

test('failed validation and check-only leave generated files untouched', () => {
  const dir = fixture(nodes);
  writeFileSync(resolve(dir, 'INDEX.md'), 'sentinel index');
  writeFileSync(resolve(dir, 'graph.json'), 'sentinel graph');
  build(dir, true);
  assert.equal(readFileSync(resolve(dir, 'INDEX.md'), 'utf8'), 'sentinel index');
  const broken = clone();
  broken[0].relations.push({ type: 'based_on', to: 'missing-node' });
  const { file, content, ...metadata } = broken[0];
  writeFileSync(resolve(dir, 'nodes', file), `---\n${JSON.stringify(metadata)}\n---\n${content}\n`);
  assert.throws(() => build(dir), /悬空引用/);
  assert.equal(readFileSync(resolve(dir, 'INDEX.md'), 'utf8'), 'sentinel index');
  assert.equal(readFileSync(resolve(dir, 'graph.json'), 'utf8'), 'sentinel graph');
});
