// ============================================================================
// 环1 日期传感器（离线，mark-only）—— 抓「情报报告把事件的日期/周几读错」的缺陷。
//
// 动机（run 52 全链路 error-analysis + 全量回归，2026-07-13）：日期编造修复
// (commit 707c774) 根除了机械 bug，但残留 ~4/15 story 的「报告读错原文周几」——
// 原文说 Saturday、报告写 Friday。这类错在环2（简报 vs 报告）看不见（简报忠实
// 照抄报告的错），只能在环1（报告 vs 原文）抓。研究结论见 memory:
// intel-grounding-judge-validated（时序理解是 LLM 公认弱点，靠确定性归一化+验证治）。
//
// 复用（不造轮子）：归一化+比对引擎 resolveWeekday/datesConflict、align 抽取
// ALIGN_PROMPT、编排 extractCompareClaim —— 全部来自 ai-worker extract-compare.ts
// （单一真源）。本文件只做环1 编排：报告 timeline/execSummary 当 claim，故事文章
// 当 source（buildArticleMarkdown 带 publishDate 行，供 article_timestamp 锚定周几）。
//
// 关键洞察（为什么现有传感器漏了这 4 个）：extract-compare 现只在环2 跑（门 F），
// 那里简报与报告都说错误的「Friday」→ 一致无冲突。同一引擎挪到环1（报告 vs 原文）
// 即暴露。见 memory「传感器站错位置」。
//
// 用法：
//   AI_WORKER_URL=http://localhost:8787 pnpm tsx ring1-date-check.ts <manifest.json>
//   SELFTEST=1 pnpm tsx ring1-date-check.ts   # 零 LLM 自测（resolveWeekday/datesConflict）
//
// manifest.json: [{ storyId, reportFile, articles: [{id,title,url,publishDate,contentFile}] }]
// 输出：<manifest>.ring1date.jsonl —— 每条 flagged 日期冲突（事件、报告值、原文值、原文时间戳）
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { chat, parseJSON } from './llm.js';
import { extractCompareClaim, resolveWeekday, datesConflict } from '../../../services/meridian-ai-worker/src/services/extract-compare.js';
import { rankSourcesByRelevance } from '../../../services/meridian-ai-worker/src/services/faithfulness-prompts.js';
import { AIResponseParser } from '../../../services/meridian-ai-worker/src/utils/ai-response-parser.js';

const TOPK = Number(process.env.TOPK ?? '3');

interface ArticleMeta { id: number; title: string; url: string; publishDate: string; contentFile: string }
interface ManifestEntry { storyId: string; reportFile: string; articles: ArticleMeta[] }
interface DateFlag {
  storyId: string;
  where: string;       // timeline[i] | executiveSummary
  event: string;       // 事件描述（截断）
  report_value: string;
  source_value: string;
  article_timestamp: string;
  why: string;
}

// 报告里承载日期的「待验 claim」：每条 timeline 事件（date 字段 + 描述一起给，描述常含周几）
// + executiveSummary。只挑「含日期/周几线索」的，省 LLM 调用。
const WD_RE = /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i;
const DATE_HINT = /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\byesterday|today|tomorrow\b|\b20\d\d-\d\d-\d\d\b/i;

function reportDateClaims(report: any): { where: string; claim: string }[] {
  const out: { where: string; claim: string }[] = [];
  const tl = Array.isArray(report?.timeline) ? report.timeline : [];
  tl.forEach((ev: any, i: number) => {
    const date = (ev?.date ?? '').toString().trim();
    const desc = (ev?.description ?? '').toString().trim();
    // date 字段本身是纯周几/相对时，把它拼进 claim 里让 align 去核（描述未必重复该词）
    const claim = DATE_HINT.test(date) && !desc.toLowerCase().includes(date.toLowerCase())
      ? `${desc} (reported date: ${date})`
      : desc;
    if (DATE_HINT.test(claim)) out.push({ where: `timeline[${i}]`, claim });
  });
  const es = (report?.executiveSummary ?? '').toString().trim();
  if (es && DATE_HINT.test(es)) out.push({ where: 'executiveSummary', claim: es });
  return out;
}

