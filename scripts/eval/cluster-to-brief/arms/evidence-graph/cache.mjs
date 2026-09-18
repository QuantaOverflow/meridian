import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const EXTRACTION_CACHE_VERSION = 1;

function sameArray(a, b) {
  return Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Validate before trusting a resumable extraction batch. A bad cache is an
 * explicit error: silently re-calling the model would hide corruption and make
 * a supposedly resumed run non-reproducible.
 */
export function validateExtractionCache(cache, { clusterId, batchIndex, batch, sentenceOf }) {
  const prefix = `invalid extraction cache c${clusterId} batch ${batchIndex + 1}`;
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) throw new Error(`${prefix}: root must be an object`);
  if (cache.version !== EXTRACTION_CACHE_VERSION) throw new Error(`${prefix}: version ${cache.version} != ${EXTRACTION_CACHE_VERSION}`);
  if (cache.cluster !== clusterId) throw new Error(`${prefix}: cluster ${cache.cluster} != ${clusterId}`);
  if (cache.batch !== batchIndex + 1) throw new Error(`${prefix}: batch field ${cache.batch} != ${batchIndex + 1}`);

  const expectedIds = batch.map(a => a.id);
  if (!sameArray(cache.articleIds, expectedIds)) {
    throw new Error(`${prefix}: articleIds do not exactly match this batch`);
  }
  if (!Array.isArray(cache.observations) || cache.observations.length === 0) {
    throw new Error(`${prefix}: observations must be a non-empty array`);
  }

  const allowed = new Set(expectedIds);
  for (const [i, o] of cache.observations.entries()) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`${prefix}: observation ${i} is not an object`);
    if (typeof o.claim !== 'string' || !o.claim.trim()) throw new Error(`${prefix}: observation ${i} has no claim`);
    if (typeof o.eventFamily !== 'string' || !o.eventFamily.trim()) throw new Error(`${prefix}: observation ${i} has no eventFamily`);
    if (!allowed.has(o.articleId)) throw new Error(`${prefix}: observation ${i} cites out-of-batch article ${o.articleId}`);
    if (!Number.isInteger(o.sentence) || sentenceOf(o.articleId, o.sentence) === undefined) {
      throw new Error(`${prefix}: observation ${i} has unresolvable citation ${o.articleId}:${o.sentence}`);
    }
  }
  return cache.observations;
}

export function readExtractionCache(path, context) {
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { throw new Error(`invalid extraction cache ${path}: ${e.message}`); }
  return validateExtractionCache(parsed, context);
}

/** Write-complete-then-rename keeps interrupted runs from leaving valid-looking partial JSON. */
export function writeExtractionCacheAtomic(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', { flag: 'wx' });
  renameSync(tmp, path);
}

