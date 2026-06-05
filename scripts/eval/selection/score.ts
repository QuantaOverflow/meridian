// 读已标注的 worklist CSV → 重建模型排序 → 算 NDCG@N。
// 模型排序 = 生产选择层排序键：importance + COVERAGE_WEIGHT·log2(1+独立源数)
//   (对齐 auto-brief-generation.ts:1023；CSV 无 article_ids，独立源数回 backend 现算)。
// 用法: BACKEND_URL=... tsx score.ts --labels worklist.csv [--n 10] [--exp]
import { readFile } from 'node:fs/promises';
import { ndcgAtN, ndcgAtNExp } from './metrics.js';
import { fetchCandidates, fetchSources } from './fetch.js';

// 生产覆盖度权重(auto-brief-generation.ts:1023)。改这里 = 改 eval 对齐的排序器。
const COVERAGE_WEIGHT = 1.0;

function parseArgs(argv: string[]) {
  let labels = '';
  let n = 10;
  let exp = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--labels') labels = argv[++i];
    else if (argv[i] === '--n') n = parseInt(argv[++i], 10);
    else if (argv[i] === '--exp') exp = true;
  }
  if (!labels) {
    console.log('用法: tsx score.ts --labels worklist.csv [--n 10] [--exp]');
    process.exit(1);
  }
  return { labels, n, exp };
}

// CSV 行解析(状态机，支持引号字段与内部双引号转义)
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

interface Row { wf: string; clusterId: number; importance: number; rel: number; title: string; }

async function main() {
  const { labels, n, exp } = parseArgs(process.argv.slice(2));
  const text = await readFile(labels, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const header = parseCsvLine(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const ci = { wf: col('workflow_id'), cl: col('cluster_id'), imp: col('importance'), rel: col('rel'), title: col('title') };

  const rows: Row[] = [];
  let unlabeled = 0;
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    const relRaw = (f[ci.rel] ?? '').trim();
    if (relRaw === '') { unlabeled++; continue; }
    rows.push({
      wf: f[ci.wf], clusterId: Number(f[ci.cl]), importance: Number(f[ci.imp]),
      rel: Number(relRaw), title: f[ci.title],
    });
  }
  if (unlabeled > 0) console.log(`[score] ⚠ ${unlabeled} 行 rel 未填，已跳过`);
  if (rows.length === 0) { console.log('[score] 没有已标注的行'); process.exit(1); }

  // 按 run 分组
  const byWf = new Map<string, Row[]>();
  for (const r of rows) (byWf.get(r.wf) ?? byWf.set(r.wf, []).get(r.wf)!).push(r);

  // 拉各 run 候选(含 article_ids)与 article→source 映射,按生产排序键算独立源数。
  // CSV 不含 article_ids,故须回 backend 取;与 coverage-compare.ts 同源。
  const candByWf = new Map<string, Map<number, number[]>>(); // wf → clusterId → articleIds
  const allIds = new Set<number>();
  for (const wf of byWf.keys()) {
    const m = new Map<number, number[]>();
    for (const c of await fetchCandidates(wf)) {
      m.set(c.clusterId, c.articleIds);
      c.articleIds.forEach(id => allIds.add(id));
    }
    candByWf.set(wf, m);
  }
  const id2src = await fetchSources([...allIds]);
  const distinct = (ids: number[]) => new Set(ids.map(i => id2src.get(i)).filter(x => x != null)).size;
  const prodScore = (wf: string, r: Row) =>
    r.importance + COVERAGE_WEIGHT * Math.log2(1 + distinct(candByWf.get(wf)?.get(r.clusterId) ?? []));

  const fn = exp ? ndcgAtNExp : ndcgAtN;
  const scores: number[] = [];
  console.log(`\n== NDCG@${n}${exp ? ' (指数增益)' : ''} 按 run (生产排序键 importance+${COVERAGE_WEIGHT}·log2(1+源)) ==`);
  for (const [wf, rs] of byWf) {
    // 模型排序：生产选择分降序(并列维持原序，稳定)
    const sc = new Map<Row, number>(rs.map(r => [r, prodScore(wf, r)]));
    const ranked = [...rs].sort((a, b) => sc.get(b)! - sc.get(a)!);
    const relsInRankOrder = ranked.map(r => r.rel);
    const s = fn(relsInRankOrder, n);
    scores.push(s);
    console.log(`  ${wf.slice(0, 18)}…  候选=${rs.length}  NDCG@${n}=${s.toFixed(3)}`);
  }
  const macro = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`\n== 宏平均 NDCG@${n} = ${macro.toFixed(3)}  (${scores.length} 个 run) ==`);
  console.log('  这是生产选择层(importance+覆盖度)的真·质量基线。');
  console.log('  覆盖度权重 W 的最优值/净效果对照见 coverage-compare.ts(扫 W，W=0 即纯 importance)。');
}

main().catch(e => { console.error(e); process.exit(1); });
