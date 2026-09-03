/**
 * 【扔掉型原型】端到端对照：storyline 分块的简报 vs 生产现状（report 76）。
 *
 * 生产现状（report 76 的尼泊尔一节）：11 个块，死亡数字在 5 个块里各报一遍（682/675/626/600/469），
 * 救援讲 4 遍，堰塞湖讲 3 遍，还有一块只有一句话。这是读者抱怨「重复播十遍」的原始材料。
 *
 * 新流程：storyline 5 票多数划分（storyline-vote.ts 产出）→ 每块一份情报报告 → 合成简报。
 * 5 块篇数 30/11/21/18/11，全部 ≤30，所以不触发截断，也就用不上要点补全。
 *
 * ⚠️ 2649（津巴布韦小巴车祸）是聚类误塞进本簇的，storyline 层把它归进了总述块。
 * 这里**保留**它——那是这条管线真实会做的事，藏起来就成了粉饰。
 *
 * 跑法：npx tsx e2e-storyline.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian';
const WF = 'admin-brief-1788058777778';
const CACHE = new URL('./.cache/', import.meta.url).pathname;

// storyline-vote.ts 的 5 票多数划分
const BLOCKS: Array<{ name: string; ids: number[] }> = [
  { name: 'Nepal-Tibet floods overview', ids: [2637, 2639, 2642, 2647, 2648, 2649] },
  { name: 'Rescue operations', ids: [2635, 2636, 2650] },
  { name: 'Missing foreigners', ids: [2634, 2638, 2641, 2643, 2646, 2654, 2655] },
  { name: 'Geological causes and risks', ids: [2644, 2645, 2652, 2653] },
  { name: 'International response', ids: [2640, 2651] },
];

const DB = readFileSync('/Users/shiwenjie/Desktop/playground/projects/meridian/apps/frontend/.env', 'utf-8')
  .split('\n').find((l) => l.startsWith('NUXT_DATABASE_URL='))!.slice(18).replace(/"/g, '');
function psql(q: string): string[][] {
  for (let k = 0; ; k++) {
    try {
      return execFileSync('psql', [DB, '-At', '-F', '\t', '-c', q],
        { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }).trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
    } catch (e) { if (k >= 4) throw e; execFileSync('sleep', ['3']); }
  }
}
const storyArts = new Map<number, number[]>(psql(
  `SELECT id, coalesce(article_ids::text,'[]') FROM brief_stories WHERE workflow_id='${WF}' AND cluster_id=47`)
  .map((r) => [Number(r[0]), JSON.parse(r[1]) as number[]]));
const meta = new Map<number, { title: string; url: string; pub: string }>(psql(
  `SELECT id, coalesce(title,''), coalesce(url,''), coalesce(publish_date::text,'') FROM articles
   WHERE id IN (${[...new Set([...storyArts.values()].flat())].join(',')})`)
  .map((r) => [Number(r[0]), { title: r[1], url: r[2], pub: r[3] }]));

const contentOf = (id: number) => {
  const f = `${CACHE}content/${id}.txt`;
  return existsSync(f) ? readFileSync(f, 'utf-8') : '';
};
{ // 卫生：5 块必须覆盖全部 22 条 story，不重不漏
  const all = BLOCKS.flatMap((b) => b.ids);
  if (new Set(all).size !== all.length) throw new Error('卫生断言失败：块之间有重复 story');
  if (all.length !== storyArts.size) throw new Error(`卫生断言失败：块覆盖 ${all.length} 条，簇内有 ${storyArts.size} 条`);
}

async function post(path: string, body: any): Promise<any> {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j: any = await r.json();
  if (j?.success === false) throw new Error(`${path} 失败：${j?.error}`);
  return j?.data ?? j;
}

console.log('═══ 每块一份情报报告');
const reports: any[] = [];
await Promise.all(BLOCKS.map(async (b, i) => {
  const ids = b.ids.flatMap((s) => storyArts.get(s)!);
  const articleData = [...new Set(ids)].map((id) => ({
    id, title: meta.get(id)!.title, url: meta.get(id)!.url, publishDate: meta.get(id)!.pub, content: contentOf(id),
  })).filter((a) => a.content.trim());
  const t0 = Date.now ? 0 : 0;
  const rep = await post('/intelligence/analyze-single-story', {
    story: { title: b.name, importance: 8, articleIds: articleData.map((a) => a.id), storyType: 'SINGLE_STORY' },
    articleData, options: { analysis_depth: 'detailed' }, skipCache: true,
  });
  if (rep?.status === 'incomplete') throw new Error(`${b.name} 报告 incomplete：${rep?.reason}`);
  reports[i] = rep;
  console.log(`  ✓ ${b.name.padEnd(30)} ${String(articleData.length).padStart(2)} 篇 → 报告 ${JSON.stringify(rep).length} 字符`);
}));

console.log('\n═══ 合成简报');
const brief = await post('/generate-final-brief', { analysisData: reports, previousBrief: null, options: {} });
const md = typeof brief === 'string' ? brief : (brief?.content ?? brief?.brief ?? JSON.stringify(brief, null, 1));
console.log(`  简报 ${md.length} 字符`);
writeFileSync('e2e-storyline-out.json', JSON.stringify({ blocks: BLOCKS, reports, brief }, null, 1));
writeFileSync('e2e-storyline-brief.md', md);
console.log('\n落盘：e2e-storyline-brief.md / e2e-storyline-out.json');
