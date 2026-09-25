/**
 * 源的生命周期：所有对 `sources` 表的写操作与对应 SourceScraperDO 的启停只经这里。
 *
 * 不变量（test/lib/sources.spec.ts、source-pause.spec.ts 逐条验）：
 * 1. 未暂停的源 ⇒ 按它当前 url 命名的 DO 有 state（url、tier 与表一致）且有 alarm
 * 2. 暂停的源 ⇒ 没有 alarm
 * 3. 删除后 ⇒ 表里没有行，DO 没有 alarm、storage 清空
 * 4. 失败不留半截状态：DO 在 DB 成功之后才动；DO 失败则把表（与已动过的 DO）改回操作前
 */
import { $articles, $sources, and, eq, isNull } from '@meridian/database';
import { getDb } from './database';
import { Logger } from './core/logger';
import type { Env } from '../index';

type Source = typeof $sources.$inferSelect;

export type SourceInput = { url: string; name?: string; category?: string; scrape_frequency?: 1 | 2 | 3 | 4 };
export type SourceResult<T> = { ok: true; value: T } | { ok: false; status: 404 | 409 | 500; error: string };

const logger = new Logger({ module: 'sources' });

// DO 按源的 url 命名：改 url 等于换了一个 DO
function scraperOf(env: Env, url: string) {
  return env.SOURCE_SCRAPER.get(env.SOURCE_SCRAPER.idFromName(url));
}

function startScraper(env: Env, source: Pick<Source, 'id' | 'url' | 'scrape_frequency'>) {
  return scraperOf(env, source.url).initialize({
    id: source.id,
    url: source.url,
    scrape_frequency: source.scrape_frequency,
  });
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

/** postgres 错误码（23505 唯一约束、23503 外键）；drizzle 有时把原始错误包在 cause 里 */
function pgCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}

const fail = (status: 404 | 409 | 500, error: string) => ({ ok: false, status, error }) as const;
const URL_TAKEN = '该URL已存在';
const NOT_FOUND = 'Source not found';

async function findSource(env: Env, id: number) {
  return getDb(env.HYPERDRIVE).query.$sources.findFirst({ where: eq($sources.id, id) });
}

export async function createSource(env: Env, input: SourceInput): Promise<SourceResult<Source>> {
  const log = logger.child({ operation: 'create-source', url: input.url });
  const db = getDb(env.HYPERDRIVE);

  let source: Source;
  try {
    if (await db.query.$sources.findFirst({ where: eq($sources.url, input.url) })) return fail(409, URL_TAKEN);
    [source] = await db
      .insert($sources)
      .values({
        url: input.url,
        name: input.name ?? 'Unknown',
        category: input.category ?? 'news',
        scrape_frequency: input.scrape_frequency ?? 2,
      })
      .returning();
  } catch (error) {
    if (pgCode(error) === '23505') return fail(409, URL_TAKEN);
    log.error('Failed to insert source', undefined, toError(error));
    return fail(500, 'Failed to create source');
  }

  try {
    await startScraper(env, source);
  } catch (error) {
    log.error('Failed to initialize source DO, rolling back', { source_id: source.id }, toError(error));
    await scraperOf(env, source.url).destroy().catch(() => {});
    await db.delete($sources).where(eq($sources.id, source.id)).catch(e => {
      log.error('Rollback failed: source row left without DO', { source_id: source.id }, toError(e));
    });
    return fail(500, 'Failed to initialize source DO');
  }

  log.info('Created source and started its DO', { source_id: source.id });
  return { ok: true, value: (await findSource(env, source.id)) ?? source };
}

