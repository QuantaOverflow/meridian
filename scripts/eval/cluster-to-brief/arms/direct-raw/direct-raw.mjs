/**
 * direct-raw: full-coverage raw windows -> evidence-bound prose candidates -> one selection pass.
 *
 * The intermediate values are already publishable sentences, not event summaries.  The final
 * model is only allowed to select candidate ids and group them into blocks; assembly is exact.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { loadCluster, sentenceOf } from '../../lib.mjs';
import { filterGrounded } from './local-grounding.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = new URL('../../', import.meta.url).pathname;
// 单变量开关：DIRECT_RAW_LOCAL_GROUNDING=1 时，候选进选择池前先做逐句接地（见 local-grounding.mjs）。
// 窗口缓存**两个臂共用**（都在 out/direct-raw/c<id>-windows/），所以两臂的候选池逐条相同，
// 唯一的差别就是过滤。只有成稿与记账分开落盘。
// DIRECT_RAW_ROUTE_GATE=1：嫁接 structure-router 的**路由门**（只要它那一个判定，不要它的文章筛选）。
// 读 out/structure-router/structure-c<id>.json，structure=topic_bag 就直接判不可写，不进生成。
// 只嫁接门、不嫁接筛选，理由是实测：按 dominantStorylineKey 选文章精度 89–100%，但 c36 召回只有
// 13%（63 篇正题里只选出 8 篇）、c43 26% —— 那正是 structure-router 覆盖只有 14% 的原因。
// DIRECT_RAW_STORYLINE_FILTER=1：嫁接 structure-router 的**主线筛选**——只把
// canonicalStorylineKey == dominantStorylineKey 的文章喂给生成。注意必须用合并后的
// canonicalStorylineKey，不是合并前的 storylineKey：后者在 c36 上只匹配 8 篇（真实主导成分 56 篇）。
// 拿人工标注对照实测：c1 精度/召回 100%/100%、c7 100%/100%、c37 100%/100%、c43 96%/81%、c36 88%/78%。
const GROUNDED = process.env.DIRECT_RAW_LOCAL_GROUNDING === '1';
const ROUTE_GATE = process.env.DIRECT_RAW_ROUTE_GATE === '1';
const STORYLINE_FILTER = process.env.DIRECT_RAW_STORYLINE_FILTER === '1';
const SHARED = `${ROOT}out/direct-raw`;
const OUT = `${ROOT}out/direct-raw${ROUTE_GATE ? '-routed' : ''}${STORYLINE_FILTER ? '-storyline' : ''}${GROUNDED ? '-grounded' : ''}`;
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
  let storylineDropped = 0;
  if (STORYLINE_FILTER) {
    const sp = `${ROOT}out/structure-router/structure-c${clusterId}.json`;
    if (!existsSync(sp)) throw new Error(`c${clusterId}: 主线筛选要 ${sp}，先跑 arms/structure-router/run.mjs`);
    const st = JSON.parse(readFileSync(sp, 'utf8'));
    const keep = new Set(st.signatures.filter(x => x.canonicalStorylineKey === st.dominantStorylineKey).map(x => x.articleId));
    if (keep.size >= 2) {
      storylineDropped = cluster.articles.length - keep.size;
      cluster.articles = cluster.articles.filter(a => keep.has(a.id));
      console.log(`  [c${clusterId}] 主线筛选：${keep.size + storylineDropped} → ${keep.size} 篇（丢 ${storylineDropped}）`);
    } else console.log(`  [c${clusterId}] 主线筛选跳过：主导成分只有 ${keep.size} 篇`);
  }
  const windows = makeWindows(cluster.articles);
  console.log(`c${clusterId}: ${cluster.articles.length} articles -> ${windows.length} windows (${windows.map(w => w.chars).join(', ')} chars)`);
  if (options.plan) return;

  mkdirSync(OUT, { recursive: true });
  if (ROUTE_GATE) {
    const sp = `${ROOT}out/structure-router/structure-c${clusterId}.json`;
    if (!existsSync(sp)) throw new Error(`c${clusterId}: 路由门要 ${sp}，先跑 arms/structure-router/run.mjs`);
    const st = JSON.parse(readFileSync(sp, 'utf8'));
    if (st.structure !== 'single_story') {
      const reason = `${st.structure}: largest storyline covers ${(st.directShare * 100).toFixed(1)}% with a ${(st.dominanceMargin * 100).toFixed(1)}-point lead`;
      writeFileSync(`${OUT}/c${clusterId}.json`, JSON.stringify({ cluster: clusterId, verdict: 'not_a_single_event', reason, blocks: [] }, null, 2));
      writeFileSync(`${OUT}/c${clusterId}-run.json`, JSON.stringify({ cluster: clusterId, routeGate: 'rejected', structure: st.structure, directShare: st.directShare, dominanceMargin: st.dominanceMargin, elapsed_s: +((Date.now() - t0) / 1000).toFixed(2) }, null, 2));
      console.log(`c${clusterId}: 路由门判不可写（${reason}）`);
      return;
    }
    console.log(`  [c${clusterId}] 路由门放行：${st.dominantStorylineKey} ${(st.directShare * 100).toFixed(1)}%`);
  }
  const cachePath = `${OUT}/c${clusterId}-candidates.json`;
  // 只有不筛文章时才共用窗口缓存——筛过之后窗口切分变了，缓存不再对应
  const windowCacheDir = STORYLINE_FILTER ? `${OUT}/c${clusterId}-windows` : `${SHARED}/c${clusterId}-windows`;
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
  const generated = batches.flat();
  let candidates = generated, groundingDropped = [];
  if (GROUNDED) {
    const r = filterGrounded(generated, (a, n) => sentenceOf(cluster, a, n));
    candidates = r.kept; groundingDropped = r.dropped;
    atomicWriteJson(`${OUT}/c${clusterId}-grounding-dropped.json`, { cluster: clusterId, generated: generated.length, kept: candidates.length, dropped: groundingDropped });
    console.log(`  [c${clusterId}] 逐句接地：${generated.length} → ${candidates.length}（丢 ${groundingDropped.length}）`);
  }
  atomicWriteJson(cachePath, { version: 1, cluster: clusterId, windows: windows.map(({ text, ...w }) => w), candidates });
  if (!candidates.length) throw new Error(`c${clusterId}: model returned no direct-written candidates`);
  const ids = candidates.map(c => c.id);
  const schema = selectionSchema(ids);
  const selection = await chatJson(`c${clusterId}-select`, selectionPrompt(candidates, cluster, schema), schema,
    x => selectionOk(x, new Set(ids)), callsPath);
  const output = assemble(clusterId, selection, candidates);
  writeFileSync(`${OUT}/c${clusterId}.json`, JSON.stringify(output, null, 2));
  const elapsed = +((Date.now() - t0) / 1000).toFixed(2);
  writeFileSync(`${OUT}/c${clusterId}-run.json`, JSON.stringify({ cluster: clusterId, routeGate: ROUTE_GATE ? 'passed' : 'off', storylineDropped, articles: cluster.articles.length, windows: windows.length, candidates: candidates.length, generated: generated.length, localGrounding: GROUNDED, groundingDropped: groundingDropped.length, elapsed_s: elapsed, model: MODEL, window_chars: WINDOW_CHARS }, null, 2));
  console.log(`c${clusterId}: ${output.verdict}, ${output.blocks.length} blocks, ${elapsed}s`);
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const targets = args.cluster ? [Number(args.cluster)] : DEV;
  // heldout(28/51)是一次性资源:跑过之后对本臂不再是「未见过的数据」,再看结果回去调就是过拟合。
  // 要跑必须显式 ALLOW_HELDOUT=1,让这个动作在命令行里留痕。
  const offDev = targets.filter(c => !DEV.includes(c));
  if (offDev.length && process.env.ALLOW_HELDOUT !== '1') {
    throw new Error(`c${offDev.join(',')} 不在 dev 内。要跑 heldout 加 ALLOW_HELDOUT=1(一次性资源,想清楚再跑)。`);
  }
  if (offDev.length) console.error(`⚠️ 正在消耗 heldout: ${offDev.map(c => 'c' + c).join(',')}`);
  for (const cid of targets) await runCluster(cid, { plan: !!args.plan, resume: !!args.resume });
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  main().catch(e => { console.error(e); process.exitCode = 2; });
}
