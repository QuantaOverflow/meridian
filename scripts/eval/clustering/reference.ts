// 用强模型(qwen-max)产一份"语义参考划分"：把当天文章分成故事。
// 这是 eval 里唯一的 LLM 步骤，每个 run 只跑一次并缓存(可复现 + 省成本)。
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArticleInfo, ReferencePartition } from './types.js';

const AI_WORKER_URL =
  process.env.AI_WORKER_URL || 'https://meridian-ai-worker.swj299792458.workers.dev';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '../../../eval-reports/clustering');

const PROMPT = (arts: ArticleInfo[]) =>
  `
You are a senior news editor. Below are today's news articles (each: [id] title + key points).
Group them into distinct NEWS STORIES.

# Definition of a story
A story = articles about ONE concrete event/situation (and its direct consequences).
Multiple outlets covering the same incident = ONE story. Different events = different stories,
even if they share a broad theme (e.g. "China trade talks" and "China-Taiwan tension" are
TWO stories, not one "China" story).

# Rules
- EVERY article id must appear in exactly one group.
- An article about a unique event that no other article covers = its own single-article group.
- Do NOT merge articles just because they share a region, country, or topic word.

# Articles
${arts.map(a => `[${a.id}] ${a.title}${a.event_summary_points?.length ? '\n    - ' + a.event_summary_points.slice(0, 4).join('\n    - ') : ''}`).join('\n')}

# Output
Reply with ONLY a JSON object inside a \`\`\`json fenced block. No prose.
{
  "stories": [
    { "label": "<short story title>", "articleIds": [<id>, ...] }
  ]
}
`.trim();

function parseJSON(raw: string): { stories: Array<{ label: string; articleIds: number[] }> } | null {
  const candidates: string[] = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  const f = raw.indexOf('{');
  const l = raw.lastIndexOf('}');
  if (f >= 0 && l > f) candidates.push(raw.slice(f, l + 1));
  for (const c of candidates) {
    try {
      const o = JSON.parse(c.replace(/,(\s*[}\]])/g, '$1').trim());
      if (Array.isArray(o?.stories)) return o;
    } catch {
      /* next */
    }
  }
  return null;
}

function promptHash(arts: ArticleInfo[]): string {
  const ids = arts.map(a => a.id).sort((a, b) => a - b).join(',');
  return createHash('sha1').update(PROMPT([]) + '|' + ids).digest('hex').slice(0, 8);
}

export async function buildReference(
  workflowId: string,
  articles: ArticleInfo[],
  opts: { model?: string; refresh?: boolean } = {}
): Promise<ReferencePartition> {
  const model = opts.model || 'qwen-max';
  const hash = promptHash(articles);
  const cachePath = resolve(CACHE_DIR, `reference-${workflowId}.json`);

  if (!opts.refresh) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8')) as ReferencePartition;
      if (cached.promptHash === hash && cached.judgeModel === model) {
        console.log(`[reference] 命中缓存 ${cachePath}`);
        return cached;
      }
    } catch {
      /* no cache */
    }
  }

  console.log(`[reference] 调用 ${model} 产参考划分 (${articles.length} 篇)...`);
  const resp = await fetch(`${AI_WORKER_URL}/meridian/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: PROMPT(articles) }],
      options: { provider: 'dashscope', model, temperature: 0, max_tokens: 4000 },
    }),
  });
  if (!resp.ok) throw new Error(`参考划分 LLM 调用失败 ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = (await resp.json()) as { data?: { choices?: Array<{ message?: { content?: string } }> } };
  const content = data?.data?.choices?.[0]?.message?.content || '';
  const parsed = parseJSON(content);
  if (!parsed) throw new Error(`参考划分 JSON 解析失败; raw: ${content.slice(0, 200)}`);

  // 校验覆盖：LLM 可能漏掉/重复 id。漏掉的补成各自单例(unassigned)。
  const assigned = new Set<number>();
  for (const s of parsed.stories) for (const id of s.articleIds) assigned.add(id);
  const unassigned = articles.map(a => a.id).filter(id => !assigned.has(id));
  if (unassigned.length) console.warn(`[reference] ${unassigned.length} 篇未被 LLM 归组，按单例处理`);

  const ref: ReferencePartition = {
    workflowId,
    judgeModel: model,
    promptHash: hash,
    createdAt: new Date().toISOString(),
    stories: parsed.stories,
    unassigned,
  };
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath, JSON.stringify(ref, null, 2), 'utf8');
  console.log(`[reference] 写入 ${cachePath} (${ref.stories.length} 个故事)`);
  return ref;
}
