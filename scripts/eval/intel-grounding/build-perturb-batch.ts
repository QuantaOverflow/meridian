// ============================================================================
// 合成 contradicted 批生成器（FactCC 式确定性最小扰动）
//
// 为什么这批可信、可自动产出：扰动是「在一条 source 支撑的 claim 上，把某个可验证特征改成
// 与 source 冲突的值」。源里的原值是逐字锚点(source_quote)，改后必然 contradicted——无需人判，
// gold 由构造方式确定。这给 meta-eval 的稀有类(contradicted)免费、无偏地补样本。
//
// 输入：worklist/perturb-base.json —— 一个数组，每项是人挑的"source 确实支撑"的 claim + 显式扰动意图：
//   {
//     "base_id": "<wf>#story<i>#<claimIdx>",   // 溯源用
//     "brief_id": "<wf>#story<i>",              // = meta-eval 里的 story_ref；对应 sources.jsonl 的 key
//     "claim": "<原 claim 全文>",
//     "kind": "number" | "negation" | "direction" | "entity" | "misquote",
//     "from": "<claim 里要改的原片段，必须逐字出现在 claim 里>",
//     "to":   "<改成的冲突值>",
//     "source_quote": "<source 里证明原值的逐字片段，用于审计：必须逐字出现在该 story 的 source>",
//     "split": "dev" | "heldout"
//   }
//
// 生成器只做"确定性材料化 + 双重逐字校验"，不猜语义：
//   1) from 必须逐字在 claim 里（否则替换无效）→ 跳过并告警
//   2) to ≠ from（否则没改）→ 跳过
//   3) source_quote 必须逐字在对应 source（否则锚点不实）→ 跳过并告警（需 sources.jsonl）
// 通过校验者输出为 gold 行：gold=contradicted, synthetic=true。
//
// 用法：
//   pnpm perturb [base.json] [out.jsonl]
//     默认 base=worklist/perturb-base.json，out=gold/synthetic-contradicted.jsonl
//   env: GOLD_SOURCES（sources 旁车，默认 gold/sources.jsonl；缺省则跳过 source_quote 校验并告警）
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

interface PerturbBase {
  base_id: string;
  brief_id: string;
  claim: string;
  kind: 'number' | 'negation' | 'direction' | 'entity' | 'misquote';
  from: string;
  to: string;
  source_quote: string;
  split?: 'dev' | 'heldout';
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// 读 sources 旁车（brief_id → source 全文），用于逐字校验 source_quote 真在源里
function loadSources(path: string): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const map: Record<string, string> = {};
  raw.split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    try {
      const o = JSON.parse(t);
      if (o.brief_id && o.source) map[o.brief_id] = o.source;
    } catch {
      /* skip */
    }
  });
  return map;
}

function main() {
  const basePath = process.argv[2] || 'worklist/perturb-base.json';
  const outPath = process.argv[3] || 'gold/synthetic-contradicted.jsonl';
  const sourcesPath = process.env.GOLD_SOURCES || 'gold/sources.jsonl';

  const bases: PerturbBase[] = JSON.parse(readFileSync(basePath, 'utf8'));
  const sources = loadSources(sourcesPath);
  const haveSources = Object.keys(sources).length > 0;
  if (!haveSources) {
    console.warn(`⚠ 未读到 sources 旁车(${sourcesPath})——将跳过 source_quote 逐字校验。建议先备好 sources.jsonl 再产终版。`);
  }

  const lines: string[] = [];
  let skipped = 0;
  let idx = 0;
  for (const b of bases) {
    idx++;
    const id = `ctr-intel-${String(idx).padStart(2, '0')}`;
    // 1) from 逐字在 claim
    if (!b.from || !b.claim.includes(b.from)) {
      console.warn(`✗ ${b.base_id}: from "${b.from}" 不在 claim 里逐字出现，跳过`);
      skipped++;
      continue;
    }
    // 2) to ≠ from
    if (norm(b.to) === norm(b.from)) {
      console.warn(`✗ ${b.base_id}: to == from，没有实际扰动，跳过`);
      skipped++;
      continue;
    }
    // 3) source_quote 逐字在源（有 sources 时强制）
    if (haveSources) {
      const src = sources[b.brief_id];
      if (!src) {
        console.warn(`✗ ${b.base_id}: sources 旁车缺 brief_id=${b.brief_id}，无法校验锚点，跳过`);
        skipped++;
        continue;
      }
      if (!b.source_quote || !norm(src).includes(norm(b.source_quote))) {
        console.warn(`✗ ${b.base_id}: source_quote 未在源中逐字命中，跳过（锚点不实=不可信样本）`);
        skipped++;
        continue;
      }
    }

    const perturbedClaim = b.claim.replace(b.from, b.to);
    lines.push(
      JSON.stringify({
        id,
        brief_id: b.brief_id,
        type: 'factual',
        claim: perturbedClaim,
        gold: 'contradicted',
        perturb: b.kind,
        source_quote: b.source_quote,
        note: `SYNTHETIC_PERTURBATION(${b.kind}): "${b.from}" -> "${b.to}"`,
        synthetic: true,
        split: b.split || 'dev',
      })
    );
  }

  mkdirSync(outPath.replace(/[^/]+$/, '') || '.', { recursive: true });
  writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''));

  const byKind: Record<string, number> = {};
  for (const l of lines) byKind[JSON.parse(l).perturb] = (byKind[JSON.parse(l).perturb] ?? 0) + 1;
  console.log(`\n[perturb] base ${bases.length} → 合成 contradicted ${lines.length}（跳过 ${skipped}）`);
  console.log(`  按扰动类型: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(' ') || '(空)'}`);
  console.log(`  输出 → ${outPath}`);
  console.log(`\n下一步：人工抽查这些合成行（确认扰动确实造成 contradicted、source_quote 锚点对），`);
  console.log(`  再 merge 进 gold/judge-gold.jsonl（带 synthetic:true 标记），随真人金标一起 pnpm meta。`);
}

try {
  main();
} catch (e) {
  console.error('perturb 生成失败:', e instanceof Error ? e.message : e);
  process.exit(1);
}
