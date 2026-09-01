/**
 * 一次性核对：块间重合到底来自"报告本身就重叠"还是"写作时照抄兄弟"？
 * 对同一批块，分别算 ①情报报告之间的重合 ②各臂产出正文之间的重合，并排看。
 */
import { existsSync, readFileSync } from 'node:fs';
import { scoreBlockPairs } from '../../src/utils/block-overlap.js';

const CACHE = new URL('../../../../scripts/eval/rarr-deletion/.cache/', import.meta.url).pathname;
const OUT = new URL('./out/', import.meta.url).pathname;
const WFID = 'admin-brief-1788170117190';

function arch(idx: number): any | null {
  const f = `${CACHE}llm-calls_${WFID}_brief_generation-${String(idx).padStart(3, '0')}.json`;
  if (!existsSync(f)) return null;
  const t = readFileSync(f, 'utf-8').replace(/\x1b\[[0-9;]*m/g, '');
  const i = t.indexOf('{');
  return i < 0 ? null : JSON.parse(t.slice(i));
}

const items: Array<{ idx: number; title: string; heading: string | null; report: string }> = [];
for (let i = 0; i < 40; i++) {
  const a = arch(100 + i); if (!a) continue;
  const p: string = a.request?.messages?.[0]?.content ?? '';
  const title = p.match(/its title: \*\*(.+?)\*\* —/)?.[1]?.trim() ?? '';
  const heading = p.match(/belongs to the section \*\*(.+?)\*\* —/)?.[1]?.trim() ?? null;
  // 报告正文：去掉 markdown 标题行，否则 `## 时间线` 会被当成章节分隔
  const report = ((p.split('<curated_news_data>\n\n')[1] ?? '').split('\n\n</curated_news_data>')[0])
    .split('\n').filter((l) => !l.startsWith('#')).join('\n');
  if (title && report) items.push({ idx: i, title, heading, report });
}

/** 把任意 idx→文本 拼成打分器认的简报形状，并回 order 反查 */
function pairsOf(texts: Map<number, string>) {
  const order = items.filter((b) => texts.has(b.idx));
  const brief = ['## all', ...order.map((b) => `<u>${b.title}</u>\n\n${texts.get(b.idx)}`)].join('\n\n');
  const m = new Map<string, number>();
  for (const p of scoreBlockPairs(brief)) m.set(`${order[p.a].idx}-${order[p.b].idx}`, p.containment);
  return m;
}

const rep = pairsOf(new Map(items.map((b) => [b.idx, b.report])));
const arms: Record<string, Map<string, number>> = {};
for (const a of ['sum', 'title']) {
  for (let r = 0; r < 5; r++) {
    const f = `${OUT}${a}-rep${r}.json`;
    if (!existsSync(f)) continue;
    const o = JSON.parse(readFileSync(f, 'utf-8'));
    arms[`${a}${r}`] = pairsOf(new Map(Object.entries(o).map(([k, v]) => [Number(k), String(v)])));
  }
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const armMean = (prefix: string, k: string) =>
  mean(Object.keys(arms).filter((n) => n.startsWith(prefix)).map((n) => arms[n].get(k) ?? 0));

const secOf = new Map(items.map((b) => [b.idx, b.heading]));
const sameSec = (k: string) => {
  const [a, b] = k.split('-').map(Number);
  return secOf.get(a) != null && secOf.get(a) === secOf.get(b);
};

const rows = [...rep.entries()]
  .filter(([k]) => sameSec(k))
  .map(([k, v]) => ({ k, report: v, sum: armMean('sum', k), title: armMean('title', k) }))
  .sort((a, b) => b.report - a.report);
if (!rows.length) throw new Error('没有同节配对，解析出错了');

console.log('同节配对(按报告重合排序)    报告重合  sum块重合 title块重合   sum-报告');
for (const r of rows) {
  const [a, b] = r.k.split('-');
  const d = r.sum - r.report;
  console.log(
    `  R${a}xR${b}`.padEnd(26) +
    r.report.toFixed(3).padStart(9) +
    r.sum.toFixed(3).padStart(10) +
    r.title.toFixed(3).padStart(11) +
    ((d >= 0 ? '+' : '') + d.toFixed(3)).padStart(11)
  );
}
console.log(`\n同节配对 ${rows.length} 组`);
console.log(`报告重合均值      ${mean(rows.map((r) => r.report)).toFixed(4)}`);
console.log(`sum   块重合均值  ${mean(rows.map((r) => r.sum)).toFixed(4)}`);
console.log(`title 块重合均值  ${mean(rows.map((r) => r.title)).toFixed(4)}`);
