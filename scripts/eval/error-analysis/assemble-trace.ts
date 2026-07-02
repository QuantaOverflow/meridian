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

// ── ⑤ 简报对齐（洞1 工具侧修复）──────────────────────────────────────
// 旧法「取标题第一个 >4 字符且在正文任意处出现的词」被泛词(building/holds/death)带偏，
// 常把已丢弃的 story 误配到别的段落，反而掩盖漏报。改为：把简报切块 → 按专有名词加权的
// 词汇重叠给每块打分 → 取最高分块；无专有名词命中则判「未进简报」（这正是漏报信号）。
// 纯离线确定性，无嵌入/API 依赖，可跑旧 run。
const STOP = new Set(
  ('the a an and or of to in on at as by is are was were be been has have had it its this that these those not no new first ever talks talk meeting meet report reports says said will would can could may might about across against between during than then them they their there here what which who whose why how when where over under after before amid into from with focus response day live crisis ' +
    'january february march april june july august september october november december 2024 2025 2026 2027').split(
    /\s+/
  )
);

// 标题 → 锚词，保留大小写以识别专有名词（首字母大写且非停用词）
function anchorTerms(title: string): { term: string; proper: boolean }[] {
  const seen = new Set<string>();
  const out: { term: string; proper: boolean }[] = [];
  for (const raw of title.split(/[^A-Za-z0-9]+/).filter(Boolean)) {
    const term = raw.toLowerCase();
    if (term.length <= 3 || STOP.has(term) || seen.has(term)) continue;
    seen.add(term);
    out.push({ term, proper: /^[A-Z]/.test(raw) });
  }
  return out;
}

// 简报切块：<u>**标题**</u> 主 story、## / ### 小节头、noteworthy 的 - 项 各自成块
function segmentBrief(brief: string): string[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.join('').trim()) blocks.push(cur.join('\n'));
    cur = [];
  };
  for (const line of brief.split('\n')) {
    if (/<u>\s*\*\*/.test(line) || /^\s*#{2,3}\s/.test(line) || /^\s*-\s+\*\*/.test(line)) flush();
    cur.push(line);
  }
  flush();
  return blocks;
}

// 给一条 story 对齐到最匹配的简报块。score = Σ 命中词 (专有?3:1)·(1/df)·min(块内出现次数,3)。
// 要求 ≥1 专有名词命中且 score≥阈值，否则返回 null（=未进简报/漏报）。
function alignStory(
  title: string,
  blocksLow: string[]
): { idx: number; score: number; hits: string[] } | null {
  const terms = anchorTerms(title);
  const df = (t: string) => blocksLow.reduce((n, b) => n + (b.includes(t) ? 1 : 0), 0) || 1;
  let best = { idx: -1, score: 0, hits: [] as string[] };
  for (let i = 0; i < blocksLow.length; i++) {
    let score = 0;
    let proper = false;
    const hits: string[] = [];
    for (const { term, proper: isProper } of terms) {
      const count = blocksLow[i].split(term).length - 1;
      if (!count) continue;
      score += (isProper ? 3 : 1) * (1 / df(term)) * Math.min(count, 3);
      if (isProper) proper = true;
      hits.push(term);
    }
    if (proper && score > best.score) best = { idx: i, score, hits };
  }
  // 阈值 1.0：低于 1.0 = 匹配靠不足一个满权重专有词，判未进简报（宁缺毋误配）
  return best.idx >= 0 && best.score >= 1.0 ? best : null;
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

  // ⑤ 简报预切块（洞1 对齐用），全小写副本供匹配
  const briefBlocks = run.brief_content ? segmentBrief(run.brief_content as string) : [];
  const briefBlocksLow = briefBlocks.map((b) => b.toLowerCase());

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

    // ⑤ 简报段落（专有名词加权对齐，见 alignStory）
    const hit = alignStory(s.title as string, briefBlocksLow);
    if (hit) {
      const block = briefBlocks[hit.idx].replace(/\n+/g, ' ').trim();
      lines.push(`\n⑤ 简报段落（锚 [${hit.hits.join(', ')}] score=${hit.score.toFixed(2)}）:`);
      lines.push(`   …${block.slice(0, 420)}${block.length > 420 ? '…' : ''}`);
    } else {
      lines.push(`\n⑤ 简报段落: ⚠️ 未进简报（无专有名词命中任何简报块 → 疑似合成层漏报）`);
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
