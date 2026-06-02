// 用强模型产一份"语义参考划分"(gold)：把当天文章分成故事。
// LLM 非确定(temp=0 也不保证，根因是 batch-invariance)，故分两层：
//   raw 层 ：并行 N 次 qwen 原始分组 → 缓存固化一次(贵且抖)。
//   consensus 层：对固定 raw 做 co-association 聚合(确定性，tau 可调免费)→ 后处理 → 人工 calibration。
// 冻结：reference-{key}.json 标 "frozen": true 后，直接返回、无视 refresh/tau/prompt 变动。
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArticleInfo, ReferencePartition } from './types.js';

const AI_WORKER_URL =
  process.env.AI_WORKER_URL || 'https://meridian-ai-worker.swj299792458.workers.dev';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '../../../eval-reports/clustering');

type Story = { label: string; articleIds: number[] };

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
- ONLY output stories with 2 OR MORE articles. Never list a single-article story (omitted articles
  are auto-treated as their own story). Double-check every group you output has >=2 ids.
- If two articles have NEARLY IDENTICAL titles, they are the SAME event — you MUST group them together.
- Include follow-up / reaction / live-update / casualty-update coverage of the SAME ongoing event in
  that event's group (condemnations, denials, updates all belong with the original event).
- Each group must be ONE concrete event. Do NOT attach a loosely-related article just to pad a group —
  if it is a different event, leave it out (it becomes its own story).
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