async function checkStory(entry: ManifestEntry): Promise<DateFlag[]> {
  const report = JSON.parse(readFileSync(entry.reportFile, 'utf8'));
  const articles = entry.articles.map((a) => ({
    id: a.id, title: a.title, url: a.url, publishDate: a.publishDate,
    content: readFileSync(a.contentFile, 'utf8'),
  }));
  const texts = articles.map((a) => a.content);
  const claims = reportDateClaims(report);
  const flags: DateFlag[] = [];
  for (const { where, claim } of claims) {
    // top-k 逐源（同 runtime codeVerifiedConflict）：把对齐的 haystack 从「全部文章拼一坨」
    // 缩到单篇——原型版全文拼接致 align 检索漏（run52 story4/5 埋在长文里没被找到）。
    // 每篇单独 buildArticleMarkdown（保留 "> Published:" 行供 article_timestamp 锚周几）。
    const order = rankSourcesByRelevance(claim, texts, TOPK);
    const seen = new Set<string>();
    for (const idx of order) {
      const sourceMd = AIResponseParser.buildArticleMarkdown([articles[idx]]);
      // 单篇对齐失败（gateway 抖动/截断）不该拖垮整轮：吞掉该篇、继续下一篇。
      // 这是 mark-only 传感器——漏一篇的代价远小于整轮丢失。
      let conflicts;
      try {
        conflicts = await extractCompareClaim(claim, sourceMd, (p, mt) => chat(p, { maxTokens: mt }), parseJSON);
      } catch (e) {
        console.warn(`  [${entry.storyId} ${where}] align 失败(跳过该源): ${(e as Error).message.slice(0, 80)}`);
        continue;
      }
      for (const c of conflicts) {
        if (!/^date:/.test(c.why)) continue; // 本传感器只管日期通道，数字冲突留给环2
        const key = `${where}|${c.pair.claim_value}|${c.pair.source_value}`;
        if (seen.has(key)) continue; // 跨源去重：多篇报同一冲突只记一次
        seen.add(key);
        flags.push({
          storyId: entry.storyId, where, event: claim.slice(0, 90),
          report_value: c.pair.claim_value, source_value: c.pair.source_value ?? '',
          article_timestamp: c.pair.article_timestamp ?? '', why: c.why,
        });
      }
    }
  }
  return flags;
}

// ---- 零 LLM 自测：锁住确定性归一化/比对不回退 ----
function selftest() {
  const A_SAT = '2026-07-11T20:00:00Z'; // 周六
  const cases: [string, string, string, boolean, string][] = [
    // [报告值, 原文值, 文章ISO, 期望冲突?, 说明]
    ['Friday', 'Saturday', A_SAT, true, 'run52 story4/5/10：报告周五 vs 原文周六 → 冲突'],
    ['Thursday', 'Friday', A_SAT, true, 'run52 story13：报告周四 vs 原文周五 → 冲突'],
    ['Wednesday', 'Wednesday', A_SAT, false, 'story7：两边周三 → 不冲突'],
    ['10 July 2026', 'Saturday', A_SAT, true, 'story10：报告显式10 July(周五) vs 原文周六 → 冲突'],
    ['Friday', '10 July', A_SAT, false, '周五=7-10 = 显式10 July → 不冲突'],
    ['July 8', '8 July 2026', A_SAT, false, '同日不同写法 → 不冲突'],
  ];
  let pass = 0;
  for (const [rep, src, iso, expect, note] of cases) {
    const got = datesConflict(rep, src, iso);
    const ok = got === expect;
    pass += ok ? 1 : 0;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} datesConflict("${rep}","${src}")=${got} 期望${expect} — ${note}`);
  }
  // resolveWeekday 锚定
  const wd = resolveWeekday('Friday', A_SAT);
  const wdOk = wd?.m === 7 && wd?.d === 10;
  console.log(`  ${wdOk ? 'PASS' : 'FAIL'} resolveWeekday("Friday", 周六7-11) = ${JSON.stringify(wd)} 期望 7-10`);
  console.log(`\n自测 ${pass + (wdOk ? 1 : 0)}/${cases.length + 1} 通过`);
}

async function main() {
  if (process.env.SELFTEST === '1') { selftest(); return; }
  const manifestPath = process.argv[2];
  if (!manifestPath) throw new Error('用法: pnpm tsx ring1-date-check.ts <manifest.json>（或 SELFTEST=1）');
  const manifest: ManifestEntry[] = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const all: DateFlag[] = [];
  for (const entry of manifest) {
    const flags = await checkStory(entry);
    all.push(...flags);
    console.log(`  story ${entry.storyId}: ${flags.length} 日期冲突 flagged`);
  }
  const out = manifestPath.replace(/\.json$/, '') + '.ring1date.jsonl';
  writeFileSync(out, all.map((f) => JSON.stringify(f)).join('\n') + '\n');
  console.log(`\n环1 日期传感器：${manifest.length} story → ${all.length} 条 flagged\n  → ${out}`);
  for (const f of all) console.log(`  [${f.storyId} ${f.where}] ${f.why}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
