/**
 * ── 一次性 TUI 外壳（不要抬进生产）─────────────────────────────────────────
 *
 * 问题：文章分析 prompt 的模板 10,264 字符是中位正文 2,912 的 3.5 倍，每天白付 686 遍。
 *      按奥卡姆剃刀把 few-shot 砍到最小——最小到哪一步会出现明显质量突变？
 *
 * 方法：5 个变体 × 10 篇真实文章（刻意含中文 / PARTIAL_USEFUL / 宣言体 / 名人八卦
 *      这些 enum 字段最容易翻车的边界），对拍基线产出。
 *
 * ⚠️ 生产用 temperature 0.1，**非确定性**。所以基线要跑两次，`full vs full₂` 的偏离
 *    就是噪声地板。任何变体落在地板内 = 与基线不可区分。不建地板就会把抖动读成退化。
 *
 * 跑：pnpm -F meridian-ai-worker prototype:slim
 *    （默认打线上 ai-worker；本地 wrangler dev 时 AI_WORKER_URL=http://localhost:8787）
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getArticleAnalysisPrompt, articleAnalysisSchema } from '../../src/prompts/articleAnalysis.ts';
import { VARIANTS, setProductionPrompt, templateChars, type PromptVariant } from './variants.ts';
import { compareOutputs, generateSearchText, neuronsOf, USD_PER_NEURON, type Comparison } from './compare.ts';

setProductionPrompt(getArticleAnalysisPrompt);

const here = dirname(fileURLToPath(import.meta.url));
const AI = process.env.AI_WORKER_URL ?? 'https://meridian-ai-worker.swj299792458.workers.dev';
const MODEL = '@cf/qwen/qwen3-30b-a3b-fp8'; // 与生产 strategy 首档一致
const TEMP = 0.1;                            // 同上，刻意不改成 0——要量的是生产条件下的偏离

const articles: Array<{ id: number; title: string; content: string; focus: string }> =
  JSON.parse(readFileSync(join(here, 'fixtures/articles.json'), 'utf8'));

// 基线跑两次：第二次是噪声地板
const ARMS: Array<PromptVariant & { noise?: boolean }> = [
  ...VARIANTS,
  { ...VARIANTS[0], id: 'full2', label: '现状·第二次采样', cuts: '同基线，用来量 temp 0.1 的噪声地板', noise: true },
];

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;

interface Run {
  ok: boolean;
  parsed?: any;
  schemaOk?: boolean;
  promptTok: number;
  compTok: number;
  neurons: number;
  searchText?: string;
  vec?: number[];
  err?: string;
}
type Key = string;
const runs = new Map<Key, Run>();
const cmp = new Map<Key, Comparison>();

let embedErr = '';

const state = {
  a: 0,          // 文章下标
  v: 0,          // 选中变体
  detail: false,
  busy: '',
};

async function chat(prompt: string): Promise<{ content: string; p: number; c: number; n: number }> {
  const res = await fetch(`${AI}/meridian/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      options: { provider: 'workers-ai', model: MODEL, temperature: TEMP, max_tokens: 4000, skipCache: true },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const j: any = await res.json();
  if (!res.ok || j?.success === false) throw new Error(j?.error ?? `HTTP ${res.status}`);
  const u = j?.data?.usage ?? {};
  return {
    content: j?.data?.choices?.[0]?.message?.content ?? '',
    p: u.prompt_tokens ?? 0,
    c: u.completion_tokens ?? 0,
    n: u.neurons ?? neuronsOf(u.prompt_tokens ?? 0, u.completion_tokens ?? 0),
  };
}

/**
 * embedding 打 **ml-service**（e5-small, 384 维），不打 ai-worker。
 * 理由：`/meridian/embeddings/generate` 线上是坏的（"Workers AI binding 目前只接 chat
 * capability"），而且就算能用也是 bge-small——**生产聚类吃的是 e5-small**，要量
 * "语义漂没漂到会影响聚类"，必须用同一个向量空间。
 * URL/Key 从 apps/backend/.dev.vars 自动读（一次性原型，省一步手工导环境变量）。
 */
function mlCreds(): { url: string; key: string } {
  if (process.env.ML_URL && process.env.ML_KEY) return { url: process.env.ML_URL, key: process.env.ML_KEY };
  const devVars = readFileSync(join(here, '../../../../apps/backend/.dev.vars'), 'utf8');
  const pick = (k: string) => devVars.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\n]+)"?`, 'm'))?.[1]?.trim() ?? '';
  return { url: pick('MERIDIAN_ML_SERVICE_URL'), key: pick('MERIDIAN_ML_SERVICE_API_KEY') };
}

