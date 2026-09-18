/**
 * 【报告层 v3 · 纯函数】一个簇的原文 → 带出处的事实、当事方、分歧（report-v3）。
 * 这里只放不碰网络、不碰 env 的部分：切句、分批、抽取结果解析、去重的候选与分组、
 * 各方 markdown 的解析、单元组装。编排（调模型、并发、重试）在 services/report-v3.ts。
 *
 * 逐条搬自原型 apps/backend/prototypes/srl-extractive/（只在本地）：
 *   splitSentences            srl.mjs
 *   parseCite / checkFact     cite-select.mjs
 *   实体归一 / 内容词 / 候选 / 贪心分组 / 分区解析   dedup-v2.mjs（文件头写着 6 步配方）
 *   单元组装（篇数、骨架、代表句、variants）        build-fixture.mjs
 * 判据不许按具体簇调（原型是在 4 个簇上定的，改了就不是那套读数）。
 */

// ── 输入 / 输出形状 ──────────────────────────────────────────────────────
export interface ReportArticleInput {
  id: number;
  title: string;
  url?: string;
  publishDate?: string;
  content: string;
}
export interface FactSource {
  articleId: number;
  sentence: number;
}
/** 抽取出来、还没去重的一条事实 */
export interface RawFact {
  text: string;
  sources: FactSource[];
}
export interface ReportFact {
  id: string;
  text: string;
  articles: number;
  skeleton: boolean;
  sources: FactSource[];
  variants: Array<{ text: string; sources: FactSource[] }>;
  figuresDiffer: boolean;
}
export interface ReportParty {
  name: string;
  identity: string;
  stance: string;
}
export interface ReportConflict {
  about: string;
  sides: string[];
}
export interface ReportV3Doc {
  version: string;
  generated: string;
  title: string;
  pipeline: Record<string, string>;
  articles: Array<{ id: number; title: string; url: string; publishDate: string }>;
  summary: string;
  facts: ReportFact[];
  parties: ReportParty[];
  conflicts: ReportConflict[];
  /** articleId → 该文章的句子，数组下标 + 1 = facts[].sources[].sentence */
  sentences: Record<string, string[]>;
}

/** 骨架事实的门槛：被 ≥2 篇报道。写作层只拿骨架当要点（ADR 0004）。 */
export const SKELETON_MIN = 2;

// ── 切句 ────────────────────────────────────────────────────────────────
const ABBREVIATIONS = [
  'Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Jr', 'Sr', 'Prof', 'Rep', 'Sen', 'Gov', 'Rev', 'Gen', 'Col',
  'Lt', 'Capt', 'vs', 'etc', 'Inc', 'Corp', 'Co', 'Ltd', 'No', 'approx', 'Ave', 'Blvd', 'Fig',
];
const PLACEHOLDER = '\u0001'; // 不算句末的那个点
const SPLIT = '\u0002';

/**
 * 正则切句。抓取时段落换行已被清掉，很多边界处一个空格都没有（"…over trade.But while…"），
 * 所以边界规则允许零空白；句号后面必须是大写字母，故小数点、"$3.5bn" 不会被切开。
 */
