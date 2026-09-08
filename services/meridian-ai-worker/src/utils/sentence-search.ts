/**
 * 【句级检索】给简报写作补原文材料用。零依赖纯函数、零网络、全量扫——
 * 一个故事簇 7–81 篇，几万到几十万字符，不需要 ANN。
 *
 * 从 `apps/backend/prototypes/block-writer/search.ts` 搬入，逻辑未改。四条设计各对着一个实测：
 *
 * 1. **实体门是加权不是硬过滤**。`rankSourcesByRelevance`（faithfulness-prompts.ts）里
 *    `if (anyEnt) cand = cand.filter(i => entHits[i] > 0)` 会把不含 query 专名的候选整个踢出。
 *    那个函数是为「一条 claim 精确定位对应源」写的，硬过滤在那边对（哥伦比亚 claim 不该撞
 *    伊朗源）；搬到「覆盖全部重要事件」这边目标反了，就成了系统性漏检——实测簇 82 的
 *    「法官裁定案件 not ripe」答案是判决书引语，法官自己写的判决书不会自称 Rodriguez，
 *    一个专名都没有，直接出局。
 *
 * 2. **有 IDF**。旧打分是集合命中计数、无 IDF：`Castro`（簇内几乎每句都有）和 `May 29`
 *    权重一样，决定性窄词被高频词淹掉。这里按 BM25 的 IDF，df 在簇内句子上算。
 *
 * 3. **句级而不是 450 字符窗**。同一批 query 实测：宽窗要 11,434 字符才命中 13/14，
 *    压进预算后掉到 12/14（不是找不到，是找到了装不下）；句级 6,471 字符拿到 14/14。
 *
 * 4. **短语通道 + RAG-Fusion 变体融合**（arXiv:2402.03367）。词袋把 `May 29` 拆成两个词
 *    分别数；短语通道要求逐字整体出现、单独计分。变体是规则生成的，不烧 LLM。
 *
 * 没做（都有反向证据）：伪相关反馈 RM3（query 已精确时帮倒忙）、生成式索引扩展 doc2query
 * （幻觉会进候选池被写作层当原文引用）、MMR（实测 answer relevancy 反而最低）。
 */

// ───────────────────────── 切句（原在 retrieve.ts，搬过来让本模块零 import） ─────────────────────────
/** 句末缩写白名单：这些词后面的句点不是句末。 */
const ABBREV = new Set(
  ('mr mrs ms dr jr sr st prof gov sen rep gen lt col sgt adm capt rev hon' +
    ' jan feb mar apr jun jul aug sep sept oct nov dec' +
    ' no vs etc inc corp co ltd llc ave blvd dept univ fig al ca approx' +
    ' u.s u.k e.g i.e a.m p.m ph.d d.c').split(' ')
);

/**
 * 断句。正文多数没有换行，且常见「leg.Christian」这种句号后直接接大写（抓取时段落被拼掉）。
 * 所以句末判据 = [.!?] 后跟空白或直接跟大写/引号，且句点前那个词不是缩写、不是单个大写字母（人名缩写）。
 */
