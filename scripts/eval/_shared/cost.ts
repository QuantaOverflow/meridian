// 成本读数 —— 把「这次实验花了多少」从月底查账变成跑完就看得见的一行。
//
// 为什么要有它：2026-09 账期拆开后，Workers AI 的 glm 花费 73% 在 cron 窗口之外（开发/原型批量跑），
// 而那些跑法既没有事前估算也没有事后读数，归因只能靠按小时查 GraphQL + 比对文件修改时间做考古。
// 每次 LLM 调用的 neurons 其实早就记在观测 span 里（`attributes.usage.neurons`），只是没人汇总。
//
// 三种模式，按证据强弱排：
//   dumps   读落盘的观测 span（最准，零额外调用；要求 harness 落了 `x.observation.spans` 或 `x.spans`）
//   window  按时间窗查 CF GraphQL（覆盖不落盘的 harness；账户级读数，窗口内的其他流量会一起算进来）
//   wrap    包住一条命令跑，跑完自动按它的起止时间查 window
//
// 跑法（`_shared` 没有自己的 package.json，借任一 harness 的 tsx，与 metrics.test.ts 同）：
//   cd scripts/eval/faithfulness
//   npx tsx ../_shared/cost.ts dumps ../../../apps/backend/prototypes/brief-writer-v3/out/runs/M3-1789131192155
//   npx tsx ../_shared/cost.ts window --since=2026-09-11T11:00:00Z --until=2026-09-11T13:00:00Z
//   npx tsx ../_shared/cost.ts wrap -- node ../../../apps/backend/prototypes/foo/run.ts
//
// 单价 $0.011 / 1,000 neurons（2026-08 核实，无任何折扣；见 memory workers-ai-pricing-no-discounts）。
// 免费额度是**账单周期池**（10,000 × 周期天数）不是每日作废，所以单次实验的「毛成本」就是它的边际成本。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PRICE_PER_NEURON = 0.011 / 1000;
const usd = (n: number) => '$' + (n * PRICE_PER_NEURON).toFixed(n * PRICE_PER_NEURON < 1 ? 3 : 2);
const ACCOUNT = process.env.CF_ACCOUNT_ID ?? 'c8317cfcb330d45b37b00ccd7e8a9936';
/** wrangler 的 OAuth token（macOS 路径；注意不是 ~/.wrangler）。GraphQL Analytics 能用，billing API 无权限。 */
const TOKEN_PATH = join(homedir(), 'Library/Preferences/.wrangler/config/default.toml');

// ── dumps：读落盘的观测 span ────────────────────────────────────────────────
function jsonFilesUnder(path: string): string[] {
  const st = statSync(path);
  if (!st.isDirectory()) return path.endsWith('.json') ? [path] : [];
  return readdirSync(path).flatMap(f => jsonFilesUnder(join(path, f)));
}

/** 一个落盘对象里的 LLM span：认 `observation.spans`（verify.ts 的形状）和顶层 `spans`。 */
function llmSpansOf(obj: any): any[] {
  const spans = obj?.observation?.spans ?? obj?.spans;
  return Array.isArray(spans) ? spans.filter((s: any) => s?.kind === 'llm') : [];
}

function dumps(paths: string[]) {
  let grandNeurons = 0, grandCalls = 0;
  for (const p of paths) {
    const byModel = new Map<string, { n: number; calls: number }>();
    let neurons = 0, calls = 0, files = 0, missing = 0;
    for (const f of jsonFilesUnder(p)) {
      let obj: any;
      try { obj = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
      const spans = llmSpansOf(obj);
      if (!spans.length) continue;
      files++;
      for (const s of spans) {
        calls++;
        const n = s?.attributes?.usage?.neurons;
        if (typeof n !== 'number') { missing++; continue; }
        neurons += n;
        const m = String(s?.attributes?.model ?? 'unknown');
        const e = byModel.get(m) ?? { n: 0, calls: 0 };
        e.n += n; e.calls++;
        byModel.set(m, e);
      }
    }
    grandNeurons += neurons; grandCalls += calls;
    console.log(`${p}\n  ${files} 个落盘对象 · ${calls} 次 LLM 调用 · ${Math.round(neurons)} neurons · ${usd(neurons)}`
      + (missing ? `  ⚠️ ${missing} 次调用没有 usage.neurons，未计入` : ''));
    for (const [m, e] of [...byModel].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`    ${m.padEnd(42)} ${String(e.calls).padStart(5)}次 ${Math.round(e.n).toString().padStart(8)} neurons ${usd(e.n)}`
        + `  (${(e.n / e.calls).toFixed(1)} n/次)`);
    }
  }
  if (paths.length > 1) console.log(`合计 ${grandCalls} 次调用 · ${Math.round(grandNeurons)} neurons · ${usd(grandNeurons)}`);
}

