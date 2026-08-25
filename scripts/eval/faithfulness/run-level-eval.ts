// ============================================================================
// Run 级忠实度门 eval —— 在「整条 brief」粒度量门的拦/放决策，补 meta-eval 的 claim 级盲区。
//
// 为什么需要：meta-eval 量的是 claim 级 judge↔人一致性（κ/per-class）；但门是按整条 brief
// 拍板拦不拦（聚合判据 contradicted>=1 或 unsupported_rate>0.15 且 count>=4）。claim 级准
// ≠ run 级门判得对。enforce 的真闸是 run 级：误拦率（好 brief 被拦）、抓捕率（坏 brief 被
// 抓）、稳定性（同 brief 多跑同判？——裁判非确定性会让门判决抖动）。业界（RAGAS 占比聚合 +
// self-consistency）就是 claim 级验尺 + run 级定门两层，本脚本是后者。详见 memory:
// faithfulness-enforce-blocked-rootcause / llm-judge-faithfulness-industry-patterns。
//
// 用法：
//   tsx run-level-eval.ts briefs.jsonl
//   env: AI_WORKER_URL（默认部署 worker）, RUNS（每条 brief 跑几次，默认 3，测稳定性）
// 输入 JSONL，一行一条：
//   {"brief_id": "...", "brief": "<全文>", "sources": [{"storyId":"s1","content":"..."}, ...],
//    "should_block": false}   // should_block 可选：有则算误拦/抓捕，无则只报 block-rate+稳定性
// 门走真实部署端点 /meridian/faithfulness-check（含 slice 1 检索路由），跑的就是线上逻辑。
// ============================================================================

import { readFileSync } from 'node:fs';

const AI_WORKER_URL = process.env.AI_WORKER_URL || 'https://meridian-ai-worker.swj299792458.workers.dev';
const RUNS = Number(process.env.RUNS ?? '3');
// 端点默认 code_only（线上传感器形态，LLM 判官旁路）；离线批跑要量 LLM 判官通道时传 MODE=full。
// 不传则沿用端点默认，与线上一致。
const MODE = process.env.MODE as 'code_only' | 'full' | undefined;

interface BriefCase {
  brief_id: string;
  brief: string;
  sources: { storyId: string; content: string }[];
  should_block?: boolean;
}
interface GateVerdict {
  block: boolean;
  contradicted: number;
  genuine_unsupported: number;
  factual_claims: number;
  unsupported_rate: number;
  flagged_factual: { verdict: string; claim: { text: string }; reason: string }[];
}

// 代理网络已知不稳，单次失败重试（同 llm.ts）
async function runGate(c: BriefCase): Promise<GateVerdict | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(`${AI_WORKER_URL}/meridian/faithfulness-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: c.sources, brief: c.brief, ...(MODE ? { options: { mode: MODE } } : {}) }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { success?: boolean; data?: GateVerdict };
      return data.success && data.data ? data.data : null;
    } catch (e) {
      if (attempt === 3) {
        console.error(`  [${c.brief_id}] gate 调用失败: ${e instanceof Error ? e.message : e}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return null;
}

function loadBriefs(path: string): BriefCase[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => JSON.parse(l) as BriefCase);
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('用法: tsx run-level-eval.ts briefs.jsonl  (env RUNS=3)');
    process.exit(1);
  }
  const briefs = loadBriefs(path);
  console.log(`[run-level-eval] ${briefs.length} briefs × ${RUNS} runs，mode=${MODE ?? '端点默认(code_only)'}，门=${AI_WORKER_URL}\n`);

  let falseBlock = 0; // should_block=false 但门拦了
  let missed = 0; // should_block=true 但门放了
  let labeled = 0;
  let unstable = 0;

  for (const c of briefs) {
    // 多跑并行：RUNS 次调用彼此独立，串行只是白等（判官单次 60-120s）。
    const verdicts: (GateVerdict | null)[] = await Promise.all(
      Array.from({ length: RUNS }, () => runGate(c))
    );
    const ok = verdicts.filter((v): v is GateVerdict => v !== null);
    if (ok.length === 0) {
      console.log(`${c.brief_id}: 全部 gate 调用失败，跳过`);
      continue;
    }
    const blocks = ok.map((v) => v.block);
    const blockCount = blocks.filter(Boolean).length;
    const stable = new Set(blocks).size === 1;
    if (!stable) unstable++;
    // 多数判决（self-consistency）：过半数 run 拦才算门最终拦
    const majorityBlock = blockCount > ok.length / 2;
    const contra = ok.map((v) => v.contradicted);
    const flaggedContra = (ok[0].flagged_factual || []).filter((f) => f.verdict === 'contradicted');

    const goldStr =
      c.should_block === undefined ? '' : `  gold=${c.should_block ? 'BLOCK' : 'pass'}`;
    const verdictMark =
      c.should_block === undefined
        ? ''
        : majorityBlock === c.should_block
          ? ' ✅'
          : majorityBlock
            ? ' 🔴误拦'
            : ' 🟡漏判';
    // A/B 对拍要看的是连续量（unsupported 占比、可核 claim 总数），不是只看拦不拦的二值判决：
    // 两条 brief 可能都 pass，但 unsupported_rate 差一倍。只打 block 会把这个差别丢掉。
    const unsup = ok.map((v) => `${v.genuine_unsupported}/${v.factual_claims}`);
    console.log(
      `${c.brief_id}: block ${blockCount}/${ok.length}${stable ? '' : ' ⚠️不稳'} | contra=[${contra.join(',')}] | unsup=[${unsup.join(' ')}] | maj=${majorityBlock ? 'BLOCK' : 'pass'}${goldStr}${verdictMark}`
    );
    for (const f of flaggedContra) {
      console.log(`    contradicted: ${f.claim.text.slice(0, 70)} :: ${(f.reason || '').slice(0, 80)}`);
    }
    if (c.should_block !== undefined) {
      labeled++;
      if (majorityBlock && !c.should_block) falseBlock++;
      if (!majorityBlock && c.should_block) missed++;
    }
  }

  console.log(`\n=== run 级汇总 ===`);
  console.log(`稳定性: ${briefs.length - unstable}/${briefs.length} brief 多跑同判（不稳=裁判非确定性发作）`);
  if (labeled) {
    console.log(`误拦(好 brief 被拦): ${falseBlock}/${labeled}`);
    console.log(`漏判(坏 brief 放行): ${missed}/${labeled}`);
  } else {
    console.log(`(无 should_block 标签 → 只报稳定性；补金标后才出误拦/抓捕率)`);
  }
}

main().catch((e) => {
  console.error('run-level-eval 失败:', e);
  process.exit(1);
});
