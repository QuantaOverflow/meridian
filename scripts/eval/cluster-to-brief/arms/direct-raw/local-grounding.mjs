/**
 * 逐句接地（local grounding）：一条候选句只对着**它自己引的那几句原文**查，
 * 查到不在其中的数字或专名就整条丢弃。
 *
 * 端口自生产 `services/meridian-ai-worker/src/utils/brief-writer-v3.ts` 的
 * `ungroundedTermsAgainst` / `materialFromText`（逐行同构，含 CAP_STOP 与复数变体规则），
 * 端口而不是 import，是因为那边是另一个包的 TS，本 harness 全是 .mjs。改那边时这里要跟。
 *
 * 为什么是「只对着自己引的句子」而不是整簇：direct-raw 的 candidateOk 已经保证引用能解析，
 * 但**引用合法不等于引用支持**——c36 实测四条硬错全是「句子断言的内容多于它引的那一句」
 * （例：断言 "the move followed Houthi strikes …"，而所引那句只讲了 Brent 油价变动）。
 * 对整簇查这类错查不出来，因为那些专名在簇里别处都有。
 */
import { proseSentences } from '../../lib.mjs';

/** 与生产同一份：句中大写词里不算专名的那些。句首词本来就跳过，所以这里只需排除周/月/I。 */
const CAP_STOP = new Set(['I', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);

/** 给一段语料算 {lower, nums}。千分位逗号先去掉，免得 1,200 被切成 1 和 200。 */
export function materialFromText(text) {
  return { lower: text.toLowerCase(), nums: new Set(text.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []) };
}

/** 正文里没出现在材料中的数字与专名。专名匹配是小写包含，并试一次去复数。 */
export function ungroundedTermsAgainst(m, text) {
  const bad = new Set();
  for (const n of text.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []) if (!m.nums.has(n)) bad.add(n);
  for (const s of proseSentences(text)) {
    s.split(/\s+/).slice(1).forEach(tok => {
      for (const part of tok.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.]+$/g, '').replace(/[’']s$/, '').replace(/\.$/, '').split(/[-–—\/]/)) {
        if (!/^[A-Z][A-Za-z.]*[A-Za-z]$/.test(part) || CAP_STOP.has(part)) continue;
        const lw = part.toLowerCase();
        if (!m.lower.includes(lw) && !m.lower.includes(lw.replace(/s$/, ''))) bad.add(part);
      }
    });
  }
  return [...bad];
}

/**
 * 一条候选未被自己的引句支持的词。`sentenceOf(cluster, articleId, sentence)` 由调用方传入，
 * 好让本模块不依赖 lib 的加载顺序。
 */
export function ungroundedInCandidate(candidate, resolve) {
  const corpus = candidate.sources.map(s => resolve(s.articleId, s.sentence) ?? '').join(' ');
  return ungroundedTermsAgainst(materialFromText(corpus), candidate.text);
}

/** 过滤候选池。返回 {kept, dropped}，dropped 带被判未接地的词，供落盘复核。 */
export function filterGrounded(candidates, resolve) {
  const kept = [], dropped = [];
  for (const c of candidates) {
    const terms = ungroundedInCandidate(c, resolve);
    if (terms.length) dropped.push({ id: c.id, topic: c.topic, text: c.text, sources: c.sources, ungrounded: terms });
    else kept.push(c);
  }
  return { kept, dropped };
}
