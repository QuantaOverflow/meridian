/**
 * 慢档的地基:LLM 调用、并发、embedding、事件归并。
 *
 * 全部抄进本目录而不 import `apps/backend/prototypes/*` —— 那些目录被根 .gitignore 挡掉,
 * 入库的 harness 不能架在会丢的文件上。抄来的部分逐处标了出处,改之前先读原件。
 */
import { writeFileSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// ── 调用配置(抄自 prototypes/intel-pipeline/scratch/run9-lib.ts)──────────
export const ENDPOINT = process.env.AI_WORKER_URL ?? 'http://localhost:8787/meridian/chat';
export const PROVIDER = 'workers-ai';
/** 抽事件清单用它。它是**抽取**任务不是判官任务:抽错各臂一起错,不影响臂间相对比较。 */
export const MODEL = process.env.CHECKLIST_MODEL ?? '@cf/zai-org/glm-4.7-flash';
/** 全进程共用的信号量上限。判定实测 1-5 秒/次,4 路约 100-300 rpm,在 Workers AI 限流内。 */
export const CONC = Number(process.env.CONC ?? 4);
/** 温度阶梯:同一 prompt 最多试三次,失败即显式返回 null,不静默降级。 */
export const TEMPS = [0.1, 0.3, 0.3];
export const MAX_TOKENS = 8000;

const ML_PY = process.env.ML_PY ?? '/Users/shiwenjie/Desktop/playground/projects/meridian/services/meridian-ml-service/.venv/bin/python';
const HERE = new URL('.', import.meta.url).pathname;

// ── 并发 ────────────────────────────────────────────────────────────────
let inflight = 0;
const q = [];
async function slot(fn) {
  if (inflight >= CONC) await new Promise(r => q.push(r));
  inflight++;
  try { return await fn(); } finally { inflight--; q.shift()?.(); }
}
export async function pool(items, n, fn) {
  const res = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, Math.max(items.length, 1)) }, async () => {
    for (;;) { const i = idx++; if (i >= items.length) return; res[i] = await fn(items[i], i); }
  }));
  return res;
}

// ── 调用记账 ────────────────────────────────────────────────────────────
let callsPath = null;
export function setCallsPath(p) { callsPath = p; mkdirSync(p.replace(/\/[^/]+$/, ''), { recursive: true }); }

/**
 * 一次 chat。**每次都 skipCache**——AI Gateway 默认缓存会把多次采样静默退化成一次
 * (本仓踩过:ai-gateway-cache-eval-trap)。
 */
export async function chat(tag, prompt, maxTokens = MAX_TOKENS, temperature = 0.1, extra = {}, reqOptions = {}) {
  return slot(async () => {
    const t0 = Date.now();
    let http = 0, json = null, err = '', text = '';
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          options: { provider: PROVIDER, model: MODEL, temperature, max_tokens: maxTokens, skipCache: true, ...reqOptions },
        }),
        signal: AbortSignal.timeout(600_000),
      });
      http = r.status;
      json = await r.json();
      if (!json?.success) err = JSON.stringify(json?.error ?? json).slice(0, 300);
      text = String(json?.data?.choices?.[0]?.message?.content ?? '');
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    const u = json?.data?.usage ?? {};
    const rec = {
      tag, http, wall_s: +((Date.now() - t0) / 1000).toFixed(2),
      finish: json?.data?.choices?.[0]?.finish_reason ?? '',
      in_tok: u.prompt_tokens ?? null, out_tok: u.completion_tokens ?? null,
      neurons: u.neurons ?? null, err, out_chars: text.length, temperature, ...extra,
    };
    if (callsPath) appendFileSync(callsPath, `${JSON.stringify(rec)}\n`);
    return { ...rec, text };
  });
}

/**
 * 约束式解码 + 温度阶梯。三次全败返回 null(**显式失败,不返回空结构**)。
 * 抄自 prototypes/block-writer/scratch/rubric.ts 的 askJSON。
 */
