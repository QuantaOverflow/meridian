// ============================================================================
// 语义通道原型（semantic-compare）—— 治判官对「方向反转 / 身份张冠李戴 / 极性」的盲区
//
// 背景：逐 claim 判官对这三类召回≈0（memory: judge-partial-match-blindspot），跨家族
// 换模型没救。extract-compare 已用「LLM 只抽取 + 代码全判定」收复数字/日期，本通道是
// 同一分工在语义槽位上的延伸。
//
// ⚠️ 设计依据（读金标 26 条合成 contradicted 得出，推翻了「抽三元组即可」的原判）：
// 「direction」四条里只有 1 条是真角色互换，2 条是 before/after 时序反转，1 条是动词
// 反义；而 7 条 negation 里 6 条带**词面否定标记**（not / refuse / no / stall / suspend）。
// 所以真正吃下这批错的不是三元组本身，是四个各自独立的判据：
//
//   Q 引语保真   零 LLM。claim 里的引号跨度必须在源里逐字出现。
//   R 角色对齐   槽位互换（crosswise 命中）/ 槽位替换（同动作同受事、施事不同名）。
//   P 极性       动作短语的否定标记位不同 → 冲突。闭集标记，不做同义/反义推理。
//   T 时序       before 类 vs after 类，闭集关系词。
//
// 与 extract-compare 同惯例：只产出单向信号（把判定推向 contradicted），绝不反向洗白；
// 只认 same_event + high confidence；抽取器自报的引文必须在源里逐字可查（防造引文）。
//
// 位置说明：现为原型，故与 eval runner 同放 scripts/eval/。若验过要进 runtime，
// 本文件整体移到 services/meridian-ai-worker/src/services/（与 extract-compare.ts 并列，
// 单一真源由 runtime 与 eval 共同 import）。
// ============================================================================

// ============================================================================
// Stage A：LLM 抽取 prompt（不判断、不推理、逐字引用）
// ============================================================================

export const ALIGN_ASSERTION_PROMPT = (claim: string, source: string) => `
You are an assertion-alignment EXTRACTOR. You do NOT judge truth. You do NOT infer.
You only locate and quote, verbatim.

Given a CLAIM and a SOURCE (a set of news articles):

For EVERY assertion in the CLAIM that states WHO did WHAT to WHOM, or that an event
did / did not happen, or that one event happened before/after another — find the
sentence in the SOURCE describing the SAME event, and decompose BOTH sides.

Rules:
- Quote VERBATIM from each side. Never paraphrase. Never normalize. Never "fix"
  a negation, and never drop one.
- agent   = the doer, exactly as named on that side ("Ken Paxton", "the High Court").
- patient = what was acted upon / the object of the action.
- action  = the main verb phrase INCLUDING any negation, refusal or blocking word
  attached to it: "has not claimed", "refused to forgo", "remain stalled",
  "would suspend". Copying that word is the whole point — do not clean it up.
- temporal_rel = the word relating this event to ANOTHER event, if the side states
  one: "before", "after", "following", "prior to", "ahead of", "since".
  Empty string when the side states no such relation.
- If the SOURCE describes the same event with DIFFERENT participants, a different
  verb, swapped roles, or opposite polarity — still pair them. That is exactly what
  this extraction is for. Do NOT decide whether they conflict.
- If the SOURCE never describes this event at all, source_status="absent" and leave
  the source_* fields empty.
- confidence "high" only if you are certain both sides describe the SAME event —
  same occasion, same participants, same time. A similar event, a follow-up, a
  different party's version, or a different location is NOT the same event.

Output ONLY JSON:
{"assertions":[{
"claim_agent":"<verbatim from claim>",
"claim_action":"<verbatim from claim, negation included>",
"claim_patient":"<verbatim from claim>",
"claim_temporal_rel":"<verbatim, or empty>",
"source_status":"same_event|absent",
"source_agent":"<verbatim from source>",
"source_action":"<verbatim from source, negation included>",
"source_patient":"<verbatim from source>",
"source_temporal_rel":"<verbatim, or empty>",
"source_quote":"<verbatim source sentence containing it, <=200 chars>",
"confidence":"high|low"}]}

# CLAIM
${claim}

# SOURCE
${source}
`;

