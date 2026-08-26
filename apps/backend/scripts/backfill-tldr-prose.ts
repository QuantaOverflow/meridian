#!/usr/bin/env node
/**
 * 给历史简报补写 reports.tldr_prose（面向读者的散文摘要）。
 *
 * 背景：tldr_prose 是 2026-08-26 读者端重设计新增的列，只有此后生成的简报会自带；
 * 之前的期数全是 NULL，归档列表没有摘要、简报页标题下少一段。这个脚本把它们补齐。
 *
 * 前置：另开一个终端跑 ai-worker（会走真实 LLM，按调用计费）
 *   cd services/meridian-ai-worker && pnpm wrangler dev --port 8787
 * Workers AI binding 在本地需要 CF 认证，没登录过先 `wrangler login`；
 * 或者把 AI_WORKER_URL 指向已部署的 worker。
 *
 * 用法（在仓库根目录）：
 *   DATABASE_URL=... pnpm -C packages/database exec tsx ../../apps/backend/scripts/backfill-tldr-prose.ts
 *   ... --dry-run       只打印待处理清单，不发请求、不写库
 *   ... --ids 70,71,72  只补指定期
 *   ... --force         连已有的也重写
 */

import { getDb, sql } from '@meridian/database';

const AI_WORKER = process.env.AI_WORKER_URL ?? 'http://localhost:8787';
const DATABASE_URL = process.env.DATABASE_URL ?? process.env.NUXT_DATABASE_URL;
/** 并发度。单次生成 5-50s，串行补 72 期要半小时以上。 */
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const idsArg = args.indexOf('--ids');
const onlyIds =
  idsArg === -1
    ? null
    : (args[idsArg + 1] ?? '')
        .split(',')
        .map(v => Number(v.trim()))
        .filter(Number.isInteger);

if (!DATABASE_URL) {
  console.error('缺少 DATABASE_URL（或 NUXT_DATABASE_URL）');
  process.exit(1);
}

const db = getDb(DATABASE_URL);

interface ReportRow {
  id: number;
  title: string;
  content: string;
}

async function generate(report: { title: string; content: string }): Promise<string> {
  const res = await fetch(`${AI_WORKER}/meridian/generate-brief-summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ briefTitle: report.title, briefContent: report.content }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const json = (await res.json()) as { data?: { tldrProse?: unknown } };
  // 只验「能否解析」不验字段契约是本仓库反复栽过的坑，这里把字段也验了：
  // 缺字段/空串一律当失败抛出去，绝不静默写一条空摘要进库。
  const prose = json?.data?.tldrProse;
  if (typeof prose !== 'string' || prose.trim() === '') {
    throw new Error(`响应缺少 data.tldrProse: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return prose.trim();
}

/**
 * 前置检查：ai-worker 没起或没认证时先失败并说清楚。
 * 否则 72 期各自 fetch 失败、刷 72 行 ✗，真正的原因淹在里面。
 */
async function preflight() {
  try {
    const res = await fetch(`${AI_WORKER}/health`);
    if (!res.ok) throw new Error(`/health 返回 ${res.status}`);
  } catch (err) {
    throw new Error(
      `连不上 ai-worker (${AI_WORKER})。先起它：\n` +
        `  cd services/meridian-ai-worker && pnpm wrangler dev --port 8787\n` +
        `原始错误: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 拿最短的一期真调一次：Workers AI binding 没认证时这里直接暴露「Not logged in」，
  // 不用等跑到一半才发现整批都在失败。
  const [probe] = (await db.execute(sql`
    SELECT title, content FROM reports ORDER BY length(content) ASC LIMIT 1
  `)) as unknown as ReportRow[];
  if (probe === undefined) return;

  try {
    await generate(probe);
  } catch (err) {
    throw new Error(
      `ai-worker 起来了但生成失败——多半是 Workers AI binding 没认证。\n` +
        `  先跑 wrangler login，或把 AI_WORKER_URL 指向已部署的 worker。\n` +
        `原始错误: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function main() {
  if (!dryRun) await preflight();

  const rows = (await db.execute(sql`
    SELECT id, title, content
    FROM reports
    WHERE ${onlyIds === null ? sql`TRUE` : sql`id = ANY(${onlyIds})`}
      AND ${force ? sql`TRUE` : sql`tldr_prose IS NULL`}
    ORDER BY created_at DESC
  `)) as unknown as ReportRow[];

  console.log(`待处理 ${rows.length} 期${dryRun ? '（dry-run，不发请求、不写库）' : ''}`);
  if (rows.length === 0 || dryRun) {
    for (const r of rows) console.log(`  #${r.id} ${r.title.slice(0, 66)}`);
    await db.$client.end();
    return;
  }

  let done = 0;
  const failures: { id: number; error: string }[] = [];
  const queue = [...rows];

  const worker = async () => {
    for (;;) {
      const report = queue.shift();
      if (report === undefined) return;
      try {
        const prose = await generate(report);
        await db.execute(sql`UPDATE reports SET tldr_prose = ${prose} WHERE id = ${report.id}`);
        done += 1;
        console.log(`✓ #${report.id} (${prose.length} 字符) ${prose.slice(0, 84)}…`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ id: report.id, error: message });
        console.error(`✗ #${report.id}: ${message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\n完成 ${done}/${rows.length}，失败 ${failures.length}`);
  if (failures.length > 0) {
    console.log('失败明细：');
    for (const f of failures) console.log(`  #${f.id}: ${f.error}`);
    // 失败不静默：非零退出码。重跑时未写入的期仍会被 tldr_prose IS NULL 选中，可续。
    process.exitCode = 1;
  }

  await db.$client.end();
}

main().catch(async (err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  try {
    await db.$client.end();
  } catch {}
  process.exit(1);
});
