// ============================================================================
// 扔掉型原型（prototype，不进生产）—— 只回答一个问题：
//
//   把 RARR 接地校验的 oracle 从「全部 25 份情报报告」收窄到
//   rankSourcesByRelevance(claim, reports, k) 检索出的 top-k 份，
//   已确认误删的支持证据，还留不留在 top-k 里？
//
// 如果收窄会把该保留的证据挤出 top-k，这个修法就会制造新的误删，不能做。
//
// 背景：RARR 接地校验现状把全部 25 份报告（约 110,000 字符）塞进一次 prompt，
// 核对一个块的正文并吐编辑表。两期已应用的删除里，9 条已由独立复核确认是把
// 「源里明明有的内容」判成 unsupported 误删——本原型验证「收窄 oracle」这个修
// 法本身是否安全，不改判官 prompt、不改判定逻辑。
//
// 数据来源：scripts/eval/rarr-deletion/.cache/ 里两期 workflow 落盘的 llm-calls
// （写作调用 100-124、校验调用 200-224）。文件开头有 wrangler 横幅，须从第一个
// '{' 截断才能 JSON.parse——本文件已处理。9 条已确认误删的关键字段（id/report/
// block/span）来自独立复核清单（原路径在会话临时目录，不保证持久，故内嵌于此）。
//
// 跑法：
//   cd services/meridian-ai-worker/prototypes/rarr-retrieval
//   pnpm i --ignore-workspace
//   pnpm probe
//
// 不打网络、不读 Neon、不改生产代码、不 git commit。
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rankSourcesByRelevance } from '../../src/services/faithfulness-prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../../../../scripts/eval/rarr-deletion/.cache');

const WORKFLOWS: Array<{ wf: string; report: 76 | 78 }> = [
  { wf: 'admin-brief-1788058777778', report: 76 },
  { wf: 'admin-brief-1788170117190', report: 78 },
];

// 9 条已确认误删（逐条人工核实过引文，支持证据都在该块「自己那份」报告里）。
const CONFIRMED_MISDELETIONS: Array<{ id: string; report: 76 | 78; block: number; span: string }> = [
  {
    id: 'R76-1',
    report: 76,
    block: 21,
    span: "initially, the country declined offers from multiple countries for search and rescue teams, citing its own security agencies' capability and past coordination issues.",
  },
  {
    id: 'R76-2',
    report: 76,
    block: 21,
    span: "india is also sending a medical team, and the latest consignment takes india's total relief assistance to nepal to 57.5 tonnes since august 26.",
  },
  {
    id: 'R76-3',
    report: 76,
    block: 4,
    span: 'the associated press reported on-the-ground efforts in nuwakot, where nongovernmental organizations distributed solar panels, clothes, and basic hygienic goods at a school being used as a temporary aid center.',
  },
  { id: 'R76-4', report: 76, block: 3, span: 'including 90 us citizens' },
  {
    id: 'R78-1',
    report: 78,
    block: 15,
    span: "congress restored the agency's 2026 funding level to $24.4bn.",
  },
  {
    id: 'R78-2',
    report: 78,
    block: 7,
    span: "as the widow of the church's founder, sun myung moon",
  },
  {
    id: 'R78-3',
    report: 78,
    block: 11,
    span: 'algeria provided military support, including fighter jets and transport aircraft',
  },
  { id: 'R78-4', report: 78, block: 0, span: 'legal proceedings, scheduled to begin june 1, 2027' },
  { id: 'R78-5', report: 78, block: 6, span: 'on a sunday afternoon' },
];

// ---------------------------------------------------------------------------
// 落盘 llm-calls 解析
// ---------------------------------------------------------------------------

function parseCallFile(filePath: string): any {
  const raw = readFileSync(filePath, 'utf-8');
  const i = raw.indexOf('{');
  if (i < 0) throw new Error(`no JSON found in ${filePath}`);
  return JSON.parse(raw.slice(i));
}

function extractCurated(content: string): string {
  const s = content.indexOf('<curated_news_data>');
  const e = content.indexOf('</curated_news_data>');
  if (s < 0 || e < 0) throw new Error('curated_news_data tag not found in message content');
  return content.slice(s + '<curated_news_data>'.length, e).trim();
}

interface DeleteEdit {
  block: number;
  span: string;
  reason: string;
}

