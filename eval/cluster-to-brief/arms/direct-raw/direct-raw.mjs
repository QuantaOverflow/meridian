/**
 * direct-raw: full-coverage raw windows -> evidence-bound prose candidates -> one selection pass.
 *
 * The intermediate values are already publishable sentences, not event summaries.  The final
 * model is only allowed to select candidate ids and group them into blocks; assembly is exact.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { sentenceOf, numbersIn, quotesIn, normQuote, OUT_ROOT } from '../../lib.mjs';
import { runArm } from '../../runner.mjs';
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
// DIRECT_RAW_SINGLE_BLOCK=1：一簇只出一块（ADR 0003 簇即简报块），子话题留在块内；选择时去重同一事实。
// 只改选择这一步，窗口候选沿用不带此开关的同名臂的缓存（配 --resume），差别只在选择。
const SINGLE_BLOCK = process.env.DIRECT_RAW_SINGLE_BLOCK === '1';
// DIRECT_RAW_WRITE_AT_END=1：改写只发生一次、且发生在看得见全局的最后一步。窗口步不再写句子，
// 只标重点（话题 + 原文句编号）；最后一步读这些重点对应的**原句**，写一段连贯的正文（一簇一块），
// 逐句标出处。动机：原型成稿是十个窗口各写各的句子拼起来的，没有主次、没有过渡（2026-09-19 人读）。
// 与 claim-anchor-not-rewrite 同一思路。窗口产物格式不同，用自己的窗口缓存。
const WRITE_AT_END = process.env.DIRECT_RAW_WRITE_AT_END === '1';
// DIRECT_RAW_WRITE_TIER=lead：写作步篇幅从生产 `more` 档（4–7 句）放到 `lead` 档（8–14 句），
// 试能否把被篇幅挤掉的核心事实写回来。只改写作步，窗口重点复用 -write 的缓存。
// DIRECT_RAW_WRITE_TIER=exec：高管简报。3–5 句，每句往上综合一组事实（不是挑几件事写），结论先行；
// 意义与影响只在原文有人明说时写（用户 2026-09-19 选 B：不许模型自己分析）。一句综合多条，出处上限放到 8。
const WRITE_TIER = ['lead', 'exec'].includes(process.env.DIRECT_RAW_WRITE_TIER) ? process.env.DIRECT_RAW_WRITE_TIER : 'more';
// DIRECT_RAW_WRITE_SUPPORT=1：告诉写作步每条重点有几篇文章报道，并把报道最多的一档列为必写。
// 动机：lead 档 c28 把核心层的飞行员营救整条判成「别的故事」丢掉（每条 4–5 篇报道）——
// 卡召回的不是篇幅，是模型自己判断什么算这个故事。改由报道量决定。
const WRITE_SUPPORT = process.env.DIRECT_RAW_WRITE_SUPPORT === '1';
// DIRECT_RAW_WRITE_REPAIR=1：v6 人读 + 慢档后的一组小修（2026-09-19）：
//  · 窗口步每条重点出处上限 4 → 8：篇数到 4 就封顶，4 篇与 20 篇的事看着一样重，挑不出主事件
//  · 代词开头的原句（"he added"）在材料里带上前一句：c1 把分析师的话安到 Andersson 名下（v6 唯一硬错）
//  · 写完由代码补出处：句中数字/引语不在所引原句里，就去材料里找字面包含它的原句补上
//  · prompt：必写重点保留专名（c36 把 Perim 岛概括没了）；一句一条线
// 试过又撤掉的：「杂烩只写报道最多的那件事」。报道篇数被各事件报道里反复交代的背景事实抬高
// （c43 的加沙死亡总数比任何真实事件都「多」，成稿混了三组），且把 c28 的营救线当成别的事件删掉。
// DIRECT_RAW_WRITE_REPAIR=mech：只取其中两个确定性修复（代词句带前一句、代码补出处），其余不动。
// 单次运行的读数被随机波动淹没（2026-09-20：同设置重跑，漏线/重复/句数不足轮流出现），
// 所以先把不引入随机性的修复单独成一版，再做多次运行比频率。
const WRITE_REPAIR = ['1', 'mech'].includes(process.env.DIRECT_RAW_WRITE_REPAIR);
const REPAIR_FULL = process.env.DIRECT_RAW_WRITE_REPAIR === '1';
const ANCHOR_SOURCES = REPAIR_FULL ? 8 : 4;
// DIRECT_RAW_RUN=n：第 n 次独立重复（窗口步、写作步都重跑），产物与窗口缓存各自分目录，量运行间波动。
const RUN = process.env.DIRECT_RAW_RUN ? `-run${process.env.DIRECT_RAW_RUN}` : '';
// DIRECT_RAW_MUST_SLACK=1：必写档放宽到最高档与次一档。mech 三次运行里 c28 营救线 3/3 丢失——
// 营救各条重点常比报告各条少一两篇，只取最高档就整条掉出必写。只改写作步，窗口重点复用同 RUN 的缓存。
// 结果（3 次）：营救 0/3 → 1/3，且写营救时挤掉了弹药部分——必写 12–14 条，5 句装不下。
// 撤回、默认 0：用户定 c28 是两件事（9 月的监察长报告 / 4 月营救的采访与争议），只写报告是对的。
const MUST_SLACK = REPAIR_FULL ? 1 : Number(process.env.DIRECT_RAW_MUST_SLACK ?? 0);
const WRITE_LEN = WRITE_TIER === 'exec'
  ? { max: 5, sources: 8, text: `An executive brief: 3–5 sentences in a single paragraph, at most about 800 characters.
  The first sentence is the bottom line — the single most important development, stated so a busy
  reader who stops there knows what happened. Each following sentence synthesizes a group of
  related key points into one statement at a higher level (for example the losses, the costs, the
  official reactions), keeping only the one or two figures that matter most; never enumerate items.
  Say why it matters only when a source states it, and attribute it ("the report warned...").
  Write no analysis, motivation or prediction of your own.` }
  : WRITE_TIER === 'lead'
  ? { max: 14, sources: 4, text: `About 8–14 sentences across two to four paragraphs, roughly 1,200–2,000 characters.
  Open with the most important development, then cover the key points, then what the people
  involved said.` }
  : { max: 8, sources: 4, text: `About 4–7 sentences in a single paragraph, roughly 600–1,000 characters. Open with the most
  important development, then the key details, then what the people involved said.` };
/**
 * 产物布局：**根目录由 runner 给**（它知道这轮的数据来自哪里），根目录下怎么分支是本臂的事——
 * 开关组合决定 candidate/write/anchor 各落哪一层。原来这些是模块级常量，算得出它们的
 * 那个后缀却来自 argv，于是臂里躺着一行数据来源的解析。
 */