export async function updateSource(env: Env, id: number, patch: Partial<SourceInput>): Promise<SourceResult<Source>> {
  const log = logger.child({ operation: 'update-source', source_id: id });
  const db = getDb(env.HYPERDRIVE);

  const fields = {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.url !== undefined && { url: patch.url }),
    ...(patch.category !== undefined && { category: patch.category }),
    ...(patch.scrape_frequency !== undefined && { scrape_frequency: patch.scrape_frequency }),
  };

  let before: Source | undefined;
  let after: Source;
  try {
    before = await findSource(env, id);
    if (!before) return fail(404, NOT_FOUND);
    if (Object.keys(fields).length === 0) return { ok: true, value: before };
    if (fields.url !== undefined && fields.url !== before.url) {
      const taken = await db.query.$sources.findFirst({ where: eq($sources.url, fields.url) });
      if (taken) return fail(409, URL_TAKEN);
    }
    [after] = await db.update($sources).set(fields).where(eq($sources.id, id)).returning();
  } catch (error) {
    if (pgCode(error) === '23505') return fail(409, URL_TAKEN);
    log.error('Failed to update source', undefined, toError(error));
    return fail(500, 'Failed to update source');
  }

  const urlChanged = after.url !== before.url;
  const tierChanged = after.scrape_frequency !== before.scrape_frequency;
  if (after.paused_at || (!urlChanged && !tierChanged)) return { ok: true, value: after };

  try {
    if (urlChanged) await scraperOf(env, before.url).destroy();
    await startScraper(env, after);
  } catch (error) {
    log.error('Failed to sync source DO, rolling back', undefined, toError(error));
    const old = before;
    try {
      await db
        .update($sources)
        .set({ name: old.name, url: old.url, category: old.category, scrape_frequency: old.scrape_frequency })
        .where(eq($sources.id, id));
      if (urlChanged) await scraperOf(env, after.url).destroy();
      await startScraper(env, old);
    } catch (e) {
      log.error('Rollback failed', undefined, toError(e));
    }
    return fail(500, 'Failed to sync source DO');
  }

  log.info('Updated source and synced its DO', { url_changed: urlChanged, tier_changed: tierChanged });
  return { ok: true, value: (await findSource(env, id)) ?? after };
}

export async function deleteSource(env: Env, id: number): Promise<SourceResult<void>> {
  const log = logger.child({ operation: 'delete-source', source_id: id });
  const db = getDb(env.HYPERDRIVE);

  let source: Source | undefined;
  let bodyKeys: string[] = [];
  try {
    source = await findSource(env, id);
    if (!source) return fail(404, NOT_FOUND);
    bodyKeys = await db.transaction(async tx => {
      const deleted = await tx
        .delete($articles)
        .where(eq($articles.sourceId, id))
        .returning({ key: $articles.contentFileKey });
      await tx.delete($sources).where(eq($sources.id, id));
      return deleted.map(r => r.key).filter((k): k is string => !!k);
    });
  } catch (error) {
    // 有文章被简报（brief_stories.lead_article_id）引用：删了就断了历史简报，事务已回滚
    if (pgCode(error) === '23503') {
      return fail(409, 'Source has articles referenced by past briefs and cannot be deleted; pause it instead');
    }
    log.error('Failed to delete source', undefined, toError(error));
    return fail(500, 'Failed to delete source');
  }

  try {
    await scraperOf(env, source.url).destroy();
  } catch (error) {
    // 行已删：DO 下一次 alarm 查不到源会自停，这里如实报错
    log.error('Source deleted but failed to stop its DO', { url: source.url }, toError(error));
    return fail(500, 'Source deleted but failed to stop its DO; it will stop on its next alarm');
  }

  // 文章行已删，它们在 R2 里的正文再没有人会读。best-effort：删不掉只是留下孤儿对象，
  // 不影响源已删这个结果，记日志不报错。R2 批量 delete 一次最多 1000 个 key。
  for (let i = 0; i < bodyKeys.length; i += 1000) {
    try {
      await env.ARTICLES_BUCKET.delete(bodyKeys.slice(i, i + 1000));
    } catch (error) {
      log.error('Failed to delete article bodies from R2', { keys: bodyKeys.length }, toError(error));
    }
  }

  log.info('Deleted source, its articles, their R2 bodies and its DO', { url: source.url, bodies: bodyKeys.length });
  return { ok: true, value: undefined };
}

