/**
 * 交叉核对：主曲线走 /meridian/chat（本地构造 prompt），这里用真端点
 * /meridian/intelligence/analyze-single-story 打同一个子集，确认墙钟同量级、
 * 且 selfCorrect 开关带来的第二次调用有多贵。
 *
 * 跑法：npx tsx crosscheck.ts <篇数> <selfCorrect:true|false>
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { pickSpreadArticles } from '../../src/lib/core/story-dedup.ts';

const HERE = new URL('.', import.meta.url).pathname;
const ENDPOINT = 'http://localhost:8787/meridian/intelligence/analyze-single-story';

interface Meta { id: number; title: string; url: string; pub: string }
const metas: Meta[] = readFileSync(`${HERE}out/meta.tsv`, 'utf-8').trim().split('\n').map((l) => {
  const [id, title, url, pub] = l.split('\t');
  return { id: Number(id), title, url, pub };
});
const byId = new Map(metas.map((m) => [m.id, m]));
const contentOf = (id: number) => {
  const f = `${HERE}.cache/content/${id}.txt`;
  return existsSync(f) ? readFileSync(f, 'utf-8') : '';
};
const pubMs = new Map(metas.map((m) => [m.id, new Date(m.pub.replace(' ', 'T') + 'Z').getTime()]));

const n = Number(process.argv[2] ?? 30);
const selfCorrect = process.argv[3] === 'true';
const ids = pickSpreadArticles(metas.map((m) => m.id), pubMs, n);
const articleData = ids.map((id) => ({
  id, title: byId.get(id)!.title, url: byId.get(id)!.url,
  publishDate: byId.get(id)!.pub, content: contentOf(id),
}));

const t0 = Date.now();
const r = await fetch(ENDPOINT, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    story: { title: 'Nepal-Tibet flash floods', importance: 8, articleIds: ids, storyType: 'SINGLE_STORY' },
    articleData, selfCorrect, skipCache: true,
  }),
  signal: AbortSignal.timeout(900_000),
});
const text = await r.text();
const wall = (Date.now() - t0) / 1000;
let j: any = null; try { j = JSON.parse(text); } catch {}
const rep = j?.data;
// 端点侧经 IntelligenceReportBuilder 已把 keyEntities 归一成 report.entities，字段名与模型原始输出不同
const ents = Array.isArray(rep?.entities) ? rep.entities : [];
const row = {
  kind: 'endpoint', n, selfCorrect, wall_s: Number(wall.toFixed(2)), http: r.status,
  ok: j?.success ?? false, status_field: rep?.status ?? null,
  timeline_n: Array.isArray(rep?.timeline) ? rep.timeline.length : null,
  entities_n: Array.isArray(ents) ? ents.length : null,
  report_chars: JSON.stringify(rep ?? {}).length,
  err: j?.success === false ? JSON.stringify(j).slice(0, 300) : '',
};
appendFileSync(`${HERE}out/crosscheck.jsonl`, JSON.stringify(row) + '\n');
console.log(JSON.stringify(row, null, 2));
