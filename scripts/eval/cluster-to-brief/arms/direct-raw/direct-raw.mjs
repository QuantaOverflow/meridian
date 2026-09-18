/**
 * direct-raw: full-coverage raw windows -> evidence-bound prose candidates -> one selection pass.
 *
 * The intermediate values are already publishable sentences, not event summaries.  The final
 * model is only allowed to select candidate ids and group them into blocks; assembly is exact.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { loadCluster, sentenceOf } from '../../lib.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = `${ROOT}out/direct-raw`;
const ENDPOINT = process.env.AI_WORKER_URL ?? 'http://localhost:8787/meridian/chat';
const MODEL = process.env.DIRECT_RAW_MODEL ?? '@cf/zai-org/glm-4.7-flash';
const WINDOW_CHARS = Number(process.env.DIRECT_RAW_WINDOW_CHARS ?? 30_000);
const OVERLAP_ARTICLES = Number(process.env.DIRECT_RAW_OVERLAP_ARTICLES ?? 1);
const CONCURRENCY = Number(process.env.DIRECT_RAW_CONCURRENCY ?? 2);
const DEV = [7, 1, 36, 37, 43];

function argsOf(argv) {
  return Object.fromEntries(argv.map(x => {
    const m = /^--([^=]+)=?(.*)$/.exec(x);
    return m ? [m[1], m[2] === '' ? true : m[2]] : [x, true];
  }));
}

export function rawArticle(a) {
  const lines = a.sentences.map((s, i) => `[${a.id}:${i + 1}] ${s}`).join('\n');
  return `## ${a.title}\narticleId=${a.id} published=${a.publishDate} source=${a.sourceId ?? '-'}\n${lines}`;
}

/** Greedy character-budget windows. Every article occurs; adjacent windows overlap by article. */
export function makeWindows(articles, budget = WINDOW_CHARS, overlap = OVERLAP_ARTICLES) {
  if (!articles.length) return [];
  if (!Number.isFinite(budget) || budget < 1) throw new Error('window budget must be positive');
  if (!Number.isInteger(overlap) || overlap < 0) throw new Error('overlap must be a non-negative integer');
  const rendered = articles.map(a => ({ article: a, raw: rawArticle(a) }));
  const out = [];
  let start = 0;
  while (start < rendered.length) {
    let end = start;
    let chars = 0;
    while (end < rendered.length) {
      const n = rendered[end].raw.length + 2;
      if (end > start && chars + n > budget) break;
      chars += n;
      end++;
    }
    out.push({
      index: out.length,
      start,
      end,
      chars,
      articleIds: rendered.slice(start, end).map(x => x.article.id),
      text: rendered.slice(start, end).map(x => x.raw).join('\n\n'),
    });
    if (end >= rendered.length) break;
    const next = Math.max(start + 1, end - Math.min(overlap, end - start - 1));
    start = next;
  }
  const covered = new Set(out.flatMap(w => w.articleIds));
  if (covered.size !== articles.length || articles.some(a => !covered.has(a.id))) {
    throw new Error(`window coverage invariant failed: ${covered.size}/${articles.length}`);
  }
  return out;
}