function parseJSON(raw: string): { stories: Story[] } | null {
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

// 单次 qwen 分组调用。失败/解析失败返回 null(由 consensus 容忍部分失败)。
async function runOnce(articles: ArticleInfo[], model: string): Promise<Story[] | null> {
  try {
    const resp = await fetch(`${AI_WORKER_URL}/meridian/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: PROMPT(articles) }],
        options: { provider: 'dashscope', model, temperature: 0, max_tokens: 8000 },
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { data?: { choices?: Array<{ message?: { content?: string } }> } };
    const content = data?.data?.choices?.[0]?.message?.content || '';
    return parseJSON(content)?.stories ?? null;
  } catch {
    return null;
  }
}

// Consensus：co-association(每对文章在 N 次里共现频率)→ average-linkage 凝聚聚类，
// 切 tau 阈值得最终组。用 average-linkage(而非 single-linkage 连通分量)避免"一条桥边焊死两簇"。
function consensus(
  runs: Story[][],
  articles: ArticleInfo[],
  tau: number
): { stories: Story[]; meanStability: number } {
  const valid = new Set(articles.map(a => a.id));
  const N = runs.length;

  // co-association 频率(只统计至少同组一次的对)
  const co = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (const run of runs) {
    const seenPair = new Set<string>(); // 同一次运行内，一对最多计一次(防 qwen 同 run 重复输出 id)
    for (const s of run) {
      const ids = [...new Set(s.articleIds.filter(id => valid.has(id)))];
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const k = key(ids[i], ids[j]);
          if (seenPair.has(k)) continue;
          seenPair.add(k);
          co.set(k, (co.get(k) ?? 0) + 1);
        }
    }
  }
  const freq = (a: number, b: number) => (co.get(key(a, b)) ?? 0) / N;

  // 只有"至少同组一次"的文章才进聚类候选(其余天然单例)
  const involved = new Set<number>();
  for (const k of co.keys()) {
    const [a, b] = k.split(',').map(Number);
    involved.add(a);
    involved.add(b);
  }

  // average-linkage 凝聚聚类：每个候选自成簇，反复合并"簇间平均共现频率最高且 >= tau"的两簇。
  let clusters: number[][] = [...involved].map(id => [id]);
  const avg = (c1: number[], c2: number[]) => {
    let sum = 0;
    for (const x of c1) for (const y of c2) sum += freq(x, y);
    return sum / (c1.length * c2.length);
  };
  for (;;) {
    let best = -1;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++) {
        const a = avg(clusters[i], clusters[j]);
        if (a > best) {
          best = a;
          bi = i;
          bj = j;
        }
      }
    if (best < tau || bi < 0) break;
    clusters[bi] = clusters[bi].concat(clusters[bj]);
    clusters.splice(bj, 1);
  }

  const stories: Story[] = [];
  let sumStab = 0;
  let nPairs = 0;
  for (const c of clusters) {
    if (c.length < 2) continue;
    stories.push({ label: `consensus:${c[0]}`, articleIds: c });
    for (let i = 0; i < c.length; i++)
      for (let j = i + 1; j < c.length; j++) {
        sumStab += freq(c[i], c[j]);
        nPairs++;
      }
  }
  return { stories, meanStability: nPairs ? sumStab / nPairs : 0 };
}

function normTitle(t: string): string {
  return (t ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// 确定性后处理：① 标题近重复(归一化相同)强制并入同组；② 剔除 <2 篇的组(落回单例)。
// 不做任何基于 embedding/语义的重分组——避免 gold 退化成几何聚类、失去独立性。
function postProcess(
  stories: Story[],
  articles: ArticleInfo[]
): { stories: Story[]; dupMerged: number; singlesDropped: number } {
  const work = stories.map(s => ({ label: s.label, articleIds: [...s.articleIds] }));
  // 全局去重 + 过滤幻觉 id：每个 id 只保留在首次出现的组，且必须真实存在于输入文章集
  const valid = new Set(articles.map(a => a.id));
  const seen = new Set<number>();
  for (const s of work) {
    s.articleIds = s.articleIds.filter(id => {
      if (!valid.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  const groupOf = new Map<number, number>();
  work.forEach((s, i) => s.articleIds.forEach(id => groupOf.set(id, i)));

  // ① 归一化标题相同的文章必须同组(抓"标题一字不差却分开"的硬错误)
  const byTitle = new Map<string, number[]>();
  for (const a of articles) {
    const k = normTitle(a.title);
    if (!k) continue;
    (byTitle.get(k) ?? byTitle.set(k, []).get(k)!).push(a.id);
  }
  let dupMerged = 0;
  for (const ids of byTitle.values()) {
    if (ids.length < 2) continue;
    let target = ids.map(id => groupOf.get(id)).find(g => g !== undefined);
    if (target === undefined) {
      work.push({ label: `dup:${ids[0]}`, articleIds: [] });
      target = work.length - 1;
    }
    for (const id of ids) {
      const cur = groupOf.get(id);
      if (cur === target) continue;
      if (cur !== undefined) work[cur].articleIds = work[cur].articleIds.filter(x => x !== id);
      work[target].articleIds.push(id);
      groupOf.set(id, target);
      dupMerged++;
    }
  }

  // ② 剔除 <2 篇的组；其 id 落回 unassigned(由调用方按单例处理)
  const finalKept = work.filter(s => s.articleIds.length >= 2);
  const singlesDropped = work.length - finalKept.length;
  return { stories: finalKept, dupMerged, singlesDropped };
}

function promptHash(arts: ArticleInfo[]): string {
  const ids = arts.map(a => a.id).sort((a, b) => a - b).join(',');
  return createHash('sha1').update(PROMPT([]) + '|' + ids).digest('hex').slice(0, 8);
}

export async function buildReference(
  workflowId: string,
  articles: ArticleInfo[],
  opts: { model?: string; refresh?: boolean; runs?: number; tau?: number; freeze?: boolean } = {}
): Promise<ReferencePartition> {
  const model = opts.model || 'qwen-max';
  const runs = opts.runs ?? 4;
  const tau = opts.tau ?? 0.75;
  const hash = promptHash(articles);
  const refPath = resolve(CACHE_DIR, `reference-${workflowId}.json`);
  const rawPath = resolve(CACHE_DIR, `raw-${workflowId}.json`);

  // 冻结：reference 文件标 frozen → 直接返回，无视 refresh/tau/prompt 变动。
  try {
    const cached = JSON.parse(await readFile(refPath, 'utf8')) as ReferencePartition & { frozen?: boolean };
    if (cached.frozen) {
      console.log(`[reference] 已冻结(frozen)，直接使用 ${refPath}`);
      return cached;
    }
  } catch {
    /* no cache */
  }

  // raw 层：N 次原始分组，缓存固化(贵且抖)。命中则复用，调 tau 时不重调 qwen。
  let rawRuns: Story[][] | null = null;
  if (!opts.refresh) {
    try {
      const r = JSON.parse(await readFile(rawPath, 'utf8')) as { runs: Story[][]; model: string; hash: string };
      if (r.hash === hash && r.model === model) rawRuns = r.runs;
    } catch {
      /* no raw cache */
    }
  }
  if (!rawRuns) {
    console.log(`[reference] 并行 ${runs} 次 ${model} 分组 (${articles.length} 篇)...`);
    const results = await Promise.all(Array.from({ length: runs }, () => runOnce(articles, model)));
    const ok = results.filter((r): r is Story[] => !!r);
    if (ok.length === 0) throw new Error('consensus 全部失败(LLM 调用或 JSON 解析失败)');
    rawRuns = ok;
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(rawPath, JSON.stringify({ runs: ok, model, hash }, null, 2));
    console.log(`[reference] ${ok.length}/${runs} 次成功并缓存 raw，各次组数: [${ok.map(r => r.length).join(', ')}]`);
  } else {
    console.log(`[reference] 复用 raw 缓存 (${rawRuns.length} 次)，各次组数: [${rawRuns.map(r => r.length).join(', ')}]`);
  }

  // consensus(确定性，tau 可调，复用 raw 免费)
  const con = consensus(rawRuns, articles, tau);
  console.log(`[reference] consensus tau=${tau} (average-linkage): ${con.stories.length} 组, 平均共现稳定度 ${con.meanStability.toFixed(2)}`);

  // 确定性后处理：近重复并组 + 剔单篇组。
  const pp = postProcess(con.stories, articles);
  console.log(`[reference] 后处理: 近重复并组 ${pp.dupMerged} 篇, 剔除单篇组 ${pp.singlesDropped} 个`);

  // 人工 calibration 兜底：calibration-{key}.json 的 drop 列表 → 强制移出所有组(变单例)。
  let stories = pp.stories;
  try {
    const cal = JSON.parse(
      await readFile(resolve(CACHE_DIR, `calibration-${workflowId}.json`), 'utf8')
    ) as { drop?: number[]; add?: Array<{ into: number; ids: number[] }>; merge?: number[][] };
    const drop = new Set<number>(cal.drop ?? []);
    const add = cal.add ?? [];
    const merge = cal.merge ?? [];
    // drop：剔组尾离群(强制单例)
    if (drop.size) {
      stories = stories.map(s => ({ ...s, articleIds: s.articleIds.filter(id => !drop.has(id)) }));
    }
    // add/merge：补漏分/漏故事。先把涉及 id 从现有组移除(防重复)，再并入锚组 / 新建组。
    const touched = new Set<number>([...add.flatMap(a => a.ids), ...merge.flat()]);
    if (touched.size) {
      stories = stories.map(s => ({ ...s, articleIds: s.articleIds.filter(id => !touched.has(id)) }));
    }
    for (const a of add) {
      const grp = stories.find(s => s.articleIds.includes(a.into));
      if (grp) grp.articleIds.push(...a.ids);
      else console.warn(`[reference] calibration add: 锚 id ${a.into} 不在任何组，跳过 [${a.ids}]`);
    }
    for (const ids of merge) stories.push({ label: `manual:${ids[0]}`, articleIds: [...ids] });
    // 剔 <2 篇的组(drop 后可能 <2)
    stories = stories.filter(s => s.articleIds.length >= 2);
    if (drop.size || add.length || merge.length) {
      const added = add.reduce((n, a) => n + a.ids.length, 0);
      console.log(`[reference] calibration: drop ${drop.size}, add ${added}, merge ${merge.length} 新组`);
    }
  } catch {
    /* 无 calibration 文件，跳过 */
  }

  // 校验覆盖：未被任何组覆盖的篇 → 各自单例(unassigned)。
  const assigned = new Set<number>();
  for (const s of stories) for (const id of s.articleIds) assigned.add(id);
  const unassigned = articles.map(a => a.id).filter(id => !assigned.has(id));
  if (unassigned.length) console.warn(`[reference] ${unassigned.length} 篇未被归组，按单例处理`);

  const ref: ReferencePartition & { frozen?: boolean } = {
    workflowId,
    judgeModel: model,
    promptHash: hash,
    createdAt: new Date().toISOString(),
    stories,
    unassigned,
  };
  if (opts.freeze) ref.frozen = true;
  await writeFile(refPath, JSON.stringify(ref, null, 2), 'utf8');
  console.log(`[reference] 写入 ${refPath} (${ref.stories.length} 个故事)`);
  return ref;
}