// ── window：按时间窗查 CF GraphQL ───────────────────────────────────────────
function oauthToken(): string {
  const m = readFileSync(TOKEN_PATH, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!m) throw new Error(`没在 ${TOKEN_PATH} 里找到 oauth_token（wrangler login 过吗？）`);
  return m[1];
}

/**
 * CF 的用量按时间桶聚合：窗口 ≤ 24 小时用 15 分钟桶，更长用天桶。
 * **桶会把窗口外的流量一起算进来**（同一个 15 分钟里生产 cron 也在跑的话，读数偏高），所以
 * window 是账户级估算，不是这次实验的精确账单——要精确就用 dumps。
 */
async function window_(sinceISO: string, untilISO: string) {
  const since = new Date(sinceISO), until = new Date(untilISO);
  if (isNaN(since.getTime()) || isNaN(until.getTime())) throw new Error('--since / --until 需要是 ISO 时间，如 2026-09-11T11:00:00Z');
  const hours = (until.getTime() - since.getTime()) / 3.6e6;
  const fine = hours <= 24;
  const dim = fine ? 'datetimeFifteenMinutes' : 'date';
  const fmt = (d: Date) => (fine ? d.toISOString().slice(0, 19) + 'Z' : d.toISOString().slice(0, 10));
  const query = `query { viewer { accounts(filter:{accountTag:"${ACCOUNT}"}) {
    g: aiInferenceAdaptiveGroups(limit:1000, filter:{${dim}_geq:"${fmt(since)}", ${dim}_leq:"${fmt(until)}"}) {
      dimensions { modelId } sum { totalNeurons } count } } } }`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${oauthToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body: any = await res.json();
  if (!body?.data) throw new Error(`GraphQL 没返回数据：${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);
  const rows: any[] = body.data.viewer.accounts[0]?.g ?? [];
  const total = rows.reduce((s, r) => s + r.sum.totalNeurons, 0);
  const calls = rows.reduce((s, r) => s + r.count, 0);
  console.log(`窗口 ${fmt(since)} → ${fmt(until)}（${dim} 桶，账户级，窗口内其他流量也计入）`);
  for (const r of rows.sort((a, b) => b.sum.totalNeurons - a.sum.totalNeurons)) {
    console.log(`  ${String(r.dimensions.modelId).padEnd(42)} ${String(r.count).padStart(5)}次 `
      + `${Math.round(r.sum.totalNeurons).toString().padStart(8)} neurons ${usd(r.sum.totalNeurons)}`);
  }
  console.log(`  合计 ${calls} 次调用 · ${Math.round(total)} neurons · ${usd(total)}`);
  if (!rows.length) console.log('  （读数为空：CF 分析数据有延迟，隔几分钟按同一窗口重跑 window 模式）');
}

// ── wrap：包住一条命令，跑完按它的起止时间查窗口 ─────────────────────────
async function wrap(cmd: string[]) {
  const since = new Date(Date.now() - 15 * 60_000); // 往前留一个 15 分钟桶，保证首批调用落在窗口内
  const t0 = Date.now();
  const code = await new Promise<number>(resolve => {
    const p = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit' });
    p.on('close', c => resolve(c ?? 0));
  });
  const until = new Date(Date.now() + 15 * 60_000);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n── 成本读数（命令退出码 ${code}，耗时 ${secs}s）──`);
  const cmdline = `npx tsx ${process.argv[1]} window --since=${since.toISOString()} --until=${until.toISOString()}`;
  try {
    await window_(since.toISOString(), until.toISOString());
  } catch (e) {
    console.log(`  查询失败：${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`（数据有延迟，稍后可重查：${cmdline}）`);
  process.exit(code);
}

// ── main ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const mode = argv[0];
const arg = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');

// 包成 async main 而不是用顶层 await：`_shared` 没有自己的 package.json，tsx 按 CJS 编译这里的 .ts，
// 顶层 await 会直接编译失败（2026-09-12 实测）。
async function main() {
  if (mode === 'dumps' && argv.length > 1) {
    dumps(argv.slice(1).filter(a => !a.startsWith('--')));
  } else if (mode === 'window') {
    await window_(arg('since') ?? new Date(Date.now() - 3.6e6).toISOString(), arg('until') ?? new Date().toISOString());
  } else if (mode === 'wrap') {
    const i = argv.indexOf('--');
    if (i < 0 || i === argv.length - 1) throw new Error('wrap 模式要写成：cost.ts wrap -- <命令>');
    await wrap(argv.slice(i + 1));
  } else {
    console.log(`用法：
  cost.ts dumps <目录或文件>...                读落盘观测 span 求和（最准，零额外调用）
  cost.ts window [--since=ISO] [--until=ISO]   按时间窗查 CF GraphQL（默认最近 1 小时；账户级）
  cost.ts wrap -- <命令>                       跑命令并在结束后按其起止时间查窗口`);
    process.exit(2);
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
