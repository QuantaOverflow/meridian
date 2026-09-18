#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EXTRACTION_CACHE_VERSION,
  readExtractionCache,
  validateExtractionCache,
  writeExtractionCacheAtomic,
} from './cache.mjs';

const base = resolve(new URL('.', import.meta.url).pathname, '../../out/evidence-graph');
mkdirSync(base, { recursive: true });
const dir = mkdtempSync(`${base}/self-test-`);
const path = `${dir}/extract-b01.json`;
const batch = [{ id: 101 }, { id: 102 }];
const sentences = new Map([['101:1', 'one'], ['102:2', 'two']]);
const context = {
  clusterId: 36, batchIndex: 0, batch,
  sentenceOf: (articleId, sentence) => sentences.get(`${articleId}:${sentence}`),
};
const payload = {
  version: EXTRACTION_CACHE_VERSION, cluster: 36, batch: 1, articleIds: [101, 102],
  observations: [
    { claim: 'Claim one', eventFamily: 'Specific event', articleId: 101, sentence: 1 },
    { claim: 'Claim two', eventFamily: 'Specific event', articleId: 102, sentence: 2 },
  ],
};

function expectThrow(label, fn, pattern) {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  if (!error || !pattern.test(error.message)) throw new Error(`${label}: expected ${pattern}, got ${error?.message ?? 'no error'}`);
}

try {
  writeExtractionCacheAtomic(path, payload);
  if (!existsSync(path) || readdirSync(dir).some(x => x.includes('.tmp-'))) throw new Error('atomic write did not publish clean final file');
  const rows = readExtractionCache(path, context);
  if (rows.length !== 2) throw new Error('valid cache did not round-trip');

  expectThrow('out-of-batch id', () => validateExtractionCache({
    ...payload, observations: [{ ...payload.observations[0], articleId: 999 }],
  }, context), /out-of-batch article 999/);
  expectThrow('unresolvable sentence', () => validateExtractionCache({
    ...payload, observations: [{ ...payload.observations[0], sentence: 99 }],
  }, context), /unresolvable citation 101:99/);
  expectThrow('wrong manifest', () => validateExtractionCache({ ...payload, articleIds: [102, 101] }, context), /articleIds do not exactly match/);
  const malformed = `${dir}/malformed.json`;
  writeFileSync(malformed, '{');
  expectThrow('malformed json', () => readExtractionCache(malformed, context), /invalid extraction cache/);

  console.log('evidence-graph cache self-test: PASS');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