export async function pauseSource(env: Env, id: number): Promise<SourceResult<void>> {
  const log = logger.child({ operation: 'pause-source', source_id: id });
  const db = getDb(env.HYPERDRIVE);

  let source: Source | undefined;
  try {
    source = await findSource(env, id);
  } catch (error) {
    log.error('Failed to fetch source', undefined, toError(error));
    return fail(500, 'Failed to fetch source');
  }
  if (!source) return fail(404, NOT_FOUND);

  // 先落标记再停 DO：停 DO 失败时，DO 下一次 alarm 看到标记也会自己停
  try {
    await db
      .update($sources)
      .set({ paused_at: source.paused_at ?? new Date(), do_initialized_at: null })
      .where(eq($sources.id, source.id));
  } catch (error) {
    log.error('Failed to mark source as paused', undefined, toError(error));
    return fail(500, 'Failed to mark source as paused');
  }

  try {
    await scraperOf(env, source.url).destroy();
  } catch (error) {
    log.error('Failed to stop source DO', undefined, toError(error));
    return fail(500, 'Failed to stop source DO');
  }

  log.info('Paused source', { url: source.url });
  return { ok: true, value: undefined };
}

export async function resumeSource(env: Env, id: number): Promise<SourceResult<void>> {
  const log = logger.child({ operation: 'resume-source', source_id: id });
  const db = getDb(env.HYPERDRIVE);

  let source: Source | undefined;
  try {
    source = await findSource(env, id);
  } catch (error) {
    log.error('Failed to fetch source', undefined, toError(error));
    return fail(500, 'Failed to fetch source');
  }
  if (!source) return fail(404, NOT_FOUND);

  // 先清标记再 init：反过来的话，DO 的第一次 alarm 可能还看到标记而自停
  try {
    await db.update($sources).set({ paused_at: null }).where(eq($sources.id, source.id));
  } catch (error) {
    log.error('Failed to clear paused mark', undefined, toError(error));
    return fail(500, 'Failed to clear paused mark');
  }

  try {
    await startScraper(env, source);
  } catch (error) {
    log.error('Failed to initialize source DO', { url: source.url }, toError(error));
    return fail(500, 'Failed to initialize source DO');
  }

  log.info('Resumed source', { url: source.url });
  return { ok: true, value: undefined };
}

export async function initSource(env: Env, id: number): Promise<SourceResult<void>> {
  const log = logger.child({ operation: 'init-source', source_id: id });

  let source: Source | undefined;
  try {
    source = await findSource(env, id);
  } catch (error) {
    log.error('Failed to fetch source', undefined, toError(error));
    return fail(500, 'Failed to fetch source');
  }
  if (!source) return fail(404, NOT_FOUND);
  if (source.paused_at) return fail(409, 'Source is paused; resume it instead');

  try {
    await startScraper(env, source);
  } catch (error) {
    log.error('Failed to initialize source DO', { url: source.url }, toError(error));
    return fail(500, 'Failed to initialize source DO');
  }

  log.info('Successfully initialized source DO', { url: source.url });
  return { ok: true, value: undefined };
}

/** 为尚未初始化且未暂停的源补启动 DO。读库失败时抛错。 */
export async function initAllSources(env: Env, batchSize: number): Promise<{ initialized: number; total: number }> {
  const log = logger.child({ operation: 'initialize-dos' });
  log.info('Initializing SourceScraperDOs from database', { batchSize });

  const pending = await getDb(env.HYPERDRIVE)
    .select({ id: $sources.id, url: $sources.url, scrape_frequency: $sources.scrape_frequency })
    .from($sources)
    // 已暂停的源 do_initialized_at 也是空的，不跳过就会被这里重新拉起
    .where(and(isNull($sources.do_initialized_at), isNull($sources.paused_at)));

  log.info('Sources fetched from database', { source_count: pending.length });

  let initialized = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async source => {
        try {
          await startScraper(env, source);
          return true;
        } catch (error) {
          log.error('Failed to initialize DO', { source_id: source.id, url: source.url }, toError(error));
          return false;
        }
      })
    );
    initialized += results.filter(Boolean).length;
    log.info('Batch completed', { batchIndex: i / batchSize + 1, totalSuccessful: initialized });
  }

  log.info('Initialization process complete', { total: pending.length, successful: initialized });
  return { initialized, total: pending.length };
}
