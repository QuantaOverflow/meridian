// ============================================================================
// 语义通道 eval harness（原型）
//
// 通道逻辑单一真源在 ./semantic-compare.ts，本文件只是跑批壳。
//
// 两个必须分开读的层：
//   L1 判定层（零 LLM）  SELFTEST=1：手写 AssertionPair 喂比对器，验「判据本身对不对」。
//   L2 抽取层（带 LLM）  全量跑：验「抽取器能不能把对应槽位找出来并逐字抄对」。
// 分开的理由：合起来跑时读数掉了，分不清是判据错还是抽取漏——这正是 eval 静默失真的
// 头号来源（memory: eval-probe-hygiene-assertions）。
//
// 两个必须一起看的集：
//   召回集  gold/synthetic-contradicted.jsonl 里 perturb ∈ {negation,direction,entity,misquote}
//   精度集  gold/judge-gold.jsonl 里 gold==='supported'（本通道在这上面开一枪都是误伤）
// 只报召回不报精度 = 无意义读数：全判 conflict 也能拿满分召回。
//
// 用法：
//   SELFTEST=1 pnpm tsx semantic-eval.ts              # 零 LLM，秒回
//   pnpm tsx semantic-eval.ts                          # 全量（默认 llama-3.3-70b 抽取）
//   LIMIT_SUPPORTED=30 pnpm tsx semantic-eval.ts       # 精度集抽样跑
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chat as sharedChat, parseJSON } from '../_shared/judge-llm.js';
import {
  semanticCompareClaim,
  findSemanticConflicts,
  findQuoteConflicts,
  polarityOf,
  temporalClassOf,
  entitiesMatch,
  quotedSpans,
  type AssertionPair,
  type SemanticConflict,
} from './semantic-compare.js';

// DashScope key 自 2026-07-29 401，qwen 通道是死的；Workers AI 的 llama 是眼下活着的出口，
// 且与生成端 glm 跨家族（避免同族共盲）。
const EXTRACT_MODEL = process.env.EXTRACT_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '5');
const SEMANTIC_PERTURBS = ['negation', 'direction', 'entity', 'misquote'];
// 命题极性补抽臂。默认关——多找冲突天然有伤精度的风险，开不开由两个集一起实测定。
const PROP_RETRY = process.env.PROP_RETRY === '1';

// 调用计数：本通道每条 claim 是「1 次对齐 + 每条未对齐断言 1 次补抽 + 时序槽 1 次
// (+ 命题臂 1 次)」，条数随 claim 复杂度浮动。成本是「接不接 runtime」的判据之一，
// 不落数就只能拍脑袋。
let llmCalls = 0;
const chat = (prompt: string, maxTokens: number) => {
  llmCalls++;
  return sharedChat(prompt, { model: EXTRACT_MODEL, maxTokens, temperature: 0 });
};

// ---------------------------------------------------------------------------
// L1 判定层自测：手写 pair，零 LLM
// 每条对应金标里一条真实扰动，pair 内容按「理想抽取器会抄出什么」构造。
// 这测的是判据，不是抽取——抽取做不到是另一层的事，见 L2。
// ---------------------------------------------------------------------------
interface SelfCase {
  id: string;
  name: string;
  claim: string;
  source: string;
  pairs: AssertionPair[];
  expectFire: boolean;
  expectKind?: string;
}

const H = { source_status: 'same_event', confidence: 'high' } as const;

