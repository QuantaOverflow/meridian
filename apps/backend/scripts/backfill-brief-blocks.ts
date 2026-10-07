#!/usr/bin/env node
/**
 * 给往期简报回填简报块（表 brief_blocks，为什么有这张表见 docs/adr/0014-brief-blocks-table.md）。
 *
 * 新出的一期在「保存简报」时就写块（src/lib/save-brief-report.ts）；这里补它上线之前的期。
 * 依据是每期的 brief-v3 记录（R2 `observability/brief-v3/<workflowId>.json`）：写出来的块按 clusterId 对回同一 run 的
 * brief_stories，标题与正文的取法、落库的写法都与保存简报共用（briefBlockDrafts / insertBriefBlocks）。
 *
 * 范围：--since（默认 2026-09-01）起已发布的期。整期回填或整期跳过，下面任一条不满足就跳过并报原因：
 *   这期有 run；有 brief-v3 记录；每个写出来的块都对得上恰好一个故事；每块都有正文；每块的标题与正文都出现在 reports.content 里。
 * 可重跑、幂等：每期在一个事务里先删后写。跳过的期不删不写（它已有的块是保存时写的）。
 *
 * 块上的落点国家与涉及国家（国家页按它查）在写块时按成员文章算，所以重跑即刷新；跳过的期已有的块只重算这两列。
 *
 * 默认只读（dry-run），加 --write 才写库。R2 只读（只 GET 上面那个前缀）。
 * 目标库只认本机与 staging（主机名与 STAGING_DATABASE_URL 相同；取自环境变量或仓库根 .staging.env），
 * 其余一律当生产拒绝，除非显式加 --production。
 *
 * 用法（在仓库根目录）：
 *   DATABASE_URL=... CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
 *     pnpm -C packages/database exec tsx ../../apps/backend/scripts/backfill-brief-blocks.ts --bucket meridian-articles-prod
 *   ... --write                 真的写库
 *   ... --since 2026-09-01      从哪天起的期（按 reports.created_at）
 *   ... --production            目标库是生产时必须加
 *
 * 退出码：0 = 正常（含有期被跳过）；1 = 出错，或写完后库里的块数与记录的成功块数对不上；2 = 用法或配置错。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { briefV3RecordKey, type BriefV3Record, type BriefV3WrittenBlock } from '@meridian/contracts';
import { $brief_blocks, eq, getDb, sql } from '@meridian/database';
import { briefBlockDrafts } from '../src/lib/core/brief-v3';
import { loadBlockCountries } from '../src/lib/reader/story-countries';
import { insertBriefBlocks } from '../src/lib/save-brief-report';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const write = args.includes('--write');
const allowProduction = args.includes('--production');
const since = flag('since') ?? '2026-09-01';
const bucket = flag('bucket');

const DATABASE_URL = process.env.DATABASE_URL;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;

function die(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}

const missing = [
  ...(DATABASE_URL ? [] : ['DATABASE_URL']),
  ...(CF_TOKEN ? [] : ['CLOUDFLARE_API_TOKEN']),
  ...(CF_ACCOUNT ? [] : ['CLOUDFLARE_ACCOUNT_ID']),
];
if (missing.length > 0) die(2, `缺环境变量：${missing.join('、')}`);
if (!bucket) die(2, '缺 --bucket <bucket 名>（往期的 brief-v3 记录在生产 bucket，只读）');
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) die(2, '--since 要是 YYYY-MM-DD');

/** 连接串的主机名；Neon 的连接池地址（-pooler）与直连地址算同一个库 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace('-pooler.', '.');
  } catch {
    return die(2, '数据库连接串解析不了');
  }
}

/** STAGING_DATABASE_URL：环境变量优先，否则读仓库根 .staging.env（按行取，值里有 & 不能 source） */
function stagingDatabaseUrl(): string | undefined {
  if (process.env.STAGING_DATABASE_URL) return process.env.STAGING_DATABASE_URL;
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../.staging.env');
  if (!fs.existsSync(file)) return undefined;
  const line = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .find(l => l.startsWith('STAGING_DATABASE_URL='));
  return line?.slice('STAGING_DATABASE_URL='.length).trim() || undefined;
}

const targetHost = hostOf(DATABASE_URL!);
const stagingUrl = stagingDatabaseUrl();
const target =
  targetHost === 'localhost' || targetHost === '127.0.0.1'
    ? '本机'
    : stagingUrl !== undefined && hostOf(stagingUrl) === targetHost
      ? 'staging'
      : '生产';
if (target === '生产' && !allowProduction) {
  die(2, '目标库不是本机也不是 staging（主机名与 STAGING_DATABASE_URL 不同），按生产对待：拒绝。确实要对生产跑就加 --production');
}

