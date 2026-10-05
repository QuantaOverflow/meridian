/**
 * 【切句 · 纯函数】不碰网络、不碰 env。
 *
 * 报告层 v3（services/report-v3.ts 等）已退役删除，本文件只留下还有调用方的这一个函数：
 *   splitSentences            简报块 v6 的切句（services/brief-block-v6.ts、utils/brief-block-v6.ts）
 *
 * 逐条搬自原型 apps/backend/prototypes/srl-extractive/（只在本地）：splitSentences ← srl.mjs
 * 判据不许按具体簇调（原型是在 4 个簇上定的，改了就不是那套读数）。
 */

// ── 切句 ────────────────────────────────────────────────────────────────
const ABBREVIATIONS = [
  'Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Jr', 'Sr', 'Prof', 'Rep', 'Sen', 'Gov', 'Rev', 'Gen', 'Col',
  'Lt', 'Capt', 'vs', 'etc', 'Inc', 'Corp', 'Co', 'Ltd', 'No', 'approx', 'Ave', 'Blvd', 'Fig',
];
const PLACEHOLDER = '\u0001'; // 不算句末的那个点
const SPLIT = '\u0002';

/**
 * 正则切句。2026-10 之前抓的正文丢了段落换行，很多边界处一个空格都没有（"…over trade.But while…"），
 * 所以边界规则允许零空白；句号后面必须是大写字母，故小数点、"$3.5bn" 不会被切开。
 * 之后抓的正文在段落、小标题、图注之间有换行（apps/backend/src/lib/api/parsers.ts），换行一律是句界：
 * 小标题和图注没有句末标点，只靠标点切会黏进下一句。
 */
export function splitSentences(text: string): string[] {
  if (!text || !text.trim()) return [];
  let t = text;
  t = t.replace(new RegExp(`\\b(${ABBREVIATIONS.join('|')})\\.`, 'g'), (_, w) => `${w}${PLACEHOLDER}`);
  t = t.replace(/\b([A-Z])\./g, (_, c) => `${c}${PLACEHOLDER}`);
  t = t.replace(/([.!?]+["'”’]*)(\s*)(?=["'“‘]?[A-Z])/g, (_, punct, ws) => `${punct}${ws}${SPLIT}`);
  t = t.replace(/\n/g, SPLIT);
  return t
    .split(SPLIT)
    .map(s => s.replace(new RegExp(PLACEHOLDER, 'g'), '.').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

