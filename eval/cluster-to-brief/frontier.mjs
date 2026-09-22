/**
 * 把盲判结果回填到各臂,跑完两档,按**事先声明的轴**排出 Pareto frontier。零 LLM。
 *
 * 为什么要盲判:目录名直接写着 `direct-raw-grounded`,判官看得见臂身份。
 * 比较臂的那一轮必须盲,否则读数里混着判官对臂名的先验。
 * `build-blind.mjs` 把包拷进洗过牌的代号目录,判完由本脚本按 MAP.json 回填。
 *
 * **轴在跑之前声明,不许跑完再挑** —— 跑完挑轴就是挑数据:
 *   1. 核心层覆盖率        目前唯一有分辨力的质量轴
 *   2. 正确性 fatal/hard/distortion   **当前退化**:fatal/hard 在测过的格子上全 0
 *   3. 引用不足率          citedSentenceSuffices=false 占比
 *   4. 块内冗余率          同块两句引同一条原句(快档,机械)
 *   5. 成本                LLM 调用数(direct-raw 家族读 run.json 的 windows;其余读 calls.jsonl)
 *
 * 用法: node frontier.mjs [--clusters=1,7,36,37,43]
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const HERE = new URL('.', import.meta.url).pathname;
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)=?(.*)$/.exec(a);
  return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
}));
const CIDS = String(args.clusters ?? '1,7,36,37,43').split(',').map(Number);

const MAP = JSON.parse(readFileSync(`${HERE}out/_blind/MAP.json`, 'utf8'));
// 生产基线不参与盲化(它一句出处都没有,判官一眼认得出,盲不了),但必须在**同一把尺**下同表比较。
// 它的判定直接落在 out/_production-r94/,不经 _blind 回填。
const BASELINE = '_production-r94';
const HAS_BASELINE = existsSync(`${HERE}out/${BASELINE}/verdict-c43.json`);

// ── 回填 ────────────────────────────────────────────────────────────────
let filled = 0, missing = [];
for (const [code, arm] of Object.entries(MAP)) {
  for (const c of CIDS) {
    const src = `${HERE}out/_blind/${code}/verdict-c${c}.json`;
    const packSrc = `${HERE}out/_blind/${code}/pack-c${c}.md`;
    if (!existsSync(packSrc)) continue;          // 该臂在该簇判了不可写,没有包
    if (!existsSync(src)) { missing.push(`${arm} c${c}`); continue; }
    copyFileSync(src, `${HERE}out/${arm}/verdict-c${c}.json`);
    filled++;
  }
}
console.log(`回填 ${filled} 份判定${missing.length ? `,缺 ${missing.length} 份: ${missing.join(', ')}` : ''}`);
if (missing.length) { console.error('\n判定不全,先补齐再算 frontier'); process.exit(2); }

// ── 跑两档 ──────────────────────────────────────────────────────────────
// **每臂只跑一次**,不能每簇跑一次:两个脚本的输出文件名都是 `<script>-<arm>-<split>.json`,
// 按簇跑会一簇覆盖一簇,最后只剩最后那簇的读数 —— 而且不报错,表会照常打出来。
const run = (script, arm) => {
  try {
    execFileSync('node', [`${HERE}${script}`, `--arm=${HERE}out/${arm}`, '--split=dev'], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { /* 退出码不为 0 是正常的(不合格/别的簇没判),读数照样落盘 */ }
};
for (const arm of [...Object.values(MAP), ...(HAS_BASELINE ? [BASELINE] : [])]) { run('verify.mjs', arm); run('score-slow.mjs', arm); }