const SELF_CASES: SelfCase[] = [
  // ---- 应该开枪 ----
  {
    id: 'ctr-intel-22', name: 'direction/角色互换', expectFire: true, expectKind: 'role_swap',
    claim: 'Cornyn defeated Paxton in the Republican runoff election.',
    source: 'Ken Paxton wins Texas Senate primary, defeating Cornyn',
    pairs: [{ ...H, claim_agent: 'Cornyn', claim_action: 'defeated', claim_patient: 'Paxton', source_agent: 'Ken Paxton', source_action: 'defeating', source_patient: 'Cornyn', source_quote: 'Ken Paxton wins Texas Senate primary, defeating Cornyn' }],
  },
  {
    id: 'ctr-intel-14', name: 'entity/施事替换（同头衔）', expectFire: true, expectKind: 'role_substitution',
    claim: "Acting Attorney General Merrick Garland declared the fund dead on June 2.",
    source: 'acting attorney general todd blanche has said the Epstein fund is dead',
    pairs: [{ ...H, claim_agent: 'Acting Attorney General Merrick Garland', claim_action: 'declared', claim_patient: 'the fund', source_agent: 'acting attorney general Todd Blanche', source_action: 'has said', source_patient: 'the Epstein fund', source_quote: 'acting attorney general todd blanche has said the Epstein fund is dead' }],
  },
  {
    id: 'ctr-intel-19', name: 'negation/显式 not', expectFire: true, expectKind: 'polarity',
    claim: 'Hezbollah claimed responsibility for cross-border strikes into northern Israel.',
    source: 'Hezbollah has not claimed any recent strikes in Israel',
    pairs: [{ ...H, claim_agent: 'Hezbollah', claim_action: 'claimed responsibility for', claim_patient: 'cross-border strikes', source_agent: 'Hezbollah', source_action: 'has not claimed', source_patient: 'any recent strikes', source_quote: 'Hezbollah has not claimed any recent strikes in Israel' }],
  },
  {
    id: 'ctr-intel-25', name: 'negation/refused', expectFire: true, expectKind: 'polarity',
    claim: 'Rwanda refused to forgo the April 2025 payments.',
    source: 'Rwanda agreed to forgo any additional payments by the United Kingdom in April 2025 and April 2026',
    pairs: [{ ...H, claim_agent: 'Rwanda', claim_action: 'refused to forgo', claim_patient: 'the April 2025 payments', source_agent: 'Rwanda', source_action: 'agreed to forgo', source_patient: 'any additional payments', source_quote: 'to forgo any additional payments by the United Kingdom in April 2025 and April 2026' }],
  },
  {
    id: 'ctr-intel-20', name: 'direction/动词反义带标记', expectFire: true, expectKind: 'polarity',
    claim: 'Iran resumed negotiations with the US.',
    source: 'Iran said it would suspend peace talks with the US',
    pairs: [{ ...H, claim_agent: 'Iran', claim_action: 'resumed', claim_patient: 'negotiations with the US', source_agent: 'Iran', source_action: 'would suspend', source_patient: 'peace talks with the US', source_quote: 'it would suspend peace talks with the US' }],
  },
  {
    id: 'ctr-intel-23', name: 'direction/时序反转', expectFire: true, expectKind: 'temporal',
    claim: 'Kuwait reports seven Iranian drones entered its airspace two days before the ceasefire began',
    source: 'seven drones entered its airspace on April 10, two days after it had begun',
    pairs: [{ ...H, claim_agent: 'seven Iranian drones', claim_action: 'entered', claim_patient: 'its airspace', claim_temporal_rel: 'two days before', source_agent: 'seven drones', source_action: 'entered', source_patient: 'its airspace', source_temporal_rel: 'two days after', source_quote: 'seven drones entered its airspace on April 10, two days after it had begun' }],
  },
  {
    id: 'ctr-intel-24', name: 'misquote/引语不在源里', expectFire: true, expectKind: 'quote',
    claim: `Trump posted claiming a 'tense call' with Netanyahu`,
    source: 'I had a very productive call with Prime Minister Bibi Netanyahu',
    pairs: [],
  },
  // ---- 不该开枪（精度对照）----
  {
    id: 'neg-alias', name: '别名不算身份冲突（Israel/Israeli military）', expectFire: false,
    claim: 'Israel struck targets in southern Lebanon.',
    source: 'The Israeli military struck targets in southern Lebanon.',
    pairs: [{ ...H, claim_agent: 'Israel', claim_action: 'struck', claim_patient: 'targets in southern Lebanon', source_agent: 'The Israeli military', source_action: 'struck', source_patient: 'targets in southern Lebanon', source_quote: 'The Israeli military struck targets in southern Lebanon.' }],
  },
  {
    id: 'neg-same', name: '同义改写不算极性冲突', expectFire: false,
    claim: 'The council approved the budget.',
    source: 'The council voted to adopt the budget.',
    pairs: [{ ...H, claim_agent: 'The council', claim_action: 'approved', claim_patient: 'the budget', source_agent: 'The council', source_action: 'voted to adopt', source_patient: 'the budget', source_quote: 'The council voted to adopt the budget.' }],
  },
  {
    id: 'neg-bothneg', name: '两侧都否定不算冲突', expectFire: false,
    claim: 'Hamas has not accepted the proposal.',
    source: 'Hamas rejected the proposal.',
    pairs: [{ ...H, claim_agent: 'Hamas', claim_action: 'has not accepted', claim_patient: 'the proposal', source_agent: 'Hamas', source_action: 'rejected', source_patient: 'the proposal', source_quote: 'Hamas rejected the proposal.' }],
  },
  {
    id: 'neg-lowconf', name: 'low confidence 一律不进比对', expectFire: false,
    claim: 'Cornyn defeated Paxton.',
    source: 'Ken Paxton wins, defeating Cornyn',
    pairs: [{ source_status: 'same_event', confidence: 'low', claim_agent: 'Cornyn', claim_action: 'defeated', claim_patient: 'Paxton', source_agent: 'Ken Paxton', source_action: 'defeating', source_patient: 'Cornyn', source_quote: 'Ken Paxton wins, defeating Cornyn' }],
  },
  {
    id: 'neg-fabquote', name: '造引文（source_quote 不在源里）一律丢弃', expectFire: false,
    claim: 'Cornyn defeated Paxton.',
    source: 'Ken Paxton wins Texas Senate primary, defeating Cornyn',
    pairs: [{ ...H, claim_agent: 'Cornyn', claim_action: 'defeated', claim_patient: 'Paxton', source_agent: 'Ken Paxton', source_action: 'defeating', source_patient: 'Cornyn', source_quote: 'Cornyn crushed Paxton in a landslide' }],
  },
  {
    id: 'neg-quotefound', name: '引语在源里就不该报', expectFire: false,
    claim: `Trump described it as a 'very productive call' with Netanyahu`,
    source: 'I had a very productive call with Prime Minister Bibi Netanyahu',
    pairs: [],
  },
];

