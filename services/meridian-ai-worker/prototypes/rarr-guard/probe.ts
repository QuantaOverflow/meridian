/**
 * 扔掉型原型 —— 不接生产，只回答一个问题就扔。
 *
 * 问题：G2「误删」守卫 `isBadDelete`（services/meridian-ai-worker/src/utils/grounded-edits.ts）
 * 的判据是"整段 span 逐字在源里才拦"。实测两期简报共 43 条被应用的删除，G2 拦下 0 条——
 * 因为真实被删的是 130-216 字符的整句转述，措辞与源不同，逐字匹配永远落空。其中 9 条已
 * 由独立复核确认是误删（删掉了源支持的内容）。
 *
 * 候选新判据：span 里的实词（非停用词、长度≥4 或含数字）是否全部/≥90%/≥80% 出现在源里
 * （逐 token，而不是整段逐字）。在三种 source 口径（全量25份 / rankSourcesByRelevance
 * top-3 / 该块自己那 1 份）下各跑一遍，看这个判据拦下多少已知误删、会不会连正确删除也拦。
 *
 * 数据：scripts/eval/rarr-deletion/.cache/ 里已经抓好的两期归档（不打网络，纯读本地缓存）。
 * 已知阳性：/Users/shiwenjie/.claude/jobs/a83191cc/tmp/rarr-candidates.json（9 条人工确认的误删）。
 * 参考实现：scripts/eval/rarr-deletion/scan.ts（token 覆盖率算法、"是否被应用"的判定、
 * curated_news_data 截取，全部照抄，不重新发明）。
 *
 * 跑法：
 *   cd services/meridian-ai-worker/prototypes/rarr-guard
 *   pnpm i --ignore-workspace
 *   DATABASE_URL=postgres://... pnpm probe
 *   (DATABASE_URL 取自 apps/frontend/.env 的 NUXT_DATABASE_URL —— 只读 reports.content
 *    用来判定某条删除是否真的落进了成品；不写库)
 */
import { readFileSync, existsSync } from 'node:fs';
import postgres from 'postgres';
import { splitBriefBlocks } from '../../src/utils/block-consistency.js';
import { inSource, isBadDelete } from '../../src/utils/grounded-edits.js';
import { rankSourcesByRelevance } from '../../src/services/faithfulness-prompts.js';

const CACHE = new URL('../../../../scripts/eval/rarr-deletion/.cache/', import.meta.url).pathname;
const CANDIDATES_PATH = '/Users/shiwenjie/.claude/jobs/a83191cc/tmp/rarr-candidates.json';

const RUNS: { wf: string; report: number }[] = [
  { wf: 'admin-brief-1788058777778', report: 76 },
  { wf: 'admin-brief-1788170117190', report: 78 },
];

// ---- 抄 scan.ts 的 归档读取 / token 覆盖率 逻辑，不重新发明 ----

function loadCache(key: string): any | null {
  const file = `${CACHE}${key.replace(/\//g, '_')}`;
  if (!existsSync(file)) return null;
  const txt = readFileSync(file, 'utf-8').replace(/\x1b\[[0-9;]*m/g, '');
  const i = txt.indexOf('{');
  if (i < 0) return null;
  try {
    return JSON.parse(txt.slice(i));
  } catch {
    return null;
  }
}

const STOP = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'had', 'was', 'were', 'been', 'are', 'its',
  'their', 'they', 'them', 'not', 'but', 'all', 'any', 'has', 'which', 'who', 'when', 'where', 'while', 'after',
  'before', 'into', 'over', 'under', 'about', 'than', 'then', 'also', 'such', 'only', 'more', 'most', 'some',
  'other', 'said', 'says', 'would', 'could', 'should', 'may', 'might', 'must', 'his', 'her', 'she', 'him', 'you',
  'out', 'off', 'per', 'via', 'due', 'both', 'each', 'one', 'two',
]);

