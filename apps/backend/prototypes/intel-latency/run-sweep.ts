/**
 * 【扔掉型原型】情报深度分析的「墙钟时间 ~ 输入规模」曲线。
 *
 * 问题：一次 LLM 调用读 N 篇正文产一份结构化报告，墙钟涨的是 prefill / 输出打满 / 解码变慢？
 *
 * 做法：固定同一个真实事件簇（F2 簇 2，81 篇，尼泊尔-西藏洪灾），只改喂进去的篇数，
 * 按发布时间等距取样（两端锚定，复刻 story-dedup.ts 的 pickSpreadArticles），
 * 打本地 wrangler dev 的 /meridian/chat，prompt 由生产真源函数构造（逐字与
 * IntelligenceService.performAIAnalysis 的第一次调用一致），配置与
 * PHASE_DEFAULTS.intelligence_analysis 一致。
 *
 * 为什么不打 /meridian/intelligence/analyze-single-story：
 *   ① 该端点默认还会跑第二次 LLM 调用（RARR 接地校验），会把曲线混成两段之和；
 *   ② 该端点不回 usage，而 output token 恰是本题的核心读数。
 * 端点侧另做一次交叉核对（见 crosscheck.ts）。
 *
 * 跑法：npx tsx run-sweep.ts <篇数,篇数,...> <重复次数>
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { AIResponseParser } from '../../../../services/meridian-ai-worker/src/utils/ai-response-parser.ts';
import { getIntelligenceAnalysisPrompt } from '../../../../services/meridian-ai-worker/src/prompts/intelligenceAnalysis.ts';
import { pickSpreadArticles } from '../../src/lib/core/story-dedup.ts';

const ENDPOINT = 'http://localhost:8787/meridian/chat';
/** 与 PHASE_DEFAULTS.intelligence_analysis 逐字一致 */
const MODEL = '@cf/zai-org/glm-4.7-flash';
const PROVIDER = 'workers-ai';
const TEMPERATURE = 0.1;
const MAX_TOKENS = 8192;
/** 与 intelligence.ts 的 INTEL_PROMPT_TOKEN_BUDGET 一致 */
const INTEL_PROMPT_TOKEN_BUDGET = 112500;
const HERE = new URL('.', import.meta.url).pathname;

interface Meta { id: number; title: string; url: string; pub: string; key: string }
const metas: Meta[] = readFileSync(`${HERE}out/meta.tsv`, 'utf-8').trim().split('\n').map((l) => {
  const [id, title, url, pub, key] = l.split('\t');
  return { id: Number(id), title, url, pub, key };
});
const byId = new Map(metas.map((m) => [m.id, m]));
const contentOf = (id: number) => {
  const f = `${HERE}.cache/content/${id}.txt`;
  return existsSync(f) ? readFileSync(f, 'utf-8') : '';
};

// 卫生断言：正文必须真拿到（假文本的 token 分布不同，曲线会失真）
{
  const empty = metas.filter((m) => contentOf(m.id).trim().length < 200);
  if (empty.length) throw new Error(`卫生断言失败：${empty.length}/${metas.length} 篇正文缺失或过短`);
  const total = metas.reduce((n, m) => n + contentOf(m.id).length, 0);
  console.log(`正文就绪：${metas.length} 篇，共 ${total} 字符，均 ${Math.round(total / metas.length)} 字符/篇`);
}

const pubMs = new Map(metas.map((m) => [m.id, new Date(m.pub.replace(' ', 'T') + 'Z').getTime()]));
if ([...pubMs.values()].some((v) => !Number.isFinite(v))) throw new Error('卫生断言失败：publish_date 解析出 NaN');
const ALL_IDS = metas.map((m) => m.id);

function subsetOf(n: number): number[] {
  const ids = pickSpreadArticles(ALL_IDS, pubMs, n);
  if (ids.length !== Math.min(n, ALL_IDS.length)) throw new Error(`取样断言失败：要 ${n} 得 ${ids.length}`);
  return ids;
}

