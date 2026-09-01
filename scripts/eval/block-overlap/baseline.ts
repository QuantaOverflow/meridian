/**
 * 块间内容重复 —— 基线与阈值校准 harness。
 *
 * 干什么：把 Neon `reports.content` 里已有的成品简报过一遍 `checkBlockOverlap`（确定性，
 * 零 LLM、零网络），打出**全部**块对的重合度分布，用来 (a) 拿改动前的基线，
 * (b) 定传感器阈值。
 *
 * 为什么先建尺再改 prompt：兄弟摘要劫持（写作 prompt 把同节其他块的 executiveSummary
 * 全文铺进去）目前只有单块人工对照可以验，全篇有多少重复没有任何读数。没有尺就改 prompt，
 * 改完只能靠"感觉好像好了"。这把尺能**回溯**跑在库里已有的历史简报上，拿基线不用重跑管线。
 *
 * 已知阳性（2026-08-31 人工核实，用作检测器自检——尺子抓不到它们就是尺子瞎）：
 *   report 78  "himalayan glacial collapse…" ↔ "evacuation of students…"
 *              前者整段在写后者的题材：同一所 tribhuvan trishuli 中学、同一个校长
 *              dawadi、同样的 69 所学校 / 两辆巴士 / 18 间教室三层楼
 * 已知阴性（负对照，防止阈值松到什么都报）：
 *   report 78  "king harald v dies…" ↔ "china imposes new rules on mortgage…"
 *
 * 用法：
 *   cd scripts/eval/block-overlap && pnpm i
 *   DATABASE_URL=postgres://... pnpm baseline [--ids 76,77,78] [--last 5] [--top 12]
 *   （DATABASE_URL 本地在 apps/frontend/.env 的 NUXT_DATABASE_URL）
 */
import postgres from 'postgres';
import { scoreBlockPairs, checkBlockOverlap, type BlockPairOverlap } from '../../../services/meridian-ai-worker/src/utils/block-overlap.js';
import { splitBriefBlocks } from '../../../services/meridian-ai-worker/src/utils/block-consistency.js';
import { checkZeroHitsNeedsReview, report, type HygieneIssue } from '../_shared/hygiene.js';

const args = process.argv.slice(2);
const argOf = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const IDS = argOf('--ids')?.split(',').map(Number).filter(Number.isFinite) ?? null;
const LAST = Number(argOf('--last') ?? '3');
const TOP = Number(argOf('--top') ?? '12');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('缺 DATABASE_URL（本地取 apps/frontend/.env 的 NUXT_DATABASE_URL）');

interface Row { id: number; title: string; content: string; created_at: Date }

/** 已知阳性/阴性对照：按块标题前缀找那一对，看它在不在传感器的输出里 */
function checkKnownPairs(
  reportId: number,
  brief: string,
  flagged: BlockPairOverlap[],
  positives: Array<[string, string]>,
  negatives: Array<[string, string]>
): HygieneIssue[] {
  const blocks = splitBriefBlocks(brief);
  const idxOf = (prefix: string) => blocks.findIndex((b) => b.title.toLowerCase().startsWith(prefix.toLowerCase()));
  const hit = (x: number, y: number) => flagged.some((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
  const issues: HygieneIssue[] = [];

  for (const [pa, pb] of positives) {
    const [x, y] = [idxOf(pa), idxOf(pb)];
    if (x < 0 || y < 0) {
      issues.push({ check: 'known-pair-missing', severity: 'fatal',
        message: `report ${reportId}: 对照块找不到（"${pa}" → ${x}，"${pb}" → ${y}）→ 简报内容变了或切块坏了，对照失效` });
      continue;
    }
    if (!hit(x, y)) {
      issues.push({ check: 'detector-sees', severity: 'fatal',
        message: `report ${reportId}: 已知重复对 [${x},${y}] "${pa}" ↔ "${pb}" 没被报出 → 尺子瞎，先修检测器再读基线` });
    }
  }
  for (const [pa, pb] of negatives) {
    const [x, y] = [idxOf(pa), idxOf(pb)];
    if (x < 0 || y < 0) continue;
    if (hit(x, y)) {
      issues.push({ check: 'detector-negative', severity: 'warn',
        message: `report ${reportId}: 负对照 [${x},${y}] "${pa}" ↔ "${pb}" 被误报 → 阈值太松` });
    }
  }
  return issues;
}

function pct(x: number) { return (x * 100).toFixed(0) + '%'; }

async function main() {
  const sql = postgres(DATABASE_URL!, { ssl: 'require' });
  const rows: Row[] = IDS
    ? await sql<Row[]>`SELECT id, title, content, created_at FROM reports WHERE id = ANY(${IDS}) ORDER BY id`
    : await sql<Row[]>`SELECT id, title, content, created_at FROM reports ORDER BY id DESC LIMIT ${LAST}`;

  const issues: HygieneIssue[] = [];
  let totalFlagged = 0;
  let totalPairs = 0;

  for (const r of rows) {
    const blocks = splitBriefBlocks(r.content);
    const all = scoreBlockPairs(r.content);
    const flagged = checkBlockOverlap(r.content);
    totalFlagged += flagged.length;
    totalPairs += (blocks.length * (blocks.length - 1)) / 2;

    console.log(`\n${'='.repeat(78)}`);
    console.log(`report ${r.id}  ${r.created_at.toISOString().slice(0, 10)}  ${blocks.length} 块 / ${(blocks.length * (blocks.length - 1)) / 2} 对`);
    console.log(`超阈 ${flagged.length} 对（同节 ${flagged.filter((p) => p.sameSection).length} / 跨节 ${flagged.filter((p) => !p.sameSection).length}）`);
    console.log('='.repeat(78));

    // checkBlockOverlap 内部重跑 scoreBlockPairs，返回的是另一批对象——按下标认，不能用 includes
    const flaggedKeys = new Set(flagged.map((p) => `${p.a}-${p.b}`));
    for (const p of all.slice(0, TOP)) {
      const mark = flaggedKeys.has(`${p.a}-${p.b}`) ? '▲' : ' ';
      console.log(
        `${mark} [${String(p.a).padStart(2)},${String(p.b).padStart(2)}] ${p.sameSection ? '同节' : '跨节'}` +
        ` 稀有 ${String(p.sharedRare.length).padStart(3)} / cont ${pct(p.containment).padStart(4)}` +
        ` / n-gram ${p.sharedNgrams.length}`
      );
      console.log(`    ${p.titleA.slice(0, 58)}`);
      console.log(`    ${p.titleB.slice(0, 58)}`);
      if (p.sharedRare.length) console.log(`    共享稀有词: ${p.sharedRare.slice(0, 14).join(', ')}`);
      if (p.sharedNgrams.length) console.log(`    共享 n-gram: ${p.sharedNgrams.slice(0, 3).map((g) => `"${g}"`).join(' | ')}`);
    }

    if (r.id === 78) {
      issues.push(...checkKnownPairs(78, r.content, flagged,
        [['himalayan glacial collapse', 'evacuation of students']],
        [['king harald v dies', 'china imposes new rules']]));
    }
  }

  issues.push(...checkZeroHitsNeedsReview(totalFlagged, totalPairs, '块间重复基线'));
  console.log(`\n${'='.repeat(78)}`);
  console.log(`合计：${rows.length} 期 / ${totalPairs} 对 / 超阈 ${totalFlagged} 对`);
  report(issues);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