export async function askJSON(tag, prompt, schema, ok, extra = {}) {
  for (let k = 0; k < TEMPS.length; k++) {
    const r = await chat(`${tag}#a${k + 1}`, prompt, MAX_TOKENS, TEMPS[k], { ...extra, attempt: k + 1 },
      { response_format: { type: 'json_schema', json_schema: schema } });
    let p = null;
    if (r.text) { try { p = JSON.parse(r.text); } catch { /* 约束解码下应为纯 JSON;解析失败即这次作废 */ } }
    const good = r.http === 200 && r.finish !== 'length' && !!p && ok(p);
    console.log(`  [${tag}#a${k + 1}] ${r.wall_s}s http=${r.http} finish=${r.finish || '-'} out=${r.out_tok ?? '-'} ok=${good}${r.err ? ' ERR:' + r.err.slice(0, 80) : ''}`);
    if (good) return p;
    if (k < TEMPS.length - 1) await new Promise(x => setTimeout(x, [3000, 8000][k] ?? 8000));
  }
  return null;
}

// ── embedding(走本地 e5-small,与生产同一向量空间)──────────────────────
let embSeq = 0;
export function embed(texts, tag, outDir) {
  if (!texts.length) return new Map();
  const uniq = [...new Set(texts)];
  mkdirSync(outDir, { recursive: true });
  const inF = `${outDir}/.emb-in-${tag}-${embSeq}.json`;
  const outF = `${outDir}/.emb-out-${tag}-${embSeq}.json`;
  embSeq++;
  writeFileSync(inF, JSON.stringify(uniq));
  execFileSync(ML_PY, [`${HERE}embed.py`, inF, outF], { stdio: ['ignore', 'inherit', 'pipe'] });
  const raw = JSON.parse(readFileSync(outF, 'utf8'));
  if (raw.length !== uniq.length) throw new Error(`embedding 条数不匹配 ${raw.length} != ${uniq.length}`);
  return new Map(uniq.map((t, i) => [t, raw[i]]));
}

/** 向量已归一化,所以 cos 就是裸点积。 */
export const cos = (a, b) => a.reduce((s, x, k) => s + x * b[k], 0);

// ── 事件跨批归并 ────────────────────────────────────────────────────────
const numsOfText = t =>
  new Set((String(t).match(/\d[\d,.]*/g) ?? [])
    .map(x => Number(x.replace(/[,.]$/, '').replace(/,/g, '')))
    .filter(Number.isFinite));

/**
 * 按 embedding 余弦归并同一事件的不同措辞。抄自 prototypes/intel-pipeline/schema-v2.ts
 * 的 dedupFactsByEmbedding,保留那条**数字否决**:两条都带数字且数字集合无交集 → 拒绝合并
 * (防止「死 38 人」和「死 157 人」被并成一条)。
 *
 * ⚠️ 阈值 0.90 沿用 rubric.ts 的取值,**没有标定记录**。偏高会让同一事件重复成两条
 * (虚增分母、压低覆盖率),偏低会把不同事件并成一条(虚减分母、抬高覆盖率)。
 * 各臂共用同一份缓存清单,所以它不影响臂间相对比较,只影响绝对值——已记为已知边界。
 */
export const MERGE_TH = Number(process.env.MERGE_TH ?? 0.90);

export function mergeEvents(rows, vecOf, th = MERGE_TH) {
  const kept = [];
  let mergedAway = 0;
  for (const r of rows) {
    const v = vecOf.get(r.event);
    let best = -1, bestCos = 0;
    if (v) {
      for (let i = 0; i < kept.length; i++) {
        const w = vecOf.get(kept[i].event);
        if (!w) continue;
        const c = cos(v, w);
        if (c < th || c <= bestCos) continue;
        const na = numsOfText(r.event), nb = numsOfText(kept[i].event);
        if (na.size && nb.size && ![...na].some(x => nb.has(x))) continue; // 数字否决
        bestCos = c; best = i;
      }
    }
    if (best >= 0) { kept[best].articleIds.push(...r.articleIds); mergedAway++; }
    else kept.push({ event: r.event, articleIds: [...r.articleIds] });
  }
  return { kept, mergedAway };
}

// ── 文章 markdown(抄自生产 utils/ai-response-parser.ts buildArticleMarkdown)──
export function buildArticleMarkdown(articles) {
  return articles.map(a => `## [${a.title}](${a.url}) (#${a.id})

> Published: ${a.publishDate} (this is when the article was filed, NOT the date of the events it describes)

\`\`\`
${a.content}
\`\`\`

`).join('');
}

export const chunk = (xs, n) => {
  const o = [];
  for (let i = 0; i < xs.length; i += n) o.push(xs.slice(i, i + n));
  return o;
};
