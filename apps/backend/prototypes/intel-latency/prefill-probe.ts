/**
 * prefill 隔离探针：同一批 prompt，把 max_tokens 压到很小（默认 200），
 * 于是墙钟 ≈ prefill + 极少量 decode。把这条曲线和主曲线一比，就能把
 * 「读输入慢」与「写输出慢」两段拆开——主曲线里两段是混在一起的。
 *
 * 跑法：npx tsx prefill-probe.ts <篇数,篇数,...> <重复次数> [max_tokens]
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { AIResponseParser } from '../../../../services/meridian-ai-worker/src/utils/ai-response-parser.ts';
import { getIntelligenceAnalysisPrompt } from '../../../../services/meridian-ai-worker/src/prompts/intelligenceAnalysis.ts';
import { pickSpreadArticles } from '../../src/lib/core/story-dedup.ts';

const HERE = new URL('.', import.meta.url).pathname;
const ENDPOINT = 'http://localhost:8787/meridian/chat';
const MODEL = '@cf/zai-org/glm-4.7-flash';

interface Meta { id: number; title: string; url: string; pub: string }
const metas: Meta[] = readFileSync(`${HERE}out/meta.tsv`, 'utf-8').trim().split('\n').map((l) => {
  const [id, title, url, pub] = l.split('\t');
  return { id: Number(id), title, url, pub };
});
const byId = new Map(metas.map((m) => [m.id, m]));
const contentOf = (id: number) => readFileSync(`${HERE}.cache/content/${id}.txt`, 'utf-8');
const pubMs = new Map(metas.map((m) => [m.id, new Date(m.pub.replace(' ', 'T') + 'Z').getTime()]));
const ALL = metas.map((m) => m.id);

const NS = (process.argv[2] ?? '10,30,60,81').split(',').map(Number);
const REPS = Number(process.argv[3] ?? 3);
const CAP = Number(process.argv[4] ?? 200);

for (const n of NS) {
  const ids = pickSpreadArticles(ALL, pubMs, n);
  const md = AIResponseParser.buildArticleMarkdown(ids.map((id) => ({
    id, title: byId.get(id)!.title, url: byId.get(id)!.url, publishDate: byId.get(id)!.pub, content: contentOf(id),
  })));
  const prompt = AIResponseParser.limitTokens(getIntelligenceAnalysisPrompt(md), 112500);
  for (let rep = 1; rep <= REPS; rep++) {
    const t0 = Date.now();
    let http = 0, j: any = null, err = '';
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }],
          options: { provider: 'workers-ai', model: MODEL, temperature: 0.1, max_tokens: CAP, skipCache: true } }),
        signal: AbortSignal.timeout(600_000),
      });
      http = r.status; j = JSON.parse(await r.text());
    } catch (e: any) { err = String(e?.message ?? e); }
    const wall = (Date.now() - t0) / 1000;
    const u = j?.data?.usage ?? {};
    const row = { kind: 'prefill', n, rep, cap: CAP, in_chars: prompt.length,
      prompt_tokens: u.prompt_tokens ?? null, completion_tokens: u.completion_tokens ?? null,
      wall_s: Number(wall.toFixed(2)), http,
      finish_reason: j?.data?.choices?.[0]?.finish_reason ?? '', err };
    appendFileSync(`${HERE}out/prefill.jsonl`, JSON.stringify(row) + '\n');
    console.log(`  n=${String(n).padStart(2)} rep${rep}  ${row.wall_s}s  in_tok=${row.prompt_tokens} out_tok=${row.completion_tokens} http=${http} ${err}`);
  }
}
console.log('完成，读数在 out/prefill.jsonl');
