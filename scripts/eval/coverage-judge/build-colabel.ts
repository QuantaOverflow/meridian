// ============================================================================
// build-colabel —— 三尺三角测量 → 暂定 gold + 分歧清单（交人裁）
//
// 三把独立尺（避 self-preference：判官 qwen、codex GPT 异家族、对齐器无 LLM）：
//   det   = worklist.jsonl 的 det_disposition（决定论对齐器）
//   judge = judge-labels.jsonl 的 judge_disposition（被验对象 qwen-long）
//   codex = codex-labels.jsonl 的 codex_disposition（GPT 第二标注器）
//
// 规则（共同标注 + 分歧人裁）：
//   三者一致            → provisional-gold.jsonl（gold=该 disposition，抽查即可）
//   仅二分(covered/dropped)一致但三分不一致 → 归 provisional-gold 的 disposition 用「多数」，仍列进 review 供确认
//   有分歧              → disagreements.md（人以仁慈独裁者身份裁定，写回 gold.jsonl）
//
// 产出：colabel.jsonl（全量三票）+ provisional-gold.jsonl + disagreements.md
// 用法：tsx build-colabel.ts
// ============================================================================
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { alignDisposition, segmentBrief, type Disposition } from './align.js';

type D = Disposition;
const COVERED = (d: D) => (d === 'dropped' ? 'dropped' : 'covered');

function loadJsonl(path: string): any[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function main() {
  const work = loadJsonl('worklist.jsonl');
  const judge = new Map(loadJsonl('judge-labels.jsonl').map((r) => [r.id, r]));
  const codexRows = loadJsonl('codex-labels.jsonl');
  const codex = new Map(codexRows.map((r) => [r.id, r.codex_disposition as D]));
  if (!work.length) throw new Error('worklist.jsonl 为空——先跑 build-worklist');
  if (!judge.size) throw new Error('judge-labels.jsonl 为空——先跑 run-judge');
  const haveCodex = codex.size > 0;
  if (!haveCodex) console.warn('⚠ 无 codex-labels.jsonl —— 仅 det+judge 二尺（codex 标注后重跑本步）');

  // 简报块缓存（给分歧清单附证据）
  const briefBlocks = new Map<string, string[]>();
  const getBlocks = (wf: string): string[] => {
    if (!briefBlocks.has(wf)) {
      const fx = JSON.parse(readFileSync(`worklist/${wf}.json`, 'utf8'));
      briefBlocks.set(wf, segmentBrief(fx.brief as string));
    }
    return briefBlocks.get(wf)!;
  };

  const colabel: any[] = [];
  const provisional: any[] = [];
  const disagree: any[] = [];

  for (const w of work) {
    const det = w.det_disposition as D;
    const j = judge.get(w.id)?.judge_disposition as D | undefined;
    const cx = codex.get(w.id);
    const votes = [det, j, cx].filter(Boolean) as D[];
    const three = haveCodex && j && cx;

    // 三分一致 / 二分(covered vs dropped)一致
    const allSame = votes.every((v) => v === votes[0]);
    const coveredVotes = votes.map(COVERED);
    const coveredSame = coveredVotes.every((v) => v === coveredVotes[0]);

    // 多数（三分）；无多数则 null
    const tally: Record<string, number> = {};
    for (const v of votes) tally[v] = (tally[v] ?? 0) + 1;
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const majority = top.length && (top.length === 1 || top[0][1] > top[1][1]) ? (top[0][0] as D) : null;

    const row = {
      id: w.id,
      workflow_id: w.workflow_id,
      sid: w.sid,
      cluster_id: w.cluster_id,
      label: w.label,
      det,
      judge: j ?? null,
      codex: cx ?? null,
      allSame,
      coveredSame,
      majority,
    };
    colabel.push(row);

    if (three && allSame) {
      provisional.push({ id: w.id, gold: votes[0], basis: 'unanimous' });
    } else if (three && coveredSame && majority) {
      // covered/dropped 一致、仅 headline↔noteworthy 分歧：二分决策不受影响，用多数暂定但仍列 review
      provisional.push({ id: w.id, gold: majority, basis: 'covered-agree-3class-split' });
      disagree.push(row);
    } else {
      disagree.push(row);
    }
  }

  writeFileSync('colabel.jsonl', colabel.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync('provisional-gold.jsonl', provisional.map((r) => JSON.stringify(r)).join('\n') + '\n');

  // 分歧清单（人裁）
  const md: string[] = [];
  md.push(`# 覆盖对账判官 — 共同标注分歧清单（人裁）\n`);
  md.push(`三尺：det(决定论对齐) / judge(qwen-long 被验) / codex(GPT 第二标注)`);
  md.push(`共 ${work.length} story：一致 ${provisional.filter((p) => p.basis === 'unanimous').length}，需裁 ${disagree.length}\n`);
  md.push(`裁定方法：读 label + 简报候选块，判该 story 在简报里的真实去向 {headline|noteworthy|dropped}。`);
  md.push(`把裁定写进 gold.jsonl，每行 {"id":"...","gold":"dropped"}（provisional-gold.jsonl 是一致项，可直接并入）。\n`);
  md.push(`> 决策级看点：**covered↔dropped 的分歧**（影响"合成漏报"计数）优先裁；headline↔noteworthy 分歧影响小。\n`);

  for (const r of disagree) {
    const blocks = getBlocks(r.workflow_id);
    const al = alignDisposition(r.label, blocks);
    const decisionLevel = new Set([r.det, r.judge, r.codex].filter(Boolean).map((d: any) => COVERED(d))).size > 1;
    md.push(`\n---\n### ${r.id}  ${decisionLevel ? '⚠️ 决策级(covered↔dropped)' : '(仅 headline↔noteworthy)'}`);
    md.push(`cluster ${r.cluster_id} · **det**=${r.det} · **judge**=${r.judge} · **codex**=${r.codex}`);
    md.push(`label: ${r.label}`);
    if (al.blockIdx >= 0) {
      const block = blocks[al.blockIdx].replace(/\n+/g, ' ').trim();
      md.push(`对齐器命中块（锚 [${al.hits.join(', ')}] score=${al.score.toFixed(2)}）:`);
      md.push(`  …${block.slice(0, 400)}${block.length > 400 ? '…' : ''}`);
    } else {
      md.push(`对齐器：无专有名词命中任何简报块（→ 判 dropped）`);
    }
  }
  writeFileSync('disagreements.md', md.join('\n') + '\n');

  console.log(`✅ colabel.jsonl（${colabel.length}）`);
  console.log(`   provisional-gold.jsonl（${provisional.length} 项：一致 ${provisional.filter((p) => p.basis === 'unanimous').length} + covered一致但三分裂 ${provisional.filter((p) => p.basis !== 'unanimous').length}）`);
  console.log(`   disagreements.md（${disagree.length} 项待人裁，其中决策级 covered↔dropped 分歧另标 ⚠️）`);
}

main();
