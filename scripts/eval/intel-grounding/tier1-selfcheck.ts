// ============================================================================
// Tier1 证据锚定时间线 —— 零共指自检 harness（离线，mark-only）
//
// 前提（commit 43ea10e）：intel 报告每个 timeline 事件带 `dateSource`（定该日期
// 所依据的逐字原文引用）。因「日期↔证据」的支持关系已在生成时由 LLM 固定，核验
// 无需事后重建事件对齐（共指）——只比对 date 与它自己的 dateSource 是否自洽。
// 这正是环1 检测传感器（e781aa0，14% 精度）过不去的坎：它得猜哪句原文对应哪个
// 事件；这里 LLM 已经绑好，退化成确定性比对。研究/证伪见 memory: intel-grounding-judge-validated。
//
// 判据（复用 extract-compare 确定性引擎，零 LLM）：
//   从 dateSource 引用里抽「事件的时间表述」（显式日期 or 周几），与 date 字段比。
//   复合句（"On Friday, X ... while on Saturday, Y ..."）取与 description 事件最贴近
//   的那个周几——按引用里各周几到 description 关键词的就近度，不取盲目第一个。
//
// 用法：pnpm tsx tier1-selfcheck.ts <glob 或 目录>   （读目录下 story*.json）
// 输出：逐条 self-consistent / conflict / weak-evidence + 汇总
// ============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { datesConflict } from '../../../services/meridian-ai-worker/src/services/extract-compare.js';

const WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ANCHOR = process.env.ANCHOR || '2026-07-11T20:00:00Z'; // run52 story 发布日（周六）
const EXPL_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s+\d{1,2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\b|\b20\d\d-\d\d-\d\d\b/i;

// 复合引用里挑「与事件最贴近」的周几：引用可能含多个周几（"On Friday, A ... on Saturday, B"）。
// 用 date 字段自身作为消歧锚——若 date 本身是某周几，优先取引用里同名周几（自证）；否则
// 取引用里离 description 名词最近的那个。简单稳妥，避免盲取第一个（旧自检的伪冲突源）。
function sourceTimeExpr(quote: string, dateField: string, desc: string): string | null {
  const expl = quote.match(EXPL_RE);
  if (expl) return expl[0];
  const wdMatches = [...quote.matchAll(new RegExp(`\\b(${WD.join('|')})\\b`, 'gi'))].map((m) => ({ w: m[0], i: m.index ?? 0 }));
  if (wdMatches.length === 0) return null;
  if (wdMatches.length === 1) return wdMatches[0].w;
  // date 字段含周几 → 取引用里同名者（自证一致性，不制造伪冲突）
  const dfWd = dateField.toLowerCase().match(new RegExp(`\\b(${WD.join('|')})\\b`, 'i'));
  if (dfWd) {
    const same = wdMatches.find((m) => m.w.toLowerCase() === dfWd[0].toLowerCase());
    if (same) return same.w;
  }
  // 否则取离 description 首个实体词最近的周几（就近归属）
  const firstNoun = (desc.match(/[A-Z][a-z]{2,}/) || [''])[0];
  const anchorPos = firstNoun ? quote.indexOf(firstNoun) : -1;
  if (anchorPos >= 0) {
    wdMatches.sort((a, b) => Math.abs(a.i - anchorPos) - Math.abs(b.i - anchorPos));
  }
  return wdMatches[0].w;
}

function main() {
  const target = process.argv[2];
  if (!target) throw new Error('用法: pnpm tsx tier1-selfcheck.ts <目录>');
  const files = readdirSync(target).filter((f) => /^story\d+\.json$/.test(f)).sort();
  let tot = 0, ok = 0, bad = 0, weak = 0;
  const conflicts: string[] = [];
  for (const f of files) {
    const sid = f.replace(/\D/g, '');
    const rep = JSON.parse(readFileSync(join(target, f), 'utf8'));
    for (const [i, e] of (rep.timeline || []).entries()) {
      const date = String(e.date || '');
      const quote = String(e.dateSource || e.date_source || '');
      const desc = String(e.description || '');
      if (!date || !quote) continue;
      tot++;
      const srcVal = sourceTimeExpr(quote, date, desc);
      if (!srcVal) { weak++; continue; }
      const conflict = datesConflict(date, srcVal, ANCHOR);
      if (conflict) { bad++; conflicts.push(`  [story ${sid} tl${i}] date=${JSON.stringify(date)} vs 引用=${JSON.stringify(srcVal)} — ${desc.slice(0, 60)}`); }
      else ok++;
    }
  }
  console.log(`Tier1 自检：${files.length} report / ${tot} 条带证据的 timeline 事件`);
  console.log(`  ✓自洽 ${ok}  ✗冲突 ${bad}  弱引用(无可解析日期) ${weak}`);
  console.log(`  date↔证据 自洽率 = ${ok}/${ok + bad} = ${(ok / (ok + bad) * 100).toFixed(1)}%（不含弱引用）`);
  if (conflicts.length) { console.log(`\n冲突明细（date 与自带引用不符 → 需人看）：`); conflicts.forEach((c) => console.log(c)); }
}

main();
