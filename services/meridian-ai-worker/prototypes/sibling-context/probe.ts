/**
 * 【扔掉型原型】兄弟上下文：摘要全文 → 块标题，块间重复会降吗？
 *
 * 病灶（2026-09-01 坐实）：块写作 prompt 把**同节其他块的 executiveSummary 全文**铺进去，
 * 配一句「别复述」。report 78 的一次调用里兄弟摘要 4956 字符 > 自己的报告 4081 字符——
 * 模型面前别人的成品比自己的原料还多，「别写这些」被读成「写这些」。
 *
 * 三臂，同批同时跑（写作 temperature 0.7，跑一次的数字没有意义）：
 *
 *   archive  生产当时的原始产出，直接从 R2 归档读，零 LLM 调用。
 *            它不是对照臂，是**锚**：用来确认打分器在这批数据上读出的数跟已知情况对得上。
 *   sum      用归档里那份 prompt 原样重打一遍（逐字，不重建）。
 *            archive↔sum 之差 = 纯运行间噪声，是判断 title 臂有没有真效果的地板。
 *   title    生产新代码：兄弟只给标题。
 *
 * ⚠️ 这里测的是**草稿**（不跑 RARR 校验）。scripts/eval/block-overlap 的 7/900 基线测的是
 * 成品（RARR 删过之后），两个数不可直接比。要比就在本文件三臂之间比。
 *
 * 跑法：
 *   cd services/meridian-ai-worker/prototypes/sibling-context
 *   pnpm i --ignore-workspace && pnpm probe [--repeats 2] [--conc 5] [--wf 78]
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { getBriefBlockPrompt } from '../../src/prompts/briefSkeleton.js';
import { toProse } from '../../src/services/brief-skeleton.js';
import { scoreBlockPairs } from '../../src/utils/block-overlap.js';

const WORKER = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian/chat';
const CACHE = new URL('../../../../scripts/eval/rarr-deletion/.cache/', import.meta.url).pathname;
const OUT = new URL('./out/', import.meta.url).pathname;
const WF: Record<string, string> = { '76': 'admin-brief-1788058777778', '78': 'admin-brief-1788170117190' };

const args = process.argv.slice(2);
const argOf = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const REPEATS = Number(argOf('--repeats') ?? '2');
const CONC = Number(argOf('--conc') ?? '5');
const WFID = WF[argOf('--wf') ?? '78'];
if (!WFID) throw new Error('--wf 只认 76 / 78');

function archive(idx: number): any | null {
  const f = `${CACHE}llm-calls_${WFID}_brief_generation-${String(idx).padStart(3, '0')}.json`;
  if (!existsSync(f)) return null;
  const t = readFileSync(f, 'utf-8').replace(/\x1b\[[0-9;]*m/g, '');
  const i = t.indexOf('{');
  return i < 0 ? null : JSON.parse(t.slice(i));
}

// ---------------------------------------------------------------------------
// 从归档的 prompt 里把块的构成拆回来。
// 不去 R2 拿骨架：那个 key 不存在（写作步不落规划调用），而块 prompt 里 heading /
// causalLink / 兄弟摘要 / 自己的报告全都在，拆回来比重建更忠实。
// ---------------------------------------------------------------------------
interface Block {
  idx: number;              // 0 基，= reportKeys 下标
  title: string;
  heading: string | null;   // null = 独立事态
  causalLink: string;
  siblingSummaries: string[];
  storyMarkdown: string;
  execSummary: string;
  prompt: string;           // 归档里那份，逐字
  archiveText: string;      // 生产当时的产出
}

function parseArchive(idx: number): Block | null {
  const a = archive(100 + idx);
  if (!a) return null;
  const prompt: string = a.request?.messages?.[0]?.content ?? '';
  const archiveText = toProse(a.response?.content ?? '') ?? '';
  if (!prompt || !archiveText) return null;

  const title = prompt.match(/its title: \*\*(.+?)\*\* —/)?.[1]?.trim() ?? '';
  const heading = prompt.match(/belongs to the section \*\*(.+?)\*\* —/)?.[1]?.trim() ?? null;
  const causalLink = heading
    ? (prompt.split('what makes that section one story:\n')[1] ?? '').split('\n\n')[0].trim()
    : '';
  const siblingSummaries = [...prompt.matchAll(/^ {2}· (.+)$/gm)].map((m) => m[1].trim());
  const storyMarkdown = (prompt.split('<curated_news_data>\n\n')[1] ?? '').split('\n\n</curated_news_data>')[0];
  const execSummary = storyMarkdown.match(/^# \[story \d+\/\d+\] (.+)$/m)?.[1]?.trim() ?? '';
  if (!title || !storyMarkdown || !execSummary) return null;
  return { idx, title, heading, causalLink, siblingSummaries, storyMarkdown, execSummary, prompt, archiveText };
}

const blocks: Block[] = [];
for (let i = 0; i < 40; i++) { const b = parseArchive(i); if (b) blocks.push(b); }
if (blocks.length < 5) throw new Error(`只解析出 ${blocks.length} 个块，归档路径或格式变了`);

// 兄弟摘要 → 兄弟下标。摘要就是那份报告的 execSummary，直接建反查表。
const bySummary = new Map(blocks.map((b) => [b.execSummary, b.idx]));
const siblingIdx = (b: Block): number[] =>
  b.siblingSummaries.map((s) => bySummary.get(s)).filter((n): n is number => typeof n === 'number');

// ---------------------------------------------------------------------------
// 卫生断言。静默失真是这类探针的头号成本，验收必须覆盖每一条被测路径。
// ---------------------------------------------------------------------------
const withSib = blocks.filter((b) => b.siblingSummaries.length > 0);
{
  const bad = withSib.filter((b) => siblingIdx(b).length !== b.siblingSummaries.length);
  if (bad.length) throw new Error(`${bad.length} 个块的兄弟摘要对不回下标（块 ${bad.map((b) => b.idx).join(',')}）`);
  if (!withSib.length) throw new Error('没有带兄弟的块，这批数据测不了这个改动');
  // 标题臂的 prompt 里必须**一个字**兄弟摘要都没有——这正是被测的那件事
  for (const b of withSib) {
    const p = titlePrompt(b);
    for (const s of b.siblingSummaries) {
      if (p.includes(s.slice(0, 60))) throw new Error(`块 ${b.idx}: 标题臂 prompt 里仍有兄弟摘要`);
    }
    if (!siblingIdx(b).every((n) => p.includes(blocks.find((x) => x.idx === n)!.title)))
      throw new Error(`块 ${b.idx}: 标题臂 prompt 里缺兄弟标题`);
    if (!b.prompt.includes(b.siblingSummaries[0].slice(0, 60)))
      throw new Error(`块 ${b.idx}: 基线臂 prompt 里没有兄弟摘要，拆错了`);
  }
}

function titlePrompt(b: Block): string {
  return getBriefBlockPrompt(
    b.storyMarkdown,
    b.title,
    b.heading
      ? {
          heading: b.heading,
          causalLink: b.causalLink,
          siblingTitles: siblingIdx(b).map((n) => blocks.find((x) => x.idx === n)!.title),
        }
      : undefined
  );
}

// ---------------------------------------------------------------------------
async function chat(prompt: string): Promise<string> {
  const r = await fetch(WORKER, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      // 与生产写作步一致：temperature 0.7 / max_tokens 2500
      options: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0.7, max_tokens: 2500, skipCache: true },
    }),
  });
  const j: any = await r.json();
  return j?.data?.choices?.[0]?.message?.content ?? '';
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cur = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (cur < items.length) { const i = cur++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/**
 * 打分器要一份完整简报文本：<u>标题</u> + 正文，章节用 `## ` 分隔。
 *
 * ⚠️ scoreBlockPairs 回的 p.a/p.b 是**拼装顺序**里的位置，不是报告下标（拼装按章节重排过）。
 * 所以同时回一个 order 数组做反查——不回的话打印出来的"3×4"会被当成报告 3 和 4，是假读数。
 */