async function embed(texts: string[]): Promise<number[][]> {
  const { url, key } = mlCreds();
  if (!url || !key) throw new Error('ml-service 凭据缺失（ML_URL / ML_KEY 或 apps/backend/.dev.vars）');
  const res = await fetch(`${url}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': key },
    body: JSON.stringify({ texts, normalize: true }),
    signal: AbortSignal.timeout(180_000),
  });
  const j: any = await res.json();
  if (!res.ok || !Array.isArray(j?.embeddings)) throw new Error(j?.detail ?? j?.error ?? `HTTP ${res.status}`);
  return j.embeddings;
}

function parseJson(raw: string): any | null {
  for (const c of [raw.match(/<final_json>([\s\S]*?)<\/final_json>/)?.[1],
                   raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1],
                   raw.match(/\{[\s\S]*\}/)?.[0], raw]) {
    if (!c) continue;
    try { const o = JSON.parse(c.replace(/,\s*([}\]])/g, '$1')); if (o && typeof o === 'object') return o; } catch {}
  }
  return null;
}

async function runArticle(ai: number) {
  const art = articles[ai];
  for (const arm of ARMS) {
    const key = `${art.id}:${arm.id}`;
    if (runs.has(key)) continue;
    state.busy = `${art.id} · ${arm.label}`;
    render();
    try {
      const r = await chat(arm.build(art.title, art.content));
      const parsed = parseJson(r.content);
      const withTitle = parsed ? { ...parsed, title: art.title } : null;
      runs.set(key, {
        ok: true, parsed, schemaOk: parsed ? articleAnalysisSchema.safeParse(parsed).success : false,
        promptTok: r.p, compTok: r.c, neurons: r.n,
        searchText: withTitle ? generateSearchText(withTitle) : undefined,
      });
    } catch (e) {
      runs.set(key, { ok: false, promptTok: 0, compTok: 0, neurons: 0, err: e instanceof Error ? e.message : String(e) });
    }
  }
  // search text 一次性批量 embed，算余弦
  state.busy = `${art.id} · embedding`;
  render();
  const arms = ARMS.filter((a) => runs.get(`${art.id}:${a.id}`)?.searchText);
  if (arms.length) {
    try {
      const vecs = await embed(arms.map((a) => runs.get(`${art.id}:${a.id}`)!.searchText!));
      arms.forEach((a, i) => { runs.get(`${art.id}:${a.id}`)!.vec = vecs[i]; });
    } catch (e) {
      // 刻意不静默：这个 catch 之前吞掉了"端点是坏的"这件事，读数上只表现为余弦一栏是
      // 空的——正是本项目反复栽的"失败静默降级成看起来正常"。
      embedErr = e instanceof Error ? e.message : String(e);
    }
  }
  const base = runs.get(`${art.id}:full`);
  for (const arm of ARMS) {
    const r = runs.get(`${art.id}:${arm.id}`);
    if (!base?.parsed || !r?.parsed) continue;
    cmp.set(`${art.id}:${arm.id}`,
      compareOutputs(base.parsed, r.parsed, base.vec && r.vec ? { base: base.vec, cand: r.vec } : undefined));
  }
  state.busy = '';
}

function fmtPct(x: number | null | undefined, digits = 2) {
  return x === null || x === undefined ? D('  —  ') : x.toFixed(digits);
}

function render() {
  if (!process.stdin.isTTY) return;
  console.clear();
  const art = articles[state.a];
  const baseTpl = templateChars(ARMS[0]);
  console.log(B(`文章 ${state.a + 1}/${articles.length}`) + `  [${art.id}] ${art.focus}  ${art.content.length.toLocaleString()} 字符`);
  console.log(D('  ' + art.title.slice(0, 96)));
  console.log('');
  console.log(B('  变体                        模板字符   省    prompt  neurons   省%   schema  硬字段  软Jacc   余弦'));

  const noise = cmp.get(`${art.id}:full2`);
  for (let i = 0; i < ARMS.length; i++) {
    const arm = ARMS[i];
    const r = runs.get(`${art.id}:${arm.id}`);
    const c = cmp.get(`${art.id}:${arm.id}`);
    const tpl = templateChars(arm);
    const save = arm.id === 'full' ? '  —  ' : `${((tpl - baseTpl) / baseTpl * 100).toFixed(0)}%`.padStart(5);
    const baseN = runs.get(`${art.id}:full`)?.neurons;
    const nSave = r && baseN ? `${((r.neurons - baseN) / baseN * 100).toFixed(0)}%`.padStart(5) : D('  —  ');
    const sel = i === state.v ? '▸' : ' ';
    const name = (arm.noise ? D(arm.label) : arm.label).padEnd(arm.noise ? 36 : 26);
    if (!r) { console.log(` ${sel} ${name}${String(tpl).padStart(8)} ${save}  ${D('未跑')}`); continue; }
    if (!r.ok) { console.log(` ${sel} ${name}${String(tpl).padStart(8)} ${save}  ${R('失败 ' + (r.err ?? '').slice(0, 40))}`); continue; }
    // 硬字段：任何不一致标红；软 Jaccard / 余弦 与噪声地板比
    const hardTxt = c ? `${c.hard.filter((h) => h.same).length}/4` : '—';
    const hard = c && c.hardAgreement < 1 ? R(hardTxt) : G(hardTxt);
    const soft = c ? c.softTokenMean : null;
    const cos = c ? c.searchCosine : null;
    const worseThanNoise = (x: number | null, floor: number | null | undefined) =>
      x !== null && floor !== null && floor !== undefined && x < floor - 0.01;
    const softTxt = fmtPct(soft);
    const cosTxt = fmtPct(cos, 3);
    console.log(
      ` ${sel} ${name}${String(tpl).padStart(8)} ${save}  ${String(r.promptTok).padStart(6)}  ${r.neurons.toFixed(1).padStart(6)}  ${nSave}` +
      `   ${r.schemaOk ? G('  ✓ ') : R('  ✗ ')}    ${hard}   ` +
      `${arm.id === 'full' ? D(softTxt) : worseThanNoise(soft, noise?.softTokenMean) ? Y(softTxt) : softTxt}   ` +
      `${arm.id === 'full' ? D(cosTxt) : worseThanNoise(cos, noise?.searchCosine) ? Y(cosTxt) : cosTxt}`
    );
  }

  console.log('');
  if (noise) {
    console.log(D(`  噪声地板（同一 prompt 跑两次）：软 Jacc ${noise.softTokenMean.toFixed(2)}  余弦 ${noise.searchCosine?.toFixed(3) ?? '—'}  硬字段 ${noise.hard.filter((h) => h.same).length}/4`));
    console.log(D('  黄色 = 偏离超过噪声地板 0.01 以上，才算真的动了；否则与基线不可区分。'));
  } else {
    console.log(D('  噪声地板未建（先按 r 跑这篇）'));
  }
  if (embedErr) console.log(R(`  ⚠ embedding 失败，余弦不可用：${embedErr.slice(0, 90)}`));

  if (state.detail) {
    const arm = ARMS[state.v];
    const c = cmp.get(`${art.id}:${arm.id}`);
    const r = runs.get(`${art.id}:${arm.id}`);
    console.log('');
    console.log(B(`  ── ${arm.label} ──`) + D(`  剃掉：${arm.cuts}`));
    if (c) {
      for (const h of c.hard) {
        console.log(`    ${h.same ? G('=') : R('≠')} ${h.field.padEnd(18)} 基线 ${D(h.base.slice(0, 26).padEnd(26))} 本变体 ${h.same ? D(h.cand.slice(0, 26)) : Y(h.cand.slice(0, 26))}`);
      }
      for (const s of c.soft) {
        console.log(D(`      ${s.field.padEnd(22)} ${s.baseN} → ${s.candN} 条   token ${s.tokenJaccard.toFixed(2)}   逐条 ${s.phraseJaccard.toFixed(2)}`));
      }
    } else if (r?.err) console.log(R('    ' + r.err));
    else console.log(D('    未跑'));
  }

  console.log('');
  if (state.busy) console.log(Y(`  跑：${state.busy} …`));
  console.log(D('  ') + B('[r]') + D(' 跑这篇  ') + B('[a]') + D(' 跑全部 10 篇  ') + B('[n/p]') + D(' 换文章  ') +
              B('[j/k]') + D(' 选变体  ') + B('[d]') + D(' 明细  ') + B('[s]') + D(' 汇总  ') + B('[q]') + D(' 退出'));
}

function summary() {
  if (process.stdin.isTTY) console.clear();
  console.log(B('汇总：全部已跑文章 × 变体') + D(`   —— 基线 = full；噪声地板 = full2（同 prompt 二次采样）`));
  console.log('');
  console.log(B('  变体                        文章数  硬字段翻车   软Jacc均   余弦均   余弦最差   neurons均   省%'));
  const baseTplC = templateChars(ARMS[0]);
  for (const arm of ARMS) {
    const rows = articles.map((a) => ({ a, c: cmp.get(`${a.id}:${arm.id}`), r: runs.get(`${a.id}:${arm.id}`) }))
      .filter((x) => x.c && x.r?.ok);
    if (!rows.length) { console.log(D(`  ${arm.label} — 未跑`)); continue; }
    const flips = rows.flatMap((x) => x.c!.hard.filter((h) => !h.same)
      .map((h) => `${x.a.id}:${h.field} 「${h.base}」→「${h.cand}」`));
    const softs = rows.map((x) => x.c!.softTokenMean);
    const coss = rows.map((x) => x.c!.searchCosine).filter((x): x is number => x !== null);
    const neu = rows.reduce((s, x) => s + x.r!.neurons, 0) / rows.length;
    const baseNeu = articles.map((a) => runs.get(`${a.id}:full`)).filter((r) => r?.ok).reduce((s, r) => s + r!.neurons, 0)
      / Math.max(1, articles.filter((a) => runs.get(`${a.id}:full`)?.ok).length);
    const name = (arm.noise ? D(arm.label) : arm.label).padEnd(arm.noise ? 36 : 26);
    console.log(`  ${name}${String(rows.length).padStart(5)}` +
      `${(flips.length ? R(String(flips.length)) : G('0')).padStart(13)}` +
      `${(softs.reduce((a, b) => a + b, 0) / softs.length).toFixed(2).padStart(11)}` +
      `${(coss.length ? (coss.reduce((a, b) => a + b, 0) / coss.length).toFixed(3) : '—').padStart(9)}` +
      `${(coss.length ? Math.min(...coss).toFixed(3) : '—').padStart(11)}` +
      `${neu.toFixed(1).padStart(12)}` +
      `${(arm.id === 'full' ? '—' : `${((neu - baseNeu) / baseNeu * 100).toFixed(0)}%`).padStart(7)}`);
    if (flips.length) flips.slice(0, 8).forEach((f) => console.log(D('      ' + f)));
  }
  if (embedErr) console.log(R(`  ⚠ embedding 失败，余弦列不可用：${embedErr.slice(0, 110)}`));
  console.log('');
  const n = articles.filter((a) => runs.get(`${a.id}:full`)?.ok).length;
  const perDay = 686;
  console.log(D(`  按 ${perDay} 篇/天换算年费（$0.011/1k neurons，免费额度 10,000/天 已被文章分析打穿）:`));
  for (const arm of ARMS.filter((a) => !a.noise)) {
    const rows = articles.map((a) => runs.get(`${a.id}:${arm.id}`)).filter((r) => r?.ok);
    if (!rows.length) continue;
    const neu = rows.reduce((s, r) => s + r!.neurons, 0) / rows.length;
    console.log(D(`    ${arm.label.padEnd(26)} ${neu.toFixed(1).padStart(5)} neurons/篇   $${(Math.max(0, neu * perDay + 1973 - 10000) * 365 * USD_PER_NEURON).toFixed(2)}/年`));
  }
  console.log('');
  console.log(D(`  已跑 ${n}/${articles.length} 篇。`) + D('  按任意键返回'));
}

// ── 非交互降级 ────────────────────────────────────────────────────────────
// 没有 TTY（后台跑 / 管道 / CI）时：按 LIMIT 篇全跑一遍，打汇总，退出。
// 交互式 TUI 是给人按键用的，脱离终端就该退化成批处理，而不是卡住。
if (!process.stdin.isTTY) {
  const limit = Number(process.env.LIMIT ?? articles.length);
  for (let i = 0; i < Math.min(limit, articles.length); i++) {
    state.a = i;
    process.stderr.write(`[${i + 1}/${limit}] ${articles[i].id} ${articles[i].focus} …\n`);
    await runArticle(i);
  }
  summary();
  process.exit(0);
}

// ── 键盘循环 ──────────────────────────────────────────────────────────────
let inSummary = false;
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
render();

process.stdin.on('data', async (raw: string) => {
  const k = raw.toString();
  if (state.busy) return;
  if (inSummary) { inSummary = false; render(); return; }
  if (k === 'q' || k === '') { console.clear(); process.exit(0); }
  if (k === 'n') state.a = (state.a + 1) % articles.length;
  if (k === 'p') state.a = (state.a - 1 + articles.length) % articles.length;
  if (k === 'j') state.v = (state.v + 1) % ARMS.length;
  if (k === 'k') state.v = (state.v - 1 + ARMS.length) % ARMS.length;
  if (k === 'd') state.detail = !state.detail;
  if (k === 's') { inSummary = true; summary(); return; }
  if (k === 'r') { await runArticle(state.a); }
  if (k === 'a') { for (let i = 0; i < articles.length; i++) { state.a = i; await runArticle(i); } }
  render();
});
