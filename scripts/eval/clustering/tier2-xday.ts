// 两层 consensus 的第二层：跨天合并。
// 第一层(build-gold-by-day)已对每天 ≤241 篇产出合规 per-day gold。
// 但 634 篇一次性走流程会触发 qwen-long 8k 输出截断(实测 finish_reason=length)，
// 所以跨天合并不在原文层做，而是把"每个 per-day 故事"抽象成一个 item(代表标题+成员标题摘要)，
// 对这 ~48 个 item 再跑一次 *同一套* consensus(N 次 qwen + co-association + 后处理)。
// 输入只有几十条摘要 → 绝不截断；输出的每个 ≥2 组 = 一组该合并的 per-day 故事(按 anchor id)。
//
// 用法: tsx tier2-xday.ts --days 2026-05-29,2026-05-30,2026-05-31,2026-06-01 \
//          --titles /tmp/pool_titles.json [--model qwen-long] [--runs 5] [--refresh]
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReference } from './reference.js';
import type { ArticleInfo, ReferencePartition } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '../../../eval-reports/clustering');

function parseArgs(argv: string[]) {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i];
  if (!o.days || !o.titles) {
    console.log('Usage: tsx tier2-xday.ts --days d1,d2,... --titles /tmp/pool_titles.json [--model qwen-long] [--runs 5] [--refresh]');
    process.exit(1);
  }
  return o;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = args.days.split(',');
  const titles = JSON.parse(await readFile(args.titles, 'utf8')) as Record<string, string>;

  // 把每个 per-day 多篇故事抽象成一个 item：id=anchor，title=代表标题，points=成员标题(最多4)
  const items: ArticleInfo[] = [];
  const anchorMeta: Record<number, { day: string; size: number; title: string }> = {};
  for (const day of days) {
    const ref = JSON.parse(await readFile(resolve(CACHE_DIR, `reference-news-${day}.json`), 'utf8')) as ReferencePartition;
    for (const s of ref.stories) {
      const anchor = Number(s.label.split(':')[1]);
      const memberTitles = s.articleIds.map(i => titles[String(i)]).filter(Boolean);
      items.push({
        id: anchor,
        title: titles[String(anchor)] || s.label,
        event_summary_points: memberTitles.slice(0, 4),
      });
      anchorMeta[anchor] = { day, size: s.articleIds.length, title: titles[String(anchor)] || s.label };
    }
  }
  console.log(`[tier2] ${days.length} 天共 ${items.length} 个 per-day 故事作为 item，送入第二层 consensus`);

  // 复用同一套 consensus 机器(N 次 qwen + co-association average-linkage + 后处理 + calibration)
  const ref = await buildReference('news-xday-0529-0601', items, {
    model: args.model || 'qwen-long',
    runs: args.runs ? parseInt(args.runs, 10) : 5,
    refresh: args.refresh === undefined ? false : true,
  });

  // 输出：每个 ≥2 组 = 一组跨天合并(anchor ids)。打印供 audit。
  console.log(`\n===== 第二层 consensus：跨天合并候选 =====`);
  console.log(`${ref.stories.length} 个合并组 (其余 ${ref.unassigned?.length ?? 0} 个 per-day 故事保持独立)\n`);
  for (const g of ref.stories) {
    console.log(`组 [${g.label}]:`);
    for (const a of g.articleIds) {
      const m = anchorMeta[a];
      console.log(`   ${a}  (${m?.day}, n=${m?.size})  ${m?.title?.slice(0, 60)}`);
    }
  }
  console.log(`\n参考文件 -> ${resolve(CACHE_DIR, 'reference-news-xday-0529-0601.json')}`);
  console.log('audit 后用 build-pooled-gold 应用这些合并组装最终合池 gold。');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
