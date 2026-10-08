/**
 * 「保存简报」step 的落库：reports 行与 brief_runs.report_id 必须同时出现或同时不出现。
 * 走本机测试库（BACKEND_TEST_DATABASE_URL，见 test/README.md「数据库」），不 mock。
 */
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { BriefBlockDraft } from '@meridian/contracts';
import { $articles, $brief_blocks, $brief_runs, $brief_stories, $reports, $sources, eq, sql } from '@meridian/database';
import { getDb } from '../../src/lib/database';
import { saveBriefReport } from '../../src/lib/save-brief-report';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);
let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
const report = (title: string) => ({ title, content: 'body', usedArticles: 3, usedSources: 2, tldr_prose: null });


/** 给本期 run 插 n 个故事，返回它们的 brief_stories.id */
async function stories(wf: string, n: number): Promise<number[]> {
  const rows = await db
    .insert($brief_stories)
    .values(Array.from({ length: n }, (_, i) => ({ workflow_id: wf, cluster_id: i })))
    .returning({ id: $brief_stories.id });
  return rows.map((r) => r.id);
}
const blocksOf = (reportId: number) =>
  db
    .select({
      storyId: $brief_blocks.story_id,
      tier: $brief_blocks.tier,
      position: $brief_blocks.position,
      title: $brief_blocks.title,
      body: $brief_blocks.body,
    })
    .from($brief_blocks)
    .where(eq($brief_blocks.report_id, reportId))
    .orderBy($brief_blocks.position);