function loadWorkflow(wf: string): { reports: string[]; drafts: string[]; deleteEdits: DeleteEdit[] } {
  const reports: string[] = new Array(25).fill('');
  const drafts: string[] = new Array(25).fill('');
  for (let i = 100; i <= 124; i++) {
    const f = path.join(CACHE_DIR, `llm-calls_${wf}_brief_generation-${i}.json`);
    const d = parseCallFile(f);
    const blockIdx = i - 100;
    const content = d.request.messages.at(-1).content as string;
    reports[blockIdx] = extractCurated(content);
    drafts[blockIdx] = d.response.content as string;
  }

  const deleteEdits: DeleteEdit[] = [];
  for (let i = 200; i <= 224; i++) {
    const f = path.join(CACHE_DIR, `llm-calls_${wf}_brief_generation-${i}.json`);
    const d = parseCallFile(f);
    const blockIdx = i - 200;
    const respContent = d.response.content as string;
    const m = respContent.match(/```json\s*([\s\S]*?)```/);
    if (!m) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue; // 少数响应被 max_tokens 截断，JSON 解不出来——跳过，计入下方口径说明
    }
    for (const edit of parsed.edits ?? []) {
      if (edit.replacement === '') {
        deleteEdits.push({ block: blockIdx, span: edit.brief_span, reason: edit.reason });
      }
    }
  }
  return { reports, drafts, deleteEdits };
}

