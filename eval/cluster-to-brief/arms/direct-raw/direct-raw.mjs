/**
 * direct-raw: full-coverage raw windows -> evidence-bound prose candidates -> one selection pass.
 *
 * The intermediate values are already publishable sentences, not event summaries.  The final
 * model is only allowed to select candidate ids and group them into blocks; assembly is exact.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { sentenceOf, numbersIn, quotesIn, normQuote, OUT_ROOT } from '../../lib.mjs';
import { runArm } from '../../runner.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = new URL('../../', import.meta.url).pathname;
// 已证伪、2026-09-25 删掉的开关（SINGLE_BLOCK / WRITE_TIER=lead / WRITE_REPAIR=1 / MUST_SLACK / MODEL）
// 及其结论见 README「删掉的开关」。
// DIRECT_RAW_WRITE_AT_END=1：改写只发生一次、且发生在看得见全局的最后一步。窗口步不再写句子，
// 只标重点（话题 + 原文句编号）；最后一步读这些重点对应的**原句**，写一段连贯的正文（一簇一块），
// 逐句标出处。动机：原型成稿是十个窗口各写各的句子拼起来的，没有主次、没有过渡（2026-09-19 人读）。
// 与 claim-anchor-not-rewrite 同一思路。窗口产物格式不同，用自己的窗口缓存。
const WRITE_AT_END = process.env.DIRECT_RAW_WRITE_AT_END === '1';
// DIRECT_RAW_WRITE_TIER=exec：高管简报。3–5 句，每句往上综合一组事实（不是挑几件事写），结论先行；
// 意义与影响只在原文有人明说时写（用户 2026-09-19 选 B：不许模型自己分析）。一句综合多条，出处上限放到 8。
const WRITE_TIER = process.env.DIRECT_RAW_WRITE_TIER === 'exec' ? 'exec' : 'more';
// DIRECT_RAW_WRITE_SUPPORT=1：告诉写作步每条重点有几篇文章报道，并把报道最多的一档列为必写。
// 动机：lead 档（8–14 句，已删）c28 把核心层的飞行员营救整条判成「别的故事」丢掉（每条 4–5 篇报道）——
// 卡召回的不是篇幅，是模型自己判断什么算这个故事。改由报道量决定。
const WRITE_SUPPORT = process.env.DIRECT_RAW_WRITE_SUPPORT === '1';
// DIRECT_RAW_WRITE_REPAIR=mech：两个确定性修复——代词开头的原句（"he added"）在材料里带上前一句
// （c1 把分析师的话安到 Andersson 名下，v6 唯一硬错）；写完由代码补出处（句中数字/引语不在所引原句里，
// 就去材料里找字面包含它的原句补上）。全套修复（=1）已删，见 README。
const WRITE_REPAIR = process.env.DIRECT_RAW_WRITE_REPAIR === 'mech';
const ANCHOR_SOURCES = 4;
// DIRECT_RAW_RUN=n：第 n 次独立重复（窗口步、写作步都重跑），产物与窗口缓存各自分目录，量运行间波动。
const RUN = process.env.DIRECT_RAW_RUN ? `-run${process.env.DIRECT_RAW_RUN}` : '';
const WRITE_LEN = WRITE_TIER === 'exec'
  ? { max: 5, sources: 8, text: `An executive brief: 3–5 sentences in a single paragraph, at most about 800 characters.
  The first sentence is the bottom line — the single most important development, stated so a busy
  reader who stops there knows what happened. Each following sentence synthesizes a group of
  related key points into one statement at a higher level (for example the losses, the costs, the
  official reactions), keeping only the one or two figures that matter most; never enumerate items.
  Say why it matters only when a source states it, and attribute it ("the report warned...").
  Write no analysis, motivation or prediction of your own.` }
  : { max: 8, sources: 4, text: `About 4–7 sentences in a single paragraph, roughly 600–1,000 characters. Open with the most
  important development, then the key details, then what the people involved said.` };
/**
 * 产物布局：**根目录由 runner 给**（它知道这轮的数据来自哪里），根目录下怎么分支是本臂的事——
 * 开关组合决定 candidate/write/anchor 各落哪一层。原来这些是模块级常量，算得出它们的
 * 那个后缀却来自 argv，于是臂里躺着一行数据来源的解析。
 */