function buildPrompt(ids: number[]): string {
  const arts = ids.map((id) => ({
    id, title: byId.get(id)!.title, url: byId.get(id)!.url,
    publishDate: byId.get(id)!.pub, content: contentOf(id),
  }));
  const md = AIResponseParser.buildArticleMarkdown(arts);
  const p = getIntelligenceAnalysisPrompt(md);
  const limited = AIResponseParser.limitTokens(p, INTEL_PROMPT_TOKEN_BUDGET);
  if (limited.length < p.length) console.warn(`  ⚠️ prompt 被 limitTokens 截断 ${p.length} → ${limited.length}`);
  return limited;
}

async function once(n: number, rep: number) {
  const ids = subsetOf(n);
  const prompt = buildPrompt(ids);
  const inChars = prompt.length;
  const body = {
    messages: [{ role: 'user', content: prompt }],
    options: { provider: PROVIDER, model: MODEL, temperature: TEMPERATURE, max_tokens: MAX_TOKENS, skipCache: true },
  };
  const t0 = Date.now();
  let status = 0, wall = 0, json: any = null, err = '';
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    });
    status = r.status;
    const text = await r.text();
    wall = (Date.now() - t0) / 1000;
    try { json = JSON.parse(text); } catch { err = `非 JSON 响应: ${text.slice(0, 300)}`; }
  } catch (e: any) {
    wall = (Date.now() - t0) / 1000;
    err = String(e?.message ?? e);
  }

  const usage = json?.data?.usage ?? {};
  const out = json?.data?.choices?.[0]?.message?.content ?? '';
  const finish = json?.data?.choices?.[0]?.finish_reason ?? '';
  const cached = json?.metadata?.cached;
  let parsed: any = null, parseOk = false;
  if (out) {
    parsed = AIResponseParser.parseIntelligenceResponse(out);
    parseOk = !!parsed && parsed.parseFailed !== true;
  }
  const ents = Array.isArray(parsed?.keyEntities) ? parsed.keyEntities : (parsed?.keyEntities?.list ?? []);
  const row = {
    n, rep, ids_first: ids[0], ids_last: ids[ids.length - 1],
    in_chars: inChars, in_tok_est: Math.round(inChars / 4.2),
    prompt_tokens: usage.prompt_tokens ?? null,
    completion_tokens: usage.completion_tokens ?? null,
    total_tokens: usage.total_tokens ?? null,
    wall_s: Number(wall.toFixed(2)),
    http: status, cached: cached ?? null, finish_reason: finish,
    out_chars: out.length,
    parse_ok: parseOk, status_field: parsed?.status ?? null,
    timeline_n: Array.isArray(parsed?.timeline) ? parsed.timeline.length : null,
    entities_n: Array.isArray(ents) ? ents.length : null,
    tok_per_s: usage.completion_tokens && wall ? Number((usage.completion_tokens / wall).toFixed(2)) : null,
    err: err || (json?.success === false ? JSON.stringify(json).slice(0, 300) : ''),
  };
  appendFileSync(`${HERE}out/sweep.jsonl`, JSON.stringify(row) + '\n');
  if (out) writeFileSync(`${HERE}out/resp-n${n}-r${rep}.txt`, out);
  console.log(`  n=${String(n).padStart(2)} rep${rep}  ${row.wall_s}s  http=${status} in_tok=${row.prompt_tokens} out_tok=${row.completion_tokens} ` +
    `finish=${finish} tok/s=${row.tok_per_s} parse=${parseOk} tl=${row.timeline_n} ent=${row.entities_n} cached=${row.cached}${row.err ? '  ERR:' + row.err.slice(0, 120) : ''}`);
  return row;
}

const NS = (process.argv[2] ?? '10,20,30,45,60').split(',').map(Number);
const REPS = Number(process.argv[3] ?? 2);
for (const n of NS) {
  console.log(`\n=== ${n} 篇 ===`);
  let stop = false;
  for (let rep = 1; rep <= REPS; rep++) {
    const row = await once(n, rep);
    if (row.wall_s > 240) { console.log(`  ⛔ 墙钟 ${row.wall_s}s > 240s，停止继续加大`); stop = true; }
  }
  if (stop) break;
}
console.log('\n完成，读数在 out/sweep.jsonl');
