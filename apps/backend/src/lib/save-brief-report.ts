// 「保存简报」step 的落库：插入 reports 与设置 brief_runs.report_id 在同一个事务里。
//
// 以前 report_id 只在最后的 persist:brief_run_complete 才写。两步之间（事件追踪归并等）中途失败，
// 就会留下一期「列表里有、信源清单与线索却为空」的简报：reports 行在，却没有 run 指向它。
// 放进同一事务后，两者同时出现或同时不出现；persist:brief_run_complete 仍照写一遍 report_id（同值）。
import { $brief_runs, $reports, eq } from '@meridian/database';
import type { getDb } from './database';

export async function saveBriefReport(
  db: ReturnType<typeof getDb>,
  workflowId: string,
  values: typeof $reports.$inferInsert
): Promise<number> {
  return db.transaction(async (tx) => {
    const insertResult = await tx.insert($reports).values(values).returning({ id: $reports.id });
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
    return reportId;
  });
}
