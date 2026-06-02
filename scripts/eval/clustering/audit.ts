// 人工核查 gold：列出某 key 的 consensus 组(带标题)，供 calibration 判定离群/漏合并。
// 用法: tsx audit.ts --key news-2026-05-29
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fetchArticles } from './fetch.js';

async function main() {
  const i = process.argv.indexOf('--key');
  const key = i >= 0 ? process.argv[i + 1] : '';
  if (!key) {
    console.log('Usage: tsx audit.ts --key <name>');
    process.exit(1);
  }
  const ref = JSON.parse(
    await readFile(resolve(`eval-reports/clustering/reference-${key}.json`), 'utf8')
  ) as { stories: Array<{ label: string; articleIds: number[] }>; unassigned: number[] };

  const allIds = [...new Set([...ref.stories.flatMap(s => s.articleIds), ...ref.unassigned])];
  const m = await fetchArticles(allIds);
  const t = (id: number) => m.get(id)?.title ?? '??';

  const sizes = ref.stories.map(s => s.articleIds.length).sort((a, b) => b - a);
  console.log(`### ${key}: ${ref.stories.length} 组, 组大小 [${sizes.join(', ')}] ###`);
  ref.stories.forEach((s, i) => {
    console.log(`\n[组${i + 1}] (${s.articleIds.length})`);
    s.articleIds.forEach(id => console.log(`   [${id}] ${t(id)}`));
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
