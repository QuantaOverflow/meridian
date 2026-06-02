// 两层 consensus 的组装步：把 per-day gold(第一层) 按 跨天合并组(第二层 tier2-xday consensus) 合并，
// 产出最终合池 gold。纯确定性数据操作，零 LLM。
//
// 用法: tsx build-pooled-gold.ts --days d1,d2,... --xday-key news-xday-0529-0601 --out-key news-pool-0529-0601
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReferencePartition } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '../../../eval-reports/clustering');

function parseArgs(argv: string[]) {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i];
  if (!o.days || !o['xday-key'] || !o['out-key']) {
    console.log('Usage: tsx build-pooled-gold.ts --days d1,d2,.. --xday-key <k> --out-key <k>');
    process.exit(1);
  }
  return o;
}

const anchorOf = (label: string) => Number(label.split(':')[1]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = args.days.split(',');

  // 第二层结果：每个合并组的 anchor ids → 组标签
  const xday = JSON.parse(
    await readFile(resolve(CACHE_DIR, `reference-${args['xday-key']}.json`), 'utf8')
  ) as ReferencePartition;
  const anchor2group = new Map<number, string>(); // anchor -> 合并组 key
  for (const g of xday.stories) for (const a of g.articleIds) anchor2group.set(a, g.label);

  // 第一层：4 天 per-day gold 并集；同一合并组的 per-day 故事累积到一起
  const merged = new Map<string, number[]>(); // 合并组 key -> 文章 ids
  const standalone: Array<{ label: string; articleIds: number[] }> = [];
  const unassigned: number[] = [];
  const seen = new Set<number>();

  for (const day of days) {
    const ref = JSON.parse(
      await readFile(resolve(CACHE_DIR, `reference-news-${day}.json`), 'utf8')
    ) as ReferencePartition;
    for (const s of ref.stories) {
      const ids = s.articleIds.filter(i => !seen.has(i));
      ids.forEach(i => seen.add(i));
      const grp = anchor2group.get(anchorOf(s.label));
      if (grp) (merged.get(grp) ?? merged.set(grp, []).get(grp)!).push(...ids);
      else standalone.push({ label: `${day}:${s.label}`, articleIds: ids });
    }
    for (const i of ref.unassigned || []) if (!seen.has(i)) { seen.add(i); unassigned.push(i); }
  }

  const stories = [
    ...[...merged.entries()].map(([k, ids]) => ({ label: `xday:${k}`, articleIds: ids.sort((a, b) => a - b) })),
    ...standalone,
  ];

  const grouped = stories.reduce((n, s) => n + s.articleIds.length, 0);
  const out: ReferencePartition & { frozen: boolean; tiers: object } = {
    workflowId: args['out-key'],
    judgeModel: 'qwen-long two-tier consensus (per-day + cross-day story-level)',
    promptHash: 'two-tier',
    createdAt: new Date().toISOString(),
    tiers: { tier1: `per-day gold (${days.join(',')})`, tier2: args['xday-key'], crossDayMergeGroups: xday.stories.length },
    stories,
    unassigned: unassigned.sort((a, b) => a - b),
    frozen: true,
  };
  await writeFile(resolve(CACHE_DIR, `reference-${args['out-key']}.json`), JSON.stringify(out, null, 2), 'utf8');

  const sizes = stories.map(s => s.articleIds.length).sort((a, b) => b - a);
  console.log(`合池 gold: ${stories.length} 故事 (跨天合并 ${merged.size} + 单日 ${standalone.length})`);
  console.log(`成组 ${grouped} + 单例 ${unassigned.length} = ${grouped + unassigned.length}`);
  console.log(`唯一性: ${new Set([...stories.flatMap(s => s.articleIds), ...unassigned]).size} 篇`);
  console.log(`故事大小(降序前15): [${sizes.slice(0, 15).join(', ')}]`);
  console.log(`-> reference-${args['out-key']}.json (frozen)`);
}

main().catch(e => { console.error(e); process.exit(1); });
