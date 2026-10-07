// 「保存简报」step 的落库：插入 reports 与设置 brief_runs.report_id 在同一个事务里。
//
// 以前 report_id 只在最后的 persist:brief_run_complete 才写。两步之间（事件追踪归并等）中途失败，
// 就会留下一期「列表里有、信源清单与线索却为空」的简报：reports 行在，却没有 run 指向它。
// 放进同一事务后，两者同时出现或同时不出现；persist:brief_run_complete 仍照写一遍 report_id（同值）。
//
// 幂等：step 在事务提交之后才失败（返回值没落进 workflow）会整步重试。本期 run 已经指向一条 report
// 就直接返回它，不再插第二条——否则同一期会在列表里出现两次。
//
// 发布：只有定时（cron）跑出的期写 published_at，读者才看得到；手动触发的期是调试用的，留空。
// 触发方以本期 run 的 params.triggeredBy 为准（cron 入口写 'cron'，见 lib/scheduled/daily-brief.ts）。
//
// 简报块：这一期写出来的每一块在同一个事务里写进 brief_blocks（为什么另存一张表见 ADR 0014）。
// 期与块同时出现或同时不出现；上面的幂等也盖住它——重试时直接返回，不会再写一遍块。
// 每块的落点国家与涉及国家在这里按成员文章算好一并写入（国家页按它查，算法见 lib/reader/story-countries.ts）。
import type { BriefBlockDraft } from '@meridian/contracts';
import { $brief_blocks, $brief_runs, $reports, eq } from '@meridian/database';
import type { getDb } from './database';
import { loadBlockCountries } from './reader/story-countries';

type Db = ReturnType<typeof getDb>;

/**
 * 把一期的块写进 brief_blocks。调用方给事务（或连接）：保存简报与往期回填（scripts/backfill-brief-blocks.ts）共用这一份写法。
 * @internal 只为回填脚本导出
 */
export async function insertBriefBlocks(
  tx: Pick<Db, 'insert' | 'select'>,
  reportId: number,
  blocks: BriefBlockDraft[]
): Promise<void> {
  if (blocks.length === 0) return;
  const countries = await loadBlockCountries(tx, blocks.map((b) => b.storyId));
  await tx.insert($brief_blocks).values(
    blocks.map((b) => ({
      report_id: reportId,
      story_id: b.storyId,
      tier: b.tier,
      position: b.position,
      title: b.title,
      body: b.body,
      placement_country: countries.get(b.storyId)?.placement ?? null,
      mention_countries: countries.get(b.storyId)?.mentions ?? [],
    }))
  );
}

export async function saveBriefReport(
  db: Db,
  workflowId: string,
  values: Omit<typeof $reports.$inferInsert, 'published_at'>,
  blocks: BriefBlockDraft[]
): Promise<number> {
  return db.transaction(async (tx) => {
    // FOR UPDATE：锁住本期 run 行，并发的第二次执行会等第一次提交后读到已写的 report_id
    const [existing] = await tx
      .select({ reportId: $brief_runs.report_id, params: $brief_runs.params })
      .from($brief_runs)
      .where(eq($brief_runs.workflow_id, workflowId))
      .for('update');
    if (existing?.reportId) return existing.reportId;

    const triggeredBy = (existing?.params as { triggeredBy?: unknown } | null | undefined)?.triggeredBy;
    const insertResult = await tx
      .insert($reports)
      .values({ ...values, published_at: triggeredBy === 'cron' ? new Date() : null })
      .returning({ id: $reports.id });
    const reportId = insertResult[0]?.id;
    if (!reportId) {
      throw new Error('简报保存失败：未返回ID');
    }
    // 本期 run 行由 persist:brief_run_start 建好；命中不是恰好 1 行说明口径错了，整笔回滚。
    const linked = await tx
      .update($brief_runs)
      .set({ report_id: reportId })
      .where(eq($brief_runs.workflow_id, workflowId))
      .returning({ id: $brief_runs.id });
    if (linked.length !== 1) {
      throw new Error(`关联 brief_runs.report_id 失败：workflow ${workflowId} 命中 ${linked.length} 行`);
    }
    await insertBriefBlocks(tx, reportId, blocks);
    return reportId;
  });
}
