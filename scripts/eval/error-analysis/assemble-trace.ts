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
// 记忆化：每次调用都 spawn 一个 wrangler 进程（~3-5s），而归属并排视图需要的情报报告
// 主循环已经取过一遍——不缓存等于把整条 trace 的耗时翻倍。null 也缓存（缺失同样是结论）。
const r2Cache = new Map<string, string | null>();
function r2Get(key: string): string | null {
  if (r2Cache.has(key)) return r2Cache.get(key)!;
  const v = r2GetUncached(key);
  r2Cache.set(key, v);
  return v;
}
function r2GetUncached(key: string): string | null {
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

  // ── 观测层：step metrics / 传感器 / 覆盖 / 忠实度 / LLM 原始 I/O ─────────────
  // 这些数据 2026-08 前就大多存在，但病历袋从没接——每次 error-analysis 都要手工
  // wrangler r2 object get 五六次去拼。数据在、工具不取，等于没有。
  lines.push('');
  lines.push('## 观测层（run 级）');

  const metricsRaw = r2Get(`observability/${workflowId}.json`);
  if (metricsRaw) {
    try {
      const m = JSON.parse(metricsRaw);
      lines.push('### 步骤链');
      const seen = new Set<string>();
      for (const step of m.detailedMetrics || []) {
        const k = `${step.stepName}:${step.status}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const dur = step.duration ? ` ${step.duration}ms` : '';
        const data = step.data ? ` ${JSON.stringify(step.data).slice(0, 200)}` : '';
        lines.push(`  ${step.stepName} → ${step.status}${dur}${data}`);
      }
    } catch { lines.push('  [步骤 metrics 解析失败]'); }
  } else lines.push('  [无步骤 metrics]');

  const covRaw = r2Get(`observability/coverage/${workflowId}.json`);
  if (covRaw) {
    try {
      const c = JSON.parse(covRaw);
      lines.push('### 覆盖对账');
      lines.push(`  补录后: ${JSON.stringify(c.summary)}`);
      // 补录前是唯一能反映**合成层原始质量**的信号：补录按构造把 dropped 推到 0，
      // 只看 summary 会把"模型漏了 4 条但被程序救回"读成"模型一条没漏"。
      lines.push(`  补录前: ${JSON.stringify(c.summaryBeforeRepair ?? '(该 run 早于此字段上线)')}`);
      for (const e of c.coverage || []) {
        if (e.disposition === 'dropped') lines.push(`  ⚠ 仍 dropped: ${e.storyLabel} — ${e.reason}`);
      }
    } catch { lines.push('  [覆盖对账解析失败]'); }
  } else lines.push('  [无覆盖对账]');

  const faithRaw = r2Get(`observability/faithfulness/${workflowId}.json`);
  if (faithRaw) {
    try {
      const v = JSON.parse(faithRaw).verdict || {};
      lines.push('### 忠实度');
      lines.push(`  judge=${v.judge_model} mode=${v.mode} block=${v.block} ` +
        `unsupported=${v.genuine_unsupported}/${v.factual_claims} contradicted=${v.contradicted}`);
      for (const f of v.flagged_factual || []) {
        lines.push(`  ⚠ flagged: ${(f.claim || f.text || JSON.stringify(f)).toString().slice(0, 200)}`);
      }
    } catch { lines.push('  [忠实度 verdict 解析失败]'); }
  } else lines.push('  [无忠实度 verdict]');

  // 传感器读数（2026-08-12 起）：卫生检查 / 情报解析重采样 / 输出语言。
  // key 形状 observability/sensors/{wf}/{kind}-{idx}.json；无 list 能力，按已知 kind 探。
  lines.push('### 传感器');
  let sensorHit = 0;
  for (const kind of ['brief_hygiene', 'intel_parse', 'output_language']) {
    for (let i = 0; i < 20; i++) {
      const raw = r2Get(`observability/sensors/${workflowId}/${kind}-${String(i).padStart(3, '0')}.json`);
      if (!raw) { if (i > 0) break; else continue; }
      sensorHit++;
      try {
        const d = JSON.parse(raw);
        if (kind === 'brief_hygiene') {
          lines.push(`  卫生检查: ${d.findingCount} 条（简报 ${d.briefChars} 字符）`);
          for (const f of d.findings || []) lines.push(`     [${f.kind}] ${f.detail}`);
        } else if (kind === 'intel_parse') {
          lines.push(`  情报解析重采样[${i}]: ${d.attempts}/${d.maxAttempts} 次${d.exhausted ? ' ⚠ 耗尽仍失败' : ''}`);
        } else {
          lines.push(`  ⚠ 输出语言[${i}]: ${d.phase} CJK ${(d.ratio * 100).toFixed(1)}% — ${String(d.sample).slice(0, 120)}`);
        }
      } catch { lines.push(`  [${kind}-${i} 解析失败]`); }
    }
  }
  if (!sensorHit) lines.push('  （无传感器读数——该 run 可能早于传感器上线，或全部零命中且未落盘）');

  // ── 归属并排视图 ────────────────────────────────────────────────────────
  // 动机：2026-08-12 人工核 report 54 抓到的唯一事实错是**归属类**——把 Pezeshkian
  // 说的话安到 Rezaei 头上，并改写了成因。它在所有落盘信号里都是干净的（忠实度 0/38、
  // 覆盖 dropped 0、卫生 0 条），因为每个 token 都在源里，错的是 token 之间的连线。
  // 这类目前没有自动检测手段，但可以把**人读成本**降下来：把简报里每个带署名的陈述、
  // 与源里所有涉及该人物的原句并排列出，核对从"翻五个文件"变成"扫一屏"。
  lines.push('### 归属并排（人读用；无自动判定）');
  {
    // 简报里的署名句：含"人名 + 表述动词"的句子。人名取自各情报报告的 keyEntities(type=Person)，
    // 避免用通用 NER——源里已经有权威的实体表，直接用它才能保证两侧同一口径。
    const persons = new Set<string>();
    const personSay = new Map<string, string[]>(); // 人名 → 源里涉及他的原句
    for (const st of stories) {
      if (!st.intel_report_r2_key) continue;
      const raw = r2Get(st.intel_report_r2_key);
      if (!raw) continue;
      try {
        const d = JSON.parse(raw);
        const ents = Array.isArray(d.keyEntities) ? d.keyEntities : (d.keyEntities?.list ?? d.entities ?? []);
        for (const e of ents) {
          const nm = String(e?.name ?? '').trim();
          if (!nm || nm.split(/\s+/).length < 2) continue; // 只取全名，单名歧义太大
          // 只收 Person：末词匹配对机构名会崩——"Russian Defence Ministry" 的末词是
          // "Ministry"，于是简报里的 "russian agriculture ministry" 被归进同一组（实测）。
          // 人名的姓氏是强标识，机构名的末词是通用词，两者不能用同一套匹配。
          if (!/person/i.test(String(e?.type ?? ''))) continue;
          persons.add(nm);
        }
        // 源句：timeline.description + factualBasis + executiveSummary，逐句切
        const srcSents: string[] = [];
        for (const t of d.timeline ?? []) if (t?.description) srcSents.push(String(t.description));
        for (const f of d.factualBasis ?? []) srcSents.push(String(f));
        if (d.executiveSummary) srcSents.push(...String(d.executiveSummary).split(/(?<=[.!?])\s+/));
        for (const nm of persons) {
          const last = nm.split(/\s+/).pop()!;
          for (const sent of srcSents) {
            if (!sent.includes(nm) && !sent.includes(last)) continue;
            const arr = personSay.get(nm) ?? [];
            if (!arr.includes(sent)) arr.push(sent);
            personSay.set(nm, arr);
          }
        }
      } catch { /* 单条报告解析失败不影响整体 */ }
    }

    const SAY = /\b(said|says|declared|announced|warned|accused|stated|suggested|told|claimed|argued|confirmed|denied|revealed)\b/i;
    const briefText = String(run.brief_content ?? '');
    const briefSents = briefText.split(/(?<=[.!?])\s+/).map((x: string) => x.trim()).filter(Boolean);
    let shown = 0;
    for (const nm of [...persons].sort()) {
      const last = nm.split(/\s+/).pop()!.toLowerCase();
      const claims = briefSents.filter((sn: string) => sn.toLowerCase().includes(last) && SAY.test(sn));
      if (!claims.length) continue;
      shown++;
      lines.push(`  ── ${nm} ──`);
      for (const c of claims) lines.push(`    简报: ${c.slice(0, 300)}`);
      const src = personSay.get(nm) ?? [];
      if (src.length) for (const ssent of src.slice(0, 6)) lines.push(`    源  : ${ssent.slice(0, 300)}`);
      else lines.push('    源  : ⚠ 源里没有涉及此人的句子——简报凭空署名，重点核');
    }
    if (!shown) lines.push('  （简报里没有可识别的署名陈述）');
  }

  lines.push('### LLM 原始调用');
  lines.push(`  按需取: wrangler r2 object get ${BUCKET}/llm-calls/${workflowId}/<phase>-<idx>.json --remote --pipe`);
  lines.push(`  phase ∈ story_validation | intelligence_analysis | brief_generation | tldr_generation | faithfulness_check`);

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