describe('saveBriefReport', () => {
  it('插入 reports 并把 id 写进本期 brief_runs.report_id', async () => {
    const wf = uniq('wf-save');
    await db.insert($brief_runs).values({ workflow_id: wf });
    const title = uniq('brief');

    const id = await saveBriefReport(db, wf, report(title), []);

    const [run] = await db.select().from($brief_runs).where(eq($brief_runs.workflow_id, wf));
    expect(run.report_id).toBe(id);
    const rows = await db.select().from($reports).where(eq($reports.title, title));
    expect(rows.map((r) => r.id)).toEqual([id]);
  });

  it('定时（cron）触发的期写 published_at，读者看得到', async () => {
    const wf = uniq('wf-cron');
    await db.insert($brief_runs).values({ workflow_id: wf, params: { triggeredBy: 'cron' } });

    const id = await saveBriefReport(db, wf, report(uniq('cron')), []);

    const [row] = await db.select().from($reports).where(eq($reports.id, id));
    expect(row.published_at).toBeInstanceOf(Date);
  });

  it('手动触发的期不写 published_at，读者看不到', async () => {
    for (const params of [{ triggeredBy: 'admin' }, { triggeredBy: 'manual-e2e-2026-09-26' }, {}, null]) {
      const wf = uniq('wf-manual');
      await db.insert($brief_runs).values({ workflow_id: wf, params });

      const id = await saveBriefReport(db, wf, report(uniq('manual')), []);

      const [row] = await db.select().from($reports).where(eq($reports.id, id));
      expect(row.published_at, JSON.stringify(params)).toBeNull();
    }
  });

  it('关联 brief_runs 失败时 reports 行一并回滚，不留下没有 run 指向的一期', async () => {
    const wf = uniq('wf-missing'); // 不插 brief_runs 行：关联必然命中 0 行
    const title = uniq('orphan');

    await expect(saveBriefReport(db, wf, report(title), [])).rejects.toThrow();

    const rows = await db.select().from($reports).where(eq($reports.title, title));
    expect(rows).toEqual([]);
  });

  it('step 在事务提交后重试：不再插第二条 report，返回已关联的那条', async () => {
    const wf = uniq('wf-retry');
    await db.insert($brief_runs).values({ workflow_id: wf });
    const title = uniq('retry');

    const first = await saveBriefReport(db, wf, report(title), []);
    const second = await saveBriefReport(db, wf, report(title), []);

    expect(second).toBe(first);
    const rows = await db.select().from($reports).where(eq($reports.title, title));
    expect(rows.map((r) => r.id)).toEqual([first]);
  });

  it('简报块与这一期一起落库', async () => {
    const wf = uniq('wf-blocks');
    await db.insert($brief_runs).values({ workflow_id: wf });
    const [a, b] = await stories(wf, 2);
    const blocks: BriefBlockDraft[] = [
      { storyId: a, tier: 'lead', position: 0, title: 'Ceasefire talks resume', body: 'Negotiators met in Doha on Tuesday.' },
      { storyId: b, tier: 'brief', position: 1, title: 'Rates held', body: 'The central bank kept rates unchanged.' },
    ];

    const id = await saveBriefReport(db, wf, report(uniq('blocks')), blocks);

    expect(await blocksOf(id)).toEqual(blocks);
  });

  it('step 在事务提交后重试：块不重复写', async () => {
    const wf = uniq('wf-blocks-retry');
    await db.insert($brief_runs).values({ workflow_id: wf });
    const [a] = await stories(wf, 1);
    const blocks: BriefBlockDraft[] = [{ storyId: a, tier: 'lead', position: 0, title: 'T', body: 'B.' }];
    const values = report(uniq('blocks-retry'));

    const first = await saveBriefReport(db, wf, values, blocks);
    const second = await saveBriefReport(db, wf, values, blocks);

    expect(second).toBe(first);
    expect(await blocksOf(first)).toEqual(blocks);
  });

  it('块写不进去时这一期一并回滚，不留下没有块的一期', async () => {
    const wf = uniq('wf-blocks-fail');
    await db.insert($brief_runs).values({ workflow_id: wf });
    const title = uniq('blocks-fail');
    const missingStory = 2_000_000_000; // 没有这个故事：外键拒绝

    await expect(
      saveBriefReport(db, wf, report(title), [{ storyId: missingStory, tier: 'lead', position: 0, title: 'T', body: 'B.' }])
    ).rejects.toThrow();

    expect(await db.select().from($reports).where(eq($reports.title, title))).toEqual([]);
    const [run] = await db.select().from($brief_runs).where(eq($brief_runs.workflow_id, wf));
    expect(run.report_id).toBeNull();
  });

  it('块的落点国家与涉及国家在落库时按成员文章算好', async () => {
    const wf = uniq('wf-blocks-countries');
    await db.insert($brief_runs).values({ workflow_id: wf });
    const [source] = await db.insert($sources).values({ url: uniq('https://feeds.example.com/c'), name: 'C', category: 'news', scrape_frequency: 1 }).returning({ id: $sources.id });
    const article = (location: string | null, entities: string[]) => ({
      title: 'a', url: uniq('https://c.example.com/a'), sourceId: source.id, primary_location: location, key_entities: entities,
    });
    const ids = (
      await db
        .insert($articles)
        .values([
          // 故事 A：三篇都在韩国，其中两篇的关键实体提到朝鲜、一篇提到美国 → 落点 KR，涉及 KP（2/3），US 只有 1/3 不算
          article('South Korea', ['North Korea', 'Kim Jong Un']),
          article('South Korea', ['north korea', 'United States']),
          article('South Korea', []),
          // 故事 B：四篇分在四国，没有国家到 30% → 没有落点，铺开的几国都算涉及
          article('France', []),
          article('Germany', []),
          article('Japan', []),
          article('Brazil', []),
        ])
        .returning({ id: $articles.id })
    ).map((r) => r.id);
    const rows = await db
      .insert($brief_stories)
      .values([
        { workflow_id: wf, cluster_id: 0, article_ids: ids.slice(0, 3) },
        { workflow_id: wf, cluster_id: 1, article_ids: ids.slice(3) },
        { workflow_id: wf, cluster_id: 2, article_ids: null },
      ])
      .returning({ id: $brief_stories.id });

    const id = await saveBriefReport(
      db,
      wf,
      report(uniq('blocks-countries')),
      rows.map((r, position) => ({ storyId: r.id, tier: 'more' as const, position, title: `T${position}`, body: 'B.' }))
    );

    const saved = await db
      .select({ placement: $brief_blocks.placement_country, mentions: $brief_blocks.mention_countries })
      .from($brief_blocks)
      .where(eq($brief_blocks.report_id, id))
      .orderBy($brief_blocks.position);
    expect(saved).toEqual([
      { placement: 'KR', mentions: ['KP'] },
      { placement: null, mentions: ['BR', 'DE', 'FR', 'JP'] },
      { placement: null, mentions: [] },
    ]);
  });

  it('块的实体在落库时按成员文章算好：至少一半成员提到才算，写法只归一大小写与首尾空白，国家与媒体名不算', async () => {
    const wf = uniq('wf-blocks-entities');
    await db.insert($brief_runs).values({ workflow_id: wf });
    const [source] = await db.insert($sources).values({ url: uniq('https://feeds.example.com/e'), name: 'E', category: 'news', scrape_frequency: 1 }).returning({ id: $sources.id });
    const article = (entities: unknown) => ({ title: 'a', url: uniq('https://e.example.com/a'), sourceId: source.id, key_entities: entities });
    const ids = (
      await db
        .insert($articles)
        .values([
          // 故事 A（4 篇）：Sam Altman 4/4（三种写法归成一个，显示用最多的那种）、OpenAI 2/4 算、Elon Musk 1/4 不算；
          // Iran 是国家、Reuters 与 BBC 是媒体，都不算；同一篇里重复写只算一次
          article(['Sam Altman', 'OpenAI', 'Iran', 'Reuters']),
          article([' sam altman ', 'OpenAI', 'BBC', 'United States']),
          article(['Sam Altman', 'Sam Altman', 'Elon Musk', '', 42]),
          article(['SAM ALTMAN']),
          // 故事 B（2 篇）：一篇的关键实体不是数组
          article(null),
          article(['Pope Leo XIV']),
        ])
        .returning({ id: $articles.id })
    ).map((r) => r.id);
    const rows = await db
      .insert($brief_stories)
      .values([
        { workflow_id: wf, cluster_id: 0, article_ids: ids.slice(0, 4) },
        { workflow_id: wf, cluster_id: 1, article_ids: ids.slice(4) },
        { workflow_id: wf, cluster_id: 2, article_ids: null },
      ])
      .returning({ id: $brief_stories.id });

    const id = await saveBriefReport(
      db,
      wf,
      report(uniq('blocks-entities')),
      rows.map((r, position) => ({ storyId: r.id, tier: 'more' as const, position, title: `T${position}`, body: 'B.' }))
    );

    const saved = await db
      .select({ entities: $brief_blocks.entities, names: $brief_blocks.entity_names })
      .from($brief_blocks)
      .where(eq($brief_blocks.report_id, id))
      .orderBy($brief_blocks.position);
    expect(saved).toEqual([
      { entities: ['sam altman', 'openai'], names: ['Sam Altman', 'OpenAI'] },
      { entities: ['pope leo xiv'], names: ['Pope Leo XIV'] },
      { entities: [], names: [] },
    ]);
  });

  it('块的标题与正文可按英文全文检索，词形不同也命中', async () => {
    const wf = uniq('wf-blocks-search');
    await db.insert($brief_runs).values({ workflow_id: wf });
    const [a, b] = await stories(wf, 2);
    const id = await saveBriefReport(db, wf, report(uniq('blocks-search')), [
      { storyId: a, tier: 'lead', position: 0, title: 'Ceasefire talks resume', body: 'Negotiators met in Doha on Tuesday.' },
      { storyId: b, tier: 'more', position: 1, title: 'Rates held', body: 'The central bank kept rates unchanged.' },
    ]);

    const hits = (q: string) =>
      db
        .select({ position: $brief_blocks.position })
        .from($brief_blocks)
        .where(sql`${$brief_blocks.report_id} = ${id} and ${$brief_blocks.search} @@ websearch_to_tsquery('english', ${q})`);

    expect(await hits('negotiator')).toEqual([{ position: 0 }]); // 正文，单复数
    expect(await hits('resuming')).toEqual([{ position: 0 }]); // 标题，词形
    expect(await hits('banks')).toEqual([{ position: 1 }]);
    expect(await hits('earthquake')).toEqual([]);
  });
});