// ---------------------------------------------------------------------------
// 诊断用：本地复刻 rankSourcesByRelevance 的打分逻辑（仅用于打印分数明细，
// 不参与任何判定——判定全部走生产函数 rankSourcesByRelevance 本身）。
// 逻辑与 faithfulness-prompts.ts 内的实现逐行一致（该文件未导出内部函数）。
// ---------------------------------------------------------------------------
const STOP = new Set(
  'the a an of to in on for and or but with by at from as is are was were be been being this that these those it its their his her over under into than then per via amid has have had will would on off out up down new'.split(
    ' '
  )
);
function contentWords(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter((w) => !STOP.has(w)));
}
function scoreBreakdown(claim: string, sourceTexts: string[]) {
  const claimWords = contentWords(claim);
  const entities = new Set(
    (claim.match(/[A-Z][A-Za-z'-]{2,}/g) || []).map((w) => w.toLowerCase()).filter((w) => !STOP.has(w))
  );
  return sourceTexts.map((src, i) => {
    const sw = contentWords(src);
    let entHits = 0;
    for (const e of entities) if (sw.has(e)) entHits++;
    let overlap = 0;
    for (const w of claimWords) if (sw.has(w)) overlap++;
    return { i, entHits, overlap, score: entHits * 3 + overlap };
  });
}
function fullRank(claim: string, sourceTexts: string[]): number[] {
  return rankSourcesByRelevance(claim, sourceTexts, sourceTexts.length);
}

// ---------------------------------------------------------------------------
// 主实验
// ---------------------------------------------------------------------------

type Method = 'A_draft' | 'B_span';
const KS = [1, 3, 5];

interface Instance {
  reportLabel: 76 | 78;
  block: number;
  span: string;
  draft: string;
}

function main() {
  const perWf: Record<string, ReturnType<typeof loadWorkflow>> = {};
  for (const { wf } of WORKFLOWS) {
    perWf[wf] = loadWorkflow(wf);
  }

  console.log('='.repeat(78));
  console.log('装配结果');
  console.log('='.repeat(78));
  for (const { wf, report } of WORKFLOWS) {
    const { reports, deleteEdits } = perWf[wf];
    const totalChars = reports.reduce((a, r) => a + r.length, 0);
    console.log(
      `report ${report} (${wf}): 25 份报告合计 ${totalChars} 字符, 全部删除型 edit 数 = ${deleteEdits.length}`
    );
  }

  // 口径说明
  console.log();
  console.log(
    '口径：「被应用的删除」用「全部删除型 edit（replacement === ""）」代替「成品块里确认消失的 span」——'
  );
  console.log('未接 Neon 查 reports.content 做二次确认，此为退而求其次口径（任务说明里允许的 fallback）。');

  // ---- 表 1：命中率 ----
  const instances: Record<76 | 78, Instance[]> = { 76: [], 78: [] };
  for (const { wf, report } of WORKFLOWS) {
    const { drafts, deleteEdits } = perWf[wf];
    for (const e of deleteEdits) {
      instances[report].push({ reportLabel: report, block: e.block, span: e.span, draft: drafts[e.block] });
    }
  }

  console.log();
  console.log('='.repeat(78));
  console.log('表 1：命中率 = 自己那份报告落在 top-k 的比例');
  console.log('（方式 A = 整块草稿当 claim；方式 B = 被删的 span 当 claim）');
  console.log('='.repeat(78));
  console.log('report | method | k=1   | k=3   | k=5   | n');
  for (const report of [76, 78] as const) {
    const { reports } = perWf[WORKFLOWS.find((w) => w.report === report)!.wf];
    const list = instances[report];
    for (const method of ['A_draft', 'B_span'] as Method[]) {
      const rates = KS.map((k) => {
        let hit = 0;
        for (const inst of list) {
          const claim = method === 'A_draft' ? inst.draft : inst.span;
          const top = rankSourcesByRelevance(claim, reports, k);
          if (top.includes(inst.block)) hit++;
        }
        return list.length === 0 ? NaN : hit / list.length;
      });
      console.log(
        `${report}    | ${method} | ${rates.map((r) => (r * 100).toFixed(1).padStart(5)).join(' | ')} | n=${list.length}`
      );
    }
  }

  // ---- 表 2：9 条已确认误删逐条排名 ----
  console.log();
  console.log('='.repeat(78));
  console.log('表 2：9 条已确认误删——自己那份报告在两种方式下的排名（第几名，1-based）');
  console.log('='.repeat(78));
  for (const c of CONFIRMED_MISDELETIONS) {
    const { reports, drafts } = perWf[WORKFLOWS.find((w) => w.report === c.report)!.wf];
    const draft = drafts[c.block];
    const rankA = fullRank(draft, reports);
    const rankB = fullRank(c.span, reports);
    const posA = rankA.indexOf(c.block) + 1;
    const posB = rankB.indexOf(c.block) + 1;
    const flagA = posA > 3 ? '  <<< 掉出 top-3' : '';
    const flagB = posB > 3 ? '  <<< 掉出 top-3' : '';
    console.log(`${c.id} (report ${c.report}, block ${c.block}): 方式A排名=${posA}${flagA}  方式B排名=${posB}${flagB}`);
    if (posA > 3 || posB > 3) {
      const bdA = scoreBreakdown(draft, reports).find((b) => b.i === c.block)!;
      const bdB = scoreBreakdown(c.span, reports).find((b) => b.i === c.block)!;
      console.log(
        `   分数明细 — 方式A: entHits=${bdA.entHits} overlap=${bdA.overlap} score=${bdA.score}` +
          `   方式B: entHits=${bdB.entHits} overlap=${bdB.overlap} score=${bdB.score}`
      );
      const topA = rankA.slice(0, 3).map((i) => {
        const bd = scoreBreakdown(draft, reports).find((b) => b.i === i)!;
        return `#${i}(score=${bd.score})`;
      });
      console.log(`   方式A 实际 top-3: ${topA.join(', ')}`);
    }
  }

  // ---- 表 3：oracle 体积变化 ----
  console.log();
  console.log('='.repeat(78));
  console.log('表 3：oracle 体积——25 份合计字符数 vs top-3 合计字符数（按方式A排 top-3，逐条删除实例）');
  console.log('='.repeat(78));
  for (const report of [76, 78] as const) {
    const { reports } = perWf[WORKFLOWS.find((w) => w.report === report)!.wf];
    const total25 = reports.reduce((a, r) => a + r.length, 0);
    const list = instances[report];
    const top3Sizes = list.map((inst) => {
      const top = rankSourcesByRelevance(inst.draft, reports, 3);
      return top.reduce((a, i) => a + reports[i].length, 0);
    });
    top3Sizes.sort((a, b) => a - b);
    const median = top3Sizes.length
      ? top3Sizes.length % 2 === 1
        ? top3Sizes[(top3Sizes.length - 1) / 2]
        : (top3Sizes[top3Sizes.length / 2 - 1] + top3Sizes[top3Sizes.length / 2]) / 2
      : NaN;
    console.log(
      `report ${report}: 25份合计=${total25} 字符  top-3合计中位数=${median} 字符  收窄比例≈${((1 - median / total25) * 100).toFixed(1)}%  (n=${list.length})`
    );
  }

  // ---- 自检：地板对照 ----
  console.log();
  console.log('='.repeat(78));
  console.log('自检：地板对照——把 query 换成随机另一个块的草稿，重跑命中率');
  console.log('（如果地板命中率也很高，说明 rankSourcesByRelevance 在这份数据上没有区分度）');
  console.log('='.repeat(78));
  for (const report of [76, 78] as const) {
    const { reports } = perWf[WORKFLOWS.find((w) => w.report === report)!.wf];
    const list = instances[report];
    const rates = KS.map((k) => {
      let hit = 0;
      for (const inst of list) {
        const randomBlock = (inst.block + 7) % 25 === inst.block ? (inst.block + 8) % 25 : (inst.block + 7) % 25;
        const randomClaim = perWf[WORKFLOWS.find((w) => w.report === report)!.wf].drafts[randomBlock];
        const top = rankSourcesByRelevance(randomClaim, reports, k);
        // 地板对照检验的是：拿一个跟 inst.block 无关的 query，own report(inst.block) 还会不会被误命中
        if (top.includes(inst.block)) hit++;
      }
      return list.length === 0 ? NaN : hit / list.length;
    });
    console.log(
      `report ${report} 地板（随机块草稿当 query，检验 own report 是否被误命中）: ` +
        KS.map((k, idx) => `k=${k}: ${(rates[idx] * 100).toFixed(1)}%`).join('  ')
    );
  }

  console.log();
  console.log('done.');
}

main();
