/** Batched, resumable structure-first cluster-to-brief prototype. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCluster } from '../../lib.mjs';
import { askJSON, cos, embed, setCallsPath } from '../../slow-lib.mjs';
import { OUT_ROOT } from '../../lib.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = `${OUT_ROOT}structure-router`;
const CACHE = `${OUT}/cache`;
mkdirSync(CACHE, { recursive: true });
setCallsPath(`${OUT}/calls.jsonl`);

const args = Object.fromEntries(process.argv.slice(2).map(x => {
  const m = /^--([^=]+)=?(.*)$/.exec(x);
  return m ? [m[1], m[2] === '' ? true : m[2]] : [x, true];
}));
const DEV = [7, 1, 36, 37, 43];
const selfTest = Boolean(args['self-test']);
const resume = Boolean(args.resume);
const targets = selfTest ? [] : args.cluster ? [Number(args.cluster)] : String(args.split ?? 'dev') === 'dev' ? DEV : [];
// dev-only 闸:防止 heldout(28/51)被随手消耗。**heldout 是一次性资源** ——
// 跑过之后它对本臂就不再是「未见过的数据」,再看结果回去调就等于过拟合。
// 要跑 heldout 必须显式声明 ALLOW_HELDOUT=1,让这个动作在命令行里留痕。
const ALLOW_HELDOUT = process.env.ALLOW_HELDOUT === '1';
if (!selfTest && (!targets.length || (!ALLOW_HELDOUT && targets.some(x => !DEV.includes(x))))) {
  throw new Error('This prototype is dev-only. Use --cluster=7|1|36|37|43 or --split=dev. 要跑 heldout 加 ALLOW_HELDOUT=1(一次性资源,想清楚再跑)。');
}
if (ALLOW_HELDOUT && targets.some(x => !DEV.includes(x))) {
  console.error(`⚠️ 正在消耗 heldout: ${targets.filter(x => !DEV.includes(x)).map(c => 'c' + c).join(',')} —— 跑完这些簇对本臂不再是未见过的数据`);
}

const BATCH_SIZE = Number(process.env.ROUTER_BATCH_SIZE ?? 18);
const MERGE_THRESHOLD = Number(process.env.ROUTER_MERGE_THRESHOLD ?? 0.87);
const DIRECT_SHARE_MIN = Number(process.env.ROUTER_DIRECT_SHARE_MIN ?? 0.45);
const DOMINANCE_MARGIN_MIN = Number(process.env.ROUTER_DOMINANCE_MARGIN_MIN ?? 0.15);
const MAX_WRITER_ARTICLES = Number(process.env.ROUTER_MAX_WRITER_ARTICLES ?? 24);

const chunks = (xs, n) => {
  const out = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

const leadOf = a => a.sentences.slice(0, 6).join(' ').slice(0, 2200);

function signaturePrompt(articles, batchIndex, batchCount) {
  const rows = articles.map(a =>
    `ARTICLE #${a.id}\nTITLE: ${a.title}\nFILED: ${a.publishDate}\nLEAD: ${leadOf(a)}`
  ).join('\n\n');
  return `You label article-level event structure for a news brief. This is batch ${batchIndex + 1}/${batchCount}.

Return exactly one signature for every article. Do not summarize the batch and do not decide whether the whole cluster is coherent.

- A storyline is one causally connected, evolving news situation. Reports, reactions, consequences, and updates may share it.
- Sharing only a country, entity, region, or broad topic is not a storyline.
- An episode is a narrower incident/update within a storyline.
- storylineKey must be a self-contained English phrase naming actors plus the concrete action/crisis. Never use a broad noun such as "Israel", "Asia", "election", or "AI".
- Reuse exactly the same storylineKey inside this batch for the same storyline. Keys from other batches will later be merged semantically.
- Do not infer anything from article IDs and do not omit articles.

ARTICLES (${articles.length}):
${rows}`;
}

function signatureSchema(n) {
  return { name: 'article_event_signatures', strict: true, schema: {
    type: 'object', additionalProperties: false,
    properties: { signatures: { type: 'array', minItems: n, maxItems: n, items: {
      type: 'object', additionalProperties: false,
      properties: {
        articleId: { type: 'integer' }, storylineKey: { type: 'string' }, episodeKey: { type: 'string' },
        actors: { type: 'array', items: { type: 'string' }, maxItems: 5 }, action: { type: 'string' },
        place: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['articleId', 'storylineKey', 'episodeKey', 'actors', 'action', 'place', 'confidence'],
    } } }, required: ['signatures'],
  } };
}

function exactIds(signatures, articles) {
  if (!Array.isArray(signatures) || signatures.length !== articles.length) return false;
  const want = new Set(articles.map(a => a.id));
  const got = new Set(signatures.map(s => s.articleId));
  return got.size === want.size && [...want].every(id => got.has(id));
}

function validBatchPayload(payload, cid, batchIndex, articles) {
  return payload?.cluster === cid && payload?.batchIndex === batchIndex &&
    Array.isArray(payload.articleIds) && payload.articleIds.length === articles.length &&
    payload.articleIds.every((id, i) => id === articles[i].id) && exactIds(payload.signatures, articles);
}

function atomicJSON(path, value) {
  mkdirSync(path.replace(/\/[^/]+$/, ''), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

async function loadSignatureBatches(cid, articles, options) {
  const batches = chunks(articles, options.batchSize);
  const all = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const path = `${options.cacheDir}/c${cid}/batch-${String(i).padStart(3, '0')}.json`;
    let payload = null;
    if (options.resume && existsSync(path)) {
      try { payload = JSON.parse(readFileSync(path, 'utf8')); } catch { /* regenerate invalid JSON */ }
      if (!validBatchPayload(payload, cid, i, batch)) payload = null;
    }
    if (payload) console.log(`  [c${cid} b${i + 1}/${batches.length}] cache hit (${batch.length} articles)`);
    else {
      const result = await options.classify(batch, i, batches.length);
      payload = { cluster: cid, batchIndex: i, batchCount: batches.length, articleIds: batch.map(a => a.id), signatures: result?.signatures };
      if (!validBatchPayload(payload, cid, i, batch)) throw new Error(`c${cid} batch ${i}: incomplete/invalid signatures; cache not written`);
      atomicJSON(path, payload);
      console.log(`  [c${cid} b${i + 1}/${batches.length}] cached (${batch.length} articles)`);
    }
    all.push(...payload.signatures.map(s => ({ ...s, batchIndex: i })));
  }
  if (!exactIds(all, articles)) throw new Error(`c${cid}: combined batches are incomplete or duplicate article IDs`);
  return all;
}

