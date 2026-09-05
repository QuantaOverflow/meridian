/**
 * 跑一轮：抽样几个簇 → 打 ai-worker → 结果落 out/（gitignored）。**用完即弃**。
 *
 *   pnpm run go                      F2、t=0.10、两个字段档、每档 12 个簇
 *   pnpm run go -- F2 0.10 rich 8    自定义
 *
 * 需要 ai-worker 在 8787 跑着（Workers AI binding 要 --remote）：
 *   cd services/meridian-ai-worker && pnpm wrangler dev --remote --port 8787
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregate, buildPrompt, parseJudge, scoreOne, type ArticleFields, type ClusterTruth, type FieldMode, type Scored } from './judge.js';

const args = process.argv.slice(2).filter(a => a !== '--');
const WIN = args[0] ?? 'F2';
const THR = args[1] ?? '0.10';
const MODES: FieldMode[] = args[2] ? [args[2] as FieldMode] : ['titles', 'rich'];
/** 传 all 就是全量跑（每个 ≥2 篇的簇都判一次），否则每类抽 N 个 */
const PER_KIND = args[3] === 'all' ? Infinity : Number(args[3] ?? 6);
const CONC = Number(process.env.CONC ?? 6);
const VARIANT = process.env.VARIANT ?? 'base';
const ENDPOINT = process.env.AIW ?? 'http://localhost:8787/meridian/chat';

const HERE = new URL('.', import.meta.url).pathname;
const BAND = join(HERE, '..', 'dedup-band');
const GOLD = join(HERE, '..', '..', '..', '..', 'scripts', 'eval', 'clustering', 'gold');
const OUT = join(HERE, 'out');
if (!existsSync(OUT)) mkdirSync(OUT);

// ── 数据 ──────────────────────────────────────────────────────────────────────
const fields = new Map<number, ArticleFields>();
for (const l of readFileSync(join(BAND, `fixture-${WIN}-text-fields.jsonl`), 'utf-8').split('\n').filter(Boolean)) {
  const r = JSON.parse(l);
  fields.set(r.id, r);
}
const labels: Record<string, number> = JSON.parse(
  readFileSync(join(BAND, 'cluster-sweep', `${WIN}-fine-avg-t${THR}.json`), 'utf-8')
).labels;

const events = readFileSync(join(GOLD, `events-${WIN}.jsonl`), 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const meta = JSON.parse(readFileSync(join(GOLD, `meta-${WIN}.json`), 'utf-8'));
const excluded = new Set<number>((meta.non_article ?? []).map((x: { id: number }) => x.id));
for (const p of meta.duplicate_pairs ?? []) excluded.add(Math.max(...(p as number[])));
const goldOf = new Map<number, string>();
const goldSize = new Map<string, number>();
for (const e of events) {
  for (const m of e.multi_label ?? []) excluded.add(m.id);
  const ids = [...e.members, ...(e.related ?? []).map((r: { id: number }) => r.id)].filter((i: number) => !excluded.has(i));
  if (ids.length < 2) continue;
  goldSize.set(e.event, ids.length);
  for (const i of ids) goldOf.set(i, e.event);
}

const byCluster = new Map<number, number[]>();
for (const [k, c] of Object.entries(labels)) {
  const id = Number(k);
  if (excluded.has(id) || c < 0 || !fields.has(id)) continue;
  (byCluster.get(c) ?? byCluster.set(c, []).get(c)!).push(id);
}

const truths: ClusterTruth[] = [];
for (const [clusterId, articleIds] of byCluster) {
  if (articleIds.length < 2) continue;
  const tally = new Map<string, number>();
  for (const id of articleIds) {
    const g = goldOf.get(id);
    if (g) tally.set(g, (tally.get(g) ?? 0) + 1);
  }
  const [top, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  const dominantEvent = n >= 2 ? top : null;
  truths.push({
    clusterId,
    articleIds,
    dominantEvent,
    impureIds: dominantEvent === null ? [] : articleIds.filter(id => goldOf.get(id) !== dominantEvent),
  });
}

// 抽样：题材袋 PER_KIND 个（取最大的，信息量大）+ 有杂质的真事件簇 PER_KIND 个（纯度 0.6-0.95）
let pockets: ClusterTruth[];
let impure: ClusterTruth[];
let sample: ClusterTruth[];
if (PER_KIND === Infinity) {
  // 全量：每个 ≥2 篇的簇都判一次。手上每个簇都有金标，这一趟本身就是验证，
  // 不需要另外构造正负对——精度/召回直接从这 152 个判决上算。
  sample = truths;
  pockets = truths.filter(t => t.dominantEvent === null);
  impure = truths.filter(t => t.dominantEvent !== null);
} else {
  pockets = truths.filter(t => t.dominantEvent === null).sort((a, b) => b.articleIds.length - a.articleIds.length).slice(0, PER_KIND);
  impure = truths
    .filter(t => t.dominantEvent !== null && t.impureIds.length > 0)
    .map(t => ({ t, purity: 1 - t.impureIds.length / t.articleIds.length }))
    .filter(x => x.purity >= 0.5 && x.purity <= 0.95)
    .sort((a, b) => b.t.articleIds.length - a.t.articleIds.length)
    .slice(0, PER_KIND)
    .map(x => x.t);
  sample = [...pockets, ...impure];
}

console.log(`【${WIN} t=${THR}】簇 ${truths.length} 个（题材袋 ${truths.filter(t => !t.dominantEvent).length}）`);
console.log(`抽样 ${sample.length} 个：题材袋 ${pockets.length} + 含杂质真事件簇 ${impure.length}；字段档 ${MODES.join('/')}`);
console.log(`共 ${sample.length * MODES.length} 次调用 → ${ENDPOINT}　变体 ${VARIANT}\n`);

async function ask(prompt: string): Promise<{ content: string; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      // 跟生产 storyline_plan 同一档：Workers AI glm-4.7-flash、temperature 0、跳缓存
      options: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, max_tokens: 1200, skipCache: true },
    }),
  });
  const j: any = await res.json();
  if (!j.success) throw new Error(`ai-worker 报错: ${JSON.stringify(j).slice(0, 300)}`);
  return { content: j.data?.choices?.[0]?.message?.content ?? '', ms: Date.now() - t0 };
}

