/**
 * 【扔掉型原型】六项 RARR 修法一起上，效果如何？
 *
 * 两臂，同批同时跑（Workers AI 在 temperature:0 下不确定，且 R2 归档是几天前另一次部署的，
 * 都不能当"现在的基线"——只有两臂之差才是改动的效果）：
 *
 *   baseline  改动前：旧 prompt（含 ABSENT 分支、无举证字段）+ 全量 25 份 oracle
 *             + 旧 G2（整段逐字）、无 G5、无删除预算
 *   all       改动后：新 prompt（只判矛盾 + 必填 source_says）+ top-5 oracle
 *             + 新 G2（实词逐个）、G5 未举证、删除预算 0.4
 *
 * 度量分两层，**必须分开看**：
 *   proposed  模型提出要删（治因层：prompt / oracle 起没起作用）
 *   applied   过完守卫后真的从正文里消失了（兜底层：守卫拦没拦住）
 * 只看 applied 会把"因治好了"和"守卫兜住了"混成一个数。
 *
 * 另报 Pres_Lev（RARR 论文式 3）——本项目此前只测忠实度、从不测保留度，所以某个块被删掉
 * 85% 正文时没有任何指标会响。
 *
 * 跑法：
 *   cd services/meridian-ai-worker/prototypes/rarr-narrow-oracle
 *   # baseline 臂要用**改动前**的 prompt。它是 git 里的历史版本，不入库（28K 全量副本
 *   # 进 git 只会腐烂），跑之前先取出来：
 *   git show 54e9ca3:services/meridian-ai-worker/src/prompts/briefGeneration.ts > baseline-prompt.ts
 *   pnpm i --ignore-workspace && pnpm probe [--tp] [--guard-narrow] [--repeats 2] [--conc 4]
 *
 *   --tp           换真幻觉金标（判定方向翻转：被删=抓到）
 *   --guard-narrow 守卫查模型看到的那份 oracle，而非全量
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { getBriefVerificationPrompt } from '../../src/prompts/briefGeneration.js';
import { getBriefVerificationPrompt as baselinePrompt } from './baseline-prompt.js';
import { rankSourcesByRelevance } from '../../src/services/faithfulness-prompts.js';
import { applyGroundedEdits, inSource, presLev, type GroundedEdit } from '../../src/utils/grounded-edits.js';
// 移植校验：rarr 臂改调**生产**函数（原型实现留在 rarr-arm.ts 供对照）。
// 搬进生产后必须用同一批金标重跑——「代码搬过去了」和「行为一致」是两回事。
import { getBriefQuestionsPrompt, getBriefAgreementPrompt } from '../../src/prompts/briefGeneration.js';
import { buildEvidenceWindows, retrieveEvidence, checksToEdits } from '../../src/utils/evidence-windows.js';

const WORKER = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian/chat';
const CACHE = new URL('../../../../scripts/eval/rarr-deletion/.cache/', import.meta.url).pathname;
const GOLD_FP = '/Users/shiwenjie/.claude/jobs/a83191cc/tmp/rarr-candidates.json';
const SEP = '\n---\n\n';
const TRACE = new URL('./traces/', import.meta.url).pathname;
const K = 5;

const args = process.argv.slice(2);
const argOf = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const REPEATS = Number(argOf('--repeats') ?? '2');
/**
 * --tp：换成**真幻觉**金标（源不支持、确实该删），判定方向随之翻转——
 * 这一批「被删/被改 = 抓到了（好）」，「原样保留 = 漏了（坏）」。
 * 两批金标必须分开跑：一批测过度删除，一批测漏删，混在一起读数会互相抵消。
 */
const TP = args.includes('--tp');
/** --guard-narrow：守卫改查模型看到的那份 oracle（默认查全量，即当前生产配置） */
const GUARD_NARROW = args.includes('--guard-narrow');
const GOLD = TP ? '/Users/shiwenjie/.claude/jobs/a83191cc/tmp/rarr-truepos.json' : GOLD_FP;
const CONC = Number(argOf('--conc') ?? '4');
// 两批金标的 id 前缀不同（误删批 R76/R78，真幻觉批 A76/A78）——只认期号
const WF: Record<string, string> = { '76': 'admin-brief-1788058777778', '78': 'admin-brief-1788170117190' };
const wfOf = (id: string) => WF[id.replace(/^[A-Za-z]+/, '').split('-')[0]];

