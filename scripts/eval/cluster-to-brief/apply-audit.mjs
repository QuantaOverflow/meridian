/**
 * 把核心层校核结论机械地应用到事件清单。零 LLM。
 *
 * 两件事:
 *   1. **改写判错的事件** —— 用校核者给的 correction 替换,原文留在 `auditTrail` 里(不删,可复核)
 *   2. **加 `variants` 字段** —— 簇内同一事实有多个口径时全部记下来。
 *      不加的话清单锁死一个,成稿写了另一个(各有独立出处)就被判没命中 —— 罚的是它没做错的事。
 *      21 条核心层里 15 条有这种冲突。
 *
 * 采纳规则:两个校核者都判 wrong 的直接改;只有一个判 wrong 的也改,但在 auditTrail 里标出是单方判定。
 * **两边都没判 wrong 的一律不动** —— 这个脚本不替校核者做判断。
 *
 * 用法: node apply-audit.mjs [--dry]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadExpectations, FIX } from './lib.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const AUD = `${HERE}out/_checklist-audit`;
const DRY = process.argv.includes('--dry');
const EXP = loadExpectations();

let changed = 0, varAdded = 0;
for (const [cid, exp] of Object.entries(EXP.clusters).filter(([, e]) => e.split === 'dev')) {
  const ckF = `${FIX}checklists/c${cid}.json`;
  const A = existsSync(`${AUD}/audit-c${cid}.json`) ? JSON.parse(readFileSync(`${AUD}/audit-c${cid}.json`, 'utf8')) : null;
  const B = existsSync(`${AUD}/audit-c${cid}.sonnet.json`) ? JSON.parse(readFileSync(`${AUD}/audit-c${cid}.sonnet.json`, 'utf8')) : null;
  if (!A && !B) { console.log(`c${cid} 无校核结果,跳过`); continue; }
  const ck = JSON.parse(readFileSync(ckF, 'utf8'));
  const by = (X) => new Map((X?.audits ?? []).map(x => [x.eventId, x]));
  const ia = by(A), ib = by(B);
  const trail = [];

  for (const id of new Set([...ia.keys(), ...ib.keys()])) {
    const e = ck.events[id - 1];
    if (!e) continue;
    const a = ia.get(id), b = ib.get(id);

    // ① 改写
    const aw = a?.verdict === 'wrong' && a.correction;
    const bw = b?.verdict === 'wrong' && b.correction;
    if (aw || bw) {
      const both = a?.verdict === 'wrong' && b?.verdict === 'wrong';
      const next = String(aw ? a.correction : b.correction).trim();
      if (next && next !== e.event) {
        trail.push({
          eventId: id, action: 'rewrite', confidence: both ? 'both_auditors' : 'single_auditor',
          by: aw ? 'opus' : 'sonnet',
          problems: [...new Set([...(a?.problems ?? []), ...(b?.problems ?? [])])],
          was: e.event, now: next,
          why: String((aw ? a.why : b.why) ?? '').slice(0, 400),
        });
        e.event = next;
        changed++;
      }
    }

    // ② variants
    const vs = [a?.conflictingFigures, b?.conflictingFigures].filter(Boolean).map(String);
    if (vs.length) {
      e.variants = [...new Set(vs)];
      varAdded++;
    }
  }

  ck.coreAudit = {
    at: new Date().toISOString().slice(0, 10),
    auditors: [A ? 'opus' : null, B ? 'sonnet' : null].filter(Boolean),
    coreAudited: ck.tiers.core,
    totalEvents: ck.events.length,
    note: '只校核了核心层(设门那一层)。次层/尾层未校核;「该有而没抽到」与「支持篇数算错导致的错误分层」两类失效结构上查不到,见 decision-hold-checklist-tiering',
    trail,
  };

  console.log(`c${String(cid).padEnd(3)} ${String(exp.name).padEnd(17)} 改写 ${trail.length} 条 · variants ${ck.events.filter(e => e.variants).length} 条`);
  for (const t of trail) console.log(`     #${t.eventId} [${t.confidence}] ${t.problems.join(',')}`);
  if (!DRY) writeFileSync(ckF, `${JSON.stringify(ck, null, 1)}\n`);
}
console.log(`\n${DRY ? '(dry run) ' : ''}改写 ${changed} 条事件,${varAdded} 条加了 variants`);
if (!DRY) console.log('⚠️ 清单变了 → 判定包内容变 → 旧判定会被指纹闸自动隔离,受影响的簇必须重判');
