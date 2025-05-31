import { Hono } from 'hono';
import { getDb } from '../lib/utils';
import { $articles, $sources, $reports, eq, isNotNull, and, sql, desc } from '@meridian/database';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

// 数据源管理端点
app.get('/sources', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    const result = await db
      .select({
        id: $sources.id,
        name: $sources.name,
        url: $sources.url,
        category: $sources.category,
        scrape_frequency: $sources.scrape_frequency,
        paywall: $sources.paywall,
        lastChecked: $sources.lastChecked,
      })
      .from($sources)
      .orderBy($sources.id);

    return c.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('获取数据源失败:', error);
    return c.json({
      success: false,
      error: '获取数据源失败'
    }, 500);
  }
});

app.post('/sources', async (c) => {
  try {
    const { name, url, category, scrape_frequency = 2, paywall = false } = await c.req.json();
    const db = getDb(c.env.HYPERDRIVE);

    if (!name || !url) {
      return c.json({
        success: false,
        error: '缺少必要字段'
      }, 400);
    }

    const result = await db
      .insert($sources)
      .values({
        name,
        url,
        category: category || 'general',
        scrape_frequency,
        paywall
      })
      .returning({ id: $sources.id });

    return c.json({
      success: true,
      data: { id: result[0].id }
    });
  } catch (error) {
    console.error('创建数据源失败:', error);
    return c.json({
      success: false,
      error: '创建数据源失败'
    }, 500);
  }
});

app.put('/sources/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { name, url, category, scrape_frequency, paywall } = await c.req.json();
    const db = getDb(c.env.HYPERDRIVE);

    const result = await db
      .update($sources)
      .set({
        name,
        url,
        category,
        scrape_frequency,
        paywall
      })
      .where(eq($sources.id, id))
      .returning({ id: $sources.id });

    if (result.length === 0) {
      return c.json({
        success: false,
        error: '数据源不存在'
      }, 404);
    }

    return c.json({
      success: true,
      data: { updated: result.length }
    });
  } catch (error) {
    console.error('更新数据源失败:', error);
    return c.json({
      success: false,
      error: '更新数据源失败'
    }, 500);
  }
});

app.delete('/sources/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const db = getDb(c.env.HYPERDRIVE);

    const result = await db
      .delete($sources)
      .where(eq($sources.id, id))
      .returning({ id: $sources.id });

    if (result.length === 0) {
      return c.json({
        success: false,
        error: '数据源不存在'
      }, 404);
    }

    return c.json({
      success: true,
      data: { deleted: result.length }
    });
  } catch (error) {
    console.error('删除数据源失败:', error);
    return c.json({
      success: false,
      error: '删除数据源失败'
    }, 500);
  }
});