function archive(wf: string, idx: number): any | null {
  const f = `${CACHE}llm-calls_${wf}_brief_generation-${String(idx).padStart(3, '0')}.json`;
  if (!existsSync(f)) return null;
  const t = readFileSync(f, 'utf-8').replace(/\x1b\[[0-9;]*m/g, '');
  const i = t.indexOf('{');
  return i < 0 ? null : JSON.parse(t.slice(i));
}
const curated = (s: string) => s.match(/<curated_news_data>([\s\S]*?)<\/curated_news_data>/)?.[1] ?? '';

async function chat(prompt: string): Promise<string> {
  const r = await fetch(WORKER, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      options: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, max_tokens: 4000, skipCache: true },
    }),
  });
  const j: any = await r.json();
  return j?.data?.choices?.[0]?.message?.content ?? '';
}

const parseEdits = (raw: string): GroundedEdit[] => {
  try { return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}').edits ?? []; } catch { return []; }
};
/** 模型措辞会漂，用前 40 字符互为子串做宽松匹配 */
const matches = (a: string, b: string) => {
  const x = a.toLowerCase().slice(0, 40), y = b.toLowerCase().slice(0, 40);
  return a.toLowerCase().includes(y) || b.toLowerCase().includes(x);
};

/** 改动前的守卫：G2 判据是整段逐字，无 G5，无预算 */
function applyBaseline(draft: string, edits: GroundedEdit[], source: string) {
  let text = draft;
  let deletedApplied = 0;
  for (const e of edits) {
    const span = e.brief_span, rep = e.replacement ?? '';
    if (typeof span !== 'string' || !span) continue;
    if (rep.trim().toLowerCase() === span.trim().toLowerCase()) continue;     // G3
    if (rep === '' && inSource(span, source)) continue;                       // 旧 G2
    if (rep && rep.trim().length > 1.5 * span.trim().length) continue;        // G4
    if (text.includes(span)) { text = text.replace(span, rep); if (rep === '') deletedApplied++; }
  }
  return { text, deletedApplied, presLev: presLev(draft, text) };
}

interface Row {
  id: string; arm: 'baseline' | 'all' | 'hybrid' | 'rarr'; rep: number;
  proposedDel: number; appliedDel: number; goldProposed: boolean; goldApplied: boolean;
  presLev: number; oracleKB: number; quoted: number; total: number;
}

