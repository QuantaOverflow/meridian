/**
 * A —— 全链路 trace 组装器（error-analysis 的"病历袋")
 *
 * 背景：管线各阶段观测性都做了，但没串起来（详见 memory: eval-program-landscape）。
 * 数据其实全在 DB + R2，主键 = workflow_id：
 *   ⑤ 简报   reports.content            (brief_runs.report_id → reports)
 *   ④ 情报报告 R2 intel_report_r2_key    (brief_stories.intel_report_r2_key)
 *   ③ 簇→文章 brief_stories.article_ids  (cluster_id + article_ids jsonb)
 *   ②① 文章  articles                    (id/url/质量/completeness/content_file_key)
 *   漏判侧   cluster_rejections + selected_for_intel=false
 *
 * A 只做 JOIN + 取 R2，把一条 story 的 ①→⑤ 竖切片拼成可读 markdown 供人 open-code。
 * 纯只读，不判断（判断是 error-analysis 那一步，由领域专家做）。
 *
 * 用法：
 *   DATABASE_URL=postgres://... tsx assemble-trace.ts <workflow_id> [--bodies] [--out dir]
 *   --bodies : 一并取每篇文章正文（走 wrangler r2，慢；默认只取标题/URL/质量）
 * 依赖：
 *   - DATABASE_URL（见 packages/database/.env）
 *   - wrangler 已登录 CF 账号 swj299792458（R2 取 intel report / 正文；--remote 打生产桶）
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';

const BUCKET = 'meridian-articles-prod';

const workflowId = process.argv[2];
if (!workflowId) {
  console.error('用法: tsx assemble-trace.ts <workflow_id> [--bodies] [--out <dir>]');
  process.exit(1);
}
const withBodies = process.argv.includes('--bodies');
const outIdx = process.argv.indexOf('--out');
const outDir = outIdx >= 0 ? process.argv[outIdx + 1] : null;

const sql = postgres(process.env.DATABASE_URL || '', { max: 1 });

// 从 R2 取一个对象（stdout pipe）。失败返回 null，不中断整条 trace。
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

// 情报报告 JSON → 摊平成可读 prose（executiveSummary + timeline + significance…）
function intelToProse(raw: string): string {
  try {
    const d = JSON.parse(raw);
    const parts: string[] = [];
    if (d.executiveSummary) parts.push(`  执行摘要: ${d.executiveSummary}`);
    if (d.storyStatus) parts.push(`  状态: ${d.storyStatus}`);
    if (Array.isArray(d.timeline)) parts.push(`  时间线: ${d.timeline.length} 条`);
    if (d.significance?.reasoning) parts.push(`  重要性依据: ${d.significance.reasoning}`);
    if (Array.isArray(d.contradictions) && d.contradictions.length)
      parts.push(
        `  矛盾点: ${d.contradictions
          .map((c: any) => (typeof c === 'string' ? c : c.claim || c.topic || c.description || JSON.stringify(c).slice(0, 120)))
          .join('; ')}`
      );
    return parts.join('\n');
  } catch {
    return `  [情报报告解析失败] ${raw.slice(0, 200)}`;
  }
}

async function main() {
  // ── brief_runs + 最终简报 ──────────────────────────────────────────
  const [run] = await sql`
    SELECT br.report_id, br.trace_id, br.status, br.total_articles, br.clusters_found,
           br.stories_identified, r.content AS brief_content, r.tldr, r.title AS report_title
    FROM brief_runs br LEFT JOIN reports r ON r.id = br.report_id
    WHERE br.workflow_id = ${workflowId}`;
  if (!run) throw new Error(`workflow ${workflowId} 无 brief_runs 记录`);

  // ── 每条 story + 其文章（③②①） ─────────────────────────────────────
  const stories = await sql`
    SELECT bs.cluster_id, bs.title, bs.importance, bs.article_count,
           bs.selected_for_intel, bs.intel_report_r2_key, bs.article_ids
    FROM brief_stories bs
    WHERE bs.workflow_id = ${workflowId}
    ORDER BY bs.selected_for_intel DESC, bs.importance DESC`;

  const rejections = await sql`
    SELECT cluster_id, reason, article_count FROM cluster_rejections
    WHERE workflow_id = ${workflowId} ORDER BY cluster_id`;

  const lines: string[] = [];
  lines.push(`# 全链路 trace — ${workflowId}`);
  lines.push(
    `run: status=${run.status} · 文章 ${run.total_articles} → 簇 ${run.clusters_found} → story ${run.stories_identified} · report#${run.report_id}\n`
  );

  for (const s of stories) {
    const ids: number[] = (s.article_ids as string[]).map(Number);
    const arts = await sql`
      SELECT a.id, a.title, a.url, a.content_quality::text AS quality,
             a.completeness::text AS completeness, a.status::text AS status,
             a.content_file_key, src.name AS source
      FROM articles a LEFT JOIN sources src ON src.id = a.source_id
      WHERE a.id = ANY(${ids}) ORDER BY a.id`;

    lines.push(`\n${'═'.repeat(70)}`);
    lines.push(`STORY [cluster ${s.cluster_id}] ${s.title}`);
    lines.push(`importance=${s.importance} · 文章 ${s.article_count} · 选入情报=${s.selected_for_intel}`);

    // ⑤ 简报段落（标题/实体粗匹配 —— 简报无显式 story 锚点，取首个命中实体的段）
    const anchor = (s.title as string).split(/[\s—:]+/).find((w) => w.length > 4 && run.brief_content?.includes(w));
    if (run.brief_content && anchor) {
      const p = run.brief_content.indexOf(anchor);
      lines.push(`\n⑤ 简报段落（锚"${anchor}"，需人工确认对齐）:`);
      lines.push(`   …${run.brief_content.slice(Math.max(0, p - 80), p + 380).replace(/\n/g, ' ')}…`);
    } else {
      lines.push(`\n⑤ 简报段落: [未在简报正文匹配到 —— 可能未进简报/需人工对齐]`);
    }

    // ④ 情报报告
    if (s.intel_report_r2_key) {
      const raw = r2Get(s.intel_report_r2_key as string);
      lines.push(`\n④ 情报报告 (${s.intel_report_r2_key}):`);
      lines.push(raw ? intelToProse(raw) : '   [R2 取报告失败]');
    } else if (s.selected_for_intel) {
      // 选中却没报告 = 分析步静默失败（intel_report_r2_key=null）。这正是要高亮的漏报根因。
      lines.push(`\n④ 情报报告: ⚠️ 缺失（此 story 选中做情报，但分析未产出报告 → 静默失败，story 因此从简报消失）`);
    } else {
      lines.push(`\n④ 情报报告: 无（此 story 未选入情报分析）`);
    }

    // ③②① 簇成员 + 抓取/质量
    lines.push(`\n③②① 簇成员（${arts.length} 篇）:`);
    for (const a of arts) {
      const flag = a.quality !== 'OK' || a.completeness !== 'COMPLETE' ? ' ⚠️' : '';
      lines.push(`   ├─ [${a.id}] ${a.title}`);
      lines.push(`   │   ${a.source} · ${a.quality}/${a.completeness}/${a.status}${flag} · ${a.url}`);
      if (withBodies && a.content_file_key) {
        const body = r2Get(a.content_file_key as string);
        if (body) lines.push(`   │   正文摘: ${body.replace(/\s+/g, ' ').slice(0, 240)}…`);
      }
    }
  }

  // 漏判侧
  if (rejections.length) {
    lines.push(`\n${'═'.repeat(70)}`);
    lines.push(`被拒簇（omission 侧，成簇但没进 story）:`);
    for (const r of rejections) lines.push(`   簇${r.cluster_id}: ${r.reason} (${r.article_count} 篇)`);
  }

  const doc = lines.join('\n');
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    const f = `${outDir}/trace-${workflowId}.md`;
    writeFileSync(f, doc);
    console.log(`写入 ${f}（${stories.length} story）`);
  } else {
    console.log(doc);
  }
  await sql.end();
}

main().catch((e) => {
  console.error('assemble-trace 失败:', e);
  process.exit(1);
});