// ── 判官模型必须同一轮一致 ────────────────────────────────────────────────
// 判官是 scorer 的一部分。混模型的 frontier 不是"有噪声",是**不可比** —— 而且不会报错。
const models = new Map();
for (const arm of Object.values(MAP)) for (const c of CIDS) {
  const mf = `${HERE}out/${arm}/judge-pack-c${c}.meta.json`;
  if (!existsSync(mf)) continue;
  const m = JSON.parse(readFileSync(mf, 'utf8')).judgeModel ?? '(未记录)';
  if (!models.has(m)) models.set(m, []);
  models.get(m).push(`${arm} c${c}`);
}
if (models.size > 1) {
  console.error('\n判官模型不一致,这一轮不可比:');
  for (const [m, cells] of models) console.error(`  ${m}: ${cells.length} 个格子 — ${cells.slice(0, 3).join(', ')}${cells.length > 3 ? '…' : ''}`);
  console.error('同一轮必须用同一个判官模型。重建这些格子的判定包并重判,或分开两张表。');
  process.exit(2);
}
console.log(`判官模型: ${[...models.keys()][0] ?? '(无)'}`);

// ── 成本 ────────────────────────────────────────────────────────────────
function calls(arm, cid) {
  const r = `${HERE}out/${arm}/c${cid}-run.json`;
  if (existsSync(r)) { const x = JSON.parse(readFileSync(r, 'utf8')); return x.windows ?? null; }
  const j = `${HERE}out/${arm}/calls.jsonl`;
  if (existsSync(j)) {
    return readFileSync(j, 'utf8').trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(x => x && (x.cluster === cid || String(x.tag ?? '').includes(`c${cid}`))).length || null;
  }
  return null;
}

// ── 汇总 ────────────────────────────────────────────────────────────────
const rows = [];
for (const arm of [...Object.values(MAP), ...(HAS_BASELINE ? [BASELINE] : [])]) {
  const agg = { arm, cells: 0, rejected: 0, sents: 0, claims: 0, fatal: 0, hard: 0, dist: 0,
    coreHit: 0, coreOf: 0, citedBad: 0, citedAll: 0, redSents: 0, impureSents: 0, gap: 0, gapOf: 0, calls: 0, callsKnown: true, fails: [] };
  for (const c of CIDS) {
    const sf = `${HERE}out/slow-${arm}-dev.json`, vf = `${HERE}out/verify-${arm}-dev.json`;
    const sr = existsSync(sf) ? JSON.parse(readFileSync(sf, 'utf8')).results?.[c] : null;
    const vr = existsSync(vf) ? JSON.parse(readFileSync(vf, 'utf8')).results?.[c] : null;
    if (!sr) continue;
    if (sr.read?.skipped) { agg.rejected++; continue; }
    if (sr.envProblems?.length) continue;   // 本轮没判的簇(c1/c36)静默跳过
    agg.cells++;
    const d = sr.read;
    agg.claims += d.claims ?? 0;
    agg.fatal += d.errors?.fatal ?? 0; agg.hard += d.errors?.hard ?? 0; agg.dist += d.errors?.distortion ?? 0;
    agg.coreHit += d.coverage?.core?.hit ?? 0; agg.coreOf += d.coverage?.core?.of ?? 0;
    agg.citedBad += d.citation?.insufficient ?? 0; agg.citedAll += d.citation?.judged ?? 0;
    agg.gap += d.pack?.citedNotInEvidence ?? 0; agg.gapOf += d.pack?.citedSources ?? 0;
    agg.sents += vr?.read?.sentences ?? 0;
    agg.redSents += vr?.read?.redundantSentences ?? 0;
    agg.impureSents += vr?.read?.impureSentences ?? 0;
    for (const f of vr?.failures ?? []) agg.fails.push(`c${c}[快档]: ${f}`);
    if (!sr.pass) agg.fails.push(`c${c}: ${sr.failures?.[0] ?? '不合格'}`);
    const k = calls(arm, c);
    if (k === null) agg.callsKnown = false; else agg.calls += k;
  }
  rows.push(agg);
}

const pct = (n, d) => (d ? +((100 * n) / d).toFixed(1) : null);
const show = v => (v === null ? '—' : String(v));