// 定向补抽：首轮标 absent/low 的断言，多半是长源检索没配上（事件以间接表述出现：
// "the High Court ordered" 对应点名法官、"officials said" 对应具名发言人），不是源里真没有。
// extract-compare 的 VALUE_RETRY_PROMPT 就是为此而设；本通道同构。线上实测：首轮 15 条
// 召回集里 6 条报 absent、1 条报 low，全部卡在这一步。
export const ASSERTION_RETRY_PROMPT = (
  claim: string,
  claimAgent: string,
  claimAction: string,
  claimPatient: string,
  source: string
) => `
You are an assertion-alignment EXTRACTOR. You do NOT judge truth. You do NOT infer.

The CLAIM below asserts this event:
  who:  ${claimAgent}
  did:  ${claimAction}
  to:   ${claimPatient}
  claim: ${claim}

Search the SOURCE for what IT says about this SAME event.

- The event may be reported in different words: an act by a named person may appear
  as "the ministry announced"; a refusal may appear as "declined to", "rejected",
  "remains stalled", "has not".
- Copy the source's own wording VERBATIM — especially any negation, refusal or
  blocking word. Never clean it up, never drop it.
- source_temporal_rel: the word relating this event to ANOTHER event, if the source
  states one ("before", "after", "following", "prior to"). Empty otherwise.
- Bridge indirect references, but only if you are certain it is the SAME event of
  the SAME occasion — not a similar event, a follow-up, or a different party's act.

Output ONLY JSON:
{"found":true|false,
"source_agent":"<verbatim>",
"source_action":"<verbatim, negation included>",
"source_patient":"<verbatim>",
"source_temporal_rel":"<verbatim, or empty>",
"source_quote":"<verbatim source sentence containing it, <=200 chars>",
"confidence":"high|low"}

# SOURCE
${source}
`;

// 时序槽定向补抽：只问「源把这个事件排在另一事件之前还是之后」，不问别的。
export const TEMPORAL_RETRY_PROMPT = (
  claimAction: string,
  claimPatient: string,
  sourceQuote: string,
  source: string
) => `
You are a temporal-relation EXTRACTOR. You do NOT judge truth. You do NOT infer.

An event is described in the SOURCE:
  event:  ${claimAction} ${claimPatient}
  source sentence: ${sourceQuote}

Find how the SOURCE orders this event relative to ANOTHER event it mentions.
Copy the ordering expression VERBATIM: "two days after it had begun", "hours before
the announcement", "following the strike", "prior to the vote".

- Only report an ordering the SOURCE itself states. If the source gives an absolute
  date/time but no ordering relative to another event, found=false.
- Do NOT flip, normalise, or rephrase the ordering word. "after" stays "after".

Output ONLY JSON:
{"found":true|false,
"source_temporal_rel":"<verbatim ordering expression>",
"source_quote":"<verbatim source sentence containing it, <=200 chars>",
"confidence":"high|low"}

# SOURCE
${source}
`;

// 命题极性定向补抽（可选臂，默认关）。
//
// 解决的失败形状：首轮把 claim 对齐到了源里**相关但不对应**的句子。金标实测三例——
// claim "Hezbollah claimed responsibility for strikes" 被对到源里 "Hezbollah fired
// rockets towards Israel"，而源里真正对应的是 "Hezbollah has not claimed any recent
// strikes"；claim "Iran resumed negotiations" 被对到 "attempted to include Lebanon in
// a wider ceasefire"，而对应句是 "it would suspend peace talks"。
// 首轮 prompt 问的是「同一事件」，模型就找了个事件；这里改问「直接说这件事成没成的那句」。
// 仍是纯检索指令，不含任何判断——是否冲突照旧由代码定。
export const PROPOSITION_RETRY_PROMPT = (
  agent: string,
  action: string,
  patient: string,
  source: string
) => `
You are a proposition-retrieval EXTRACTOR. You do NOT judge truth. You do NOT infer.

Proposition asserted by a claim:
  "${agent} ${action} ${patient}"

Find the ONE sentence in the SOURCE that speaks MOST DIRECTLY to whether this
proposition holds — including a sentence stating that it did NOT happen, was
refused, denied, rejected, declined, suspended, or remains undone.

- Prefer such a directly-addressing sentence over a sentence about a merely related
  or adjacent event, even if the related one is a closer word match.
- Copy the source's verb phrase VERBATIM, including any negation or refusal word.
  Never clean it up, never drop it, never add one.
- If no sentence in the SOURCE addresses this proposition at all, found=false.

Output ONLY JSON:
{"found":true|false,
"source_agent":"<verbatim>",
"source_action":"<verbatim verb phrase about THIS proposition, negation included>",
"source_quote":"<verbatim source sentence, <=200 chars>",
"confidence":"high|low"}

# SOURCE
${source}
`;