/** 只读：GET 一个对象。没有返回 null；被限速或 5xx 重试 3 次 */
async function readRecord(workflowId: string): Promise<BriefV3Record | null> {
  const key = briefV3RecordKey(workflowId);
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${CF_TOKEN}` }, signal: AbortSignal.timeout(60_000) });
    if (res.status === 404) return null;
    if (res.ok) {
      const record = (await res.json()) as BriefV3Record;
      if (!Array.isArray(record?.blocks)) throw new Error(`${key} 形状不对（blocks 不是数组）`);
      return record;
    }
    await res.body?.cancel();
    if ((res.status !== 429 && res.status < 500) || attempt === 4) throw new Error(`读 ${key} 失败：HTTP ${res.status}`);
    await new Promise(r => setTimeout(r, attempt * 10_000));
  }
}

type Period = { id: number; day: string; content: string; workflow_id: string | null };
type Story = { id: number; cluster_id: number | null; selected_for_intel: boolean };

/** 这一块对应的故事：同一 run 里 cluster_id 相同的恰好一个；有几个时只看选中的（写块的只会是选中的故事） */
function storyOf(block: BriefV3WrittenBlock, stories: Story[]): number | null {
  if (block.clusterId === null || block.clusterId === undefined) return null;
  const same = stories.filter(s => s.cluster_id === block.clusterId);
  const candidates = same.length > 1 ? same.filter(s => s.selected_for_intel) : same;
  return candidates.length === 1 ? candidates[0].id : null;
}

/** 跳过的期：已有的块（保存时写的）只重算落点国家与涉及国家，返回块数 */
async function refreshCountries(db: ReturnType<typeof getDb>, reportId: number): Promise<number> {
  const blocks = await db
    .select({ id: $brief_blocks.id, storyId: $brief_blocks.story_id })
    .from($brief_blocks)
    .where(eq($brief_blocks.report_id, reportId));
  const countries = await loadBlockCountries(db, blocks.map(b => b.storyId));
  await db.transaction(async tx => {
    for (const b of blocks) {
      const c = countries.get(b.storyId);
      await tx
        .update($brief_blocks)
        .set({ placement_country: c?.placement ?? null, mention_countries: c?.mentions ?? [] })
        .where(eq($brief_blocks.id, b.id));
    }
  });
  return blocks.length;
}

async function main() {
  const db = getDb(DATABASE_URL!);
  try {
    // 一期可能有不止一个 run 指向它：取最晚开始的那个（与地图接口 lib/reader/brief-map.ts 同口径）
    const periods = (await db.execute(sql`
      SELECT r.id, to_char(r.created_at, 'YYYY-MM-DD') AS day, r.content,
        (SELECT br.workflow_id FROM brief_runs br WHERE br.report_id = r.id ORDER BY br.started_at DESC LIMIT 1) AS workflow_id
      FROM reports r
      WHERE r.published_at IS NOT NULL AND r.created_at >= ${since}::date
      ORDER BY r.id
    `)) as unknown as Period[];

    console.log(
      `${write ? '写库' : 'dry-run（不写库，加 --write 才写）'} · 目标库 ${target} · 记录取自 bucket ${bucket} · ${since} 起已发布 ${periods.length} 期`
    );

    const skipped: string[] = [];
    const mismatched: string[] = [];
    let filled = 0;
    let blocksTotal = 0;
    for (const p of periods) {
      const label = `report ${p.id}（${p.day}）`;
      const skip = async (reason: string) => {
        const refreshed = write ? await refreshCountries(db, p.id) : 0;
        skipped.push(`${label}：${reason}`);
        console.log(`${label}  跳过：${reason}${refreshed > 0 ? ` · 已有的 ${refreshed} 块重算了国家` : ''}`);
      };
      if (p.workflow_id === null) {
        await skip('没有 run 指向这一期');
        continue;
      }
      const record = await readRecord(p.workflow_id);
      if (record === null) {
        await skip(`没有 brief-v3 记录（${p.workflow_id}）`);
        continue;
      }
      const written = record.blocks.filter((b): b is BriefV3WrittenBlock => b?.ok === true);
      const failed = record.blocks.length - written.length;
      const stories = (await db.execute(sql`
        SELECT id, cluster_id, selected_for_intel FROM brief_stories WHERE workflow_id = ${p.workflow_id}
      `)) as unknown as Story[];

      const matched = written.map(b => ({ storyId: storyOf(b, stories), title: b.title, text: b.text, tier: b.tier }));
      const unmatched = matched.filter(b => b.storyId === null).length;
      if (unmatched > 0 || new Set(matched.map(b => b.storyId)).size !== matched.length) {
        await skip(`块与故事对不上（写出 ${written.length} 块，${unmatched} 块找不到唯一的故事）`);
        continue;
      }
      const drafts = briefBlockDrafts(matched);
      if (drafts.length !== written.length) {
        await skip(`${written.length - drafts.length} 块没有正文`);
        continue;
      }
      const notInContent = drafts.filter(d => !p.content.includes(d.body) || !p.content.includes(`**${d.title}**`));
      if (notInContent.length > 0) {
        await skip(`${notInContent.length} 块的标题或正文不在这一期的正文里（记录与成稿不一致），第一块：「${notInContent[0].title}」`);
        continue;
      }

      let note = '';
      if (write) {
        await db.transaction(async tx => {
          await tx.delete($brief_blocks).where(eq($brief_blocks.report_id, p.id));
          await insertBriefBlocks(tx, p.id, drafts);
        });
        // 写完从库里数一遍，与记录的成功块数对：两个数来自不同的地方
        const [{ n }] = (await db.execute(
          sql`SELECT count(*)::int AS n FROM brief_blocks WHERE report_id = ${p.id}`
        )) as unknown as { n: number }[];
        note = ` · 库里 ${n} 块`;
        if (n !== written.length) mismatched.push(`${label}：库里 ${n} 块，记录成功 ${written.length} 块`);
      }
      filled++;
      blocksTotal += drafts.length;
      console.log(`${label}  ${write ? '回填' : '可回填'} ${drafts.length} 块 · 记录成功 ${written.length} 块、失败 ${failed} 块${note}`);
    }

    console.log(`\n${write ? '已回填' : '可回填'} ${filled} 期共 ${blocksTotal} 块 · 跳过 ${skipped.length} 期`);
    for (const s of skipped) console.log(`  跳过 ${s}`);
    if (mismatched.length > 0) {
      for (const m of mismatched) console.error(`  对不上 ${m}`);
      process.exitCode = 1;
    }
  } finally {
    await db.$client.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