// 文章管理端点
app.get('/articles', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    const url = new URL(c.req.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const status = url.searchParams.get('status');

    let whereConditions = [];
    if (status) {
      whereConditions.push(eq($articles.status, status as any));
    }

    const result = await db
      .select({
        id: $articles.id,
        title: $articles.title,
        url: $articles.url,
        status: $articles.status,
        publishDate: $articles.publishDate,
        sourceId: $articles.sourceId,
        language: $articles.language,
        hasEmbedding: sql`CASE WHEN embedding IS NOT NULL THEN true ELSE false END`.as('hasEmbedding'),
        hasContentFile: sql`CASE WHEN content_file_key IS NOT NULL THEN true ELSE false END`.as('hasContentFile'),
      })
      .from($articles)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(desc($articles.id))
      .limit(limit)
      .offset(offset);

    return c.json({
      success: true,
      data: result,
      pagination: {
        limit,
        offset,
        count: result.length
      }
    });
  } catch (error) {
    console.error('获取文章失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// 简报生成端点
app.post('/briefs/generate', async (c) => {
  try {
    const body = await c.req.json();
    const { 
      dateFrom, 
      dateTo, 
      minImportance = 5,
      triggeredBy = 'manual'
    } = body;

    console.log('[Admin] 触发简报生成工作流');

    // 创建工作流实例并启动
    const workflow = c.env.MY_WORKFLOW;
    const instance = await workflow.create({
      params: {
        triggeredBy,
        dateFrom,
        dateTo,
        minImportance
      }
    });

    return c.json({
      success: true,
      workflow_id: instance.id,
      message: '简报生成工作流已启动',
      params: {
        triggeredBy,
        dateFrom,
        dateTo,
        minImportance
      }
    });
  } catch (error) {
    console.error('启动简报生成失败:', error);
    return c.json({
      success: false,
      error: '启动简报生成失败',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// 获取简报生成状态
app.get('/briefs/status/:workflowId', async (c) => {
  try {
    const workflowId = c.req.param('workflowId');
    const workflow = c.env.MY_WORKFLOW;
    
    // 获取工作流实例
    const instance = await workflow.get(workflowId);
    
    if (!instance) {
      return c.json({
        success: false,
        error: '工作流实例不存在'
      }, 404);
    }

    // 获取工作流状态
    const status = await instance.status();

    return c.json({
      success: true,
      workflow_id: workflowId,
      status
    });
  } catch (error) {
    console.error('获取简报状态失败:', error);
    return c.json({
      success: false,
      error: '获取简报状态失败',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// 获取已生成的简报列表
app.get('/briefs', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    const url = new URL(c.req.url);
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const briefs = await db
      .select({
        id: $reports.id,
        title: $reports.title,
        createdAt: $reports.createdAt,
        totalArticles: $reports.totalArticles,
        totalSources: $reports.totalSources,
        usedArticles: $reports.usedArticles,
        usedSources: $reports.usedSources,
        tldr: $reports.tldr
      })
      .from($reports)
      .orderBy(desc($reports.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({
      success: true,
      data: briefs,
      pagination: {
        limit,
        offset,
        total: briefs.length
      }
    });
  } catch (error) {
    console.error('获取简报列表失败:', error);
    return c.json({
      success: false,
      error: '获取简报列表失败'
    }, 500);
  }
});

// 获取单个简报详情
app.get('/briefs/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const db = getDb(c.env.HYPERDRIVE);
    
    const brief = await db
      .select()
      .from($reports)
      .where(eq($reports.id, id))
      .limit(1);

    if (brief.length === 0) {
      return c.json({
        success: false,
        error: '简报不存在'
      }, 404);
    }

      return c.json({
        success: true,
      data: brief[0]
    });
  } catch (error) {
    console.error('获取简报详情失败:', error);
    return c.json({
      success: false,
      error: '获取简报详情失败'
    }, 500);
  }
});

// 系统状态检查
app.get('/system/status', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    
    // 检查各种状态的文章数量
    const statusCounts = await db
      .select({
        status: $articles.status,
        count: sql`count(*)`.as('count')
      })
      .from($articles)
      .groupBy($articles.status);
    
    // 检查有嵌入向量的文章数量
    const embeddingCount = await db
      .select({
        count: sql`count(*)`.as('count')
      })
      .from($articles)
      .where(isNotNull($articles.embedding));
    
    // 检查PROCESSED状态且有嵌入向量的文章
    const processedWithEmbedding = await db
      .select({
        count: sql`count(*)`.as('count')
      })
      .from($articles)
      .where(
        and(
          eq($articles.status, 'PROCESSED'),
          isNotNull($articles.embedding),
          isNotNull($articles.contentFileKey)
        )
      );

    const readyCount = Number(processedWithEmbedding[0]?.count || 0);

    return c.json({
      success: true,
      data: {
        articles: {
          statusCounts: statusCounts,
          withEmbedding: embeddingCount[0]?.count || 0,
          readyForBriefing: readyCount
        },
        system: {
          recommendation: readyCount >= 2 ? 
            "系统就绪，可生成简报" : 
            `需要至少2篇PROCESSED文章，当前只有${readyCount}篇`
        }
      }
    });
      } catch (error) {
    console.error('检查系统状态失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export default app; 