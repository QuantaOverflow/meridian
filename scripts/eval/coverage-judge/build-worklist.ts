// ============================================================================
// build-worklist —— 忠实重建判官(reconcileCoverage)在生产里看到的输入，并跑决定论对齐尺
//
// 母集团：到达合成层的 story = brief_stories.selected_for_intel 且 intel_report_r2_key 非空
//   （选中但分析静默失败 = 无报告 = 未进 reports[] = 不在判官对账范围，正确排除）。
// 忠实点（对齐生产）：
//   - 顺序：analysisData 顺 = intel step results 顺 = storiesForIntelligence 顺 = R2 key idx 昇顺。
//     故按 intel_report_r2_key 里的数字 idx 昇序排 → S1..Sn 与生产一致（位置偏置最小化）。
//   - 标签：label = executiveSummary.replace(/\s+/g,' ').trim().slice(0,160)（与 brief-generation.ts 完全一致）。
//   - storyList：`[S{i+1}] label` 换行拼接（与 reconcileCoverage 完全一致）。
//
// 产出：
//   worklist/<wf>.json  —— 每 brief 的判官输入 fixture（storyList + brief + story↔storyId 映射）
//   worklist.jsonl      —— 每条 story 一行 + 决定论对齐票（det_disposition/score/hits）
//
// 用法：DATABASE_URL=... tsx build-worklist.ts
// ============================================================================
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { alignDisposition, segmentBrief, type Disposition } from './align.js';

const execFileP = promisify(execFile);

const BUCKET = 'meridian-articles-prod';
const WORKFLOWS = [
  'admin-brief-1782370673032',
  'admin-brief-1782322639966',
  'admin-brief-1782204768600',
  'admin-brief-1781007434068',
  'admin-brief-1780662961660',
  'admin-brief-1780554095183',
  'admin-brief-1780494276570',
  'admin-brief-1780036335731',
];

const sql = postgres(process.env.DATABASE_URL || '', { max: 1 });
const CACHE_DIR = '.r2cache';
const CONCURRENCY = Number(process.env.R2_CONCURRENCY ?? '6');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// R2 取对象：磁盘缓存（幂等，重跑跳过成功项）+ 重试（代理网络不稳，单 blip 不该丢 story）。
// 关键：重试后仍失败 → 返回 null，调用方据此**硬失败中止**，绝不静默 skip（否则母集团缺口无声）。
async function r2Get(key: string): Promise<string | null> {
  const cacheFile = `${CACHE_DIR}/${key.replace(/[^A-Za-z0-9]+/g, '_')}`;
  if (existsSync(cacheFile)) {
    const c = readFileSync(cacheFile, 'utf8');
    if (c.trim()) return c;
  }
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const { stdout } = await execFileP(
        'npx',
        ['wrangler', 'r2', 'object', 'get', `${BUCKET}/${key}`, '--pipe', '--remote'],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
      );
      if (stdout && stdout.trim()) {
        writeFileSync(cacheFile, stdout);
        return stdout;
      }
    } catch {
      /* retry */
    }
    if (attempt < 5) await sleep(1000 * attempt);
  }
  return null;
}

// 限并发跑 fetch 任务（execFile 非阻塞，池化把 112 串行 ~20min 压到 ~3-4min）
async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// intel_report_r2_key = intel-reports/<wf>/<idx>.json → 取 idx（决定生产里的 S 顺序）
function keyIdx(key: string): number {
  const m = /\/(\d+)\.json$/.exec(key);
  return m ? Number(m[1]) : 1e9;
}

interface StoryRow {
  sid: string; // S1..Sn
  storyId: string | number;
  cluster_id: number;
  title: string;
  label: string; // executiveSummary[:160]（判官实际看到的短标题）
  r2_idx: number;
  r2_key: string;
  det: { disposition: Disposition; score: number; hits: string[] };
}