function pathsOf(base) {
  const candidateOut = base;
  const writeOut = `${candidateOut}-write`;
  const anchorCache = `${writeOut}${RUN}`;
  const out = WRITE_AT_END ? `${writeOut}${WRITE_TIER === 'more' ? '' : `-${WRITE_TIER}`}${WRITE_SUPPORT ? '-support' : ''}${WRITE_REPAIR ? '-mech' : ''}${RUN}` : candidateOut;
  // shared：不筛文章时的窗口缓存位置，就是根目录本身（不带任何开关后缀，所以两个臂共用）
  return { shared: base, candidateOut, writeOut, anchorCache, out };
}
// 出处标签 [articleId:sentence] 不许出现在成稿里（快档 verify.mjs 同一条判据）
const MARKER = /\[\s*\d{3,}\s*:\s*\d+/;
// 模型常把引用标签写进句尾（实测 c28 五句全带 [986133:3, 1006787:2]），标签对读者无意义、出处已在 sources。
// 确定性剥掉整组标签，剥不干净的残留再由 MARKER 拒收重试。
export const stripMarkers = t => t.replace(/\s*\[\s*\d{3,}\s*:\s*\d+(?:\s*[,;]\s*\d{3,}\s*:\s*\d+)*\s*\]/g, '');
const ENDPOINT = process.env.AI_WORKER_URL ?? 'http://localhost:8787/meridian/chat';
const MODEL = '@cf/zai-org/glm-4.7-flash';
const WINDOW_CHARS = Number(process.env.DIRECT_RAW_WINDOW_CHARS ?? 30_000);
const OVERLAP_ARTICLES = Number(process.env.DIRECT_RAW_OVERLAP_ARTICLES ?? 1);
const CONCURRENCY = Number(process.env.DIRECT_RAW_CONCURRENCY ?? 2);

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

const anchorSchema = {
  type: 'object', additionalProperties: false, required: ['anchors'],
  properties: {
    anchors: {
      type: 'array', maxItems: 12,
      items: {
        type: 'object', additionalProperties: false, required: ['topic', 'sources'],
        properties: {
          topic: { type: 'string', maxLength: 100 },
          sources: {
            type: 'array', minItems: 1, maxItems: ANCHOR_SOURCES,
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

function anchorPrompt(window, totalWindows) {
  return `You are one pass of a news brief pipeline. Below is raw source text, with every sentence
labeled [articleId:sentence]. This is window ${window.index + 1}/${totalWindows} of one cluster; it may
contain several unrelated stories. Do NOT write any prose. Your job is only to mark what matters.

List up to 12 key points from this raw text. A key point is one newsworthy claim: what happened,
a concrete figure, a consequence, or a named person's statement. For each key point give a short
event-specific label in topic, and in sources cite the exact sentence(s) that state it — if several
articles report the same claim, cite them together (up to ${ANCHOR_SOURCES}). Prefer claims corroborated by
multiple articles, but a specific important claim may cite one source. Do not merge different
claims into one key point.

RAW ARTICLES\n${window.text}\n\nReturn only JSON matching this schema:\n${JSON.stringify(anchorSchema)}`;
}

function anchorOk(obj, cluster, allowed) {
  if (!Array.isArray(obj?.anchors) || obj.anchors.length > 12) return false;
  return obj.anchors.every(c =>
    typeof c?.topic === 'string' && c.topic.trim() &&
    Array.isArray(c.sources) && c.sources.length > 0 && c.sources.length <= ANCHOR_SOURCES &&
    c.sources.every(s => allowed.has(s.articleId) && sentenceOf(cluster, s.articleId, s.sentence) !== undefined));
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
export function validateWindowCache(doc, clusterId, window, cluster, mode = 'candidate') {
  if (!doc || doc.version !== 1 || doc.cluster !== clusterId || doc.window !== window.index + 1) {
    throw new Error(`bad window cache metadata for c${clusterId}-w${window.index + 1}`);
  }
  if (!sameIds(doc.articleIds, window.articleIds)) {
    throw new Error(`bad window cache coverage for c${clusterId}-w${window.index + 1}`);
  }
  const allowed = new Set(window.articleIds);
  const anchor = mode === 'anchor';
  const items = anchor ? doc.anchors : doc.candidates;
  if (!(anchor ? anchorOk({ anchors: items }, cluster, allowed) : candidateOk({ candidates: items }, cluster, allowed))) {
    throw new Error(`bad window cache candidates/references for c${clusterId}-w${window.index + 1}`);
  }
  const expectedPrefix = `w${window.index + 1}${anchor ? 'a' : 'c'}`;
  if (items.some((c, i) => c.id !== `${expectedPrefix}${i + 1}`)) {
    throw new Error(`bad window cache candidate ids for c${clusterId}-w${window.index + 1}`);
  }
  return items;
}

function readWindowCache(path, clusterId, window, cluster, mode) {
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { throw new Error(`cannot parse window cache ${path}: ${e.message}`); }
  return validateWindowCache(doc, clusterId, window, cluster, mode);
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

const SHAPE_RULES = `Decide the cluster shape from the evidence:
- If one clearly recurring event dominates, write exactly one block about that event and exclude
  topical hitchhikers, geographic neighbors, commentary, and isolated unrelated stories.
- If several separate events have meaningful support, put them in separate non-overlapping blocks.
- If the input is a miscellaneous topic bag with no defensible brief structure, use
  not_a_single_event, explain why, and return no blocks.
Choose 3-8 non-redundant sentences per block where available. A block is an event, not a broad
entity or region. Never place unrelated events in one block.`;

function selectionPrompt(candidates, cluster, schema) {
  const material = candidates.map(c => `### ${c.id} | ${c.topic}\nPROSE: ${c.text}\nEVIDENCE:\n${evidenceForCandidate(c, cluster)}`).join('\n\n');
  return `Select a coherent news brief from direct-written candidate sentences and their verbatim
evidence. You may ONLY return candidate ids; a deterministic assembler will copy their prose
unchanged. Do not reward smooth wording over evidentiary support.

${SHAPE_RULES}

CANDIDATES AND RAW EVIDENCE\n${material}\n\nReturn only JSON matching this schema:\n${JSON.stringify(schema)}`;
}

const writeSchema = {
  type: 'object', additionalProperties: false, required: ['verdict', 'reason', 'title', 'sentences'],
  properties: {
    verdict: { type: 'string', enum: ['written', 'not_a_single_event'] },
    reason: { type: 'string', maxLength: 500 },
    title: { type: 'string', maxLength: 120 },
    sentences: {
      type: 'array', maxItems: WRITE_LEN.max,
      items: {
        type: 'object', additionalProperties: false, required: ['text', 'sources'],
        properties: {
          text: { type: 'string', maxLength: 400 },
          sources: {
            type: 'array', minItems: 1, maxItems: WRITE_LEN.sources,
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

/** 一条重点的报道篇数 = 它引到的不同文章数。窗口步每条最多引 4 句，所以 4 即「4 篇及以上」。 */
export const supportOf = a => new Set(a.sources.map(s => s.articleId)).size;

/**
 * 必写档：报道篇数达到本簇最高档的重点（下限 2 篇，单篇报道的不强制）。
 * 放宽到次一档的 slack 已证伪删除，见 README「删掉的开关」。
 */
export function mustCover(anchors) {
  const top = Math.max(0, ...anchors.map(supportOf));
  const floor = Math.max(2, top);
  return top >= 2 ? new Set(anchors.filter(a => supportOf(a) >= floor).map(a => a.id)) : new Set();
}

/** 写作材料：每条重点只给话题标签 + 它指向的**原句**（不给任何上一步写出的转述）。 */
// 说话人藏在前一句的原句：代词开头，或含 "he added / she said" 这类无主名的引述
const PRONOUN_LED = /^\W*(he|she|they|his|her|their|it)\b|\b(he|she|they) (added|said|says|told|wrote|noted|warned|stressed)\b/i;

/** 需要带上下文的原句 → 它的前一句（同篇）。写作材料与补出处都用它。 */
export function contextOf(cluster, s) {
  const t = sentenceOf(cluster, s.articleId, s.sentence) ?? '';
  return s.sentence > 1 && PRONOUN_LED.test(t) ? { articleId: s.articleId, sentence: s.sentence - 1 } : null;
}

export function writeMaterial(anchors, cluster, withSupport = false, withContext = false) {
  const must = withSupport ? mustCover(anchors) : new Set();
  const list = withSupport ? [...anchors].sort((a, b) => supportOf(b) - supportOf(a)) : anchors;
  const line = s => `[${s.articleId}:${s.sentence}] ${sentenceOf(cluster, s.articleId, s.sentence)}`;
  return list.map(a => {
    const head = withSupport ? `### ${a.topic} — reported by ${supportOf(a)} article(s)${must.has(a.id) ? ' — MUST COVER' : ''}` : `### ${a.topic}`;
    return `${head}\n${a.sources.map(s => {
      const ctx = withContext ? contextOf(cluster, s) : null;
      return ctx ? `(preceding sentence, for who is speaking) ${line(ctx)}\n${line(s)}` : line(s);
    }).join('\n')}`;
  }).join('\n\n');
}

/**
 * 补出处：句中的数字/引语不在所引原句里，就在材料池里找**字面包含**它的原句补进 sources。
 * 只补不删、只认字面包含，所以不会把出处改错；找不到就原样留着，由快档报读数。
 */
export function repairCitations(sentences, pool, cluster) {
  let added = 0;
  const out = sentences.map(s => {
    const sources = [...s.sources];
    const have = () => sources.map(r => sentenceOf(cluster, r.articleId, r.sentence) ?? '').join(' ');
    const needNums = () => { const h = numbersIn(have()); return [...numbersIn(s.text)].filter(n => !h.has(n)); };
    const needQuotes = () => { const h = normQuote(have()); return quotesIn(s.text).filter(q => !h.includes(normQuote(q))); };
    for (const n of needNums()) {
      if (!needNums().includes(n)) continue;
      const hit = pool.find(r => numbersIn(sentenceOf(cluster, r.articleId, r.sentence) ?? '').has(n));
      if (hit) { sources.push(hit); added++; }
    }
    for (const q of needQuotes()) {
      const hit = pool.find(r => normQuote(sentenceOf(cluster, r.articleId, r.sentence) ?? '').includes(normQuote(q)));
      if (hit) { sources.push(hit); added++; }
    }
    return { ...s, sources };
  });
  return { sentences: out, added };
}

function writePrompt(anchors, cluster) {
  return `You are writing one item for a daily world-news brief, in English, for a reader who has not
seen any of the material. The material below is key points marked in the reporting of one news
cluster, each followed by the original source sentences, labeled [articleId:sentence]. The labels
are for citing only.

<material>
${writeMaterial(anchors, cluster, WRITE_SUPPORT, WRITE_REPAIR)}
</material>

Decide first: if the material has no single dominant story (a miscellaneous topic bag), return
verdict not_a_single_event with a reason, an empty title and no sentences. Otherwise write ONE item
about the dominant story; leave out key points that belong to other stories.
${WRITE_SUPPORT ? `
Key points are ordered by how many articles reported them. The points marked MUST COVER are the
most widely reported and are part of this story by definition: include every one of them, even if
it looks like a separate thread (for example a rescue alongside a cost report)${WRITE_TIER === 'exec' ? ` — at summary
level is enough: the reader must learn its substance, not its detail` : ''}. Then add other
points as space allows, preferring the more widely reported ones.
` : ''}
How to write it:
- ${WRITE_LEN.text} It must read as one connected item, not a list of facts: compress minor
  detail, and put related figures together in one sentence.
- Say each fact once. If several key points report the same fact, use it once.
- Use only facts, names and figures from the original sentences; never from memory. Any number in
  a sentence must appear in a source sentence that sentence cites. Keep attribution and
  uncertainty: every opinion, prediction or interpretation belongs to a named person or outlet.
  Present one event as the cause of or response to another only when a source sentence says so.
  Do not present different people's statements as agreeing with, echoing or answering each other
  unless a source sentence says so; report each person's statement on its own.
- Copy a quote word for word inside quotation marks and name its speaker.
- For each sentence, cite in sources the exact source sentences that support every part of it
  (up to ${WRITE_LEN.sources}). Never write the [articleId:sentence] labels inside text.
- Plain prose, normal sentence case. title: a short headline for the story, under 10 words.

Return only JSON matching this schema:\n${JSON.stringify(writeSchema)}`;
}

function cleanWrite(x) {
  if (!x || !Array.isArray(x.sentences)) return x;
  return { ...x, title: stripMarkers(String(x.title ?? '')), sentences: x.sentences.map(s => ({ ...s, text: stripMarkers(String(s?.text ?? '')) })) };
}

function writeOk(raw, cited) {
  const x = cleanWrite(raw);
  if (!['written', 'not_a_single_event'].includes(x?.verdict) || typeof x?.reason !== 'string' || !Array.isArray(x.sentences)) return false;
  if (x.verdict === 'not_a_single_event') return x.reason.trim().length > 0 && x.sentences.length === 0;
  if (!x.title?.trim() || MARKER.test(x.title) || !x.sentences.length) return false;
  return x.sentences.every(s => typeof s?.text === 'string' && s.text.trim() && !MARKER.test(s.text) &&
    Array.isArray(s.sources) && s.sources.length > 0 && s.sources.every(r => cited.has(`${r.articleId}:${r.sentence}`)));
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
            provider: 'workers-ai', model: MODEL, temperature, max_tokens: 8000,
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

/**
 * 跑一个 sample。`sample.input.cluster` 是 runner 已经载好的 `{ clusterId, articles }`——
 * 本臂不碰任何加载函数，也就不需要知道这批文章从哪来。
 * `options`：`{ plan, resume, outDir }`，outDir 是 runner 定的产物根目录。
 */
export async function runSample(sample, options = {}) {
  const t0 = Date.now();
  const clusterId = sample.input.clusterId;
  const cluster = sample.input.cluster;
  const { shared: SHARED, anchorCache: ANCHOR_CACHE, out: OUT } = pathsOf(options.outDir);
  const windows = makeWindows(cluster.articles);
  console.log(`c${clusterId}: ${cluster.articles.length} articles -> ${windows.length} windows (${windows.map(w => w.chars).join(', ')} chars)`);
  if (options.plan) return;

  mkdirSync(OUT, { recursive: true });
  const cachePath = `${OUT}/c${clusterId}-candidates.json`;
  const windowCacheDir = WRITE_AT_END ? `${ANCHOR_CACHE}/c${clusterId}-windows` : `${SHARED}/c${clusterId}-windows`;
  const mode = WRITE_AT_END ? 'anchor' : 'candidate';
  mkdirSync(windowCacheDir, { recursive: true });
  const callsPath = `${OUT}/calls.jsonl`;
  const batches = await pool(windows, CONCURRENCY, async w => {
    const windowPath = `${windowCacheDir}/w${w.index + 1}.json`;
    if (options.resume && existsSync(windowPath)) {
      const cached = readWindowCache(windowPath, clusterId, w, cluster, mode);
      console.log(`  [c${clusterId}-w${w.index + 1}] reused ${cached.length} cached candidates`);
      return cached;
    }
    const allowed = new Set(w.articleIds);
    if (WRITE_AT_END) {
      const result = await chatJson(`c${clusterId}-w${w.index + 1}`, anchorPrompt(w, windows.length), anchorSchema,
        x => anchorOk(x, cluster, allowed), callsPath);
      const anchors = result.anchors.map((c, i) => ({ ...c, id: `w${w.index + 1}a${i + 1}` }));
      atomicWriteJson(windowPath, { version: 1, cluster: clusterId, window: w.index + 1, articleIds: w.articleIds, anchors });
      return anchors;
    }
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
  if (WRITE_AT_END) {
    const pool = generated.flatMap(a => a.sources.flatMap(s => {
      const ctx = WRITE_REPAIR ? contextOf(cluster, s) : null;
      return ctx ? [s, ctx] : [s];
    }));
    const cited = new Set(pool.map(s => `${s.articleId}:${s.sentence}`));
    atomicWriteJson(`${ANCHOR_CACHE}/c${clusterId}-anchors.json`, { version: 1, cluster: clusterId, windows: windows.map(({ text, ...w }) => w), anchors: generated });
    if (!generated.length) throw new Error(`c${clusterId}: model marked no key points`);
    const written = cleanWrite(await chatJson(`c${clusterId}-write`, writePrompt(generated, cluster), writeSchema, x => writeOk(x, cited), callsPath));
    let repaired = 0;
    if (WRITE_REPAIR && written.verdict === 'written') {
      const r = repairCitations(written.sentences, pool, cluster);
      written.sentences = r.sentences; repaired = r.added;
    }
    const output = written.verdict === 'not_a_single_event'
      ? { cluster: clusterId, verdict: written.verdict, reason: written.reason, blocks: [] }
      : { cluster: clusterId, verdict: 'written', blocks: [{ title: written.title, sentences: written.sentences.map(s => ({ text: s.text, sources: s.sources })) }] };
    writeFileSync(`${OUT}/c${clusterId}.json`, JSON.stringify(output, null, 2));
    const elapsed = +((Date.now() - t0) / 1000).toFixed(2);
    writeFileSync(`${OUT}/c${clusterId}-run.json`, JSON.stringify({ cluster: clusterId, articles: cluster.articles.length, windows: windows.length, anchors: generated.length, writeAtEnd: true, citationsRepaired: repaired, elapsed_s: elapsed, model: MODEL, window_chars: WINDOW_CHARS }, null, 2));
    console.log(`c${clusterId}: ${output.verdict}, ${output.blocks.length} blocks, ${elapsed}s`);
    return;
  }
  const candidates = generated;
  atomicWriteJson(cachePath, { version: 1, cluster: clusterId, windows: windows.map(({ text, ...w }) => w), candidates });
  if (!candidates.length) throw new Error(`c${clusterId}: model returned no direct-written candidates`);
  const ids = candidates.map(c => c.id);
  const schema = selectionSchema(ids);
  const selection = await chatJson(`c${clusterId}-select`, selectionPrompt(candidates, cluster, schema), schema,
    x => selectionOk(x, new Set(ids)), callsPath);
  const output = assemble(clusterId, selection, candidates);
  writeFileSync(`${OUT}/c${clusterId}.json`, JSON.stringify(output, null, 2));
  const elapsed = +((Date.now() - t0) / 1000).toFixed(2);
  writeFileSync(`${OUT}/c${clusterId}-run.json`, JSON.stringify({ cluster: clusterId, articles: cluster.articles.length, windows: windows.length, candidates: candidates.length, generated: generated.length, elapsed_s: elapsed, model: MODEL, window_chars: WINDOW_CHARS }, null, 2));
  console.log(`c${clusterId}: ${output.verdict}, ${output.blocks.length} blocks, ${elapsed}s`);
}

export const meta = {
  name: 'direct-raw',
  /** consumed 的 by：臂名 + 影响读数的开关。光看这一行就知道这份数据是被哪一版臂用掉的。 */
  consumerId() {
    const flags = [
      WRITE_AT_END && 'write', WRITE_TIER !== 'more' && WRITE_TIER,
      WRITE_SUPPORT && 'support', WRITE_REPAIR && 'mech', RUN && RUN.slice(1),
    ].filter(Boolean);
    return [meta.name, ...flags].join('-');
  },
  /** 根目录 → 本轮成稿真正落的那一层。runner 只拿它打开跑横幅。 */
  resolveOutDir: base => pathsOf(base).out,
};

async function main() {
  await runArm({ meta, runSample });
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  main().catch(e => { console.error(e); process.exitCode = 2; });
}