const candidateSchema = {
  type: 'object', additionalProperties: false, required: ['candidates'],
  properties: {
    candidates: {
      type: 'array', maxItems: 12,
      items: {
        type: 'object', additionalProperties: false,
        required: ['topic', 'text', 'sources'],
        properties: {
          topic: { type: 'string', maxLength: 100 },
          text: { type: 'string', maxLength: 500 },
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
};

function candidatePrompt(window, totalWindows) {
  return `You are one pass of a direct news brief writer. Below is raw source text, with every
sentence labeled [articleId:sentence]. This is window ${window.index + 1}/${totalWindows} of one
cluster; it may contain several unrelated stories.

Write up to 12 concise, publishable English brief sentences from this raw text. Do not produce
notes, event labels masquerading as prose, or a summary of the window. Each sentence must state
one newsworthy claim and cite the exact source sentence(s) that support every part of it. Prefer
claims corroborated by multiple articles, but a specific important claim may use one source.
Do not combine unrelated events. Put a short event-specific label in topic. Never use facts from
memory. Preserve attribution and uncertainty. Any number in text must occur in a cited sentence.

RAW ARTICLES\n${window.text}\n\nReturn only JSON matching this schema:\n${JSON.stringify(candidateSchema)}`;
}

function candidateOk(obj, cluster, allowed) {
  if (!Array.isArray(obj?.candidates) || obj.candidates.length > 12) return false;
  return obj.candidates.every(c =>
    typeof c?.topic === 'string' && c.topic.trim() && typeof c?.text === 'string' && c.text.trim() &&
    Array.isArray(c.sources) && c.sources.length > 0 && c.sources.length <= 4 &&
    c.sources.every(s => allowed.has(s.articleId) && sentenceOf(cluster, s.articleId, s.sentence) !== undefined));
}

function sameIds(a, b) {
  return Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Validate a persisted raw-window result against the current deterministic window plan. */
export function validateWindowCache(doc, clusterId, window, cluster) {
  if (!doc || doc.version !== 1 || doc.cluster !== clusterId || doc.window !== window.index + 1) {
    throw new Error(`bad window cache metadata for c${clusterId}-w${window.index + 1}`);
  }
  if (!sameIds(doc.articleIds, window.articleIds)) {
    throw new Error(`bad window cache coverage for c${clusterId}-w${window.index + 1}`);
  }
  const allowed = new Set(window.articleIds);
  if (!candidateOk({ candidates: doc.candidates }, cluster, allowed)) {
    throw new Error(`bad window cache candidates/references for c${clusterId}-w${window.index + 1}`);
  }
  const expectedPrefix = `w${window.index + 1}c`;
  if (doc.candidates.some((c, i) => c.id !== `${expectedPrefix}${i + 1}`)) {
    throw new Error(`bad window cache candidate ids for c${clusterId}-w${window.index + 1}`);
  }
  return doc.candidates;
}

function readWindowCache(path, clusterId, window, cluster) {
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { throw new Error(`cannot parse window cache ${path}: ${e.message}`); }
  return validateWindowCache(doc, clusterId, window, cluster);
}

function atomicWriteJson(path, value) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { flag: 'wx' });
  renameSync(tmp, path);
}

function selectionSchema(candidateIds) {
  return {
    type: 'object', additionalProperties: false, required: ['verdict', 'reason', 'blocks'],
    properties: {
      verdict: { type: 'string', enum: ['written', 'not_a_single_event'] },
      reason: { type: 'string', maxLength: 500 },
      blocks: {
        type: 'array', maxItems: 5,
        items: {
          type: 'object', additionalProperties: false, required: ['title', 'candidateIds'],
          properties: {
            title: { type: 'string', maxLength: 160 },
            candidateIds: {
              // Workers AI structured decoding does not implement `uniqueItems`.
              // `selectionOk` enforces uniqueness deterministically after decode.
              type: 'array', minItems: 1, maxItems: 10,
              items: { type: 'string', enum: candidateIds },
            },
          },
        },
      },
    },
  };
}

function evidenceForCandidate(c, cluster) {
  return c.sources.map(s => `[${s.articleId}:${s.sentence}] ${sentenceOf(cluster, s.articleId, s.sentence)}`).join('\n');
}

function selectionPrompt(candidates, cluster, schema) {
  const material = candidates.map(c => `### ${c.id} | ${c.topic}\nPROSE: ${c.text}\nEVIDENCE:\n${evidenceForCandidate(c, cluster)}`).join('\n\n');
  return `Select a coherent news brief from direct-written candidate sentences and their verbatim
evidence. You may ONLY return candidate ids; a deterministic assembler will copy their prose
unchanged. Do not reward smooth wording over evidentiary support.

Decide the cluster shape from the evidence:
- If one clearly recurring event dominates, write exactly one block about that event and exclude
  topical hitchhikers, geographic neighbors, commentary, and isolated unrelated stories.
- If several separate events have meaningful support, put them in separate non-overlapping blocks.
- If the input is a miscellaneous topic bag with no defensible brief structure, use
  not_a_single_event, explain why, and return no blocks.
Choose 3-8 non-redundant sentences per block where available. A block is an event, not a broad
entity or region. Never place unrelated events in one block.

CANDIDATES AND RAW EVIDENCE\n${material}\n\nReturn only JSON matching this schema:\n${JSON.stringify(schema)}`;
}

async function chatJson(tag, prompt, schema, ok, callsPath) {
  for (const [attempt, temperature] of [0.1, 0.3, 0.3].entries()) {
    const t0 = Date.now();
    let http = 0, finish = '', inTok = null, outTok = null, text = '', err = '';
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          options: {
            provider: 'workers-ai', model: MODEL, temperature, max_tokens: 8000, skipCache: true,
            response_format: { type: 'json_schema', json_schema: schema },
          },
        }),
        signal: AbortSignal.timeout(600_000),
      });
      http = res.status;
      const json = await res.json();
      finish = json?.data?.choices?.[0]?.finish_reason ?? '';
      inTok = json?.data?.usage?.prompt_tokens ?? null;
      outTok = json?.data?.usage?.completion_tokens ?? null;
      text = String(json?.data?.choices?.[0]?.message?.content ?? '');
      if (!json?.success) err = JSON.stringify(json?.error ?? json).slice(0, 300);
    } catch (e) { err = e instanceof Error ? e.message : String(e); }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* retry */ }
    const good = http === 200 && finish !== 'length' && parsed && ok(parsed);
    const rec = { tag, attempt: attempt + 1, temperature, wall_s: +((Date.now() - t0) / 1000).toFixed(2), http, finish, in_tok: inTok, out_tok: outTok, out_chars: text.length, ok: !!good, err };
    appendFileSync(callsPath, `${JSON.stringify(rec)}\n`);
    console.log(`  [${tag}#${attempt + 1}] ${rec.wall_s}s http=${http} in=${inTok ?? '-'} out=${outTok ?? '-'} ok=${!!good}`);
    if (good) return parsed;
    if (attempt < 2) await new Promise(r => setTimeout(r, [3000, 8000][attempt]));
  }
  throw new Error(`${tag}: all model attempts failed validation`);
}

