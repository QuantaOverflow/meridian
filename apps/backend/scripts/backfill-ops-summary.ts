#!/usr/bin/env node
/**
 * 给历史生产运行补 brief_runs.ops_summary（运维台读的那份 run 汇总）。一次性脚本。
 *
 * 汇总怎么算不在这里，在 apps/backend/src/lib/ops/run-summary.ts —— workflow 结束时那一步跑的是同一份实现。
 * 这里只负责：从库里挑出要补的 run，经 Cloudflare REST API 读它们在 R2 的记录，把结果写回去。
 *
 * 默认只读（dry-run）：算出来打印，不写库。加 --write 才写。读不到的 run 跳过，列保持 null。
 * 补出来的汇总 degradedReasons 恒为空：降级原因当时只进了日志，R2 里没有。
 *
 * 用法（在仓库根目录）：
 *   DATABASE_URL=... CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
 *     pnpm -C packages/database exec tsx ../../apps/backend/scripts/backfill-ops-summary.ts
 *   ... --write                 真的写库
 *   ... --days 30               回看天数（默认 30）
 *   ... --run <workflowId>      只算指定的 run（可重复）；不加 --write 时不连库，只读 R2
 *
 * R2 的 REST API 全账号限 1200 次 / 5 分钟，脚本按约 3.6 次 / 秒匀速发；写作–核查循环上线后的 run 一期约 400 条调用记录，约 2 分钟一期。
 */

import { $brief_runs, eq, getDb, sql } from '@meridian/database';
import { buildRunOpsSummary, type RunRecordSource } from '../src/lib/ops/run-summary';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const write = args.includes('--write');
const days = flag('days') === undefined ? 30 : Number(flag('days'));
const onlyRuns = args.flatMap((a, i) => (a === '--run' && args[i + 1] ? [args[i + 1]] : []));

const DATABASE_URL = process.env.DATABASE_URL;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const BUCKET = process.env.R2_BUCKET ?? 'meridian-articles-prod';
const needsDb = write || onlyRuns.length === 0;

const missing = [
  ...(needsDb && !DATABASE_URL ? ['DATABASE_URL'] : []),
  ...(CF_TOKEN ? [] : ['CLOUDFLARE_API_TOKEN']),
  ...(CF_ACCOUNT ? [] : ['CLOUDFLARE_ACCOUNT_ID']),
];
if (missing.length > 0 || !Number.isFinite(days) || days <= 0) {
  console.error(missing.length > 0 ? `缺环境变量：${missing.join('、')}` : '--days 要是正数');
  process.exit(1);
}

const R2_API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/r2/buckets/${BUCKET}/objects`;
/** 两次请求之间至少隔这么久（1200 次 / 5 分钟的限额留一成余量） */
const MIN_INTERVAL_MS = 275;
let nextSlot = 0;

async function r2Fetch(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const wait = Math.max(0, nextSlot - Date.now());
    nextSlot = Math.max(nextSlot, Date.now()) + MIN_INTERVAL_MS;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const res = await fetch(url, { headers: { Authorization: `Bearer ${CF_TOKEN}` }, signal: AbortSignal.timeout(60_000) });
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt === 4) throw new Error(`R2 REST API ${res.status}（重试 3 次后仍失败）`);
    await res.body?.cancel();
    await new Promise(r => setTimeout(r, attempt * 10_000));
  }
}

/** 只读：GET 列举、GET 对象 */
const r2RestSource: RunRecordSource = {
  async list(prefix, cursor) {
    const q = new URLSearchParams({ prefix, per_page: '1000', ...(cursor ? { cursor } : {}) });
    const res = await r2Fetch(`${R2_API}?${q}`);
    if (!res.ok) throw new Error(`列 ${prefix} 失败：HTTP ${res.status}`);
    const body = (await res.json()) as {
      result: Array<{ key: string }>;
      result_info?: { cursor?: string; is_truncated?: boolean };
    };
    return {
      keys: body.result.map(o => o.key),
      cursor: body.result_info?.is_truncated ? body.result_info.cursor : undefined,
    };
  },
  async get(key) {
    const res = await r2Fetch(`${R2_API}/${encodeURIComponent(key)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`读 ${key} 失败：HTTP ${res.status}`);
    return res.text();
  },
};

async function main() {
  const db = needsDb ? getDb(DATABASE_URL!) : null;
  try {
    const targets =
      onlyRuns.length > 0
        ? onlyRuns
        : (
            (await db!.execute(sql`
              SELECT workflow_id
              FROM brief_runs
              WHERE workflow_id LIKE 'cron-brief-%'
                AND ops_summary IS NULL
                AND status <> 'RUNNING'
                AND started_at >= now() - make_interval(days => ${days})
              ORDER BY started_at ASC
            `)) as unknown as { workflow_id: string }[]
          ).map(r => r.workflow_id);

    console.log(`${write ? '写库' : 'dry-run（不写库，加 --write 才写）'} · 桶 ${BUCKET} · 待处理 ${targets.length} 个 run`);

    let done = 0;
    const unreadable: string[] = [];
    for (const wf of targets) {
      try {
        const summary = await buildRunOpsSummary(r2RestSource, wf, []);
        if (summary.llm.calls === 0 && summary.steps.length === 0) {
          // R2 里这次 run 什么都没有（记录过期或从没写过）：不写一份全 0 的汇总冒充「这期没花钱」
          throw new Error('R2 里没有这次 run 的调用记录和观测');
        }
        const phases = Object.entries(summary.llm.byPhase)
          .map(([p, v]) => `${p} ${v.calls}/${v.neurons}`)
          .join('，');
        console.log(
          `${wf}  调用 ${summary.llm.calls} · neurons ${summary.llm.neurons} · 步骤 ${summary.steps.length} · ` +
            `块 ${summary.blocks ? `${summary.blocks.written}/${summary.blocks.expected}` : '—'}  [${phases}]`
        );
        if (write) {
          // 只补空的：脚本跑的这会儿 workflow 自己写上了的，不覆盖
          await db!
            .update($brief_runs)
            .set({ ops_summary: summary })
            .where(sql`${eq($brief_runs.workflow_id, wf)} AND ${$brief_runs.ops_summary} IS NULL`);
        }
        done++;
      } catch (error) {
        unreadable.push(wf);
        console.error(`${wf}  跳过（保持 null）：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log(`\n${write ? '已写' : '可写'} ${done} 个 · 读不到跳过 ${unreadable.length} 个`);
  } finally {
    await db?.$client.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