async function main() {
  mkdirSync('worklist', { recursive: true });
  mkdirSync(CACHE_DIR, { recursive: true });
  const worklistRows: any[] = [];
  let totalStories = 0;
  const fetchFailures: string[] = [];

  for (const wf of WORKFLOWS) {
    const [run] = await sql`
      SELECT r.content AS brief
      FROM brief_runs br LEFT JOIN reports r ON r.id = br.report_id
      WHERE br.workflow_id = ${wf}`;
    if (!run?.brief) {
      console.error(`✗ ${wf}: 无简报正文，跳过`);
      continue;
    }
    const brief = run.brief as string;

    const stories = await sql`
      SELECT cluster_id, title, intel_report_r2_key
      FROM brief_stories
      WHERE workflow_id = ${wf} AND selected_for_intel = true AND intel_report_r2_key IS NOT NULL`;

    // 按 R2 key idx 昇序（= 生产 reports[] 顺序）
    const ordered = stories
      .map((s: any) => ({ ...s, idx: keyIdx(s.intel_report_r2_key as string) }))
      .sort((a: any, b: any) => a.idx - b.idx);

    const blocks = segmentBrief(brief);

    // 并发取所有 intel report（缓存+重试）
    const raws = await pool(ordered, CONCURRENCY, (s: any) => r2Get(s.intel_report_r2_key as string));

    const rows: StoryRow[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const s = ordered[i];
      const raw = raws[i];
      if (!raw) {
        // 重试后仍失败：记下并硬失败中止（绝不静默 skip → 保母集团完整）
        fetchFailures.push(`${wf} ${s.intel_report_r2_key}`);
        continue;
      }
      let execSummary = '';
      let storyId: string | number = s.cluster_id;
      try {
        const j = JSON.parse(raw);
        // 忠实复现 index.ts:463 的 IntelligenceReport 映射兜底链：判官在生产里看到的是映射后的
        // executiveSummary，旧 schema 报告(仅 overview/summary)会被兜到 overview。直读生 R2 会得空 label。
        execSummary = j.executiveSummary || j.overview || j.summary || '发展概述';
        storyId = j.storyId ?? s.cluster_id;
      } catch {
        fetchFailures.push(`${wf} ${s.intel_report_r2_key} (JSON 解析失败)`);
        continue;
      }
      // 与 brief-generation.ts reconcileCoverage 完全一致的 label 公式
      const label = execSummary.replace(/\s+/g, ' ').trim().slice(0, 160);
      const sid = `S${rows.length + 1}`;
      const det = alignDisposition(label, blocks);
      rows.push({
        sid,
        storyId,
        cluster_id: s.cluster_id as number,
        title: s.title as string,
        label,
        r2_idx: s.idx,
        r2_key: s.intel_report_r2_key as string,
        det: { disposition: det.disposition, score: det.score, hits: det.hits },
      });
    }

    // storyList 字符串（与 reconcileCoverage 完全一致）
    const storyList = rows.map((r) => `[${r.sid}] ${r.label}`).join('\n');
    writeFileSync(
      `worklist/${wf}.json`,
      JSON.stringify({ workflow_id: wf, brief, storyList, stories: rows }, null, 2)
    );

    for (const r of rows) {
      worklistRows.push({
        id: `${wf}#${r.sid}`,
        workflow_id: wf,
        sid: r.sid,
        storyId: r.storyId,
        cluster_id: r.cluster_id,
        title: r.title,
        label: r.label,
        det_disposition: r.det.disposition,
        det_score: Number(r.det.score.toFixed(2)),
        det_hits: r.det.hits,
      });
    }
    totalStories += rows.length;
    const n = (d: Disposition) => rows.filter((r) => r.det.disposition === d).length;
    console.log(
      `${wf}: ${rows.length} story → 决定论对齐 headline ${n('headline')} / noteworthy ${n('noteworthy')} / dropped ${n('dropped')}`
    );
  }

  await sql.end();

  // 硬失败：任何 R2 取报告失败即中止（母集团缺口无声 = 判官 precision 会被算错）。
  // 缓存已落盘，直接重跑本脚本即可只补失败项。
  if (fetchFailures.length) {
    console.error(`\n❌ ${fetchFailures.length} 份 intel report 取报告失败（重试后仍失败）：`);
    for (const f of fetchFailures) console.error(`   - ${f}`);
    console.error('母集团不完整，已中止。缓存已落盘，重跑本脚本只补失败项。');
    process.exit(1);
  }

  writeFileSync('worklist.jsonl', worklistRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\n✅ ${totalStories} story-disposition 组 → worklist.jsonl + worklist/<wf>.json`);
}

main().catch((e) => {
  console.error('build-worklist 失败:', e);
  process.exit(1);
});