const rows: Array<Scored & { raw: string; prompt: string; ms: number }> = [];
const jobs: Array<{ mode: FieldMode; t: ClusterTruth }> = [];
for (const mode of MODES) for (const t of sample) jobs.push({ mode, t });

let cursor = 0;
let done = 0;
async function worker() {
  for (;;) {
    const k = cursor++;
    if (k >= jobs.length) return;
    const { mode, t } = jobs[k];
    const prompt = buildPrompt(t.articleIds.map(id => fields.get(id)!), mode);
    let raw = '';
    let ms = 0;
    try {
      const r = await ask(prompt);
      raw = r.content;
      ms = r.ms;
    } catch (e) {
      raw = `__CALL_FAILED__ ${e instanceof Error ? e.message : String(e)}`;
    }
    const out = raw.startsWith('__CALL_FAILED__') ? null : parseJudge(raw);
    const s = scoreOne(t, out, mode);
    rows.push({ ...s, raw, prompt, ms });
    done++;
    const tag = t.dominantEvent === null ? '题材袋' : `真事件(杂质${t.impureIds.length}/${t.articleIds.length})`;
    console.log(
      `${String(done).padStart(3)}/${jobs.length} ${mode.padEnd(6)} 簇${String(t.clusterId).padStart(3)} ${String(t.articleIds.length).padStart(2)}篇 ${tag.padEnd(20)}` +
        ` → ${(out?.verdict ?? 'PARSE_FAIL').padEnd(9)} ${s.pocketCorrect ? '✓' : '✗'}` +
        ` 排除${out?.excluded_ids.length ?? 0}(命中${s.excludedHit}/误${s.excludedFalse}) ${ms}ms`
    );
  }
}
await Promise.all(Array.from({ length: Math.min(CONC, jobs.length) }, worker));

console.log('');
for (const mode of MODES) {
  const a = aggregate(rows.filter(r => r.mode === mode));
  const mr = rows.filter(r => r.mode === mode);
  const evRows = mr.filter(r => !r.truthIsPocket);
  const poRows = mr.filter(r => r.truthIsPocket);
  const killed = evRows.filter(r => r.out?.verdict === 'NO_EVENT');
  const saidNo = mr.filter(r => r.out?.verdict === 'NO_EVENT');
  const pocketHit = poRows.filter(r => r.pocketCorrect).length;
  console.log(
    `【${VARIANT}/${mode}】误杀率 ${((killed.length / evRows.length) * 100).toFixed(1)}% (${killed.length}/${evRows.length})  ` +
      `题材袋召回 ${(pocketHit / poRows.length).toFixed(2)} (${pocketHit}/${poRows.length})  ` +
      `题材袋精度 ${saidNo.length ? (pocketHit / saidNo.length).toFixed(2) : 'NaN'} (${pocketHit}/${saidNo.length})  ` +
      `UNSURE ${mr.filter(r => r.out?.verdict === 'UNSURE').length}  解析失败 ${mr.filter(r => r.out === null).length}`
  );
  console.log(`  误杀簇号: ${killed.map(r => r.clusterId).sort((x, y) => x - y).join(',') || '无'}`);
  console.log(
    `${mode.padEnd(6)} 题材袋召回 ${a.pocketRecall.toFixed(2)}  真事件保留 ${a.eventKept.toFixed(2)}  ` +
      `篇级排除 精度 ${a.excludedPrecision.toFixed(2)} 召回 ${a.excludedRecall.toFixed(2)}  ` +
      `(命中 ${a.excludedHit} 漏 ${a.excludedMiss} 误 ${a.excludedFalse})  UNSURE ${a.unsure}  解析失败 ${a.parseFail}`
  );
}

const file = join(OUT, `judge-${WIN}-t${THR}-${VARIANT}-result.json`);
writeFileSync(file, JSON.stringify({ win: WIN, thr: THR, sample: sample.map(t => ({ ...t })), rows }, null, 1));
console.log(`\n明细 → ${file}（pnpm run review 逐簇看）`);
