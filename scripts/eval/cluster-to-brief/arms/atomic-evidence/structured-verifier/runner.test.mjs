import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoundedClient, run } from './runner.mjs';
import { hash, VERSION } from './context-store.mjs';
import { atomicWriteJson } from '../probe.mjs';
import { oracleCases } from './oracle.mjs';
const limits = { logicalCalls: 21, httpAttempts: 42, knownTokens: 30000, timeoutMs: 1000 };
const temp = () => mkdtempSync(join(tmpdir(), 'meridian-structured-test-'));
const request = { prompt: 'test fixture only', schema: { type: 'object' } };
const response = (raw, usage = { prompt_tokens: 10, completion_tokens: 10 }) => ({ status: 200, json: async () => ({ success: true, data: { usage, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }] } }) });
test('runner: dry-run is truly offline and freezes a 6-case, 3-evidence plan', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('network must not be called'); });
  const out = temp(); const result = await run({ out });
  assert.equal(result.remoteCalls, 0); assert.equal(result.smoke, 6); assert.equal(result.evidenceConversions, 3); assert.ok(existsSync(`${out}/plan.json`));
});
test('runner: missing explicit remote authorization blocks fetch', async t => {
  const old = process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED; delete process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED;
  t.after(() => { if (old === undefined) delete process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED; else process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED = old; });
  let called = false; t.mock.method(globalThis, 'fetch', () => { called = true; throw Error('unexpected'); });
  await assert.rejects(run({ out: temp(), remote: true }), /remote_authorization_required/); assert.equal(called, false);
});
test('runner: one contract recovery, then durable cache reuse', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => response(++calls === 1 ? {} : { value: 1 }));
  const out = temp(); const client = new BoundedClient(out, limits);
  const validate = raw => { if (raw.value !== 1) throw Error('contract'); return raw; };
  assert.deepEqual(await client.request('test', request, validate), { value: 1 });
  assert.deepEqual(await new BoundedClient(out, limits).request('test', request, validate), { value: 1 });
  assert.equal(calls, 2); assert.equal(client.totals().httpAttempts, 2);
});
test('runner: service failure with HTTP 200 is infrastructure, not semantic/contract failure', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return { status: 200, json: async () => ({ success: false, error: 'internal error' }) }; });
  const out = temp(), client = new BoundedClient(out, limits);
  await assert.rejects(client.request('test', request, x => x), /infrastructure_stop/); assert.equal(calls, 1);
  assert.equal(JSON.parse(readFileSync(`${out}/calls.jsonl`, 'utf8').trim()).failureKind, 'infrastructure');
});
test('runner: unknown usage stops subsequent requests rather than claiming zero tokens', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return response({ value: 1 }, {}); });
  const client = new BoundedClient(temp(), limits);
  await client.request('first', request, x => x);
  await assert.rejects(client.request('next', { ...request, prompt: 'different' }, x => x), /unknown_usage_requires_explicit_audit/);
  assert.equal(calls, 1); assert.equal(client.totals().unknownUsageAttempts, 1);
});
test('runner: in-flight restart receipt prohibits silent resend', async t => {
  let called = false; t.mock.method(globalThis, 'fetch', () => { called = true; throw Error('unexpected'); });
  const out = temp(), client = new BoundedClient(out, limits);
  const cacheKey = hash({ version: VERSION, request, model: '@cf/zai-org/glm-4.7-flash', parameters: { temperature: [0, 0.1], max_tokens: 5000 } });
  atomicWriteJson(`${out}/cache/${cacheKey}-inflight.json`, { status: 'inflight_usage_unknown' });
  await assert.rejects(client.request('test', request, x => x), /inflight_unknown_usage_requires_explicit_audit/); assert.equal(called, false);
});
test('runner: known token budget stops before another call', async t => {
  let called = false; t.mock.method(globalThis, 'fetch', () => { called = true; throw Error('unexpected'); });
  const client = new BoundedClient(temp(), limits);
  client.records.push({ cacheKey: 'old', http: 200, inputTokens: 30000, outputTokens: 0, usageKnown: true, elapsedMs: 1 });
  await assert.rejects(client.request('test', request, x => x), /attempt_or_token_budget_exhausted/); assert.equal(called, false);
});
test('runner: audited unknown-usage reserve counts against budget, not billed zero', async t => {
  let called = false; t.mock.method(globalThis, 'fetch', () => { called = true; throw Error('unexpected'); });
  const out = temp(); atomicWriteJson(`${out}/recovery-audit.json`, { reviewedFailures: [{ cacheKey: 'failed', attempt: 1, reason: 'local test audit', reservedTokens: 30000 }] });
  const client = new BoundedClient(out, limits);
  client.records.push({ cacheKey: 'failed', attempt: 1, http: 500, usageKnown: false, elapsedMs: 1 });
  assert.equal(client.totals().unknownUsageAttempts, 1); assert.equal(client.totals().knownTokens, 0); assert.equal(client.totals().budgetTokens, 30000);
  await assert.rejects(client.request('test', request, x => x), /attempt_or_token_budget_exhausted/); assert.equal(called, false);
});
test('runner: whole pipeline executes 21 mocked logical calls with independent evidence cache', async t => {
  const old = process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED; process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED = 'yes';
  t.after(() => { if (old === undefined) delete process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED; else process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED = old; });
  const cases = oracleCases();
  const quoteRaw = ({ sourceId, exactText, occurrence }) => ({ sourceId, exactText, occurrence });
  const graphRaw = graph => ({ version: graph.version, family: graph.family, sourceHash: graph.sourceHash,
    nodes: graph.nodes.map(n => ({ ...n, anchors: n.anchors.map(quoteRaw) })),
    facts: graph.facts.map(f => { const { rawValue, ...rest } = f; return { ...rest, anchors: f.anchors.map(quoteRaw) }; }),
    coverage: graph.coverage.map(c => ({ ...c, span: quoteRaw(c.span) })), needsContext: graph.needsContext });
  const alignmentRaw = a => ({ nodeLinks: a.nodeLinks.map(l => ({ ...l, anchors: l.anchors.map(quoteRaw) })), factPairs: a.factPairs.map(l => ({ ...l, anchors: l.anchors.map(quoteRaw) })) });
  let calls = 0;
  // This mock has hand-authored oracle replies, not a language model. No network call.
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++; const prompt = JSON.parse(init.body).messages[0].content;
    assert.ok(!prompt.includes('originalId')); assert.ok(!prompt.includes('p11-u'));
    if (prompt.includes('SIDE ')) {
      const side = prompt.includes('SIDE candidate') ? 'candidate' : 'evidence';
      const sourceHash = /sourceHash=([a-f0-9]{64})/.exec(prompt)[1];
      const row = cases.find(c => c[side].sourceHash === sourceHash); assert.ok(row);
      return response(graphRaw(row[side]));
    }
    if (prompt.includes('CANDIDATE_GRAPH ')) {
      const graph = JSON.parse(prompt.split('CANDIDATE_GRAPH ')[1].split('\nEVIDENCE_GRAPH ')[0]);
      const row = cases.find(c => c.candidate.sourceHash === graph.sourceHash); assert.ok(row);
      return response(alignmentRaw(row.alignment));
    }
    const evidence = JSON.parse(prompt.split('\nEVIDENCE ')[1].split('\nReturn JSON')[0]);
    return response({ status: 'supported', quotes: [quoteRaw({ ...evidence[0], exactText: evidence[0].text, occurrence: 0 })] });
  });
  const out = temp(); const result = await run({ out, remote: true });
  assert.equal(calls, 21); assert.equal(result.cost.logicalCalls, 21); assert.equal(result.cases, 6);
  const saved = JSON.parse(readFileSync(`${out}/results.json`, 'utf8'));
  assert.equal(saved.semanticReview, 'not_performed'); assert.equal(saved.results.length, 6);
  assert.equal(JSON.parse(readFileSync(`${out}/run-state.json`, 'utf8')).status, 'completed');
});
