#!/usr/bin/env node
/**
 * Evidence-graph arm.
 *
 * Pipeline:
 *   full articles -> cited atomic observations -> event-family graph ->
 *   cross-source consensus facts -> evidence-constrained prose.
 *
 * This is deliberately not a draft-and-repair pipeline. The writer never sees
 * rejected articles or facts; an invalid writer response fails the run.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCluster, sentenceOf } from '../../lib.mjs';
import { askJSON, embed, cos, pool, setCallsPath, MODEL } from '../../slow-lib.mjs';
import {
  EXTRACTION_CACHE_VERSION,
  readExtractionCache,
  validateExtractionCache,
  writeExtractionCacheAtomic,
} from './cache.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const HARNESS = resolve(HERE, '../..');
const args = Object.fromEntries(process.argv.slice(2).map(x => {
  const m = /^--([^=]+)=?(.*)$/.exec(x);
  return m ? [m[1], m[2] === '' ? true : m[2]] : [x, true];
}));
const clusterId = Number(args.cluster);
if (!Number.isInteger(clusterId)) {
  console.error('usage: node arms/evidence-graph/index.mjs --cluster=N [--out=out/evidence-graph] [--resume]');
  process.exit(2);
}
if (clusterId === 28 || clusterId === 51) {
  throw new Error('heldout cluster refused: this prototype is dev-only until the parent explicitly unlocks heldout');
}

const outArg = String(args.out ?? 'out/evidence-graph');
const outDir = resolve(HARNESS, outArg);
mkdirSync(outDir, { recursive: true });
setCallsPath(`${outDir}/calls-c${clusterId}.jsonl`);
const cacheDir = `${outDir}/cache/c${clusterId}`;

const MAX_BATCH_CHARS = Number(process.env.EG_BATCH_CHARS ?? 30000);
const FAMILY_SIM = Number(process.env.EG_FAMILY_SIM ?? 0.82);
const FACT_SIM = Number(process.env.EG_FACT_SIM ?? 0.86);
const MIN_FAMILY_ARTICLES = Number(process.env.EG_MIN_FAMILY_ARTICLES ?? 2);
const MIN_FAMILY_SOURCES = Number(process.env.EG_MIN_FAMILY_SOURCES ?? 2);
const MAX_EVIDENCE_FACTS = Number(process.env.EG_MAX_EVIDENCE_FACTS ?? 18);

function articleText(a) {
  return `ARTICLE ${a.id}\nTITLE: ${a.title}\nSOURCE_ID: ${a.sourceId ?? 'unknown'}\nPUBLISHED: ${a.publishDate}\n` +
    a.sentences.map((s, i) => `[${i + 1}] ${s}`).join('\n');
}

function batchesByChars(articles) {
  const out = [];
  let cur = [], chars = 0;
  for (const a of articles) {
    const n = articleText(a).length;
    if (cur.length && chars + n > MAX_BATCH_CHARS) { out.push(cur); cur = []; chars = 0; }
    cur.push(a); chars += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

const extractionSchema = {
  name: 'cited_atomic_observations', strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['observations'],
    properties: {
      observations: {
        type: 'array', maxItems: 80,
        items: {
          type: 'object', additionalProperties: false,
          required: ['claim', 'eventFamily', 'articleId', 'sentence'],
          properties: {
            claim: { type: 'string' },
            eventFamily: { type: 'string' },
            articleId: { type: 'integer' },
            sentence: { type: 'integer' },
          },
        },
      },
    },
  },
};

function extractionPrompt(batch) {
  return `You are constructing an evidence graph from a noisy news cluster.

For EACH article, extract at most 5 newsworthy atomic factual observations. Every observation must be fully supported by ONE numbered source sentence. Do not infer, combine sentences, compute, generalize, or copy opinion as fact.

eventFamily is crucial: name the SPECIFIC continuing event/story the observation belongs to (for example "Houthi attacks and Red Sea shipping crisis"), not a broad topic such as "Middle East", "politics", a country, or an industry. Use the same eventFamily wording for articles about the same concrete story, even if they emphasize different developments. Unrelated hitchhiker stories must receive their own distinct eventFamily. Never force an article into the apparent majority story.

Return only the required JSON. Article IDs and sentence numbers must be copied exactly.

${batch.map(articleText).join('\n\n')}`;
}

function validExtraction(x, allowed) {
  return Array.isArray(x?.observations) && x.observations.every(o =>
    typeof o?.claim === 'string' && o.claim.trim() &&
    typeof o?.eventFamily === 'string' && o.eventFamily.trim() &&
    allowed.has(o.articleId) && Number.isInteger(o.sentence));
}

class DSU {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(x) { while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; } return x; }
  union(a, b) { a = this.find(a); b = this.find(b); if (a !== b) this.p[b] = a; }
}

function componentsBySimilarity(rows, textOf, threshold, tag) {
  const texts = rows.map(textOf);
  const vec = embed(texts, tag, outDir);
  const dsu = new DSU(rows.length);
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    if (cos(vec.get(texts[i]), vec.get(texts[j])) >= threshold) dsu.union(i, j);
  }
  const groups = new Map();
  rows.forEach((r, i) => {
    const k = dsu.find(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  return [...groups.values()];
}

function distinct(xs) { return [...new Set(xs)]; }
function groupStats(group, articleById) {
  const articleIds = distinct(group.map(x => x.articleId));
  const sources = distinct(articleIds.map(id => articleById.get(id)?.sourceId).filter(x => x !== null && x !== undefined));
  return { articleIds, sources, articleCount: articleIds.length, sourceCount: sources.length };
}

function writerSchema(maxBlocks) {
  return {
    name: 'evidence_bound_brief', strict: true,
    schema: {
      type: 'object', additionalProperties: false, required: ['blocks'],
      properties: {
        blocks: {
          type: 'array', minItems: 1, maxItems: maxBlocks,
          items: {
            type: 'object', additionalProperties: false, required: ['title', 'sentences'],
            properties: {
              title: { type: 'string' },
              sentences: {
                type: 'array', minItems: 3, maxItems: 8,
                items: {
                  type: 'object', additionalProperties: false, required: ['text', 'sources'],
                  properties: {
                    text: { type: 'string' },
                    sources: {
                      type: 'array', minItems: 1, maxItems: 4,
                      items: {
                        type: 'object', additionalProperties: false, required: ['articleId', 'sentence'],
                        properties: { articleId: { type: 'integer' }, sentence: { type: 'integer' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function validateDraft(draft, allowedRefs, maxBlocks) {
  if (!Array.isArray(draft?.blocks) || !draft.blocks.length || draft.blocks.length > maxBlocks) return false;
  return draft.blocks.every(b => typeof b.title === 'string' && Array.isArray(b.sentences) && b.sentences.length >= 3 &&
    b.sentences.every(s => typeof s.text === 'string' && s.text.trim() && Array.isArray(s.sources) && s.sources.length &&
      s.sources.every(r => allowedRefs.has(`${r.articleId}:${r.sentence}`))));
}

const cluster = loadCluster(clusterId);
const articleById = new Map(cluster.articles.map(a => [a.id, a]));
const batches = batchesByChars(cluster.articles);
console.log(`c${clusterId}: ${cluster.articles.length} articles, ${batches.length} extraction batches, model=${MODEL}`);

// Preflight every existing cache before starting the pool. Otherwise a corrupt
// later batch could be discovered after workers had already issued new calls.
const resumedByBatch = new Map();
if (args.resume) {
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const cachePath = `${cacheDir}/extract-b${String(i + 1).padStart(2, '0')}.json`;
    if (!existsSync(cachePath)) continue;
    const rows = readExtractionCache(cachePath, {
      clusterId, batchIndex: i, batch,
      sentenceOf: (articleId, sentence) => sentenceOf(cluster, articleId, sentence),
    });
    resumedByBatch.set(i, rows);
  }
}

const extracted = await pool(batches, Number(process.env.CONC ?? 4), async (batch, i) => {
  const cachePath = `${cacheDir}/extract-b${String(i + 1).padStart(2, '0')}.json`;
  const cacheContext = {
    clusterId, batchIndex: i, batch,
    sentenceOf: (articleId, sentence) => sentenceOf(cluster, articleId, sentence),
  };
  if (resumedByBatch.has(i)) {
    const rows = resumedByBatch.get(i);
    console.log(`  [eg-c${clusterId}-extract-${i + 1}] resumed ${rows.length} observations`);
    return rows;
  }
  const allowed = new Set(batch.map(a => a.id));
  const x = await askJSON(`eg-c${clusterId}-extract-${i + 1}`, extractionPrompt(batch), extractionSchema,
    y => validExtraction(y, allowed), { phase: 'extract', articles: batch.length });
  if (!x) throw new Error(`extraction failed for batch ${i + 1}`);
  const rows = x.observations.filter(o => sentenceOf(cluster, o.articleId, o.sentence) !== undefined);
  if (!rows.length) throw new Error(`extraction batch ${i + 1} has no resolvable observations`);
  const payload = {
    version: EXTRACTION_CACHE_VERSION,
    cluster: clusterId,
    batch: i + 1,
    articleIds: batch.map(a => a.id),
    observations: rows,
  };
  // Validate the exact bytes we intend to trust on a later resume, then publish
  // atomically. A calls log is intentionally never consulted as extraction data.
  validateExtractionCache(payload, cacheContext);
  writeExtractionCacheAtomic(cachePath, payload);
  console.log(`  [eg-c${clusterId}-extract-${i + 1}] cached ${rows.length} observations`);
  return rows;
});
const observations = extracted.flat();
if (!observations.length) throw new Error('no valid observations extracted');

// First graph: concrete event families. Repeated support from independent
// articles/sources is the admission ticket; generic one-off hitchhikers vanish.
const familyGroups = componentsBySimilarity(observations, x => x.eventFamily, FAMILY_SIM, `eg-c${clusterId}-families`)
  .map(group => ({ group, ...groupStats(group, articleById) }))
  .filter(g => g.articleCount >= MIN_FAMILY_ARTICLES && g.sourceCount >= MIN_FAMILY_SOURCES)
  .sort((a, b) => b.articleCount - a.articleCount || b.sourceCount - a.sourceCount);
if (!familyGroups.length) throw new Error('evidence graph has no cross-source event family');

const leader = familyGroups[0];
const runner = familyGroups[1];
const dominance = leader.articleCount / cluster.articles.length;
const rivalry = runner ? runner.articleCount / leader.articleCount : 0;

// A coherent single event has a large leader and no similarly sized rival.
// Topic bags and minority-title mixtures are rejected rather than forcibly
// narrated. This decision uses graph topology, never fixture labels.
const coherent = dominance >= 0.30 && rivalry < 0.55;
const diagnostics = {
  cluster: clusterId, articles: cluster.articles.length, extractionBatches: batches.length,
  observations: observations.length, thresholds: { family: FAMILY_SIM, fact: FACT_SIM },
  families: familyGroups.slice(0, 12).map(g => ({
    label: g.group[0].eventFamily, articles: g.articleCount, sources: g.sourceCount,
  })), dominance: +dominance.toFixed(3), rivalry: +rivalry.toFixed(3), coherent,
};

if (!coherent) {
  const labels = familyGroups.slice(0, 4).map(g => `${g.group[0].eventFamily} (${g.articleCount} articles)`).join('; ');
  const out = {
    cluster: clusterId, verdict: 'not_a_single_event',
    reason: `Evidence graph has no unambiguous dominant event family (dominance=${diagnostics.dominance}, rivalry=${diagnostics.rivalry}); leading families: ${labels}`,
    blocks: [],
  };
  writeFileSync(`${outDir}/c${clusterId}.json`, JSON.stringify(out, null, 2) + '\n');
  writeFileSync(`${outDir}/diagnostics-c${clusterId}.json`, JSON.stringify(diagnostics, null, 2) + '\n');
  console.log(`c${clusterId}: rejected as non-single-event (${labels})`);
  process.exit(0);
}

// Second graph: consensus atomic facts inside the winning event family.
const factGroups = componentsBySimilarity(leader.group, x => x.claim, FACT_SIM, `eg-c${clusterId}-facts`)
  .map(group => ({ group, ...groupStats(group, articleById) }))
  .filter(g => g.articleCount >= 2 && g.sourceCount >= 2)
  .sort((a, b) => b.articleCount - a.articleCount || b.sourceCount - a.sourceCount)
  .slice(0, MAX_EVIDENCE_FACTS);
if (factGroups.length < 3) throw new Error(`only ${factGroups.length} cross-source consensus facts; refusing thin draft`);

const evidence = factGroups.map((g, i) => ({
  id: `F${i + 1}`, supportArticles: g.articleCount, supportSources: g.sourceCount,
  observations: g.group.slice(0, 4).map(o => ({
    claim: o.claim, articleId: o.articleId, sentence: o.sentence,
    sourceText: sentenceOf(cluster, o.articleId, o.sentence),
  })),
}));
const allowedRefs = new Set(evidence.flatMap(f => f.observations.map(o => `${o.articleId}:${o.sentence}`)));
const writePrompt = `Write one concise English news brief block using ONLY the admitted consensus evidence below.

Rules:
- Every output sentence must express one atomic factual claim directly supported by its cited sourceText.
- Use only articleId/sentence pairs shown in the evidence. Copy all names, numbers and quotations exactly; do not calculate, infer, predict or add background.
- Prefer facts with more independent article and source support. Synthesize wording; do not merely paste source sentences.
- 4-7 informative sentences, ordered from the central development to consequences/context.
- Do not mention evidence IDs, graph scores, missing material, or the extraction process.
- Return only the required JSON.

EVENT FAMILY: ${leader.group[0].eventFamily}
EVIDENCE:\n${JSON.stringify(evidence, null, 2)}`;
const draft = await askJSON(`eg-c${clusterId}-write`, writePrompt, writerSchema(1),
  x => validateDraft(x, allowedRefs, 1), { phase: 'write', evidenceFacts: evidence.length });
if (!draft) throw new Error('writer failed evidence-bound schema; no post-generation repair is permitted');

const out = { cluster: clusterId, verdict: 'written', blocks: draft.blocks };
diagnostics.consensusFacts = factGroups.length;
diagnostics.evidenceRefs = allowedRefs.size;
writeFileSync(`${outDir}/c${clusterId}.json`, JSON.stringify(out, null, 2) + '\n');
writeFileSync(`${outDir}/diagnostics-c${clusterId}.json`, JSON.stringify(diagnostics, null, 2) + '\n');
console.log(`c${clusterId}: wrote ${draft.blocks[0].sentences.length} sentences from ${factGroups.length} consensus facts`);
