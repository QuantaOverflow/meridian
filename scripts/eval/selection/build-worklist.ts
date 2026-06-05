// 生成待标清单 CSV：每行一个候选 story，你在 rel 列填 0-3。
// rel 语义：0=不该上(噪音/纯本地)  1=可上可不上(边缘)  2=该上(重要)  3=必上(漏了是事故)
// 用法: BACKEND_URL=... tsx build-worklist.ts --wf <workflowId> [--wf <id2> ...] [--out worklist.csv]
import { writeFile } from 'node:fs/promises';
import { fetchCandidates } from './fetch.js';

function parseArgs(argv: string[]) {
  const wfs: string[] = [];
  let out = 'worklist.csv';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--wf') wfs.push(argv[++i]);
    else if (argv[i] === '--out') out = argv[++i];
  }
  if (wfs.length === 0) {
    console.log('用法: tsx build-worklist.ts --wf <workflowId> [--wf <id2>] [--out worklist.csv]');
    process.exit(1);
  }
  return { wfs, out };
}

// CSV 转义：含逗号/引号/换行的字段加引号、内部引号翻倍
function csvCell(s: string): string {
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  const { wfs, out } = parseArgs(process.argv.slice(2));
  const rows: string[] = ['workflow_id,cluster_id,importance,article_count,title,rel'];
  for (const wf of wfs) {
    const cands = await fetchCandidates(wf);
    console.log(`[worklist] ${wf}: ${cands.length} 候选`);
    for (const c of cands) {
      rows.push([wf, c.clusterId, c.importance, c.articleCount, csvCell(c.title), ''].join(','));
    }
  }
  await writeFile(out, rows.join('\n') + '\n', 'utf8');
  console.log(`[worklist] 写出 ${rows.length - 1} 行 → ${out}`);
  console.log('  打开 CSV，在 rel 列逐行填 0-3，存回原文件，再跑 `tsx score.ts --labels ' + out + '`。');
}

main().catch(e => { console.error(e); process.exit(1); });