export function splitSentences(text: string): string[] {
  if (!text || !text.trim()) return [];
  let t = text;
  t = t.replace(new RegExp(`\\b(${ABBREVIATIONS.join('|')})\\.`, 'g'), (_, w) => `${w}${PLACEHOLDER}`);
  t = t.replace(/\b([A-Z])\./g, (_, c) => `${c}${PLACEHOLDER}`);
  t = t.replace(/([.!?]+)(\s*)(?=["'“‘]?[A-Z])/g, (_, punct, ws) => `${punct}${ws}${SPLIT}`);
  return t
    .split(SPLIT)
    .map(s => s.replace(new RegExp(PLACEHOLDER, 'g'), '.').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export interface BatchPart {
  article: ReportArticleInput;
  localStart: number;
  sentences: string[];
}

/** 每批最多 budget 句，长文章切成多段；一批可以装几篇短文章（原型 BUDGET=20）。 */
export function packBatches(
  articles: Array<{ article: ReportArticleInput; sentences: string[] }>,
  budget: number
): BatchPart[][] {
  const units: BatchPart[] = [];
  for (const a of articles) {
    for (let i = 0; i < a.sentences.length; i += budget) {
      units.push({ article: a.article, localStart: i, sentences: a.sentences.slice(i, i + budget) });
    }
  }
  const batches: BatchPart[][] = [];
  let cur: BatchPart[] = [];
  let n = 0;
  for (const u of units) {
    if (n && n + u.sentences.length > budget) {
      batches.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(u);
    n += u.sentences.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

// ── 抽取结果 ────────────────────────────────────────────────────────────
export interface ParsedCite {
  facts: Array<{ text: string; cites: number[] }>;
  unparsed: string[];
  jsonError: string | null;
}

/** 约束式解码的产出；什么都不静默丢（解不出的进 unparsed）。 */
export function parseCite(content: string): ParsedCite {
  const facts: Array<{ text: string; cites: number[] }> = [];
  const unparsed: string[] = [];
  let obj: unknown;
  try {
    obj = JSON.parse(content);
  } catch (e) {
    return { facts, unparsed, jsonError: e instanceof Error ? e.message : String(e) };
  }
  const arr = (obj as { facts?: unknown })?.facts;
  for (const f of Array.isArray(arr) ? arr : []) {
    const text = String((f as { text?: unknown })?.text ?? '').trim();
    const rawCites = (f as { cite?: unknown })?.cite;
    const cites = (Array.isArray(rawCites) ? rawCites : []).map(Number).filter(Number.isInteger);
    if (text) facts.push({ text, cites });
    else unparsed.push(JSON.stringify(f));
  }
  return { facts, unparsed, jsonError: null };
}

// trim 是 2026-09-13 补的：只压内部空白、不去首尾，会让「首尾多一个空格的同一句」当成两条不同的事实，
// preMergeIdentical 就漏掉它们（纯函数自检抓到）。
const normText = (s: string) =>
  (s ?? '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/'s\b/g, '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
const numbersOf = (s: string) => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(x => x.replace(/,/g, ''));
const NAME_STOP = new Set(['The', 'This', 'That', 'These', 'Those', 'It', 'In', 'On', 'At', 'For', 'After', 'Before', 'When', 'While', 'And', 'But', 'Its', 'Their', 'His', 'Her']);

/**
 * 对着所引原句做确定性检查：编号越界、凭空的数字与名字。
 * 抓不到「名字数字都在、关系接错」那类（那是写作层的关系错，见 ADR 0004）。
 */
export function checkFact(fact: { text: string; cites: number[] }, flat: string[]) {
  const valid = [...new Set(fact.cites)].filter(k => k >= 1 && k <= flat.length);
  const invalid = fact.cites.filter(k => !(k >= 1 && k <= flat.length)).length;
  const src = normText(valid.map(k => flat[k - 1]).join(' '));
  const srcNums = new Set(numbersOf(src));
  const numbersMissing = numbersOf(fact.text).filter(x => !srcNums.has(x));
  // 前缀匹配，免得 demonym / 所有格算成凭空（"Australian" vs "Australia's"）
  const found = (w: string) => {
    const x = w.toLowerCase().replace(/'s$/, '');
    return src.includes(x) || src.includes(x.slice(0, Math.max(5, x.length - 3)));
  };
  const namesMissing = (fact.text.match(/\b[A-Z][a-zA-Z&'.-]{2,}\b/g) ?? []).filter(w => !NAME_STOP.has(w) && !found(w));
  return { valid, invalid, numbersMissing, namesMissing };
}

/** 复读退化：同一条事实出现 >3 次、重复率 >30%，或单条里某个词出现 ≥5 次。 */
export function repetitionOfTexts(texts: string[]): { ok: boolean; reason?: string } {
  if (texts.length >= 5) {
    const c = new Map<string, number>();
    for (const t of texts) c.set(normText(t), (c.get(normText(t)) ?? 0) + 1);
    const worst = Math.max(...c.values());
    const dup = 1 - c.size / texts.length;
    if (worst > 3 || dup > 0.3) return { ok: false, reason: `line-repeat: ${texts.length} facts dedup to ${c.size} (worst ${worst}x)` };
  }
  for (const t of texts) {
    const c = new Map<string, number>();
    for (const w of normText(t).match(/[a-z0-9$%]{3,}/g) ?? []) {
      if (!['the', 'and', 'for', 'with', 'that', 'from'].includes(w)) c.set(w, (c.get(w) ?? 0) + 1);
    }
    for (const [w, k] of c) if (k >= 5) return { ok: false, reason: `in-field repeat: "${w}" x${k}` };
  }
  return { ok: true };
}

// ── 去重：实体归一 + 内容词 ─────────────────────────────────────────────
const LEADING_STRIP = new Set(['the', 'a', 'an']);
const DEMONYM: Record<string, string> = {
  american: 'usa', america: 'usa', us: 'usa', 'u.s': 'usa', 'u.s.': 'usa', usa: 'usa', 'united states': 'usa',
  canadian: 'canada', canada: 'canada', chinese: 'china', china: 'china', mexican: 'mexico', mexico: 'mexico',
  british: 'uk', britain: 'uk', uk: 'uk', 'u.k': 'uk', 'u.k.': 'uk', 'united kingdom': 'uk',
  european: 'eu', eu: 'eu', 'e.u': 'eu', 'e.u.': 'eu', russian: 'russia', russia: 'russia',
  ukrainian: 'ukraine', ukraine: 'ukraine', japanese: 'japan', japan: 'japan', korean: 'korea', korea: 'korea',
  german: 'germany', germany: 'germany', french: 'france', france: 'france', italian: 'italy', italy: 'italy',
  indian: 'india', india: 'india', australian: 'australia', australia: 'australia', brazilian: 'brazil', brazil: 'brazil',
  israeli: 'israel', israel: 'israel', palestinian: 'palestine', palestine: 'palestine', spanish: 'spain', spain: 'spain',
  irish: 'ireland', ireland: 'ireland', scottish: 'scotland', scotland: 'scotland', swiss: 'switzerland', switzerland: 'switzerland',
  dutch: 'netherlands', netherlands: 'netherlands', polish: 'poland', poland: 'poland', turkish: 'turkey', turkey: 'turkey',
  saudi: 'saudi arabia', iranian: 'iran', iran: 'iran', iraqi: 'iraq', iraq: 'iraq', pakistani: 'pakistan', pakistan: 'pakistan',
  afghan: 'afghanistan', afghanistan: 'afghanistan', venezuelan: 'venezuela', venezuela: 'venezuela',
  colombian: 'colombia', colombia: 'colombia', argentine: 'argentina', argentina: 'argentina', chilean: 'chile', chile: 'chile',
  egyptian: 'egypt', egypt: 'egypt', nigerian: 'nigeria', nigeria: 'nigeria', vietnamese: 'vietnam', vietnam: 'vietnam',
  thai: 'thailand', thailand: 'thailand', filipino: 'philippines', philippines: 'philippines',
  indonesian: 'indonesia', indonesia: 'indonesia', malaysian: 'malaysia', malaysia: 'malaysia',
  singaporean: 'singapore', singapore: 'singapore', taiwanese: 'taiwan', taiwan: 'taiwan',
  greek: 'greece', greece: 'greece', portuguese: 'portugal', portugal: 'portugal', swedish: 'sweden', sweden: 'sweden',
  norwegian: 'norway', norway: 'norway', danish: 'denmark', denmark: 'denmark', finnish: 'finland', finland: 'finland',
  belgian: 'belgium', belgium: 'belgium', austrian: 'austria', austria: 'austria',
};
const ENTITY_STOP = new Set(['The', 'This', 'That', 'These', 'Those', 'It', 'Its', 'On', 'In', 'At', 'As',
  'His', 'Her', 'They', 'Their', 'A', 'An', 'He', 'She', 'We', 'Our', 'You', 'Your',
  'President', 'Prime', 'Minister', 'According', 'Meanwhile', 'However', 'Reuters']);

function normalizeEntityPhrase(phrase: string): string {
  let words = phrase.toLowerCase().split(/\s+/);
  if (words.length > 1 && LEADING_STRIP.has(words[0])) words = words.slice(1);
  let s = words.join(' ');
  s = s.replace(/['’]s$/, '').replace(/['’]$/, '').replace(/\.$/, '');
  const collapsedDots = s.replace(/\./g, '');
  if (DEMONYM[s]) return DEMONYM[s];
  if (DEMONYM[collapsedDots]) return DEMONYM[collapsedDots];
  return collapsedDots || s;
}

export function normalizedEntities(text: string): Set<string> {
  const out = new Set<string>();
  const re = /\b[A-Z][a-zA-Z'.-]*(?:\s+[A-Z][a-zA-Z'.-]*)*\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const phrase = m[0].trim();
    if (!phrase) continue;
    if (phrase.split(/\s+/).length === 1 && ENTITY_STOP.has(phrase)) continue;
    const n = normalizeEntityPhrase(phrase);
    if (n) out.add(n);
  }
  return out;
}

const STOPWORDS = new Set(
  `a an the this that these those it its he she they his her their him them
is are was were be been being am
of on in at to for with from by as into onto over under about after before
and or but not no nor so yet
will would shall should can could may might must
than then there here when where while who whom whose which what why how
i you we our your my me us
said says stated say told say's according
also just only even still more most much many few both each every any all
one two three`
    .trim()
    .split(/\s+/)
);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z][a-z']*/g) ?? []) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    out.add(stem(w));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
function hasOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}
export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export interface DedupFeat {
  ent: Set<string>;
  tok: Set<string>;
}
export interface DedupParams {
  topK: number;
  cosMin: number;
  overlapMin: number;
  groupCap: number;
}

/**
 * 候选：bge-m3 top-k 近邻（cos ≥ cosMin）+ 内容词重合 ≥ overlapMin，两者都受实体约束
 * （两条都带具名实体时必须有交集）。数字不算候选证据。
 */
export function buildCandidates(members: number[], vecs: number[][], feats: DedupFeat[], p: DedupParams): Map<number, Set<number>> {
  const neighbors = new Map<number, Set<number>>(members.map(i => [i, new Set<number>()]));
  const add = (a: number, b: number) => {
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
  };
  const entityOk = (a: number, b: number) => {
    const ea = feats[a].ent, eb = feats[b].ent;
    if (!ea.size || !eb.size) return true;
    return hasOverlap(ea, eb);
  };
  for (const i of members) {
    const sims = members
      .filter(j => j !== i)
      .map(j => [j, cosine(vecs[i], vecs[j])] as [number, number])
      .filter(([, s]) => s >= p.cosMin)
      .sort((x, y) => y[1] - x[1])
      .slice(0, p.topK);
    for (const [j] of sims) if (entityOk(i, j)) add(i, j);
  }
  for (let a = 0; a < members.length; a++) {
    for (let b = a + 1; b < members.length; b++) {
      const i = members[a], j = members[b];
      if (jaccard(feats[i].tok, feats[j].tok) >= p.overlapMin && entityOk(i, j)) add(i, j);
    }
  }
  return neighbors;
}

/** 贪心、不重叠的邻域分组（community_detection 那一路，不是连通分量），每组最多 groupCap 条。 */
export function greedyGroups(members: number[], neighbors: Map<number, Set<number>>, vecs: number[][], groupCap: number): number[][] {
  const unassigned = new Set(members);
  const groups: number[][] = [];
  while (unassigned.size) {
    let best: number | null = null;
    let bestCount = -1;
    for (const i of unassigned) {
      const cnt = [...neighbors.get(i)!].filter(j => unassigned.has(j)).length;
      if (cnt > bestCount || (cnt === bestCount && (best === null || i < best))) {
        best = i;
        bestCount = cnt;
      }
    }
    const pick = best as number;
    unassigned.delete(pick);
    if (bestCount === 0) {
      groups.push([pick]);
      continue;
    }
    const cands = [...neighbors.get(pick)!]
      .filter(j => unassigned.has(j))
      .sort((a, b) => cosine(vecs[pick], vecs[b]) - cosine(vecs[pick], vecs[a]) || a - b)
      .slice(0, groupCap - 1);
    for (const j of cands) unassigned.delete(j);
    groups.push([pick, ...cands]);
  }
  return groups;
}

/**
 * 逐字相同的事实先并起来，不问模型：同一句话不可能是两件事。
 * 收益有两头——这些组不再进候选与判定（省调用），以及它们本来会被判成两条独立事实、
 * 各算 1 篇报道，于是该成为骨架（≥2 篇）的事实被算漏（2026-09-13 c3 实测到一例）。
 *
 * @returns reps 每组的代表下标（取最小），groupOf 代表 → 该组全部成员下标
 */
export function preMergeIdentical(facts: RawFact[]): { reps: number[]; groupOf: Map<number, number[]> } {
  const byText = new Map<string, number[]>();
  facts.forEach((f, i) => {
    const k = normText(f.text);
    const arr = byText.get(k);
    if (arr) arr.push(i);
    else byText.set(k, [i]);
  });
  const reps: number[] = [];
  const groupOf = new Map<number, number[]>();
  for (const members of byText.values()) {
    reps.push(members[0]);
    groupOf.set(members[0], members);
  }
  reps.sort((a, b) => a - b);
  return { reps, groupOf };
}

export interface Partition {
  subgroups: Array<{ indices: number[]; figuresDiffer: boolean }>;
  droppedIndices: number;
  missingFilled: number;
  parseError: boolean;
}

/** 解析 {subgroups}；越界/重复的下标丢掉并计数，漏掉的下标补成单条子组——绝不静默少人。 */
export function parsePartition(content: string, n: number): Partition {
  let j: unknown;
  try {
    j = JSON.parse(content);
  } catch {
    return { subgroups: Array.from({ length: n }, (_, i) => ({ indices: [i], figuresDiffer: false })), droppedIndices: 0, missingFilled: n, parseError: true };
  }
  const raw = Array.isArray((j as { subgroups?: unknown })?.subgroups) ? ((j as { subgroups: unknown[] }).subgroups) : [];
  const seen = new Set<number>();
  let droppedIndices = 0;
  const subgroups: Array<{ indices: number[]; figuresDiffer: boolean }> = [];
  for (const sg of raw) {
    const indices = (sg as { indices?: unknown })?.indices;
    if (!Array.isArray(indices)) continue;
    const clean: number[] = [];
    for (const x of indices) {
      if (!Number.isInteger(x) || (x as number) < 0 || (x as number) >= n) {
        droppedIndices++;
        continue;
      }
      if (seen.has(x as number)) {
        droppedIndices++;
        continue;
      }
      seen.add(x as number);
      clean.push(x as number);
    }
    if (clean.length) subgroups.push({ indices: clean, figuresDiffer: !!(sg as { figuresDiffer?: unknown })?.figuresDiffer });
  }
  let missingFilled = 0;
  for (let i = 0; i < n; i++) {
    if (!seen.has(i)) {
      subgroups.push({ indices: [i], figuresDiffer: false });
      missingFilled++;
    }
  }
  return { subgroups, droppedIndices, missingFilled, parseError: false };
}

// ── 单元组装 ────────────────────────────────────────────────────────────
export interface Unit {
  members: number[];
  figuresDiffer: boolean;
}

/**
 * 一个单元 → 一条报告事实：代表句取出处文章数最多的那条，其余进 variants；
 * articles = 单元里所有成员引到的不同文章数；出处按文章在簇里的顺序、句号升序去重。
 */
export function buildFacts(units: Unit[], facts: RawFact[], articleOrder: number[]): ReportFact[] {
  const order = new Map(articleOrder.map((id, i) => [id, i]));
  const key = (s: FactSource) => `${s.articleId}:${s.sentence}`;
  const sortSrc = (arr: FactSource[]): FactSource[] =>
    [...new Map(arr.map(s => [key(s), s])).values()].sort(
      (a, b) => (order.get(a.articleId) ?? 0) - (order.get(b.articleId) ?? 0) || a.sentence - b.sentence
    );
  const nArts = (fs: RawFact[]) => new Set(fs.flatMap(f => f.sources.map(s => s.articleId))).size;
  return units
    .map(u => {
      const ix = [...u.members].sort((a, b) => a - b);
      const fs = ix.map(i => facts[i]);
      const rep = fs.reduce((a, b) => (nArts([b]) > nArts([a]) ? b : a));
      const articles = nArts(fs);
      return {
        first: ix[0],
        text: rep.text,
        articles,
        skeleton: articles >= SKELETON_MIN,
        sources: sortSrc(fs.flatMap(f => f.sources)),
        variants: fs.filter(f => f !== rep).map(f => ({ text: f.text, sources: sortSrc(f.sources) })),
        figuresDiffer: u.figuresDiffer,
      };
    })
    .sort((a, b) => b.articles - a.articles || a.first - b.first)
    .map((u, k) => {
      const { first, ...rest } = u;
      return { id: `f${k + 1}`, ...rest };
    });
}

// ── 各方与分歧 ──────────────────────────────────────────────────────────
/** 模型偶尔在名字/立场里留 markdown（`**Rawdhah Hasan**`），原型的 fixture 里就有。写进报告前剥掉。 */
export function cleanField(s: string): string {
  return String(s ?? '')
    .replace(/\*\*|__/g, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function section(md: string, head: string): string | null {
  const m = md.match(new RegExp(`^#{1,2}\\s*${head}\\s*$`, 'im'));
  if (!m || m.index == null) return null;
  const rest = md.slice(m.index + m[0].length);
  const nx = rest.search(/^#{1,2}\s+\S/m);
  return (nx === -1 ? rest : rest.slice(0, nx)).trim();
}
const bullets = (s: string | null) => (s ?? '').split('\n').map(l => l.trim()).filter(l => l.startsWith('* ')).map(l => l.slice(2).trim());

export interface ParsedVoices {
  summary: string;
  parties: ReportParty[];
  conflicts: ReportConflict[];
}

/**
 * 解析 voices 的 markdown。分歧的各侧先按 " vs " 切再去重——同一行里把
 * "C$27.6bn vs C$28bn" 重复十几遍出现过（簇 0），去重不丢信息，单侧内部的复读仍由复读检查拦。
 */
export function parseVoices(md: string): ParsedVoices | { err: string } {
  const summaryRaw = section(md, 'Summary');
  const partiesS = section(md, 'Parties');
  const conflictsS = section(md, 'Conflicts');
  if (!summaryRaw) return { err: '缺 # Summary' };
  if (partiesS == null) return { err: '缺 ## Parties' };
  const summary = cleanField(summaryRaw);
  const parties = bullets(partiesS).map(l => {
    const [left, ...rest] = l.split(/\s+[—–]\s+/);
    const pm = left.match(/^(.*?)\s*\((.*)\)\s*$/);
    return {
      name: cleanField(pm ? pm[1] : left),
      identity: cleanField(pm ? pm[2] : ''),
      stance: cleanField(rest.join(' — ')),
    };
  }).filter(p => p.name);
  const conflicts = bullets(conflictsS)
    .filter(l => !/^none\.?$/i.test(l))
    .map(l => {
      const [about, ...rest] = l.split(/\s+[—–]\s+/);
      const sides = rest.join(' — ').split(/\s+vs\.?\s+/i).map(s => cleanField(s)).filter(Boolean);
      return { about: cleanField(about), sides: [...new Map(sides.map(x => [x.toLowerCase(), x])).values()] };
    })
    .filter(c => c.about);
  for (const [name, lines] of [
    ['parties', bullets(partiesS)],
    ['summary', [summary]],
  ] as Array<[string, string[]]>) {
    const rep = repetitionOfTexts(lines);
    if (!rep.ok) return { err: `${name} 复读：${rep.reason}` };
  }
  // 分歧只查「整行重复」，不查行内词频：一条分歧本来就要把同一个当事方的名字在两侧各写一遍
  // （"Trump says X vs Trump's own filing says Y"），行内词频那条会把正常的分歧判成复读——
  // 2026-09-12 整链实测就因此整份报告作废了一次。
  const confLines = conflicts.map(c => `${c.about} — ${c.sides.join(' vs ')}`);
  if (confLines.length >= 5) {
    const c = new Map<string, number>();
    for (const l of confLines) c.set(l.toLowerCase(), (c.get(l.toLowerCase()) ?? 0) + 1);
    const worst = Math.max(...c.values());
    if (worst > 3 || 1 - c.size / confLines.length > 0.3) {
      return { err: `conflicts 复读：${confLines.length} 行去重后只剩 ${c.size}（最多一行重复 ${worst} 次）` };
    }
  }
  if (!parties.length) return { err: 'parties 为空' };
  return { summary, parties, conflicts };
}

/**
 * voices 调用的输入：整簇原文。发布时间要讲清是发稿时间，不是事件发生时间。
 *
 * @param maxCharsPerArticle 每篇正文截到多少字符。生产的簇可达 30 篇（原型只到 16 篇），不截的话
 *   这一次调用的产出会被 max_tokens 截断、整份报告作废。宁可每篇少读一段，也不要少一个当事方——
 *   所以截的是每篇的长度，不是篇数。
 */
export function renderArticlesForVoices(articles: ReportArticleInput[], maxCharsPerArticle = 6000): string {
  return articles
    .map(a => {
      const body = a.content.length > maxCharsPerArticle ? `${a.content.slice(0, maxCharsPerArticle)}\n…[truncated]` : a.content;
      return `## [${a.title}](${a.url ?? ''}) (#${a.id})\n\n> Published: ${a.publishDate ?? 'unknown'} (this is when the article was filed, NOT the date of the events it describes)\n\n\`\`\`\n${body}\n\`\`\`\n\n`;
    })
    .join('');
}