async function pool(items, n, fn) {
  const result = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) { const i = cursor++; if (i >= items.length) return; result[i] = await fn(items[i], i); }
  }));
  return result;
}

export function assemble(clusterId, selection, candidates) {
  if (selection.verdict === 'not_a_single_event') {
    return { cluster: clusterId, verdict: selection.verdict, reason: selection.reason, blocks: [] };
  }
  const byId = new Map(candidates.map(c => [c.id, c]));
  return {
    cluster: clusterId,
    verdict: 'written',
    blocks: selection.blocks.map(b => ({
      title: b.title,
      sentences: b.candidateIds.map(id => {
        const c = byId.get(id);
        if (!c) throw new Error(`selector returned unknown candidate ${id}`);
        return { text: c.text, sources: c.sources };
      }),
    })),
  };
}

function selectionOk(x, candidateIds) {
  if (!['written', 'not_a_single_event'].includes(x?.verdict) || typeof x?.reason !== 'string' || !Array.isArray(x.blocks)) return false;
  if (x.verdict === 'not_a_single_event') return x.reason.trim().length > 0 && x.blocks.length === 0;
  if (!x.blocks.length) return false;
  const used = new Set();
  for (const b of x.blocks) {
    if (!b?.title?.trim() || !Array.isArray(b.candidateIds) || !b.candidateIds.length) return false;
    for (const id of b.candidateIds) {
      if (!candidateIds.has(id) || used.has(id)) return false;
      used.add(id);
    }
  }
  return true;
}

async function runCluster(clusterId, options = {}) {
  const t0 = Date.now();
  const cluster = loadCluster(clusterId);
  const windows = makeWindows(cluster.articles);
  console.log(`c${clusterId}: ${cluster.articles.length} articles -> ${windows.length} windows (${windows.map(w => w.chars).join(', ')} chars)`);
  if (options.plan) return;

  mkdirSync(OUT, { recursive: true });
  const cachePath = `${OUT}/c${clusterId}-candidates.json`;
  const windowCacheDir = `${OUT}/c${clusterId}-windows`;
  mkdirSync(windowCacheDir, { recursive: true });
  const callsPath = `${OUT}/calls.jsonl`;
  const batches = await pool(windows, CONCURRENCY, async w => {
    const windowPath = `${windowCacheDir}/w${w.index + 1}.json`;
    if (options.resume && existsSync(windowPath)) {
      const cached = readWindowCache(windowPath, clusterId, w, cluster);
      console.log(`  [c${clusterId}-w${w.index + 1}] reused ${cached.length} cached candidates`);
      return cached;
    }
    const allowed = new Set(w.articleIds);
    const result = await chatJson(`c${clusterId}-w${w.index + 1}`, candidatePrompt(w, windows.length), candidateSchema,
      x => candidateOk(x, cluster, allowed), callsPath);
    const candidates = result.candidates.map((c, i) => ({ ...c, id: `w${w.index + 1}c${i + 1}` }));
    // Persist each validated window before starting/awaiting the final selector. An interrupted run
    // can therefore resume without paying for successful windows again.
    atomicWriteJson(windowPath, {
      version: 1, cluster: clusterId, window: w.index + 1,
      articleIds: w.articleIds, candidates,
    });
    return candidates;
  });
  const candidates = batches.flat();
  atomicWriteJson(cachePath, { version: 1, cluster: clusterId, windows: windows.map(({ text, ...w }) => w), candidates });
  if (!candidates.length) throw new Error(`c${clusterId}: model returned no direct-written candidates`);
  const ids = candidates.map(c => c.id);
  const schema = selectionSchema(ids);
  const selection = await chatJson(`c${clusterId}-select`, selectionPrompt(candidates, cluster, schema), schema,
    x => selectionOk(x, new Set(ids)), callsPath);
  const output = assemble(clusterId, selection, candidates);
  writeFileSync(`${OUT}/c${clusterId}.json`, JSON.stringify(output, null, 2));
  const elapsed = +((Date.now() - t0) / 1000).toFixed(2);
  writeFileSync(`${OUT}/c${clusterId}-run.json`, JSON.stringify({ cluster: clusterId, articles: cluster.articles.length, windows: windows.length, candidates: candidates.length, elapsed_s: elapsed, model: MODEL, window_chars: WINDOW_CHARS }, null, 2));
  console.log(`c${clusterId}: ${output.verdict}, ${output.blocks.length} blocks, ${elapsed}s`);
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const targets = args.cluster ? [Number(args.cluster)] : DEV;
  for (const cid of targets) await runCluster(cid, { plan: !!args.plan, resume: !!args.resume });
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  main().catch(e => { console.error(e); process.exitCode = 2; });
}