class UnionFind {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(x) { while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; } return x; }
  union(a, b) { a = this.find(a); b = this.find(b); if (a !== b) this.p[b] = a; }
}

/** Deterministic connected components over cosine-similar storyline keys. */
function mergeStorylines(signatures, vectorOf, threshold = MERGE_THRESHOLD) {
  const keys = [...new Set(signatures.map(s => s.storylineKey.trim()).filter(Boolean))].sort();
  const uf = new UnionFind(keys.length);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = vectorOf.get(keys[i]), b = vectorOf.get(keys[j]);
    if (a && b && cos(a, b) >= threshold) uf.union(i, j);
  }
  const members = new Map();
  keys.forEach((key, i) => {
    const root = uf.find(i);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(key);
  });
  const canonical = new Map();
  for (const group of members.values()) {
    const ranked = group.map(key => [key, signatures.filter(s => s.storylineKey.trim() === key).length])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const key of group) canonical.set(key, ranked[0][0]);
  }
  return signatures.map(s => ({ ...s, canonicalStorylineKey: canonical.get(s.storylineKey.trim()) ?? s.storylineKey.trim() }));
}

function route(signatures, n) {
  const groups = new Map();
  for (const s of signatures) {
    const key = s.canonicalStorylineKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const ranked = [...groups.entries()].map(([key, xs]) => ({ key, count: xs.length, signatures: xs }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const first = ranked[0] ?? { key: '', count: 0, signatures: [] };
  const second = ranked[1] ?? { count: 0 };
  const share = first.count / n;
  const margin = (first.count - second.count) / n;
  const accepted = share >= DIRECT_SHARE_MIN && margin >= DOMINANCE_MARGIN_MIN;
  return {
    accepted, direct: first.signatures, share, margin, dominant: first.key,
    structure: accepted ? 'single_story' : second.count >= 2 ? 'topic_bag' : 'no_dominant_story', groups: ranked,
  };
}

function selectForWriter(direct) {
  const bins = new Map();
  for (const s of [...direct].sort((a, b) => b.confidence - a.confidence || a.articleId - b.articleId)) {
    const key = s.episodeKey.trim() || s.canonicalStorylineKey;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(s);
  }
  const chosen = [];
  while (chosen.length < MAX_WRITER_ARTICLES) {
    let moved = false;
    for (const xs of bins.values()) if (xs.length && chosen.length < MAX_WRITER_ARTICLES) {
      chosen.push(xs.shift()); moved = true;
    }
    if (!moved) break;
  }
  return chosen;
}

function sourcePacket(articles) {
  return articles.map(a => {
    const body = a.sentences.map((s, i) => `[${a.id}:${i + 1}] ${s}`).join('\n');
    return `## ${a.title} (#${a.id})\nFiled: ${a.publishDate}\n${body}`;
  }).join('\n\n');
}

function writerPrompt(storyline, articles) {
  return `Write one concise English intelligence-brief block about exactly this storyline: ${storyline}

Use ONLY the original sentence-numbered sources below. Routing signatures are intentionally absent: reread source text.

- Write 4 to 8 sentences, ordered by importance; each sentence makes one atomic factual claim.
- Every sentence cites source coordinates exactly as articleId and 1-based sentence.
- Every material part must be supported by the cited sentence(s).
- Add no context, causality, labels, dates, quantities, or attribution absent from citations.
- Exclude unrelated regional news. Title the concrete development, not an entity/topic.

ORIGINAL SOURCES:
${sourcePacket(articles)}`;
}

const writerSchema = { name: 'cited_brief_block', strict: true, schema: {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' }, sentences: { type: 'array', minItems: 4, maxItems: 8, items: {
      type: 'object', additionalProperties: false,
      properties: {
        text: { type: 'string' }, sources: { type: 'array', minItems: 1, maxItems: 4, items: {
          type: 'object', additionalProperties: false,
          properties: { articleId: { type: 'integer' }, sentence: { type: 'integer', minimum: 1 } },
          required: ['articleId', 'sentence'],
        } },
      }, required: ['text', 'sources'],
    } },
  }, required: ['title', 'sentences'],
} };