export interface AssertionPair {
  claim_agent?: string;
  claim_action?: string;
  claim_patient?: string;
  claim_temporal_rel?: string;
  source_status?: string;
  source_agent?: string;
  source_action?: string;
  source_patient?: string;
  source_temporal_rel?: string;
  source_quote?: string;
  confidence?: string;
}

// ============================================================================
// Stage B：纯代码判定（零 LLM，可离线自测）
// ============================================================================

const norm = (s: string) => (s || '').toLowerCase().replace(/[‘’“”]/g, "'").replace(/\s+/g, ' ').trim();

// --- 实体归一 -----------------------------------------------------------------
// 头衔/职务前缀是别名的头号来源（"Acting Attorney General Todd Blanche" vs "Todd Blanche"），
// 剥掉再比。这份清单只收**职务**，不收姓氏/国名，避免把实体本体剥没了。
const TITLES = [
  'acting', 'former', 'ex', 'interim', 'deputy', 'vice', 'chief', 'senior', 'junior',
  'president', 'prime', 'minister', 'premier', 'chancellor', 'secretary', 'attorney',
  'general', 'senator', 'sen', 'representative', 'rep', 'congressman', 'congresswoman',
  'governor', 'mayor', 'judge', 'justice', 'ambassador', 'spokesman', 'spokeswoman',
  'spokesperson', 'official', 'officials', 'mp', 'mps', 'lawmaker', 'lawmakers',
  'dr', 'mr', 'mrs', 'ms', 'sir', 'lord', 'labor', 'labour', 'republican', 'democrat',
  'democratic', 'the', 'a', 'an', 'of', 'and', 'his', 'her', 'its', 'their',
];