/** span 里的实词有多少在源里（逐 token，忽略停用词/短词）。原样照抄 scan.ts::tokenCoverage */
function tokenCoverage(span: string, source: string): { cov: number; missing: string[] } {
  const src = source.toLowerCase();
  const toks = [
    ...new Set(
      (span.toLowerCase().match(/[a-z0-9][a-z0-9'’.\-]*/g) ?? [])
        .map((t) => t.replace(/[.'’\-]+$/, ''))
        .filter((t) => (t.length >= 4 || /\d/.test(t)) && !STOP.has(t))
    ),
  ];
  if (!toks.length) return { cov: 1, missing: [] };
  const missing = toks.filter(
    (t) => !new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(src)
  );
  return { cov: 1 - missing.length / toks.length, missing };
}

// ---- 已知阳性（9 条人工确认的误删）----

interface KnownPositive {
  id: string;
  report: number;
  block: number;
  span: string;
}
const known: KnownPositive[] = JSON.parse(readFileSync(CANDIDATES_PATH, 'utf-8')).map((c: any) => ({
  id: c.id,
  report: Number(c.id.match(/R(\d+)-/)?.[1]),
  block: c.block,
  span: c.deleted_span,
}));

function matchKnown(report: number, blk: number, span: string): KnownPositive | undefined {
  return known.find((k) => k.report === report && k.block === blk && k.span.trim() === span.trim());
}

// ---- 每条「被应用的删除」+ 三种 source 口径 ----

interface Row {
  report: number;
  blk: number;
  blockTitle: string;
  span: string;
  reason: string;
  full: string;
  top3: string;
  own: string;
}

async function loadRows(wf: string, reportId: number): Promise<Row[]> {
  const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
  const [rep] = await sql`SELECT content FROM reports WHERE id = ${reportId}`;
  await sql.end();
  if (!rep) throw new Error(`reports.id=${reportId} 不存在`);
  const finalBlocks = splitBriefBlocks(rep.content);
  const finalByTitle = new Map(finalBlocks.map((b) => [b.title.toLowerCase().trim(), b.text]));

  const rows: Row[] = [];
  for (let i = 0; i < 25; i++) {
    const w = loadCache(`llm-calls/${wf}/brief_generation-${String(100 + i).padStart(3, '0')}.json`);
    if (!w?.response?.content) continue;
    const lastWriteMsg = w.request.messages.at(-1).content;
    const ownSource: string = lastWriteMsg.match(/<curated_news_data>([\s\S]*?)<\/curated_news_data>/)?.[1] ?? '';
    const title = (lastWriteMsg.match(/already has its title: \*\*(.+?)\*\*/)?.[1] ?? '').trim();
    const final = finalByTitle.get(title.toLowerCase());

    const v = loadCache(`llm-calls/${wf}/brief_generation-${String(200 + i).padStart(3, '0')}.json`);
    if (!v?.response?.content) continue;
    const lastVerifyMsg = v.request.messages.at(-1).content;
    const fullSource: string = lastVerifyMsg.match(/<curated_news_data>([\s\S]*?)<\/curated_news_data>/)?.[1] ?? '';
    const stories = fullSource
      .split(/(?=# \[story \d+\/25\])/)
      .map((s: string) => s.trim())
      .filter(Boolean);

    let edits: any[] = [];
    try {
      edits = JSON.parse(v.response.content.match(/\{[\s\S]*\}/)?.[0] ?? '{}').edits ?? [];
    } catch {
      /* 解析失败=当无编辑，与 scan.ts 一致 */
    }

    const delEdits = edits.filter((e: any) => (e?.replacement ?? '') === '' && typeof e?.brief_span === 'string');
    for (const e of delEdits) {
      const applied = final !== undefined && !final.includes(e.brief_span);
      if (!applied) continue; // 只看真正落到成品上的删除
      const top3idx = rankSourcesByRelevance(e.brief_span, stories, 3);
      const top3 = top3idx.map((idx) => stories[idx]).join('\n\n');
      rows.push({
        report: reportId,
        blk: i,
        blockTitle: title,
        span: e.brief_span,
        reason: String(e.reason ?? ''),
        full: fullSource,
        top3,
        own: ownSource,
      });
    }
  }
  return rows;
}

// ---- 主流程 ----

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('要 DATABASE_URL=postgres://...（取自 apps/frontend/.env 的 NUXT_DATABASE_URL）');

  const rows: Row[] = [];
  for (const r of RUNS) rows.push(...(await loadRows(r.wf, r.report)));

  console.log(`\n加载完成：被应用的删除共 ${rows.length} 条（两期合计），已知误删 ${known.length} 条`);

  const FLAVORS: { name: string; get: (r: Row) => string }[] = [
    { name: '现状(全量25份)', get: (r) => r.full },
    { name: 'top-3', get: (r) => r.top3 },
    { name: 'own(自己那1份)', get: (r) => r.own },
  ];
  const THRESHOLDS = [1.0, 0.9, 0.8];

  // 预计算每行 x 每口径的 tokenCoverage，后面复用
  const cov = new Map<string, Map<string, { cov: number; missing: string[] }>>(); // flavor -> rowKey -> coverage
  const rowKey = (r: Row) => `${r.report}:${r.blk}:${r.span}`;
  for (const fl of FLAVORS) {
    const m = new Map<string, { cov: number; missing: string[] }>();
    for (const r of rows) m.set(rowKey(r), tokenCoverage(r.span, fl.get(r)));
    cov.set(fl.name, m);
  }

  // ---- 自检：own + 100% 阈值必须 9/9 命中已知阳性 ----
  console.log(`\n${'='.repeat(80)}\n自检：own 口径 + 100% 阈值应拦下全部 9 条已知误删\n${'='.repeat(80)}`);
  const ownCov = cov.get('own(自己那1份)')!;
  let selfCheckHits = 0;
  for (const k of known) {
    const r = rows.find((r) => r.report === k.report && r.blk === k.block && r.span.trim() === k.span.trim());
    if (!r) {
      console.log(`  ✗ ${k.id} 在「被应用的删除」集合里找不到对应行（report=${k.report} blk=${k.block}）`);
      continue;
    }
    const c = ownCov.get(rowKey(r))!;
    const hit = c.cov >= 1.0;
    if (hit) selfCheckHits++;
    console.log(`  ${hit ? '✓' : '✗'} ${k.id}  own_tokCov=${(c.cov * 100).toFixed(0)}%  missing=[${c.missing.join(', ')}]`);
  }
  console.log(`\n  自检结果：${selfCheckHits}/${known.length}`);
  if (selfCheckHits !== known.length) {
    console.log('  ⚠️ 未 9/9 命中 —— 说明本原型实现与参考数据的筛选逻辑不一致，下面读数仅供参考，需先排查再采信。');
  }

  // ---- 表 1 + 表 2：3 口径 x 3 阈值 ----
  console.log(`\n${'='.repeat(80)}\n表 1 + 表 2：3 口径 x 3 阈值 —— 拦下几条 / 总共几条，其中命中已知阳性几条\n${'='.repeat(80)}`);
  const blockedSets = new Map<string, Row[]>(); // "flavor@threshold" -> blocked rows
  for (const fl of FLAVORS) {
    const m = cov.get(fl.name)!;
    console.log(`\n  [${fl.name}]`);
    for (const th of THRESHOLDS) {
      const blocked = rows.filter((r) => m.get(rowKey(r))!.cov >= th);
      blockedSets.set(`${fl.name}@${th}`, blocked);
      const knownHits = blocked.filter((r) => matchKnown(r.report, r.blk, r.span));
      console.log(
        `    阈值≥${(th * 100).toFixed(0)}%：拦下 ${String(blocked.length).padStart(2)}/${rows.length}` +
          `　命中已知阳性 ${knownHits.length}/${known.length}`
      );
    }
  }

  // ---- 表 3：现行 isBadDelete 在三种口径下各拦下几条 ----
  console.log(`\n${'='.repeat(80)}\n表 3：现行 isBadDelete（整段逐字）在三种口径下各拦下几条\n${'='.repeat(80)}`);
  for (const fl of FLAVORS) {
    const n = rows.filter((r) => isBadDelete(r.span, '', fl.get(r))).length;
    console.log(`  [${fl.name}]  isBadDelete 拦下 ${n}/${rows.length}`);
  }
  // 顺带验一下 inSource 本身没坏（应该跟 isBadDelete 结果一致，因为 isBadDelete = inSource when replacement=''）
  for (const fl of FLAVORS) {
    const n = rows.filter((r) => inSource(r.span, fl.get(r))).length;
    console.log(`  [${fl.name}]  inSource（整段逐字）命中 ${n}/${rows.length}（应与上面一致）`);
  }

  // ---- 表 4：被拦下但不在已知 9 条里的新候选，逐条打印待人工判定 ----
  console.log(`\n${'='.repeat(80)}\n表 4：拦下但不在已知 9 条里的新候选（待人工判定，不下结论）\n${'='.repeat(80)}`);
  for (const fl of FLAVORS) {
    for (const th of THRESHOLDS) {
      const blocked = blockedSets.get(`${fl.name}@${th}`)!;
      const novel = blocked.filter((r) => !matchKnown(r.report, r.blk, r.span));
      console.log(`\n  [${fl.name} ≥${(th * 100).toFixed(0)}%]  新候选 ${novel.length} 条`);
      for (const r of novel) {
        console.log(`    R${r.report} blk${r.blk} | span: "${r.span.slice(0, 70).replace(/\s+/g, ' ')}${r.span.length > 70 ? '…' : ''}"`);
        console.log(`             reason: "${r.reason.slice(0, 140).replace(/\s+/g, ' ')}"`);
      }
    }
  }

  console.log(`\n${'='.repeat(80)}\n结束。以上读数为真实运行结果，判据"精度"未下结论——只有 9 条已知阳性有人工标签，其余标"未判定"。\n${'='.repeat(80)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