function validBlock(block, selected) {
  if (!block || !Array.isArray(block.sentences) || block.sentences.length < 4) return false;
  const byId = new Map(selected.map(a => [a.id, a]));
  return block.sentences.every(s => typeof s.text === 'string' && s.text.trim() &&
    Array.isArray(s.sources) && s.sources.length && s.sources.every(src => {
      const a = byId.get(src.articleId);
      return a && Number.isInteger(src.sentence) && src.sentence >= 1 && src.sentence <= a.sentences.length;
    }));
}

async function runOne(cid) {
  const cluster = loadCluster(cid);
  console.log(`\n[c${cid}] batched structure · ${cluster.articles.length} articles · batch=${BATCH_SIZE} · resume=${resume}`);
  const signatures = await loadSignatureBatches(cid, cluster.articles, {
    batchSize: BATCH_SIZE, cacheDir: CACHE, resume,
    classify: async (batch, i, count) => {
      const result = await askJSON(`router-c${cid}-b${i}`, signaturePrompt(batch, i, count), signatureSchema(batch.length),
        p => exactIds(p?.signatures, batch), { stage: 'structure-batch', cluster: cid, batch: i, articles: batch.length });
      if (!result) throw new Error(`c${cid} batch ${i}: signature call failed after all attempts`);
      return result;
    },
  });

  const keys = [...new Set(signatures.map(s => s.storylineKey.trim()).filter(Boolean))];
  const merged = mergeStorylines(signatures, embed(keys, `router-c${cid}`, OUT));
  const decision = route(merged, cluster.articles.length);
  atomicJSON(`${OUT}/structure-c${cid}.json`, {
    cluster: cid, batchSize: BATCH_SIZE, mergeThreshold: MERGE_THRESHOLD,
    structure: decision.structure, dominantStorylineKey: decision.dominant,
    directShare: decision.share, dominanceMargin: decision.margin,
    groups: decision.groups.map(g => ({ storylineKey: g.key, articles: g.count })), signatures: merged,
  });
  console.log(`[c${cid}] structure=${decision.structure} dominant=${decision.direct.length}/${cluster.articles.length} (${(decision.share * 100).toFixed(1)}%) margin=${(decision.margin * 100).toFixed(1)}%`);

  if (!decision.accepted) {
    atomicJSON(`${OUT}/c${cid}.json`, {
      cluster: cid, verdict: 'not_a_single_event',
      reason: `${decision.structure}: largest storyline covers ${(decision.share * 100).toFixed(1)}% with a ${(decision.margin * 100).toFixed(1)}-point lead; routing requires ${(DIRECT_SHARE_MIN * 100).toFixed(0)}% and ${(DOMINANCE_MARGIN_MIN * 100).toFixed(0)} points.`,
      blocks: [],
    });
    return;
  }

  const chosen = selectForWriter(decision.direct);
  const ids = new Set(chosen.map(s => s.articleId));
  const selected = cluster.articles.filter(a => ids.has(a.id));
  console.log(`[c${cid}] writer route · ${selected.length} original articles across ${new Set(chosen.map(s => s.episodeKey)).size} episodes`);
  const block = await askJSON(`writer-c${cid}`, writerPrompt(decision.dominant, selected), writerSchema,
    p => validBlock(p, selected), { stage: 'writer', cluster: cid, articles: selected.length });
  if (!block) throw new Error(`c${cid}: writer failed after all attempts`);
  atomicJSON(`${OUT}/c${cid}.json`, { cluster: cid, verdict: 'written', blocks: [block] });
}

