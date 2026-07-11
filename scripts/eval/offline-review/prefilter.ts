/**
 * 离线预筛 —— 「线上只标记、离线审阅」闭环的第一步（方向定案见 memory:
 * intel-grounding-judge-validated 2026-07-11）
 *
 * 干什么：把攒下来的线上简报批量过一遍 qwen 全量判官（mode=full，即原线上门的
 * LLM 判官，现已撤到离线按需跑），产出一份「待审清单」worklist.jsonl——
 * 这份清单就是 Claude(session 判官) 盲判的输入，把几千条 claim 压到一两百条。
 *
 * 清单构成（按预筛口径，见 memory 预筛指标结论）：
 *   - flagged 全集：qwen 判 unsupported/contradicted 的（二元 flagged 召回 ~83%）
 *     + 条款 C 代码坐实冲突（code_verified，基本无需复核，直接进归因）
 *   - audit 抽样：从 supported 堆按 wf_id 种子确定性抽 AUDIT_RATE——预筛器的
 *     系统性盲区（极性类被盖章 supported）唯一的兜底通道
 *
 * 数据通路（同 error-analysis/assemble-trace）：
 *   简报 = Neon reports.content（brief_runs.report_id → reports）
 *   源   = R2 brief_stories.intel_report_r2_key（wrangler r2 get --remote）
 *
 * 用法：
 *   cd services/meridian-ai-worker && pnpm wrangler dev --port 8787   # 判官打本地 worker
 *   DATABASE_URL=postgres://... AI_WORKER_URL=http://localhost:8787 \
 *     pnpm prefilter [--days 14] [--wf <id>[,<id>...]] [--audit 0.1] [--limit 10]
 *   （DATABASE_URL 本地在 apps/frontend/.env 的 NUXT_DATABASE_URL；packages/database/.env 不存在）
 *
 * 输出：
 *   worklist/<日期>.worklist.jsonl   待审清单（盲判输入；claim+判决+理由，不含源全文）
 *   sources/<wf_id>.sources.json     源旁车（盲判时按需取，与 worklist 分离防金标污染）
 * 两者都 gitignored；盲判定稿的标注沉淀到 gold/ 才进 git。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import postgres from 'postgres';

const AI_WORKER_URL = process.env.AI_WORKER_URL || 'http://localhost:8787';
const BUCKET = 'meridian-articles-prod';
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'qwen-max';

// ---- 参数 ----
const args = process.argv.slice(2);
function argOf(flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}
const DAYS = Number(argOf('--days') ?? '14');
const WF_LIST = argOf('--wf')?.split(',').filter(Boolean) ?? null;
const AUDIT_RATE = Number(argOf('--audit') ?? '0.1');
const LIMIT = Number(argOf('--limit') ?? '10');

// ---- 确定性抽样：wf_id+claim id 做种子，复跑同一批结果一致（可复现审计） ----
function seededPick(key: string, rate: number): boolean {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // murmur3 终混：裸 FNV 对"长共享前缀+短变化后缀"雪崩不足（实测 0/200 命中 10% 抽样），
  // 终混把尾字节熵扩散到全 32 位后分布才均匀。
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff < rate;
}

function r2Get(key: string): string | null {
  try {
    return execFileSync(
      'npx',
      ['wrangler', 'r2', 'object', 'get', `${BUCKET}/${key}`, '--pipe', '--remote'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch {
    return null;
  }
}

interface WorkItem {
  id: string; // <wf_id>#<claim_id>
  wf_id: string;
  kind: 'flagged' | 'audit';
  claim: string;
  qwen_verdict: string;
  qwen_reason: string;
  code_verified: boolean;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('需 DATABASE_URL（见 packages/database/.env）');
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });

  // 1. 选 run：显式 --wf 或最近 N 天成功 run
  const runs: { workflow_id: string; report_id: number }[] = WF_LIST
    ? await sql`SELECT workflow_id, report_id FROM brief_runs WHERE workflow_id IN ${sql(WF_LIST)} AND report_id IS NOT NULL`
    : await sql`SELECT workflow_id, report_id FROM brief_runs
                WHERE report_id IS NOT NULL AND started_at > now() - ${DAYS + ' days'}::interval
                ORDER BY started_at DESC LIMIT ${LIMIT}`;
  console.log(`[prefilter] 选中 ${runs.length} 个 run（${WF_LIST ? '--wf 显式指定' : `最近 ${DAYS} 天，上限 ${LIMIT}`}）`);
  if (!runs.length) {
    await sql.end();
    return;
  }

  mkdirSync('worklist', { recursive: true });
  mkdirSync('sources', { recursive: true });

  const worklist: WorkItem[] = [];
  const stats = { runs: 0, claims: 0, flagged: 0, code: 0, audit: 0, skipped: [] as string[] };

  for (const run of runs) {
    const wf = run.workflow_id;
    // 2. 简报正文
    const reportRows = await sql`SELECT content FROM reports WHERE id = ${run.report_id}`;
    const brief = reportRows[0]?.content;
    if (!brief) {
      stats.skipped.push(`${wf}(无简报)`);
      continue;
    }
    // 3. 各故事源（情报报告，per-story 拆分与线上门同形）
    const storyRows = await sql`SELECT cluster_id, intel_report_r2_key FROM brief_stories
                                WHERE workflow_id = ${wf} AND intel_report_r2_key IS NOT NULL`;
    const sources = storyRows
      .map((r) => ({ storyId: String(r.cluster_id), content: r2Get(r.intel_report_r2_key) }))
      .filter((s): s is { storyId: string; content: string } => !!s.content);
    if (!sources.length) {
      stats.skipped.push(`${wf}(无源)`);
      continue;
    }

    // 4. qwen 全量判官（mode=full 返回 all_factual 含 supported，供审计抽样）
    console.log(`  [${wf}] brief ${brief.length} chars / ${sources.length} 源，跑判官...`);
    const resp = await fetch(`${AI_WORKER_URL}/meridian/faithfulness-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources, brief, options: { model: JUDGE_MODEL, mode: 'full' } }),
    });
    if (!resp.ok) {
      stats.skipped.push(`${wf}(判官 HTTP ${resp.status})`);
      continue;
    }
    const data = (await resp.json()) as any;
    const all: any[] = data?.data?.all_factual ?? [];
    if (!all.length) {
      stats.skipped.push(`${wf}(判官空返)`);
      continue;
    }

    // 5. 组装：flagged 全集 + supported 确定性审计抽样
    for (const j of all) {
      const itemId = `${wf}#${j.claim.id}`;
      const isFlagged = j.verdict !== 'supported';
      const isAudit = !isFlagged && seededPick(itemId, AUDIT_RATE);
      if (!isFlagged && !isAudit) continue;
      worklist.push({
        id: itemId,
        wf_id: wf,
        kind: isFlagged ? 'flagged' : 'audit',
        claim: j.claim.text,
        qwen_verdict: j.verdict,
        qwen_reason: (j.reason || '').slice(0, 300),
        code_verified: !!j.code_verified,
      });
      if (isFlagged) stats.flagged++;
      if (j.code_verified) stats.code++;
      if (isAudit) stats.audit++;
    }
    stats.claims += all.length;
    stats.runs++;
    // 源旁车：盲判按 wf 取用（与清单分离，判官先不看 qwen 理由之外的东西可自行控制）
    writeFileSync(`sources/${wf}.sources.json`, JSON.stringify({ wf_id: wf, sources }, null, 2));
  }
  await sql.end();

  const stamp = new Date().toISOString().slice(0, 10);
  const out = `worklist/${stamp}.worklist.jsonl`;
  writeFileSync(out, worklist.map((w) => JSON.stringify(w)).join('\n') + '\n');

  console.log(`\n[prefilter] ${stats.runs} run / ${stats.claims} claims → 待审 ${worklist.length} 条`);
  console.log(`  flagged=${stats.flagged}（其中代码坐实 ${stats.code}）+ audit=${stats.audit}（supported 抽样率 ${AUDIT_RATE}）`);
  if (stats.skipped.length) console.log(`  跳过: ${stats.skipped.join(', ')}`);
  console.log(`  清单 → ${out}（源旁车 → sources/<wf>.sources.json）`);
  console.log(`  下一步：开 Claude session 盲判（协议见 memory: intel-grounding-judge-validated 07-09 先例）`);
}

main().catch((e) => {
  console.error('prefilter 失败:', e);
  process.exit(1);
});