function runSelfTest(): boolean {
  console.log('\n=== L1 判定层自测（零 LLM）===\n');
  let pass = 0;
  for (const c of SELF_CASES) {
    const conflicts = [
      ...findQuoteConflicts(c.claim, c.source),
      ...findSemanticConflicts(c.pairs, c.claim, c.source),
    ];
    const fired = conflicts.length > 0;
    const kindOk = !c.expectKind || conflicts.some((x) => x.kind === c.expectKind);
    const ok = fired === c.expectFire && (!c.expectFire || kindOk);
    if (ok) pass++;
    console.log(
      `${ok ? '✅' : '❌'} ${c.id.padEnd(16)} ${c.name.padEnd(30)} ` +
        `期望${c.expectFire ? `开枪(${c.expectKind})` : '不开枪'} → ${fired ? conflicts.map((x) => x.kind).join(',') : '静默'}`
    );
    if (!ok) conflicts.forEach((x) => console.log(`      ↳ ${x.why}`));
  }
  console.log(`\nL1: ${pass}/${SELF_CASES.length} 通过\n`);
  return pass === SELF_CASES.length;
}

// ---------------------------------------------------------------------------
// L2 全量：金标加载（与 extract-compare-eval.ts 同构）
// ---------------------------------------------------------------------------
interface Item {
  id: string;
  claim: string;
  source: string;
  gold: string;
  perturb?: string;
  set: 'recall' | 'precision';
}

function loadSources(path: string): Record<string, string> {
  const map: Record<string, string> = {};
  readFileSync(path, 'utf8').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const o = JSON.parse(t);
    if (o.brief_id && o.source) map[o.brief_id] = o.source;
  });
  return map;
}

function loadJsonl(path: string): any[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => JSON.parse(l));
}

function resolveSource(o: any, sources: Record<string, string>): string | undefined {
  const briefId = o.brief_id ?? String(o.id).split('#').slice(0, 2).join('#');
  return o.source ?? sources[briefId] ?? sources[String(o.id).split('#')[0]];
}

// 并发 worker pool（照 expand.ts 惯例；memory: eval-probe-concurrency-default）
async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

