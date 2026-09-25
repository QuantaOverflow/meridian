/**
 * 「保存简报」step 的落库：reports 行与 brief_runs.report_id 必须同时出现或同时不出现。
 * 走本机测试库（BACKEND_TEST_DATABASE_URL，见 test/README.md「数据库」），不 mock。
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { $brief_runs, $reports, eq } from '@meridian/database';
import { getDb } from '../../src/lib/database';
import { saveBriefReport } from '../../src/lib/save-brief-report';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);
let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
const report = (title: string) => ({ title, content: 'body', usedArticles: 3, usedSources: 2, tldr_prose: null });

describe('saveBriefReport', () => {
  it('插入 reports 并把 id 写进本期 brief_runs.report_id', async () => {
    const wf = uniq('wf-save');
    await db.insert($brief_runs).values({ workflow_id: wf });
    const title = uniq('brief');

    const id = await saveBriefReport(db, wf, report(title));

    const [run] = await db.select().from($brief_runs).where(eq($brief_runs.workflow_id, wf));
    expect(run.report_id).toBe(id);
    const rows = await db.select().from($reports).where(eq($reports.title, title));
    expect(rows.map((r) => r.id)).toEqual([id]);
  });

  it('关联 brief_runs 失败时 reports 行一并回滚，不留下没有 run 指向的一期', async () => {
    const wf = uniq('wf-missing'); // 不插 brief_runs 行：关联必然命中 0 行
    const title = uniq('orphan');

    await expect(saveBriefReport(db, wf, report(title))).rejects.toThrow();

    const rows = await db.select().from($reports).where(eq($reports.title, title));
    expect(rows).toEqual([]);
  });

  it('step 在事务提交后重试：不再插第二条 report，返回已关联的那条', async () => {
    const wf = uniq('wf-retry');
    await db.insert($brief_runs).values({ workflow_id: wf });
    const title = uniq('retry');

    const first = await saveBriefReport(db, wf, report(title));
    const second = await saveBriefReport(db, wf, report(title));

    expect(second).toBe(first);
    const rows = await db.select().from($reports).where(eq($reports.title, title));
    expect(rows.map((r) => r.id)).toEqual([first]);
  });
});
