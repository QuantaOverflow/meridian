/**
 * RARR 删除对账 —— 量「接地校验删了多少、删得对不对」。
 *
 * 背景（2026-08-31 定案）：report 76 的块「nepal accepts international aid」原始草稿
 * 960 字符六句话，成品只剩 149 字符——RARR 回了 5 条 edit 全是删除，把 5/6 句删光，
 * 而被删的内容（"57.5 tonnes"、"reconnaissance team being flown in first"）**逐字在源里**。
 * G2 守卫 `isBadDelete` 一条没拦住：它要求整段 span 逐字在源，实际删的是 130-216 字符的
 * **整句转述**，5-gram 覆盖 62-94% 但整句不逐字 → 全部漏过。
 *
 * 这个 harness 回答两个问题：
 *   Q1 普遍性——一期 25 块里，RARR 平均删掉多少正文？分布长什么样？
 *   Q2 修法阈值——每条被应用的删除，它在源里的 n-gram 覆盖率是多少？
 *      误删（内容在源里）应当高覆盖，真幻觉（内容不在源里）应当低覆盖。
 *      两侧分布分不分得开，决定 `isBadDelete` 判据能否换成覆盖率阈值。
 *
 * ⚠️ 本 harness **不判**某条删除是误删还是真删——它只给覆盖率。判定要人看。
 *    「高覆盖 = 误删」是待验假设，不是结论：模型可能删掉一段措辞相似但事实被改坏的话。
 *
 * 数据通路：
 *   草稿 + 编辑表 = R2 `llm-calls/{wf}/brief_generation-{100+i}.json`（写）/`{200+i}`（校验）
 *   成品块        = Neon reports.content，按块标题与草稿对齐
 *
 * 用法：
 *   cd scripts/eval/rarr-deletion && pnpm i
 *   DATABASE_URL=postgres://... pnpm scan --wf admin-brief-1788170117190 --report 78
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { splitBriefBlocks } from '../../../services/meridian-ai-worker/src/utils/block-consistency.js';
import { inSource } from '../../../services/meridian-ai-worker/src/utils/grounded-edits.js';

const BUCKET = 'meridian-articles-prod';
const CACHE = new URL('./.cache/', import.meta.url).pathname;

const args = process.argv.slice(2);
const argOf = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const WF = argOf('--wf');
const REPORT_ID = Number(argOf('--report'));
const NGRAM = Number(argOf('--ngram') ?? '5');
const DUMP = argOf('--dump');       // own100% 候选（疑似误删）连同源报告，供盲判
const DUMP_ALL = argOf('--dump-all'); // **全部**被应用的删除，用于找「真该删」的那一半金标
if (!WF || !Number.isFinite(REPORT_ID)) throw new Error('要 --wf <workflowId> --report <reports.id>');

/** wrangler 的 --pipe 会把横幅打在 stdout，得从第一个 `{` 开始截 */
function r2Get(key: string): any | null {
  const file = `${CACHE}${key.replace(/\//g, '_')}`;
  if (!existsSync(file)) {
    let raw = '';
    try {
      raw = execFileSync('npx', ['wrangler', 'r2', 'object', 'get', `${BUCKET}/${key}`, '--pipe'],
        { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { return null; }
    writeFileSync(file, raw);
  }
  const txt = readFileSync(file, 'utf-8').replace(/\x1b\[[0-9;]*m/g, '');
  const i = txt.indexOf('{');
  if (i < 0) return null;
  try { return JSON.parse(txt.slice(i)); } catch { return null; }
}

/** span 的 n-gram 有多少比例出现在源里。逐字整段命中是它的特例（=1.0） */
function ngramCoverage(span: string, source: string, n: number): number {
  const w = span.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  if (w.length < n) return inSource(span, source) ? 1 : 0;
  const src = source.toLowerCase();
  let hit = 0, tot = 0;
  for (let i = 0; i + n <= w.length; i++) { tot++; if (src.includes(w.slice(i, i + n).join(' '))) hit++; }
  return tot ? hit / tot : 0;
}

const STOP = new Set(['the','and','for','that','this','with','from','have','has','had','was','were','been','are','its','their','they','them','not','but','all','any','has','which','who','when','where','while','after','before','into','over','under','about','than','then','also','such','only','more','most','some','other','said','says','would','could','should','may','might','must','his','her','she','him','you','out','off','per','via','due','both','each','one','two']);

/**
 * 逐 token 覆盖：span 里的实词有多少在源里。**这是 n-gram 覆盖率补不上的那一半**——
 * 「congress restored the agency's 2026 funding level to $24.4bn」整句措辞都在源里
 * （5-gram 覆盖 67%），唯独 `$24.4bn` 这个数是编的，而那正是该删的东西。
 * 逐 token 能把它挑出来：missing=['24.4bn']。
 * 反过来 report 76 那 5 条误删，实词一个不缺（missing=[]）。
 */
function tokenCoverage(span: string, source: string): { cov: number; missing: string[] } {
  const src = source.toLowerCase();
  const toks = [...new Set((span.toLowerCase().match(/[a-z0-9][a-z0-9'’.\-]*/g) ?? [])
    .map((t) => t.replace(/[.'’\-]+$/, ''))
    .filter((t) => (t.length >= 4 || /\d/.test(t)) && !STOP.has(t)))];
  if (!toks.length) return { cov: 1, missing: [] };
  const missing = toks.filter((t) => !new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(src));
  return { cov: 1 - missing.length / toks.length, missing };
}

interface DeletionRow {
  blk: number; blockTitle: string; span: string; spanLen: number;
  coverage: number; tokCov: number; missing: string[]; ownCov: number; ownMissing: string[];
  verbatim: boolean; applied: boolean; reason: string; ownSource: string; draft: string;
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
  const [rep] = await sql`SELECT content FROM reports WHERE id = ${REPORT_ID}`;
  await sql.end();
  if (!rep) throw new Error(`reports.id=${REPORT_ID} 不存在`);
  const finalBlocks = splitBriefBlocks(rep.content);
  const finalByTitle = new Map(finalBlocks.map((b) => [b.title.toLowerCase().trim(), b.text]));

  const dels: DeletionRow[] = [];
  const perBlock: Array<{ i: number; title: string; draft: number; final: number; edits: number; delEdits: number }> = [];
  let noVerify = 0, noFinal = 0;

  for (let i = 0; i < 25; i++) {
    const w = r2Get(`llm-calls/${WF}/brief_generation-${String(100 + i).padStart(3, '0')}.json`);
    if (!w?.response?.content) continue;
    const draft: string = w.response.content;
    // 写作 prompt 里的 curated_news_data = **只有这一份**报告（b′ 写作窄输入）。
    // 校验 prompt 里的是全量 25 份。同一个 span 对两者各算一次覆盖，差值就是
    // 「oracle 放宽到 25 份」带来的噪声。
    const ownSource: string = w.request.messages.at(-1).content
      .match(/<curated_news_data>([\s\S]*?)<\/curated_news_data>/)?.[1] ?? '';
    const title = (w.request.messages.at(-1).content.match(/already has its title: \*\*(.+?)\*\*/)?.[1] ?? '').trim();
    const final = finalByTitle.get(title.toLowerCase());
    if (final === undefined) noFinal++;

    const v = r2Get(`llm-calls/${WF}/brief_generation-${String(200 + i).padStart(3, '0')}.json`);
    if (!v?.response?.content) { noVerify++; continue; }
    const source: string = v.request.messages.at(-1).content
      .match(/<curated_news_data>([\s\S]*?)<\/curated_news_data>/)?.[1] ?? '';
    let edits: any[] = [];
    try { edits = JSON.parse(v.response.content.match(/\{[\s\S]*\}/)?.[0] ?? '{}').edits ?? []; } catch { /* 解析失败=当无编辑 */ }

    const delEdits = edits.filter((e) => (e?.replacement ?? '') === '' && typeof e?.brief_span === 'string');
    for (const e of delEdits) {
      const tc = tokenCoverage(e.brief_span, source);
      const oc = tokenCoverage(e.brief_span, ownSource);
      dels.push({
        blk: i, blockTitle: title, span: e.brief_span, spanLen: e.brief_span.length,
        coverage: ngramCoverage(e.brief_span, source, NGRAM),
        tokCov: tc.cov, missing: tc.missing, ownCov: oc.cov, ownMissing: oc.missing,
        verbatim: inSource(e.brief_span, source),          // 现行 G2 判据
        // 应用与否的地面真相：span 还在成品里 = 没删成
        applied: final !== undefined && !final.includes(e.brief_span),
        reason: String(e.reason ?? ''), ownSource, draft,
      });
    }
    perBlock.push({ i, title, draft: draft.length, final: final?.length ?? -1, edits: edits.length, delEdits: delEdits.length });
  }

  // ---- Q1 普遍性 ----
  console.log(`\n${'='.repeat(80)}\nQ1 删除普遍性（report ${REPORT_ID} / ${perBlock.length} 块）\n${'='.repeat(80)}`);
  const shrink = perBlock.filter((b) => b.final >= 0).map((b) => ({ ...b, lost: 1 - b.final / b.draft }));
  shrink.sort((a, b) => b.lost - a.lost);
  for (const b of shrink) {
    const bar = '█'.repeat(Math.max(0, Math.round(b.lost * 40)));
    console.log(`  [${String(b.i).padStart(2)}] ${(b.lost * 100).toFixed(0).padStart(3)}% ${bar.padEnd(40)} ${b.draft}→${b.final}  del ${b.delEdits}/${b.edits}  ${b.title.slice(0, 40)}`);
  }
  const totDraft = shrink.reduce((t, b) => t + b.draft, 0);
  const totFinal = shrink.reduce((t, b) => t + b.final, 0);
  console.log(`\n  整期：草稿 ${totDraft} → 成品 ${totFinal}（净减 ${((1 - totFinal / totDraft) * 100).toFixed(1)}%）`);
  console.log(`  删除型 edit ${dels.length} 条，其中应用 ${dels.filter((d) => d.applied).length} 条`);
  if (noVerify) console.log(`  ⚠ ${noVerify} 块没取到校验归档`);
  if (noFinal) console.log(`  ⚠ ${noFinal} 块标题对不上成品（草稿/成品无法配对）`);

  // ---- Q2 覆盖率分布 ----
  console.log(`\n${'='.repeat(80)}\nQ2 被应用的删除：${NGRAM}-gram 源内覆盖率（高=内容在源里=疑似误删）\n${'='.repeat(80)}`);
  const applied = dels.filter((d) => d.applied).sort((a, b) => b.coverage - a.coverage);
  for (const d of applied) {
    console.log(`  ngram ${(d.coverage * 100).toFixed(0).padStart(3)}% | tok ${(d.tokCov * 100).toFixed(0).padStart(3)}% | G2${d.verbatim ? '拦' : '漏'} | [${d.blk}] ${d.span.slice(0, 58)}…`);
    console.log(`        源里没有的实词: ${d.missing.length ? d.missing.join(', ') : '（无——整段实词都在源里）'}`);
  }
  const bucket = (lo: number, hi: number) => applied.filter((d) => d.coverage >= lo && d.coverage < hi).length;
  console.log(`\n  覆盖率分桶：<20% ${bucket(0, .2)} | 20-40% ${bucket(.2, .4)} | 40-60% ${bucket(.4, .6)} | 60-80% ${bucket(.6, .8)} | ≥80% ${bucket(.8, 1.01)}`);
  console.log(`  现行 G2（整段逐字）能拦下：${applied.filter((d) => d.verbatim).length}/${applied.length}`);
  const clean = applied.filter((d) => d.missing.length === 0);
  console.log(`\n  实词全在**全量 oracle**里：${clean.length}/${applied.length}（判据太松——110KB 里常用词必然出现）`);
  const ownClean = applied.filter((d) => d.ownMissing.length === 0);
  console.log(`  实词全在**自己那份报告**里：${ownClean.length}/${applied.length}  ← 这才是「删掉了本报告支持的内容」`);
  for (const d of ownClean) console.log(`      own100% [${d.blk}] ${d.span.slice(0, 66)}…`);
  if (DUMP_ALL) {
    writeFileSync(DUMP_ALL, JSON.stringify(applied.map((d, k) => ({
      id: `A${REPORT_ID}-${k + 1}`, block: d.blk, blockTitle: d.blockTitle,
      deleted_span: d.span, model_reason: d.reason,
      own_token_coverage: Number(d.ownCov.toFixed(3)),
      tokens_missing_from_own_report: d.ownMissing,
      draft_before_edit: d.draft, own_intel_report: d.ownSource,
    })), null, 1));
    console.log(`\n  已写出 ${applied.length} 条全部删除 → ${DUMP_ALL}`);
  }
  if (DUMP) {
    writeFileSync(DUMP, JSON.stringify(ownClean.map((d, k) => ({
      id: `R${REPORT_ID}-${k + 1}`, block: d.blk, blockTitle: d.blockTitle,
      deleted_span: d.span, model_reason: d.reason,
      draft_before_edit: d.draft, own_intel_report: d.ownSource,
    })), null, 1));
    console.log(`\n  已写出 ${ownClean.length} 条候选 → ${DUMP}`);
  }
  console.log(`\n  自身覆盖分桶：<40% ${applied.filter(d=>d.ownCov<.4).length} | 40-70% ${applied.filter(d=>d.ownCov>=.4&&d.ownCov<.7).length} | 70-99% ${applied.filter(d=>d.ownCov>=.7&&d.ownCov<1).length} | 100% ${ownClean.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
