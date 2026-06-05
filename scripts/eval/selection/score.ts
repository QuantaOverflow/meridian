// 读已标注的 worklist CSV → 重建模型排序 → 算 NDCG@N。
// 模型排序 = 选择层当前/历史行为：按 importance 降序(覆盖度排序的对照见末尾说明)。
// 用法: tsx score.ts --labels worklist.csv [--n 10] [--exp]
import { readFile } from 'node:fs/promises';
import { ndcgAtN, ndcgAtNExp } from './metrics.js';

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

  const fn = exp ? ndcgAtNExp : ndcgAtN;
  const scores: number[] = [];
  console.log(`\n== NDCG@${n}${exp ? ' (指数增益)' : ''} 按 run ==`);
  for (const [wf, rs] of byWf) {
    // 模型排序：importance 降序(并列时维持原序，稳定)
    const ranked = [...rs].sort((a, b) => b.importance - a.importance);
    const relsInRankOrder = ranked.map(r => r.rel);
    const s = fn(relsInRankOrder, n);
    scores.push(s);
    console.log(`  ${wf.slice(0, 18)}…  候选=${rs.length}  NDCG@${n}=${s.toFixed(3)}`);
  }
  const macro = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`\n== 宏平均 NDCG@${n} = ${macro.toFixed(3)}  (${scores.length} 个 run) ==`);
  console.log('  这是"按 importance 排序"的选择层质量基线。下一步：再算一遍"按 importance+覆盖度排序"的 NDCG 做对照，');
  console.log('  两者之差即 ② 覆盖度改动对选择质量的净效果(需把 distinct source 数接进来，story 已带 article_ids)。');
}

main().catch(e => { console.error(e); process.exit(1); });