console.log(`\nPareto frontier · 簇 ${CIDS.map(c => 'c' + c).join(' ')} · 盲判\n`);
console.log('臂                              判/拒  句   杂质       核心层覆盖    引用不足   块内冗余   致命 硬错 失真  调用');
// 按读者体验的重要性排:杂质(能直接感知)优先于覆盖(静默)
for (const r of rows.sort((a, b) => (pct(a.impureSents, a.sents) ?? 99) - (pct(b.impureSents, b.sents) ?? 99) || (pct(b.coreHit, b.coreOf) ?? -1) - (pct(a.coreHit, a.coreOf) ?? -1))) {
  console.log(
    `${r.arm.padEnd(30)} ${String(r.cells).padStart(2)}/${r.rejected}  ${String(r.sents).padStart(3)}  ` +
    `${`${r.impureSents}/${r.sents} (${show(pct(r.impureSents, r.sents))}%)`.padEnd(10)} ` +
    `${`${r.coreHit}/${r.coreOf} (${show(pct(r.coreHit, r.coreOf))}%)`.padEnd(13)} ` +
    `${`${r.citedBad}/${r.citedAll} (${show(pct(r.citedBad, r.citedAll))}%)`.padEnd(10)} ` +
    `${`${r.redSents}/${r.sents} (${show(pct(r.redSents, r.sents))}%)`.padEnd(10)} ` +
    `${String(r.fatal).padStart(4)} ${String(r.hard).padStart(4)} ${String(r.dist).padStart(4)}  ` +
    `${(r.callsKnown ? String(r.calls) : '—').padStart(4)}`
  );
}

// ── Pareto:只在"越大越好/越小越好"方向明确的轴上比 ────────────────────────
// 声明的第 2 条轴是「正确性 fatal/hard/distortion」。2026-09-19 首轮跑之前 hard 在测过的格子上全 0,
// 所以只拿 distortion 代表它;加了「消息源剥离」这条守则之后 hard 不再全 0(routed 3、多数 1),
// 于是把 hard 也算回来 —— 这是**把声明过的轴补全**,不是跑完再加新轴。
const axes = [
  { k: 'impure', better: 'min', of: r => pct(r.impureSents, r.sents) },
  { k: 'cov', better: 'max', of: r => pct(r.coreHit, r.coreOf) },
  { k: 'cite', better: 'min', of: r => pct(r.citedBad, r.citedAll) },
  { k: 'redund', better: 'min', of: r => pct(r.redSents, r.sents) },
  { k: 'hardRate', better: 'min', of: r => pct(r.fatal * 3 + r.hard, r.claims) },
  { k: 'distRate', better: 'min', of: r => pct(r.dist, r.claims) },
];
const dominates = (a, b) => {
  let strictly = false;
  for (const ax of axes) {
    const va = ax.of(a), vb = ax.of(b);
    if (va === null || vb === null) return false;
    const aBetter = ax.better === 'max' ? va > vb : va < vb;
    const aWorse = ax.better === 'max' ? va < vb : va > vb;
    if (aWorse) return false;
    if (aBetter) strictly = true;
  }
  return strictly;
};
const front = rows.filter(r => !rows.some(o => o !== r && dominates(o, r)));
console.log(`\nfrontier(未被支配): ${front.map(r => r.arm).join(', ')}`);
const dominated = rows.filter(r => !front.includes(r));
if (dominated.length) console.log(`被支配:            ${dominated.map(r => r.arm).join(', ')}`);
console.log('\n注:轴有 6 条、点只有 5 个,支配关系天然稀少 —— frontier 里留下谁,信息量低于各轴的具体取值。');
console.log('注:[快档] 开头的不合格是杂质率/二元判据,与慢档的覆盖、正确性是两回事 —— 两档都过才算五簇全过。');
console.log('注:块内冗余是机械读数(同块两句引同一条原句),只报不设门 —— 两句展开同一原句的不同侧面是正当写法。');
for (const r of rows) for (const f of r.fails) console.log(`  [${r.arm}] ${f}`);

writeFileSync(`${HERE}out/frontier.json`, `${JSON.stringify({ at: new Date().toISOString(), clusters: CIDS, map: MAP, rows, frontier: front.map(r => r.arm) }, null, 1)}\n`);
console.log(`\n落盘: out/frontier.json`);