/** 实体 → 可比较的核心 token 集（去标点、去头衔、去短词）。 */
export function entityTokens(raw: string): string[] {
  return norm(raw)
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/[\s'-]+/)
    .filter((t) => t.length >= 3 && !TITLES.includes(t));
}

/**
 * 两个实体是否指同一个？
 * 判据 = 存在一对 token 前缀相同（≥4 字符）。
 * 前缀而非全等：吃下 "Israel"/"Israeli"、"Iran"/"Iranian"、"Philippines"/"Philippine"
 * 这类形态变化——这些是别名，判成不同就是假冲突。
 * ⚠️ 反过来照不到「同一实体的不同称呼」（"the High Court" vs "Justice Smith"），
 * 那是本通道已知的假阳性来源，靠精度集实测其代价。
 */
export function entitiesMatch(a: string, b: string): boolean {
  const ta = entityTokens(a);
  const tb = entityTokens(b);
  if (!ta.length || !tb.length) return false;
  for (const x of ta) {
    for (const y of tb) {
      // token 全等：姓氏共享即同人（"Sir Jonathan Ive" vs "Jony Ive" → "ive"=="ive"）。
      // 线上实测假阳性正是这条缺失——名字的爱称形式（Jonathan/Jony）前缀对不上，
      // 但姓氏是逐字相同的。金标里的三条真身份替换（Wong/Husic、Garland/Blanche、
      // Rome Statute/Geneva Conventions）无任何共享 token，不受此条影响。
      if (x === y) return true;
      // 窗口 5 而非 6：线上实测 "Lebanese Government" vs "Lebanon" 在 6 下算不同
      // （lebane / lebano），5 下算同（leban）——这是形态变化不是身份冲突。
      // 金标里三对真身份替换（Wong/Husic、Garland/Blanche、Rome/Geneva）无共享前缀，
      // 放宽到 5 不影响召回，已实测。
      const n = Math.min(x.length, y.length, 5);
      if (n >= 4 && x.slice(0, n) === y.slice(0, n)) return true;
    }
  }
  return false;
}

// 泛指中心词：以这些词为中心的短语指的是**一类**行为者，不是某一个。
// 类与其中的实例（"Immigrant rights groups in Dallas" ↔ "El Movimiento DFW"）不构成
// 身份冲突——线上实测这正是一条误伤。注意 "Dallas" 让该短语通过了大写实体判据，
// 所以必须单独挡中心词，光看大写不够。
const GENERIC_HEADS = [
  'group', 'groups', 'organisation', 'organisations', 'organization', 'organizations',
  'agency', 'agencies', 'authority', 'authorities', 'official', 'officials', 'force',
  'forces', 'troop', 'troops', 'source', 'sources', 'analyst', 'analysts', 'expert',
  'experts', 'activist', 'activists', 'resident', 'residents', 'family', 'families',
  'company', 'companies', 'firm', 'firms', 'party', 'parties', 'leader', 'leaders',
  'campaigner', 'campaigners', 'protester', 'protesters', 'critic', 'critics',
];

/**
 * 专有名词样：能唯一指称某个行为者的短语。
 * 判据 = 有非头衔的大写 token，且中心词不是泛指类别词。
 * 用途：把「泛指主语」排除在身份冲突之外——泛指与具体是包含关系，不是矛盾。
 */
export function looksLikeProperNoun(raw: string): boolean {
  const words = (raw || '').replace(/[^\w\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.some((w) => GENERIC_HEADS.includes(w.toLowerCase()))) return false;
  const capped = words.filter((w) => /^[A-Z][a-z'-]{2,}/.test(w) && !TITLES.includes(w.toLowerCase()));
  return capped.length >= 1;
}

// --- P 极性 -------------------------------------------------------------------
// 闭集词面否定标记。收的是**否定/阻断/拒绝**这一族，不做反义推理（"struck their targets"
// vs "fell short" 这类无标记反义本通道照不到，是已知缺口）。
const NEG_MARKERS = [
  /\bnot\b/, /\bn't\b/, /\bno\b/, /\bnever\b/, /\bnone\b/, /\bneither\b/, /\bnor\b/,
  /\bwithout\b/, /\brefus\w*/, /\bden(?:y|ies|ied|ial)\b/, /\bdeclin\w*/, /\breject\w*/,
  /\bfail(?:s|ed|ing)?\s+to\b/, /\bhalt\w*/, /\bsuspend\w*/, /\bstall\w*/, /\bcancel\w*/,
  /\bblock\w*/, /\bbarred\b/, /\boppos\w*/, /\bwithdr\w*/, /\bpull(?:ed|s)?\s+out\b/,
  /\bcall(?:ed|s)?\s+off\b/, /\babandon\w*/, /\bveto\w*/, /\bresist\w*/, /\bunable\b/,
];

/**
 * 动作短语的极性位：谓语头部命中否定标记 = 1（负），否则 0（正）。
 *
 * ⚠️ 只看**前 HEAD_WINDOW 个 token**。英语否定附着在谓语头（"has not claimed" /
 * "refused to forgo" / "would suspend" / "remain stalled"），落在宾语里的否定词说的是
 * 别的事。线上实测的假阳性正是后者：claim "explained the technical rationale for
 * **abandoning** mid-engine EV concepts"（abandon 在第 6 token）撞源 "explains" →
 * 假极性冲突。窗口取 3 覆盖上面全部真例，同时把这类宾语内否定挡在外面。
 */
const HEAD_WINDOW = 3;
export function polarityOf(phrase: string): 0 | 1 {
  const head = norm(phrase).split(/\s+/).slice(0, HEAD_WINDOW).join(' ');
  return NEG_MARKERS.some((re) => re.test(head)) ? 1 : 0;
}

// --- T 时序 -------------------------------------------------------------------
const BEFORE_RE = /\b(before|prior to|ahead of|in advance of|preceding)\b/;
const AFTER_RE = /\b(after|afterwards?|following|subsequent to|in the wake of|once)\b/;

/** 时序关系类：'before' | 'after' | null（无关系词，或两类同现→不判）。 */
export function temporalClassOf(phrase: string): 'before' | 'after' | null {
  const s = norm(phrase);
  const b = BEFORE_RE.test(s);
  const a = AFTER_RE.test(s);
  if (b && a) return null; // "before and after" 之类，代码不冒险
  if (b) return 'before';
  if (a) return 'after';
  return null;
}

// --- Q 引语保真（零 LLM，直接打 claim + 全源）------------------------------------
/**
 * claim 里 ≥2 个词的引号跨度。单词引号（'dead'）是评价性引用，噪声大，不收。
 *
 * ⚠️ 单引号必须做边界判定：撇号（所有格 declaration's / 缩写 don't）与开引号同字符。
 * 线上实测假阳性：`The declaration's language normalizes Russia's war as a 'crisis'`
 * 被抓成跨度 `s language normalizes Russia`——两个所有格撇号配成了一对。
 * 判据：开引号前必须是行首/空白/开括号，闭引号后必须是行尾/空白/标点。
 */
export function quotedSpans(claim: string): string[] {
  const out: string[] = [];
  const text = (claim || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const patterns: RegExp[] = [
    /(?:^|[\s(\[{])'([^']{4,120})'(?=$|[\s.,;:!?)\]}])/g,
    /(?:^|[\s(\[{])"([^"]{4,120})"(?=$|[\s.,;:!?)\]}])/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const span = m[1].trim();
      if (span.split(/\s+/).length >= 2) out.push(span);
    }
  }
  return out;
}

/** 引语是否在源里逐字出现（只归一空白与大小写，不做同义匹配——引号就该是逐字的）。 */
export function quoteFoundInSource(span: string, source: string): boolean {
  return norm(source).includes(norm(span));
}

// --- 抽取自查（防造引文/造槽位）--------------------------------------------------
/** 抽取器给的 verbatim 片段必须真在原文里；否则整对是幻觉，不进比对。 */
export function verbatimIn(haystack: string, needle: string): boolean {
  const n = norm(needle);
  if (n.length < 3) return false;
  return norm(haystack).includes(n);
}

// ============================================================================
// 判定汇总
// ============================================================================

export type SemanticKind = 'quote' | 'role_swap' | 'role_substitution' | 'polarity' | 'temporal';

export interface SemanticConflict {
  kind: SemanticKind;
  why: string;
  pair?: AssertionPair;
}

/**
 * 一条 claim 的抽取结果 → 语义冲突列表。
 * 门（与 extract-compare 同惯例，全部为「宁可漏不可错」）：
 *   ① source_status === 'same_event' 且 confidence === 'high'
 *   ② source_quote 必须在源里逐字可查
 *   ③ claim 侧槽位必须在 claim 里逐字可查
 */
export function findSemanticConflicts(
  pairs: AssertionPair[],
  claim: string,
  source: string
): SemanticConflict[] {
  const out: SemanticConflict[] = [];

  for (const p of pairs || []) {
    if (p.source_status !== 'same_event' || p.confidence !== 'high') continue;
    if (p.source_quote && !verbatimIn(source, p.source_quote)) continue; // 造引文，丢弃

    const cA = p.claim_agent || '';
    const cP = p.claim_patient || '';
    const sA = p.source_agent || '';
    const sP = p.source_patient || '';
    const cAct = p.claim_action || '';
    const sAct = p.source_action || '';

    // ---- R1 角色互换：claim 的施事=源的受事，且 claim 的受事=源的施事 -------------
    // 双向 crosswise 同时命中才算，单边命中不算——这是本判据高精度的来源。
    if (cA && cP && sA && sP && entitiesMatch(cA, sP) && entitiesMatch(cP, sA) && !entitiesMatch(cA, sA)) {
      out.push({
        kind: 'role_swap',
        why: `role swap: claim "${cA}" ${cAct} "${cP}" vs source "${sA}" ${sAct} "${sP}"`,
        pair: p,
      });
      continue; // 互换已定性，不再按替换重复报
    }

    // ---- R2 槽位替换：一个槽位对得上，另一个是不同的专有名词 ----------------------
    const agentDiff = cA && sA && !entitiesMatch(cA, sA) && looksLikeProperNoun(cA) && looksLikeProperNoun(sA);
    const patientDiff = cP && sP && !entitiesMatch(cP, sP) && looksLikeProperNoun(cP) && looksLikeProperNoun(sP);
    if (agentDiff && cP && sP && entitiesMatch(cP, sP)) {
      out.push({ kind: 'role_substitution', why: `agent: claim "${cA}" vs source "${sA}" (same patient "${sP}")`, pair: p });
    } else if (patientDiff && cA && sA && entitiesMatch(cA, sA)) {
      out.push({ kind: 'role_substitution', why: `patient: claim "${cP}" vs source "${sP}" (same agent "${sA}")`, pair: p });
    }

    // ---- P 极性 ---------------------------------------------------------------
    // 前置条件：两侧施事必须是同一个。极性说的是「同一个行为者做没做同一件事」，
    // 施事都不同就无从谈起。线上实测假阳性：claim「Lanzavecchia 解释了放弃中置 EV 的
    // 理由」(neg，abandoning) 撞源「Ferrari did explore ... but decided」(pos)——
    // 两侧讲的其实是一回事，只是主语不同层级。加此条即挡住。
    const sameActor = cA && sA && entitiesMatch(cA, sA);
    if (sameActor && cAct && sAct && verbatimIn(claim, cAct) && polarityOf(cAct) !== polarityOf(sAct)) {
      out.push({
        kind: 'polarity',
        why: `polarity: claim "${cAct}" (${polarityOf(cAct) ? 'neg' : 'pos'}) vs source "${sAct}" (${polarityOf(sAct) ? 'neg' : 'pos'})`,
        pair: p,
      });
    }

    // ---- T 时序 ---------------------------------------------------------------
    const ct = temporalClassOf(p.claim_temporal_rel || '');
    const st = temporalClassOf(p.source_temporal_rel || '');
    if (ct && st && ct !== st) {
      out.push({
        kind: 'temporal',
        why: `temporal: claim "${p.claim_temporal_rel}" (${ct}) vs source "${p.source_temporal_rel}" (${st})`,
        pair: p,
      });
    }
  }

  return out;
}

/** Q 通道：零 LLM，独立于抽取。 */
export function findQuoteConflicts(claim: string, source: string): SemanticConflict[] {
  return quotedSpans(claim)
    .filter((span) => !quoteFoundInSource(span, source))
    .map((span) => ({ kind: 'quote' as const, why: `quote not in source: "${span}"` }));
}

/**
 * 通道触发门（成本闸，不是正确性闸）。
 *
 * ⚠️ 两个已实测的坑，都会让门静默吃掉真阳性：
 *  ① 不能用 polarityOf()——那个函数只看谓语头三个 token（为压假阳性），当门用会漏。
 *    这里用全句扫描。
 *  ② 更根本：极性冲突可以**只在源侧**带否定标记。金标 ctr-intel-18 的 claim 是
 *    "An interim official confirmed that procedural changes occurred"（无引号、无否定、
 *    无时序、无专有名词），源是 "no change was implemented" —— claim 侧四个判据全不命中，
 *    门直接把它挡在外面，读数上表现为「抽取层 0 个 assertion」。门看不见源侧，就不能
 *    拿 claim 侧特征当必要条件。
 * 故兜底放行任何 ≥6 词的实质 claim；门只挡碎片。真正的成本控制应放在别处（先跑一遍
 * 廉价判官筛出可疑 claim，再进本通道），那是独立的题目。
 */
export function hasSemanticSurface(claim: string): boolean {
  const words = norm(claim).split(/\s+/).filter((w) => w.length >= 2);
  return (
    quotedSpans(claim).length > 0 ||
    NEG_MARKERS.some((re) => re.test(norm(claim))) ||
    temporalClassOf(claim) !== null ||
    looksLikeProperNoun(claim) ||
    words.length >= 6
  );
}

// ============================================================================
// 编排：一条 claim 打一份源 → 语义冲突列表
// chatFn/parseFn 由调用方注入（与 extract-compare 同惯例）。
// ============================================================================
export async function semanticCompareClaim(
  claim: string,
  source: string,
  chatFn: (prompt: string, maxTokens: number) => Promise<string>,
  parseFn: <T>(raw: string) => T | null,
  onExtractFailure?: (stage: 'align', claim: string) => void,
  // 抽取原始结果回调。存在理由：conflicts 为空时「抽取器没找到对应事实」与「找到了但
  // 代码判无冲突」在返回值上不可区分，而这两者的修法完全相反（改 prompt vs 改判据）。
  // 漏检归因不到层，就只能瞎猜——eval 静默失真的典型入口。
  onPairs?: (pairs: AssertionPair[]) => void,
  propositionRetry = false
): Promise<SemanticConflict[]> {
  // Q 通道零 LLM，先跑，且不受抽取成败影响
  const quoteConflicts = findQuoteConflicts(claim, source);
  if (!hasSemanticSurface(claim)) return quoteConflicts;

  const raw = await chatFn(ALIGN_ASSERTION_PROMPT(claim, source), 1600);
  const parsed = parseFn<{ assertions: AssertionPair[] }>(raw);
  if (!parsed?.assertions) {
    // 降级要留痕：返回 [] 时「真没冲突」与「抽取没解析成」在类型上不可区分
    onExtractFailure?.('align', claim);
    return quoteConflicts;
  }

  // 定向补抽：absent 或 low confidence 的断言各追问一次
  for (const p of parsed.assertions) {
    if (p.source_status === 'same_event' && p.confidence === 'high') continue;
    const retryRaw = await chatFn(
      ASSERTION_RETRY_PROMPT(claim, p.claim_agent || '', p.claim_action || '', p.claim_patient || '', source),
      600
    );
    const r = parseFn<{
      found: boolean;
      source_agent?: string;
      source_action?: string;
      source_patient?: string;
      source_temporal_rel?: string;
      source_quote?: string;
      confidence?: string;
    }>(retryRaw);
    if (r?.found && r.source_action && r.confidence === 'high') {
      p.source_status = 'same_event';
      p.source_agent = r.source_agent || p.source_agent;
      p.source_action = r.source_action;
      p.source_patient = r.source_patient || p.source_patient;
      p.source_temporal_rel = r.source_temporal_rel || p.source_temporal_rel;
      p.source_quote = r.source_quote || p.source_quote;
      p.confidence = 'high';
    }
  }

  // 时序槽定向补抽：claim 说了 before/after 而源侧该槽为空时，追问一次。
  // 单独一轮的理由：这类对多半首轮就是 same_event/high（事件本身对上了），因此不会
  // 触发上面那轮补抽，时序槽会一直空着——线上实测 ctr-intel-23/26 正是卡在这里，
  // 表现为「事件对上了但 T 通道无事可比」，与「源里真没有时序关系」不可区分。
  for (const p of parsed.assertions) {
    if (p.source_status !== 'same_event' || p.confidence !== 'high') continue;
    if (!temporalClassOf(p.claim_temporal_rel || '')) continue;
    if (p.source_temporal_rel) continue;
    const tRaw = await chatFn(TEMPORAL_RETRY_PROMPT(p.claim_action || '', p.claim_patient || '', p.source_quote || '', source), 400);
    const t = parseFn<{ found: boolean; source_temporal_rel?: string; source_quote?: string; confidence?: string }>(tRaw);
    if (t?.found && t.source_temporal_rel && t.confidence === 'high') {
      p.source_temporal_rel = t.source_temporal_rel;
      if (t.source_quote) p.source_quote = t.source_quote;
    }
  }

  // 命题极性补抽臂（opts.propositionRetry）：对「事件对上了、施事也对上了、但两侧极性
  // 相同」的对再问一次——首轮很可能对到了相关但不对应的句子。是否真的划算由精度集实测，
  // 故做成可开关的臂而非默认行为（多找冲突天然有伤精度的风险）。
  if (propositionRetry) {
    for (const p of parsed.assertions) {
      if (p.source_status !== 'same_event' || p.confidence !== 'high') continue;
      if (!p.claim_agent || !p.source_agent || !entitiesMatch(p.claim_agent, p.source_agent)) continue;
      if (polarityOf(p.claim_action || '') !== polarityOf(p.source_action || '')) continue; // 已有冲突，不必再问
      const pRaw = await chatFn(
        PROPOSITION_RETRY_PROMPT(p.claim_agent || '', p.claim_action || '', p.claim_patient || '', source),
        500
      );
      const r = parseFn<{ found: boolean; source_agent?: string; source_action?: string; source_quote?: string; confidence?: string }>(pRaw);
      if (r?.found && r.source_action && r.confidence === 'high') {
        p.source_action = r.source_action;
        p.source_agent = r.source_agent || p.source_agent;
        if (r.source_quote) p.source_quote = r.source_quote;
      }
    }
  }

  onPairs?.(parsed.assertions);
  return [...quoteConflicts, ...findSemanticConflicts(parsed.assertions, claim, source)];
}
