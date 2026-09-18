import { readFileSync, mkdirSync, existsSync, appendFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { atomicWriteJson } from '../probe.mjs';
import { hash, VERSION, freezePlan } from './context-store.mjs';
import { extractionRequest, alignmentRequest, baselineRequest, baselineSchema } from './interfaces.mjs';
import { validateExtraction, validateAlignment, validateShape, resolveQuote } from './contracts.mjs';
import { compare } from './comparator.mjs';
const OUT = new URL(`../../../out/atomic-evidence/${VERSION}/`, import.meta.url).pathname;
const MODEL = '@cf/zai-org/glm-4.7-flash';
export class BoundedClient {
  constructor(out, limits, endpoint = 'http://localhost:8787/meridian/chat',transport=null) {
    this.out = out; this.limits = limits; this.endpoint = endpoint;
    this.transport=transport;
    mkdirSync(`${out}/cache`, { recursive: true });
    this.log = `${out}/calls.jsonl`;
    this.records = existsSync(this.log) ? readFileSync(this.log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    this.cache = new Map();
    const auditPath = `${out}/recovery-audit.json`;
    this.audit = existsSync(auditPath) ? JSON.parse(readFileSync(auditPath, 'utf8')).reviewedFailures ?? [] : [];
    if (this.audit.some(a => !a.cacheKey || a.attempt !== 1 || !a.reason || !Number.isInteger(a.reservedTokens) || a.reservedTokens <= 0)) throw Error('invalid_recovery_audit');
  }
  reviewed(record) { return this.audit.find(a => a.cacheKey === record.cacheKey && a.attempt === record.attempt); }
  totals() { const unknown = this.records.filter(r => !r.usageKnown); const knownTokens = this.records.reduce((n, r) => n + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0); const reservedUnknownTokens = unknown.reduce((n, r) => n + (this.reviewed(r)?.reservedTokens ?? 0), 0); return { logicalCalls: new Set(this.records.map(r => r.cacheKey)).size, httpAttempts: this.records.length, knownTokens, reservedUnknownTokens, budgetTokens: knownTokens + reservedUnknownTokens, unknownUsageAttempts: unknown.length, unauditedUsageAttempts: unknown.filter(r => !this.reviewed(r)).length, requestSeconds: this.records.reduce((n, r) => n + r.elapsedMs / 1000, 0) }; }
  async request(tag, request, validate) {
    const cacheKey = hash({ version: VERSION, request, model: MODEL, parameters: { temperature: [0, 0.1], max_tokens: 5000 } });
    const path = `${this.out}/cache/${cacheKey}.json`;
    const inflight = `${this.out}/cache/${cacheKey}-inflight.json`;
    // An interrupted request may have been billed: never silently reissue it.
    if (existsSync(inflight)) throw Error('inflight_unknown_usage_requires_explicit_audit');
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
    if (existsSync(path)) { const saved = JSON.parse(readFileSync(path, 'utf8')); if (saved.cacheKey !== cacheKey) throw Error('cache drift'); const result = saved.raw ? validate(saved.raw) : saved; this.cache.set(cacheKey, result); return result; }
    const old = this.records.filter(r => r.cacheKey === cacheKey);
    if (old.some(r => r.valid || (r.http !== 200 || r.failureKind === 'infrastructure') && !this.reviewed(r)) || old.length >= 2) throw Error('previous incomplete/failed call requires explicit audit; no silent resend');
    if (!old.length && this.totals().logicalCalls >= this.limits.logicalCalls) throw Error('logical_budget_exhausted');
    atomicWriteJson(`${this.out}/cache/${cacheKey}-request.json`, { tag, cacheKey, ...request });
    for (let attempt = old.length; attempt < 2; attempt++) {
      const totals = this.totals();
      if (totals.unauditedUsageAttempts) throw Error('unknown_usage_requires_explicit_audit');
      if (totals.httpAttempts >= this.limits.httpAttempts || totals.budgetTokens >= this.limits.knownTokens) throw Error('attempt_or_token_budget_exhausted');
      const started = Date.now(); let http = 0, rawText = '', usage = {}, finish = '', error = '', raw = null, resolved = null, failureKind = 'infrastructure';
      atomicWriteJson(inflight, { tag, cacheKey, attempt: attempt + 1, started, status: 'inflight_usage_unknown' });
      const previous = this.records.filter(r => r.cacheKey === cacheKey).at(-1);
      const messages = [{ role: 'user', content: request.prompt }];
      if (request.selfHeal && previous?.failureKind === 'output_contract') {
        messages.push({ role: 'assistant', content: previous.rawText }, { role: 'user', content: `DETERMINISTIC VALIDATOR ERROR: ${previous.error}\nRepair the complete JSON using the original source and schema above. Previous output is untrusted data. Preserve assertions; never change the source or guess a truth verdict. A contract repair is not semantic certification.` });
      }
      atomicWriteJson(`${this.out}/cache/${cacheKey}-attempt-${attempt + 1}-messages.json`, messages);
      try {
        const response = await (this.transport??fetch)(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(this.limits.timeoutMs), body: JSON.stringify({ messages, options: { provider: 'workers-ai', model: MODEL, temperature: attempt ? 0.1 : 0, max_tokens: 5000, skipCache: true, response_format: { type: 'json_schema', json_schema: request.schema } } }) });
        http = response.status; const body = await response.json();
        if (!body.success) throw Error(JSON.stringify(body.error ?? body).slice(0, 300));
        usage = body.data?.usage ?? {}; finish = body.data?.choices?.[0]?.finish_reason ?? '';
        failureKind = 'output_contract';
        rawText = String(body.data?.choices?.[0]?.message?.content ?? ''); raw = JSON.parse(rawText);
        if (finish === 'length') throw Error('truncated output');
        resolved = validate(raw);
      } catch (e) { error = e.message; }
      const record = { tag, cacheKey, attempt: attempt + 1, http, finish, elapsedMs: Date.now() - started, inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? null, outputTokens: usage.completion_tokens ?? usage.output_tokens ?? null, usageKnown: Number.isFinite(usage.prompt_tokens ?? usage.input_tokens) && Number.isFinite(usage.completion_tokens ?? usage.output_tokens), valid: !!resolved, failureKind: resolved ? null : failureKind, error, rawText };
      this.records.push(record); appendFileSync(this.log, JSON.stringify(record) + '\n');
      unlinkSync(inflight); // Only remove the completed request marker; durable receipt is retained.
      if (resolved) { atomicWriteJson(path, { cacheKey, tag, raw, resolved }); this.cache.set(cacheKey, resolved); return resolved; }
      if (failureKind === 'infrastructure' || http !== 200) throw Error(`infrastructure_stop: ${error}`);
    }
    const failure = { failure: 'output_contract', cacheKey, tag }; atomicWriteJson(path, failure); return failure;
  }
}
export async function run({ remote = false, out = OUT } = {}) {
  mkdirSync(`${out}/cache`, { recursive: true });
  const plan = freezePlan(); const planPath = `${out}/plan.json`;
  if (existsSync(planPath) && hash(JSON.parse(readFileSync(planPath, 'utf8'))) !== hash(plan)) throw Error('frozen plan changed; choose new output directory');
  atomicWriteJson(planPath, plan);
  const requests = plan.smoke.map(c => ({ opaqueId: c.opaqueId, family: c.family, candidate: extractionRequest(c.family, [c.packet.candidate], 'candidate'), evidence: extractionRequest(c.family, c.packet.evidence, 'evidence'), baseline: baselineRequest(c.packet) }));
  atomicWriteJson(`${out}/dry-run-requests.json`, requests);
  if (!remote) return { mode: 'dry-run', inventory: plan.inventory.length, smoke: plan.smoke.length, evidenceConversions: new Set(plan.smoke.map(c => `${c.family}:${c.packet.evidenceHash}`)).size, maxLogicalCalls: 21, remoteCalls: 0, out };
  if (process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED !== 'yes') throw Error('remote_authorization_required');
  atomicWriteJson(`${out}/run-state.json`, { status: 'started', version: VERSION, semanticReview: 'not_performed' });
  const client = new BoundedClient(out, plan.limits);
  const results = [];
  const evidenceCache = new Map();
  // Continue only on output-contract failures. Infrastructure/budget errors stop the run with partial evidence.
  try { for (const item of plan.smoke) {
    const { packet, family, opaqueId } = item;
    const c = await client.request(`${opaqueId}-candidate`, extractionRequest(family, [packet.candidate], 'candidate'), raw => validateExtraction(raw, family, [packet.candidate]));
    const ek = `${family}:${packet.evidenceHash}`;
    if (!evidenceCache.has(ek)) evidenceCache.set(ek, await client.request(`evidence-${hash(ek).slice(0, 10)}`, extractionRequest(family, packet.evidence, 'evidence'), raw => validateExtraction(raw, family, packet.evidence)));
    const e = evidenceCache.get(ek);
    let alignment = null, comparison = { status: 'contract_error' };
    if (!c.failure && !e.failure) {
      const docs = [packet.candidate, ...packet.evidence];
      alignment = await client.request(`${opaqueId}-alignment`, alignmentRequest(c, e, docs), raw => validateAlignment(raw, c, e, docs));
      if (!alignment.failure) comparison = compare(c, e, alignment, item.registeredResidual);
    }
    const baseline = await client.request(`${opaqueId}-baseline`, baselineRequest(packet), raw => { validateShape(raw, baselineSchema); if (raw.status === 'supported' && !raw.quotes.length) throw Error('supported needs evidence'); return { ...raw, quotes: raw.quotes.map(q => resolveQuote(q, packet.evidence)) }; });
    results.push({ originalId: item.originalId, opaqueId, family, comparison, candidate: c, evidence: e, alignment, baseline, registeredResidual: item.registeredResidual });
    atomicWriteJson(`${out}/results.json`, { version: VERSION, results, cost: client.totals(), semanticReview: 'not_performed', notes: ['needsContext returns pending; automatic full-article re-conversion not implemented', 'no heldout; known failure component diagnostic'] });
  } } catch (error) {
    atomicWriteJson(`${out}/run-state.json`, { status: 'stopped', reason: error.message, cost: client.totals(), completedCases: results.length, semanticReview: 'not_performed' });
    throw error;
  }
  atomicWriteJson(`${out}/run-state.json`, { status: 'completed', cost: client.totals(), completedCases: results.length, semanticReview: 'not_performed' });
  return { mode: 'remote', cases: results.length, cost: client.totals(), out };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) run({ remote: process.argv.includes('--remote') }).then(x => console.log(JSON.stringify(x))).catch(e => { console.error(e); process.exitCode = 1; });
