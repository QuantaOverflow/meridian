// 数据底座：对"某天的纯新闻文章"产一份 qwen 语义参考(gold)。
// 取数复用现有 by-ids 端点；ids 由调用方从 DB 按天 + category='news' 取好后传入。
// 用法: tsx build-gold-by-day.ts --key news-2026-05-29 --ids-file /tmp/ids.txt [--model qwen-long] [--refresh]
import { readFile } from 'node:fs/promises';
import { fetchArticles } from './fetch.js';
import { buildReference } from './reference.js';

function parseArgs(argv: string[]) {
  const out: { key?: string; idsFile?: string; ids?: string; model: string; refresh: boolean; runs?: number; tau?: number; freeze?: boolean } = {
    model: 'qwen-long',
    refresh: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--key') out.key = argv[++i];
    else if (a === '--ids-file') out.idsFile = argv[++i];
    else if (a === '--ids') out.ids = argv[++i];
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--refresh') out.refresh = true;
    else if (a === '--runs') out.runs = parseInt(argv[++i], 10);
    else if (a === '--tau') out.tau = parseFloat(argv[++i]);
    else if (a === '--freeze') out.freeze = true;
  }
  if (!out.key || (!out.idsFile && !out.ids)) {
    console.log('Usage: tsx build-gold-by-day.ts --key <name> (--ids-file <path> | --ids "1,2,3") [--model qwen-long] [--runs 5] [--tau 0.75] [--refresh] [--freeze]');
    process.exit(1);
  }
  return out as { key: string; idsFile?: string; ids?: string; model: string; refresh: boolean; runs?: number; tau?: number; freeze?: boolean };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = args.ids ?? (await readFile(args.idsFile!, 'utf8'));
  const ids = raw
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n));
  console.log(`[gold] key=${args.key} model=${args.model} 输入 ${ids.length} 个 id`);

  const map = await fetchArticles(ids);
  const articles = ids.map(i => map.get(i)).filter((a): a is NonNullable<typeof a> => !!a);
  console.log(`[gold] 取到 ${articles.length}/${ids.length} 篇文章详情`);

  const ref = await buildReference(args.key, articles, {
    model: args.model,
    refresh: args.refresh,
    runs: args.runs,
    tau: args.tau,
    freeze: args.freeze,
  });

  const single = ref.unassigned.length;
  const groupedArticles = articles.length - single;
  const pct = (n: number) => ((n / articles.length) * 100).toFixed(0);
  console.log('\n===== gold 形态 =====');
  console.log(`多篇故事数  = ${ref.stories.length}`);
  console.log(`成组文章    = ${groupedArticles} (${pct(groupedArticles)}%)`);
  console.log(`单例文章    = ${single} (${pct(single)}%)  ← 过滤 HN 前富样本是 ~87%`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