function pathsOf(base) {
  const candidateOut = `${base}${ROUTE_GATE ? '-routed' : ''}${STORYLINE_FILTER ? '-storyline' : ''}${GROUNDED ? '-grounded' : ''}`;
  const writeOut = `${candidateOut}-write`;
  const anchorCache = `${writeOut}${ANCHOR_SOURCES === 4 ? '' : `-a${ANCHOR_SOURCES}`}${RUN}`;
  const out = WRITE_AT_END ? `${writeOut}${WRITE_TIER === 'more' ? '' : `-${WRITE_TIER}`}${WRITE_SUPPORT ? '-support' : ''}${REPAIR_FULL ? '-repair' : WRITE_REPAIR ? '-mech' : ''}${!REPAIR_FULL && MUST_SLACK ? `-slack${MUST_SLACK}` : ''}${RUN}` : `${candidateOut}${SINGLE_BLOCK ? '-single' : ''}`;
  // shared：不筛文章时的窗口缓存位置，就是根目录本身（不带任何开关后缀，所以两个臂共用）
  return { shared: base, candidateOut, writeOut, anchorCache, out };
}
// 出处标签 [articleId:sentence] 不许出现在成稿里（快档 verify.mjs 同一条判据）
const MARKER = /\[\s*\d{3,}\s*:\s*\d+/;
// 模型常把引用标签写进句尾（实测 c28 五句全带 [986133:3, 1006787:2]），标签对读者无意义、出处已在 sources。
// 确定性剥掉整组标签，剥不干净的残留再由 MARKER 拒收重试。
export const stripMarkers = t => t.replace(/\s*\[\s*\d{3,}\s*:\s*\d+(?:\s*[,;]\s*\d{3,}\s*:\s*\d+)*\s*\]/g, '');
const ENDPOINT = process.env.AI_WORKER_URL ?? 'http://localhost:8787/meridian/chat';
const MODEL = process.env.DIRECT_RAW_MODEL ?? '@cf/zai-org/glm-4.7-flash';
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
        type: 'array', maxItems: SINGLE_BLOCK ? 1 : 5,
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

const SINGLE_BLOCK_RULES = `Write exactly ONE block: one brief item about the story that dominates the evidence.
Different aspects of that story (costs, damage, reactions, follow-ups) belong in the same block;
do not split them into separate blocks. Exclude topical hitchhikers, geographic neighbors,
commentary, and isolated unrelated stories.
- If the input is a miscellaneous topic bag with no dominant story, use not_a_single_event,
  explain why, and return no blocks.
Choose 4-10 sentences, ordered so the block reads as one item: the core development first, then
supporting detail. Never select two candidates that state the same fact, even if worded
differently or citing different articles; keep the one with the stronger evidence.
Title the block with a short headline for the story.`;

function selectionPrompt(candidates, cluster, schema) {
  const material = candidates.map(c => `### ${c.id} | ${c.topic}\nPROSE: ${c.text}\nEVIDENCE:\n${evidenceForCandidate(c, cluster)}`).join('\n\n');
  return `Select a coherent news brief from direct-written candidate sentences and their verbatim
evidence. You may ONLY return candidate ids; a deterministic assembler will copy their prose
unchanged. Do not reward smooth wording over evidentiary support.

${SINGLE_BLOCK ? SINGLE_BLOCK_RULES : SHAPE_RULES}

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
 * WRITE_REPAIR 下放宽到最高档与次一档（top-1）：窗口步重跑一次，c28 营救线各条重点从 4 篇变 3 篇，
 * 只取最高档时整条线掉出必写、从成稿里消失——一篇之差不该决定一整条线写不写。
 */
export function mustCover(anchors, slack = 0) {
  const top = Math.max(0, ...anchors.map(supportOf));
  const floor = Math.max(2, top - slack);
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
  const must = withSupport ? mustCover(anchors, MUST_SLACK) : new Set();
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
- Copy a quote word for word inside quotation marks and name its speaker.${REPAIR_FULL ? `
- Keep the specific names of people, places and organisations from the key points you use; do not
  generalise a name away (write "the island of Perim", not "islands").
- Each sentence covers one thread. Do not join unrelated developments in one sentence with "while"
  or "meanwhile".
- When a source sentence says "he said" or "she added", check the preceding sentence to see who is
  speaking before you name anyone.` : ''}
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
  const { shared: SHARED, candidateOut: CANDIDATE_OUT, anchorCache: ANCHOR_CACHE, out: OUT } = pathsOf(options.outDir);
  let storylineDropped = 0;
  if (STORYLINE_FILTER) {
    const sp = `${OUT_ROOT}structure-router/structure-c${clusterId}.json`;
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
    const sp = `${OUT_ROOT}structure-router/structure-c${clusterId}.json`;
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
  const windowCacheDir = WRITE_AT_END ? `${ANCHOR_CACHE}/c${clusterId}-windows`
    : STORYLINE_FILTER ? `${CANDIDATE_OUT}/c${clusterId}-windows` : `${SHARED}/c${clusterId}-windows`;
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
    writeFileSync(`${OUT}/c${clusterId}-run.json`, JSON.stringify({ cluster: clusterId, routeGate: ROUTE_GATE ? 'passed' : 'off', storylineDropped, articles: cluster.articles.length, windows: windows.length, anchors: generated.length, writeAtEnd: true, citationsRepaired: repaired, elapsed_s: elapsed, model: MODEL, window_chars: WINDOW_CHARS }, null, 2));
    console.log(`c${clusterId}: ${output.verdict}, ${output.blocks.length} blocks, ${elapsed}s`);
    return;
  }
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

export const meta = {
  name: 'direct-raw',
  /** consumed 的 by：臂名 + 影响读数的开关。光看这一行就知道这份数据是被哪一版臂用掉的。 */
  consumerId() {
    const flags = [
      GROUNDED && 'grounded', ROUTE_GATE && 'routed', STORYLINE_FILTER && 'storyline',
      SINGLE_BLOCK && 'single', WRITE_AT_END && 'write', WRITE_TIER !== 'more' && WRITE_TIER,
      WRITE_SUPPORT && 'support', REPAIR_FULL ? 'repair' : WRITE_REPAIR && 'mech',
      !REPAIR_FULL && MUST_SLACK && `slack${MUST_SLACK}`, RUN && RUN.slice(1),
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