function assemble(texts: Map<number, string>): { brief: string; order: Block[] } {
  const bySec = new Map<string, Block[]>();
  for (const b of blocks) {
    const k = b.heading ?? '__isolated__';
    (bySec.get(k) ?? bySec.set(k, []).get(k)!).push(b);
  }
  const parts: string[] = [];
  const order: Block[] = [];
  for (const [heading, bs] of bySec) {
    parts.push(`## ${heading === '__isolated__' ? 'isolated' : heading}`);
    for (const b of bs) { parts.push(`<u>${b.title}</u>\n\n${texts.get(b.idx) ?? ''}`); order.push(b); }
  }
  return { brief: parts.join('\n\n'), order };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function score(label: string, texts: Map<number, string>) {
  const { brief, order } = assemble(texts);
  const pairs = scoreBlockPairs(brief);
  const flagged = pairs.filter((p) => (p.sharedRare.length >= 6 && p.containment >= 0.22) || p.sharedNgrams.length >= 2);
  const chars = [...texts.values()].reduce((n, t) => n + t.length, 0);
  // 同节 = 被改动直接作用的那批对（兄弟上下文只在同节内出现）。跨节对是对照：
  // 改动碰不到它们，它们要是也一起动了，说明看到的是噪声不是效果。
  const sameSec = (p: { a: number; b: number }) =>
    order[p.a].heading !== null && order[p.a].heading === order[p.b].heading;
  const sib = pairs.filter(sameSec);
  const cross = pairs.filter((p) => !sameSec(p));
  const label2 = (p: { a: number; b: number }) => `R${order[p.a].idx}×R${order[p.b].idx}`;
  return {
    label, pairs: pairs.length,
    flagged: flagged.length,
    sibFlagged: flagged.filter(sameSec).length,
    sibMeanCont: Number(mean(sib.map((p) => p.containment)).toFixed(4)),
    sibMaxCont: Number(Math.max(0, ...sib.map((p) => p.containment)).toFixed(4)),
    crossMeanCont: Number(mean(cross.map((p) => p.containment)).toFixed(4)),
    sibNgramPairs: sib.filter((p) => p.sharedNgrams.length > 0).length,
    avgChars: Math.round(chars / texts.size),
    flaggedPairs: flagged.map(
      (p) => `${label2(p)}${sameSec(p) ? '(同节)' : ''} cont=${p.containment.toFixed(3)} rare=${p.sharedRare.length} ng=${p.sharedNgrams.length}`
    ),
  };
}

// ---------------------------------------------------------------------------
const rows: any[] = [];
mkdirSync(OUT, { recursive: true });

rows.push(score('archive（生产原始产出，0 次调用）', new Map(blocks.map((b) => [b.idx, b.archiveText]))));

for (const arm of ['sum', 'title'] as const) {
  for (let rep = 0; rep < REPEATS; rep++) {
    // 落盘即缓存：已有的那一轮直接读回重算指标，不重打 LLM。
    // 改指标不该重花钱，而重花的那一次还会因 temperature 0.7 换一组样本，两件事就混了。
    const file = `${OUT}${arm}-rep${rep}.json`;
    let texts: Map<number, string>;
    if (existsSync(file)) {
      texts = new Map(Object.entries(JSON.parse(readFileSync(file, 'utf-8'))).map(([k, v]) => [Number(k), String(v)]));
      console.log(`  ${arm} rep${rep} 读缓存`);
    } else {
      const outs = await pool(blocks, CONC, async (b) => {
        const raw = await chat(arm === 'sum' ? b.prompt : titlePrompt(b));
        return [b.idx, toProse(raw) ?? ''] as [number, string];
      });
      const empty = outs.filter(([, t]) => !t.trim());
      if (empty.length) console.warn(`  ⚠️ ${arm} rep${rep}: ${empty.length} 个块返回空正文`);
      texts = new Map(outs);
      writeFileSync(file, JSON.stringify(Object.fromEntries(texts), null, 2));
      console.log(`  ${arm} rep${rep} 跑完`);
    }
    if (texts.size !== blocks.length) throw new Error(`${arm} rep${rep}: ${texts.size} 个块，应为 ${blocks.length}`);
    rows.push(score(`${arm} rep${rep}`, texts));
  }
}

console.log(`\n块 ${blocks.length} 个（带兄弟 ${withSib.length}）· 简报 ${WFID}\n`);
console.log('臂'.padEnd(30), '超阈', '同节超阈', '同节均重合', '同节最高', '同节6gram', '跨节均重合', '块均字符');
for (const r of rows) {
  console.log(
    r.label.padEnd(30),
    String(r.flagged).padStart(4),
    String(r.sibFlagged).padStart(8),
    String(r.sibMeanCont).padStart(10),
    String(r.sibMaxCont).padStart(8),
    String(r.sibNgramPairs).padStart(9),
    String(r.crossMeanCont).padStart(10),
    String(r.avgChars).padStart(8)
  );
}
console.log('\n超阈明细：');
for (const r of rows) { if (r.flaggedPairs.length) console.log(` ${r.label}: ${r.flaggedPairs.join(' | ')}`); }
writeFileSync(`${OUT}summary.json`, JSON.stringify(rows, null, 2));