export function splitSentences(raw: string): string[] {
  const text = raw.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!'.!?'.includes(text[i])) continue;
    // 句点后允许一个引号/括号
    let j = i + 1;
    if (j < text.length && '”"\')]'.includes(text[j])) j++;
    const rest = text.slice(j);
    const m = /^(\s*)([A-Z“"(‘“])/.exec(rest);
    if (!m) continue;                              // 后面不是大写开头 → 不是句末
    if (text[i] === '.') {
      const before = text.slice(Math.max(0, i - 12), i);
      const w = (/([A-Za-z.]+)$/.exec(before)?.[1] ?? '').toLowerCase();
      if (ABBREV.has(w)) continue;
      if (/^[A-Z]$/.test(text[i - 1] ?? '')) continue; // "Rodriguez, Jr." 里的首字母缩写
    }
    const s = text.slice(start, j).trim();
    if (s) out.push(s);
    start = j + m[1].length;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

// ───────────────────────── 语料 ─────────────────────────

export interface Sent { articleId: number; si: number; text: string }

export function buildSentences(articleIds: number[], bodyOf: (id: number) => string): Sent[] {
  const out: Sent[] = [];
  for (const id of articleIds) {
    const body = bodyOf(id);
    if (body.trim().length <= 200) throw new Error(`卫生断言：文章 ${id} 正文缺失或 <=200 字符`);
    splitSentences(body).forEach((text, si) => {
      const t = text.trim();
      if (t.length >= 25) out.push({ articleId: id, si, text: t });
    });
  }
  if (!out.length) throw new Error('卫生断言：切句结果为空');
  return out;
}

// ───────────────────────── 词法 ─────────────────────────

const STOP = new Set(
  ('the a an of to in on for and or but with by at from as is are was were be been being this that'
  + ' these those it its their his her over under into than then per via amid has have had will'
  + ' would off out up down how what who when where why which whose whom does did do said says'
  + ' he she they them we you i not no nor so if while during after before about also more most'
  + ' other such only even just there here his her him').split(' ')
);
const termsOf = (s: string): string[] =>
  (s.toLowerCase().match(/[a-z][a-z'’-]{1,}|\d[\d,.\/-]*/g) || []).filter(w => !STOP.has(w));
/** 专名：句中首字母大写且不在停用词表里。句首词会有假阳，靠 IDF 压。 */
const properOf = (s: string): Set<string> =>
  new Set((s.match(/[A-Z][A-Za-z'’-]{2,}/g) || []).map(w => w.toLowerCase()).filter(w => !STOP.has(w)));
/** 归一化用于逐字短语匹配：折叠空白、统一引号与连字符、小写。 */
export const normPhrase = (s: string): string =>
  s.toLowerCase().replace(/[‘’´`]/g, "'").replace(/[“”]/g, '"').replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ').trim();

// ───────────────────────── 索引 ─────────────────────────

export interface Index {
  sents: Sent[];
  norm: string[];            // 归一后的句子，短语通道用
  terms: Array<Set<string>>;
  len: number[];
  avgdl: number;
  idf: Map<string, number>;
  proper: Set<string>;       // 全簇出现过的专名（用于判断 query 里哪些是专名）
}

export function buildIndex(sents: Sent[]): Index {
  const terms = sents.map(s => new Set(termsOf(s.text)));
  const len = sents.map((_, i) => terms[i].size);
  const df = new Map<string, number>();
  for (const t of terms) for (const w of t) df.set(w, (df.get(w) ?? 0) + 1);
  const N = sents.length;
  const idf = new Map<string, number>();
  // BM25 的 IDF。df 大的词（Castro 这种簇内到处都是的）压到接近 0，窄词（May 29 的 29）拉高
  for (const [w, d] of df) idf.set(w, Math.log(1 + (N - d + 0.5) / (d + 0.5)));
  const proper = new Set<string>();
  for (const s of sents) for (const p of properOf(s.text)) proper.add(p);
  return { sents, norm: sents.map(s => normPhrase(s.text)), terms, len, avgdl: len.reduce((a, b) => a + b, 0) / N, idf, proper };
}

// ───────────────────────── query 变体（RAG-Fusion，规则式） ─────────────────────────

/** 日期 / 数量 / 序数这类「决定性窄词」的字面模式。抽出来单独当短语用。 */
const ANCHOR_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b\d+\s*(?:days?|hours?|years?|months?|weeks?|counts?|people|dead)\b|\b\d{4}-\d{2}-\d{2}\b/gi;

export interface Variant { tag: string; text: string; phrases: string[] }

/**
 * 从 query 里抽**决定性短语**：逐字 n-gram，按簇内文档频次筛。
 *
 * 只抽日期/数量锚点是不够的——簇 82 的 Q13 漏检就是这么来的：
 * `not ripe for adjudication` 在 query 与答案句里都逐字存在，却没有任何通道去用它。
 * 判据用 df 而不是词性：**df 低就是决定性**（`not ripe for adjudication` df=1，
 * `in Minnesota` df 几十）。df=0 的短语说明簇内不存在，留着也没用。
 * 长的优先，被更长短语包含的丢掉，避免同一处重复加分。
 */
function ngramPhrases(query: string, idx: Index, minN = 3, maxN = 6): string[] {
  const words = query.split(/\s+/).filter(Boolean);
  const cap = Math.max(3, Math.floor(idx.sents.length * 0.05));
  const cand: Array<{ p: string; df: number; n: number }> = [];
  for (let n = maxN; n >= minN; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const p = normPhrase(words.slice(i, i + n).join(' ')).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
      if (p.length < 8 || !termsOf(p).length) continue;
      let df = 0; for (const s of idx.norm) if (s.includes(p)) df++;
      if (df > 0 && df <= cap) cand.push({ p, df, n });
    }
  }
  const kept: string[] = [];
  for (const o of cand.sort((a, b) => (b.n - a.n) || (a.df - b.df)))
    if (!kept.some(k => k.includes(o.p))) kept.push(o.p);
  return kept.slice(0, 4);
}

/**
 * 一条 query 生成 2–4 个变体。**全部规则生成，不调 LLM。**
 * v0 原句；v1 只留锚点与专名；v2 去掉专名只留描述（救「答案段无专名」）；v3 引号内短语。
 */
export function variantsOf(query: string, idx: Index): Variant[] {
  const V: Variant[] = [];
  const anchors = [...(query.match(ANCHOR_RE) ?? [])].map(x => x.trim());
  const props = [...properOf(query)].filter(p => idx.proper.has(p));
  const quoted = [...query.matchAll(/[“"']([^“”"']{8,})[”"']/g)].map(m => m[1].trim());

  const ngrams = ngramPhrases(query, idx);
  V.push({ tag: 'full', text: query, phrases: [...new Set([...anchors, ...ngrams])] });
  // anchor 变体**只在有真锚点（日期/数量）时才建**。曾经写成「有锚点或有专名就建」，
  // 结果纯专名变体（"judge fernando rodriguez"）检回的是「所有提到这法官的句子」，
  // 对「他裁定了什么」这类 query 毫无用处却照样产出排名——RRF 是排名倒数求和，
  // 真值句在这一路缺席就丢一份，而一堆无关句三路占两路，累加反超。
  // 实测：Q13 的真值句在 full 排 2、bare 排 1，融合后掉到 11。**坏变体会污染融合。**
  if (anchors.length)
    V.push({ tag: 'anchor', text: [...anchors, ...props].join(' '), phrases: anchors });
  // 去专名：只留内容词。Q13 的答案段（判决书引语）一个专名都没有，这一路才够得着
  const bare = termsOf(query).filter(w => !props.includes(w)).join(' ');
  // bare 也带上 n-gram 短语：Q13 的答案句一个专名都没有，短语命中是它唯一能上榜的通道
  if (bare.split(' ').length >= 3) V.push({ tag: 'bare', text: bare, phrases: ngrams });
  if (quoted.length) V.push({ tag: 'quoted', text: quoted.join(' '), phrases: quoted });
  return V;
}

// ───────────────────────── 打分 ─────────────────────────

const K1 = 1.2, B = 0.6;
const PHRASE_BONUS = 6;      // 逐字短语整体命中的额外分，量级对齐一个高 IDF 词
const PROPER_BOOST = 1.6;    // 专名加权（不是硬门）

export function scoreOne(idx: Index, v: Variant): number[] {
  const qterms = [...new Set(termsOf(v.text))];
  const qprops = properOf(v.text);
  const ph = v.phrases.map(normPhrase).filter(p => p.length >= 4);
  return idx.sents.map((_, i) => {
    const T = idx.terms[i];
    let s = 0;
    for (const w of qterms) {
      if (!T.has(w)) continue;
      const idfw = idx.idf.get(w) ?? 0;
      // tf 在句级基本恒为 1，保留 BM25 的长度归一：长句不因为词多而占便宜
      const denom = 1 + K1 * (1 - B + B * (idx.len[i] / idx.avgdl));
      s += idfw * ((K1 + 1) / denom) * (qprops.has(w) ? PROPER_BOOST : 1);
    }
    for (const p of ph) if (idx.norm[i].includes(p)) s += PHRASE_BONUS;
    return s;
  });
}

/** RRF 融合多个变体的排名。k=60 是标准取值。 */
const RRF_K = 60;
export function fuse(idx: Index, variants: Variant[]): number[] {
  const fused = new Array(idx.sents.length).fill(0);
  for (const v of variants) {
    const sc = scoreOne(idx, v);
    const order = sc.map((s, i) => ({ s, i })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    order.forEach((x, r) => { fused[x.i] += 1 / (RRF_K + r + 1); });
  }
  return fused;
}

// ───────────────────────── 对外接口 ─────────────────────────

export interface Hit { articleId: number; si: number; text: string; score: number; matchedPhrases: string[] }
export interface SearchResult { query: string; variants: string[]; hits: Hit[]; total: number }

/**
 * 检索一条 query。`k` 是返回句数。
 * **零命中会如实返回空 hits**——那本身是信息（「搜过，簇内确实没有」），
 * 不像旧版永远有 top-k，让「不存在」这个结论无从得出。
 */
export function search(idx: Index, query: string, k = 2): SearchResult {
  const vs = variantsOf(query, idx);
  const fused = fuse(idx, vs);
  const ph = [...new Set(vs.flatMap(v => v.phrases))].map(normPhrase).filter(p => p.length >= 4);
  const order = fused.map((s, i) => ({ s, i })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k);
  return {
    query, variants: vs.map(v => `${v.tag}:${v.text}`),
    total: fused.filter(s => s > 0).length,
    hits: order.map(x => ({
      articleId: idx.sents[x.i].articleId, si: idx.sents[x.i].si, text: idx.sents[x.i].text,
      score: Number(x.s.toFixed(5)),
      matchedPhrases: ph.filter(p => idx.norm[x.i].includes(p)),
    })),
  };
}

/** 命中句 ± ctx 句，同文章内。渲染给写作层时用，单独一层是为了让命中判定与呈现解耦。 */
export function expand(idx: Index, h: Hit, ctx = 1): string {
  const same = idx.sents.filter(s => s.articleId === h.articleId);
  const pos = same.findIndex(s => s.si === h.si);
  return same.slice(Math.max(0, pos - ctx), pos + ctx + 1).map(s => s.text).join(' ');
}