async function runSelfTest() {
  const articles = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
  const dir = mkdtempSync(join(tmpdir(), 'structure-router-test-'));
  let calls = 0;
  const classify = async batch => {
    calls++;
    return { signatures: batch.map(a => ({
      articleId: a.id, storylineKey: a.id < 4 ? 'alpha' : 'beta', episodeKey: `e${a.id}`,
      actors: [], action: '', place: '', confidence: 1,
    })) };
  };
  try {
    const first = await loadSignatureBatches(9, articles, { batchSize: 2, cacheDir: dir, resume: false, classify });
    assert.equal(first.length, 5, 'batch completeness');
    assert.equal(new Set(first.map(x => x.articleId)).size, 5, 'no duplicate IDs');
    assert.equal(calls, 3, 'all batches built');
    const resumed = await loadSignatureBatches(9, articles, { batchSize: 2, cacheDir: dir, resume: true, classify });
    assert.equal(resumed.length, 5, 'cache recovery completeness');
    assert.equal(calls, 3, 'resume made no classifier calls');

    const sigs = [
      { articleId: 1, storylineKey: 'alpha one', episodeKey: 'a', confidence: 1 },
      { articleId: 2, storylineKey: 'alpha update', episodeKey: 'b', confidence: 1 },
      { articleId: 3, storylineKey: 'beta', episodeKey: 'c', confidence: 1 },
    ];
    const vectors = new Map([['alpha one', [1, 0]], ['alpha update', [0.9, Math.sqrt(0.19)]], ['beta', [0, 1]]]);
    const merged = mergeStorylines(sigs, vectors, 0.87);
    assert.equal(merged[0].canonicalStorylineKey, merged[1].canonicalStorylineKey, 'cross-batch merge');
    assert.notEqual(merged[0].canonicalStorylineKey, merged[2].canonicalStorylineKey, 'separate storyline');
    assert.equal(route(merged, 3).accepted, true, 'dominant storyline accepted');
    const bag = merged.map((s, i) => ({ ...s, canonicalStorylineKey: `g${i}` }));
    assert.equal(route(bag, 3).accepted, false, 'topic bag rejected');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('structure-router self-test: ok');
}

if (selfTest) await runSelfTest();
else {
  for (const cid of targets) await runOne(cid);
  console.log(`\nDone: ${targets.map(x => `c${x}`).join(', ')} -> ${OUT}`);
}