async function main() {
  const gold: any[] = JSON.parse(readFileSync(GOLD, 'utf-8'));
  const jobs: Array<{ id: string; arm: Row['arm']; rep: number; prompt: string; draft: string; full: string; goldSpan: string; oracleKB: number; pieces?: string[] }> = [];

  for (const g of gold) {
    const wf = wfOf(g.id);
    const w = archive(wf, 100 + g.block), v = archive(wf, 200 + g.block);
    if (!w?.response?.content || !v) { console.warn(`跳过 ${g.id}：归档缺失`); continue; }
    const draft: string = w.response.content;
    const pieces = curated(v.request.messages.at(-1).content).split(SEP);
    if (pieces.length < 20) { console.warn(`跳过 ${g.id}：oracle 只切出 ${pieces.length} 份`); continue; }

    const full = pieces.join(SEP);
    const narrow = rankSourcesByRelevance(draft, pieces, K).sort((a, b) => a - b).map((i) => pieces[i]).join(SEP);
    for (let r = 0; r < REPEATS; r++) {
      jobs.push({ id: g.id, arm: 'baseline', rep: r, prompt: baselinePrompt(draft, full), draft, full, goldSpan: g.deleted_span, oracleKB: full.length / 1000 });
      jobs.push({ id: g.id, arm: 'all', rep: r, prompt: getBriefVerificationPrompt(draft, narrow), draft,
                 full: GUARD_NARROW ? narrow : full, goldSpan: g.deleted_span, oracleKB: narrow.length / 1000 });
      // hybrid：**旧 prompt**（保留 ABSENT 分支，模型照旧敢提）+ 窄 oracle + 新守卫。
      // 假设：提议权归模型、否决权归代码——比让 prompt 自己克制更可控。
      jobs.push({ id: g.id, arm: 'hybrid', rep: r, prompt: baselinePrompt(draft, narrow), draft,
                 full: GUARD_NARROW ? narrow : full, goldSpan: g.deleted_span, oracleKB: narrow.length / 1000 });
      // rarr：论文结构（提问 → 逐问题检索 → 逐问题判断）。prompt 留空，跑时两次调用现构造。
      jobs.push({ id: g.id, arm: 'rarr', rep: r, prompt: '', draft,
                 full: GUARD_NARROW ? narrow : full, goldSpan: g.deleted_span, oracleKB: 0, pieces });
    }
  }

  console.log(`${jobs.length} 次调用（${gold.length} 金标 × 2 臂 × ${REPEATS} 次），k=${K}，并发 ${CONC}\n`);
  const rows: Row[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    for (let i = next++; i < jobs.length; i = next++) {
      const j = jobs[i];
      let raw = '';
      let edits: GroundedEdit[] = [];
      let nq = 0, evKB = 0;
      if (j.arm === 'rarr') {
        try {
          const qRaw = await chat(getBriefQuestionsPrompt(j.draft));
          const qs: string[] = (JSON.parse(qRaw.match(/\{[\s\S]*\}/)?.[0] ?? '{}').questions ?? []).filter((x: any) => typeof x === 'string');
          nq = qs.length;
          // 窗口只从**与本块相关的 top-5 份报告**里切，不是全部 25 份。
          // 首跑不收窄：问"受影响多少人"，top-1 窗口可能来自另一场灾难的报告——
          // 4 行的窗口没有故事标识，跨故事分不开。金标 0/12 疑似出在这里。
          const scoped = rankSourcesByRelevance(j.draft, j.pieces ?? [], 5).map((i) => (j.pieces ?? [])[i]);
          const items = retrieveEvidence(qs, buildEvidenceWindows(scoped));
          evKB = items.reduce((t, it) => t + it.evidence.length, 0) / 1000;
          if (items.length) {
            raw = await chat(getBriefAgreementPrompt(j.draft, items));
            const checks = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}').checks ?? [];
            edits = checksToEdits(checks);
            // 中间产物必须落盘：首轮没存 questions/evidence/checks，导致 6 条金标只能离线推到
            // 检索层，判断层（模型判成 agree 了吗）完全不可观测，逐条归因做不下去。
            mkdirSync(TRACE, { recursive: true });
            writeFileSync(`${TRACE}${TP ? 'tp' : 'fp'}-${j.id}-r${j.rep}.json`,
              JSON.stringify({ id: j.id, rep: j.rep, goldSpan: j.goldSpan, questions: qs, items, checks }, null, 1));
          }
        } catch (e) { console.warn(`  rarr 调用失败 ${j.id}: ${e}`); }
      } else {
        try { raw = await chat(j.prompt); } catch (e) { console.warn(`  调用失败 ${j.id}/${j.arm}: ${e}`); }
        edits = parseEdits(raw);
      }
      const dels = edits.filter((e) => (e.replacement ?? '') === '' && typeof e.brief_span === 'string');
      const goldProposed = dels.some((d) => matches(d.brief_span!, j.goldSpan));

      let out: string, appliedDel: number, pres: number;
      if (j.arm === 'baseline') {
        const r = applyBaseline(j.draft, edits, j.full);
        out = r.text; appliedDel = r.deletedApplied; pres = r.presLev;
      } else {
        // hybrid 用旧 prompt，本就没有 source_says 字段——开 G5 会把每条 edit 都判"未举证"
        // 全拦掉（首跑踩过：26 条提删生效 0、Pres 恒 1.000）。那是探针配置错，不是读数。
        const r = applyGroundedEdits(j.draft, edits, j.full, { requireQuote: j.arm === 'all' });
        out = r.text; pres = r.presLev;
        // 必须同时要求"原本在草稿里" —— 模型吐出的 span 若对不上原文，applyGroundedEdits 会
        // skip（宁可不动），但 `!out.includes(span)` 对这种情况也为真，会把 skip 误记成生效。
        // 首跑症状：某条"生效 6 条删除"而 Pres=1.000（一个字没改），自相矛盾。
        appliedDel = dels.filter((d) => j.draft.includes(d.brief_span!) && !out.includes(d.brief_span!)).length;
      }
      const goldApplied = !out.includes(j.goldSpan) && j.draft.includes(j.goldSpan);

      rows.push({
        id: j.id, arm: j.arm, rep: j.rep, proposedDel: dels.length, appliedDel,
        goldProposed, goldApplied, presLev: pres, oracleKB: j.oracleKB,
        quoted: edits.filter((e) => typeof e.source_says === 'string' && e.source_says.length >= 8).length,
        total: edits.length,
      });
      console.log(`  ${j.id} ${j.arm.padEnd(8)} r${j.rep}  提删 ${String(dels.length).padStart(2)} → 生效 ${String(appliedDel).padStart(2)}  金标${TP ? (goldApplied ? '抓到 ✓' : '漏掉 ✗') : (goldApplied ? '被删 ✗' : '保住 ✓')}  Pres ${pres.toFixed(3)}  举证 ${rows.at(-1)!.quoted}/${rows.at(-1)!.total}${j.arm === 'rarr' ? `  问题 ${nq} / 证据 ${evKB.toFixed(1)}KB` : ''}`);
    }
  }));

  console.log(`\n${'='.repeat(74)}`);
  for (const arm of ['baseline', 'all', 'hybrid', 'rarr'] as const) {
    const rs = rows.filter((r) => r.arm === arm);
    if (!rs.length) continue;
    const n = rs.length;
    console.log(
      `${arm.padEnd(9)} oracle ${(rs[0].oracleKB).toFixed(0)}KB | 金标 ${TP ? '抓到' : '被删'} ${rs.filter((r) => r.goldApplied).length}/${n}（其中提删 ${rs.filter((r) => r.goldProposed).length}）` +
      ` | 删除 提 ${rs.reduce((t, r) => t + r.proposedDel, 0)} → 生效 ${rs.reduce((t, r) => t + r.appliedDel, 0)}` +
      ` | Pres 均 ${(rs.reduce((t, r) => t + r.presLev, 0) / n).toFixed(3)} 最低 ${Math.min(...rs.map((r) => r.presLev)).toFixed(3)}` +
      ` | 带举证 ${rs.reduce((t, r) => t + r.quoted, 0)}/${rs.reduce((t, r) => t + r.total, 0)}`
    );
  }
  console.log(`\n逐条（${TP ? '✓=抓到该删的，✗=漏掉' : '✗=金标被误删'}；b=baseline, a=all）`);
  for (const g of gold) {
    const cell = (arm: string) => rows.filter((r) => r.id === g.id && r.arm === arm).map((r) => (TP ? (r.goldApplied ? '✓' : '✗') : (r.goldApplied ? '✗' : '✓'))).join('');
    if (!cell('baseline') && !cell('all')) continue;
    console.log(`  ${g.id.padEnd(6)} b:${cell('baseline').padEnd(REPEATS)} a:${cell('all').padEnd(REPEATS)} h:${cell('hybrid').padEnd(REPEATS)} r:${cell('rarr').padEnd(REPEATS)}  ${g.deleted_span.slice(0, 42)}…`);
  }
  const flip = (arm: string) => gold.filter((g) => {
    const rs = rows.filter((r) => r.id === g.id && r.arm === arm);
    return rs.length === REPEATS && new Set(rs.map((r) => r.goldApplied)).size > 1;
  }).length;
  console.log(`\n噪声地板：同臂重复间判定翻转  baseline ${flip('baseline')} / all ${flip('all')}（共 ${gold.length} 条）`);
}

main().catch((e) => { console.error(e); process.exit(1); });