async function main() {
  const selfOk = runSelfTest();
  if (process.env.SELFTEST) process.exit(selfOk ? 0 : 1);
  if (!selfOk) {
    console.error('L1 未全过 —— 判据本身有问题，跑 L2 得到的读数无法归因。先修 L1。');
    process.exit(1);
  }

  const sources = loadSources('gold/sources.jsonl');

  const recall: Item[] = loadJsonl('gold/synthetic-contradicted.jsonl')
    .filter((o) => SEMANTIC_PERTURBS.includes(o.perturb))
    .map((o) => {
      const source = resolveSource(o, sources);
      if (!source) throw new Error(`召回集 ${o.id} 缺 source`);
      return { id: o.id, claim: o.claim, source, gold: 'contradicted', perturb: o.perturb, set: 'recall' as const };
    });

  const limitSup = Number(process.env.LIMIT_SUPPORTED ?? '0');
  let precision: Item[] = loadJsonl('gold/judge-gold.jsonl')
    .filter((o) => o.type === 'factual' && o.gold === 'supported')
    .map((o) => {
      const source = resolveSource(o, sources);
      if (!source) throw new Error(`精度集 ${o.id} 缺 source`);
      return { id: o.id, claim: o.claim, source, gold: 'supported', set: 'precision' as const };
    });
  if (limitSup > 0) precision = precision.slice(0, limitSup);

  const all = [...recall, ...precision];
  console.log(`=== L2 全量（抽取 ${EXTRACT_MODEL}，并发 ${CONCURRENCY}，命题补抽臂 ${PROP_RETRY ? '开' : '关'}）===`);
  console.log(`召回集 ${recall.length} 条（语义类合成 contradicted）｜精度集 ${precision.length} 条（真金标 supported）\n`);

  let extractFailures = 0;
  const t0 = Date.now();
  const results = await pool(all, CONCURRENCY, async (item, i) => {
    let conflicts: SemanticConflict[] = [];
    let pairs: AssertionPair[] = [];
    let error: string | undefined;
    try {
      conflicts = await semanticCompareClaim(
        item.claim,
        item.source,
        chat,
        parseJSON,
        () => {
          extractFailures++;
        },
        (ps) => {
          pairs = ps;
        },
        PROP_RETRY
      );
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    process.stdout.write(`\r  ${i + 1}/${all.length} 完成`);
    return { ...item, conflicts, pairs, error };
  });
  console.log(
    `\n  用时 ${((Date.now() - t0) / 1000).toFixed(0)}s，LLM 调用 ${llmCalls} 次` +
      `（${(llmCalls / all.length).toFixed(1)} 次/claim），抽取解析失败 ${extractFailures} 次\n`
  );

  // --- 读数 ---
  const rec = results.filter((r) => r.set === 'recall');
  const pre = results.filter((r) => r.set === 'precision');
  const hit = rec.filter((r) => r.conflicts.length > 0);
  const fp = pre.filter((r) => r.conflicts.length > 0);

  console.log('--- 召回（按扰动类型）---');
  for (const p of SEMANTIC_PERTURBS) {
    const sub = rec.filter((r) => r.perturb === p);
    const h = sub.filter((r) => r.conflicts.length > 0);
    console.log(`  ${p.padEnd(10)} ${h.length}/${sub.length}`);
  }
  console.log(`  ${'合计'.padEnd(9)} ${hit.length}/${rec.length} = ${(hit.length / Math.max(rec.length, 1)).toFixed(3)}`);

  console.log('\n--- 精度（真金标 supported 上开枪 = 误伤）---');
  console.log(`  误伤 ${fp.length}/${pre.length} = FPR ${(fp.length / Math.max(pre.length, 1)).toFixed(3)}`);
  if (fp.length) {
    const byKind: Record<string, number> = {};
    fp.forEach((r) => r.conflicts.forEach((c) => (byKind[c.kind] = (byKind[c.kind] || 0) + 1)));
    console.log(`  误伤来源：${JSON.stringify(byKind)}`);
  }

  console.log('\n--- 逐条明细（召回集）---');
  for (const r of rec) {
    const mark = r.conflicts.length ? '✅' : '❌';
    console.log(`${mark} ${r.id.padEnd(15)} [${(r.perturb || '').padEnd(9)}] ${r.conflicts.map((c) => c.kind).join(',') || '未检出'}`);
    r.conflicts.forEach((c) => console.log(`     ↳ ${c.why.slice(0, 160)}`));
    if (!r.conflicts.length) {
      // 漏检归因：抽取器到底抽出了什么？没抽到对应事实 vs 抽到了但判据没开枪
      if (!r.pairs.length) console.log('     ↳ 抽取层：0 个 assertion');
      r.pairs.forEach((p) =>
        console.log(
          `     ↳ [${p.source_status}/${p.confidence}] C(${p.claim_agent}|${p.claim_action}|${p.claim_patient}|${p.claim_temporal_rel || '-'}) ` +
            `S(${p.source_agent}|${p.source_action}|${p.source_patient}|${p.source_temporal_rel || '-'})`
        )
      );
    }
    if (r.error) console.log(`     ⚠️ ${r.error.slice(0, 120)}`);
  }

  if (fp.length) {
    console.log('\n--- 逐条明细（误伤）---');
    for (const r of fp) {
      console.log(`❌ ${r.id}`);
      console.log(`   claim: ${r.claim.slice(0, 150)}`);
      r.conflicts.forEach((c) => console.log(`     ↳ [${c.kind}] ${c.why.slice(0, 200)}`));
    }
  }

  mkdirSync('eval-reports/semantic', { recursive: true });
  const out = `eval-reports/semantic/result${PROP_RETRY ? '-proprety' : ''}.json`;
  writeFileSync(
    out,
    JSON.stringify(
      {
        model: EXTRACT_MODEL,
        extractFailures,
        recall: { hit: hit.length, total: rec.length },
        precision: { fp: fp.length, total: pre.length },
        results: results.map((r) => ({ id: r.id, set: r.set, perturb: r.perturb, claim: r.claim, conflicts: r.conflicts, pairs: r.pairs, error: r.error })),
      },
      null,
      2
    )
  );
  console.log(`\n审计明细 → ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
