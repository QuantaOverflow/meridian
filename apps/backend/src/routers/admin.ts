import { Hono } from 'hono';
import { getDb } from '../lib/utils';
import { $sources, $articles, $reports, eq, and, desc, isNotNull, gte, sql } from '@meridian/database';
import { AutoBriefGenerationWorkflow } from '../workflows/auto-brief-generation';
import { createAIServices, handleServiceResponse } from '../lib/ai-services';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

// ========== RSS源管理 ==========
app.get('/sources', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    const sources = await db.select().from($sources).orderBy($sources.id);
    
    return c.json({
      success: true,
      data: sources,
      count: sources.length
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

app.post('/sources', async (c) => {
  try {
    const { name, url, category, scrape_frequency } = await c.req.json();
    
    if (!name || !url) {
      return c.json({
        success: false,
        error: '缺少必需的字段: name, url'
      }, 400);
    }

    const db = getDb(c.env.HYPERDRIVE);
    
    // 检查URL是否已存在
    const existing = await db.select().from($sources).where(eq($sources.url, url));
    if (existing.length > 0) {
      return c.json({
        success: false,
        error: '该URL已存在'
      }, 409);
    }

    const newSource = await db.insert($sources).values({
      name,
      url,
      category: category || null,
      scrape_frequency: scrape_frequency || 60,
    }).returning();

    return c.json({
      success: true,
      message: 'RSS源添加成功',
      data: newSource[0]
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

app.put('/sources/:id', async (c) => {
  try {
    const sourceId = parseInt(c.req.param('id'));
    const { name, url, category, scrape_frequency } = await c.req.json();
    
    const db = getDb(c.env.HYPERDRIVE);
    
    const updated = await db.update($sources)
      .set({
        name: name || undefined,
        url: url || undefined, 
        category: category !== undefined ? category : undefined,
        scrape_frequency: scrape_frequency || undefined,
      })
      .where(eq($sources.id, sourceId))
      .returning();

    if (updated.length === 0) {
      return c.json({
        success: false,
        error: '未找到指定的RSS源'
      }, 404);
    }

    return c.json({
      success: true,
      message: 'RSS源更新成功',
      data: updated[0]
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

app.delete('/sources/:id', async (c) => {
  try {
    const sourceId = parseInt(c.req.param('id'));
    const db = getDb(c.env.HYPERDRIVE);
    
    const deleted = await db.delete($sources)
      .where(eq($sources.id, sourceId))
      .returning();

    if (deleted.length === 0) {
      return c.json({
        success: false,
        error: '未找到指定的RSS源'
      }, 404);
    }

    return c.json({
      success: true,
      message: 'RSS源删除成功',
      data: deleted[0]
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// ========== 文章管理 ==========
app.get('/articles', async (c) => {
  try {
    const url = new URL(c.req.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
    const status = url.searchParams.get('status');
    const offset = (page - 1) * limit;

    const db = getDb(c.env.HYPERDRIVE);
    
    const conditions = [];
    if (status) {
      // Cast status to any to avoid enum type issues
      conditions.push(eq($articles.status, status as any));
    }

    const articles = await db.select({
      id: $articles.id,
      title: $articles.title,
      url: $articles.url,
      status: $articles.status,
      publishDate: $articles.publishDate,
      processedAt: $articles.processedAt,
      sourceId: $articles.sourceId,
      contentFileKey: $articles.contentFileKey,
      embedding: $articles.embedding,
    })
    .from($articles)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc($articles.createdAt))
    .limit(limit)
    .offset(offset);

    return c.json({
      success: true,
      data: articles,
      pagination: {
        page,
        limit,
        total_returned: articles.length
      }
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// ========== 简报管理 ==========
app.post('/briefs/generate', async (c) => {
  try {
    const body = await c.req.json();
    const { 
      dateFrom, 
      dateTo, 
      minImportance = 5,
      triggeredBy = 'admin'
    } = body;

    // 转换字符串日期为Date对象
    const parsedDateFrom = dateFrom ? new Date(dateFrom) : undefined;
    const parsedDateTo = dateTo ? new Date(dateTo) : undefined;
    
    console.log('[AdminBrief] 生成简报请求:', {
      dateFrom: parsedDateFrom?.toISOString(), 
      dateTo: parsedDateTo?.toISOString(), 
      minImportance, 
      triggeredBy
    });

    const workflow = c.env.MY_WORKFLOW;
    const instance = await workflow.create({
      params: {
        triggeredBy,
        dateFrom: parsedDateFrom,
        dateTo: parsedDateTo,
        minImportance
      }
    });

    return c.json({
      success: true,
      workflow_id: instance.id,
      message: '简报生成工作流已启动',
      params: { 
        triggeredBy, 
        dateFrom: parsedDateFrom?.toISOString(), 
        dateTo: parsedDateTo?.toISOString(), 
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

// 添加 /admin/reports 端点来获取报告列表
app.get('/reports', async (c) => {
  try {
    const url = new URL(c.req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);
    const sortBy = url.searchParams.get('sortBy') || 'createdAt';
    const sortOrder = url.searchParams.get('sortOrder') || 'desc';

    const db = getDb(c.env.HYPERDRIVE);
    
    const reports = await db.select({
      id: $reports.id,
      title: $reports.title,
      content: $reports.content,
      tldr: $reports.tldr,
      createdAt: $reports.createdAt,
      totalArticles: $reports.totalArticles,
      usedArticles: $reports.usedArticles,
      totalSources: $reports.totalSources,
      usedSources: $reports.usedSources,
      model_author: $reports.model_author,
      clustering_params: $reports.clustering_params,
    })
    .from($reports)
    .orderBy(sortOrder === 'asc' ? $reports.createdAt : desc($reports.createdAt))
    .limit(limit);

    return c.json({
      success: true,
      data: reports,
      count: reports.length
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

app.get('/briefs/status/:workflowId', async (c) => {
  try {
    const workflowId = c.req.param('workflowId');
    
    // 这里需要查询工作流状态的API
    // 暂时返回基本信息
    return c.json({
      success: true,
      workflow_id: workflowId,
      status: 'running', // 需要实际实现状态查询
      message: '工作流状态查询功能待实现'
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

app.get('/briefs', async (c) => {
  try {
    const url = new URL(c.req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);

    const db = getDb(c.env.HYPERDRIVE);
    
    const reports = await db.select({
      id: $reports.id,
      title: $reports.title,
      tldr: $reports.tldr,
      created_at: $reports.createdAt,
      total_articles: $reports.totalArticles,
      total_sources: $reports.totalSources,
    })
    .from($reports)
    .orderBy(desc($reports.createdAt))
    .limit(limit);

    return c.json({
      success: true,
      data: reports,
      count: reports.length
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

app.get('/briefs/:id', async (c) => {
  try {
    const reportId = parseInt(c.req.param('id'));
    const db = getDb(c.env.HYPERDRIVE);
    
    const report = await db.select().from($reports).where(eq($reports.id, reportId));
    
    if (report.length === 0) {
      return c.json({
        success: false,
        error: '未找到指定的简报'
      }, 404);
    }

    return c.json({
      success: true,
      data: report[0]
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

/**
 * 查看简报详细内容和质量分析
 */
app.get('/briefs/:id/analysis', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getDb(c.env.HYPERDRIVE);

    // 获取简报基本信息
    const brief = await db.select()
      .from($reports)
      .where(eq($reports.id, parseInt(id)))
      .limit(1);

    if (brief.length === 0) {
      return c.json({ error: '简报不存在' }, 404);
    }

    const briefData = brief[0];
    const content = JSON.parse(briefData.content || '{}');

    // 分析简报质量
    const analysis = {
      brief_id: parseInt(id),
      title: briefData.title,
      created_at: briefData.createdAt,
      tldr: briefData.tldr,
      statistics: {
        total_articles: briefData.totalArticles,
        used_articles: briefData.usedArticles,
        total_sources: briefData.totalSources,
        used_sources: briefData.usedSources
      },
      content_analysis: {
        stories_count: content.stories?.length || 0,
        clustering_params: content.clustering_params || {},
        stats: content.stats || {}
      },
      stories: content.stories || [],
      quality_metrics: {
        has_intelligence_analysis: false,
        avg_articles_per_story: 0,
        content_length_analysis: {},
        r2_content_verification: {}
      }
    };

    // 质量分析
    if (content.stories && content.stories.length > 0) {
      analysis.quality_metrics.avg_articles_per_story = 
        content.stories.reduce((sum: number, story: any) => sum + (story.articles?.length || 0), 0) / content.stories.length;
      
      analysis.quality_metrics.has_intelligence_analysis = 
        content.stories.some((story: any) => story.intelligence_analysis);

      // 验证是否使用了R2中的完整内容
      const firstStory = content.stories[0];
      if (firstStory && firstStory.articles && firstStory.articles.length > 0) {
        const sampleArticle = firstStory.articles[0];
        
        // 从数据库获取文章的contentFileKey
        const dbArticle = await db.select({
          id: $articles.id,
          title: $articles.title,
          contentFileKey: $articles.contentFileKey
        })
        .from($articles)
        .where(eq($articles.id, sampleArticle.id))
        .limit(1);

        if (dbArticle.length > 0 && dbArticle[0].contentFileKey) {
          try {
            const obj = await c.env.ARTICLES_BUCKET.get(dbArticle[0].contentFileKey);
            if (obj) {
              const r2Content = await obj.text();
              analysis.quality_metrics.r2_content_verification = {
                article_id: sampleArticle.id,
                r2_content_length: r2Content.length,
                r2_content_available: true,
                sample_r2_content: r2Content.substring(0, 200) + '...'
              };
            }
          } catch (error) {
            analysis.quality_metrics.r2_content_verification = {
              article_id: sampleArticle.id,
              error: error instanceof Error ? error.message : String(error)
            };
          }
        }
      }
    }

    return c.json({
      success: true,
      analysis
    });

  } catch (error) {
    console.error('[Brief Analysis] 错误:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }, 500);
  }
});

// ========== 系统状态 ==========
app.get('/system/status', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    const aiServices = createAIServices(c.env);
    
    // 获取系统统计
    const [articleStats] = await db.select({
      total: sql<number>`count(*)`,
      processed: sql<number>`count(case when status = 'PROCESSED' then 1 end)`,
      with_embedding: sql<number>`count(case when embedding is not null then 1 end)`,
      failed: sql<number>`count(case when ${$articles.status}::text like '%FAILED%' then 1 end)`
    }).from($articles);

    const [sourceStats] = await db.select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(case when paywall = false then 1 end)`
    }).from($sources);

    const [reportStats] = await db.select({
      total: sql<number>`count(*)`
    }).from($reports);

    // 检查AI服务状态
    const aiWorkerResponse = await aiServices.aiWorker.healthCheck();
    const mlServiceResponse = await aiServices.mlService.healthCheck();
    
    const aiWorkerHealth = await handleServiceResponse(aiWorkerResponse, 'AI Worker health');
    const mlServiceHealth = await handleServiceResponse(mlServiceResponse, 'ML Service health');

    return c.json({
      success: true,
      system_status: {
        articles: {
          total: Number(articleStats.total),
          processed: Number(articleStats.processed),
          with_embedding: Number(articleStats.with_embedding),
          failed: Number(articleStats.failed),
          processing_rate: Number(articleStats.total) > 0 ? 
            (Number(articleStats.processed) / Number(articleStats.total) * 100).toFixed(1) + '%' : '0%'
        },
        sources: {
          total: Number(sourceStats.total),
          active: Number(sourceStats.active)
        },
        reports: {
          total: Number(reportStats.total)
        },
        ai_services: {
          ai_worker: aiWorkerHealth.success ? 'healthy' : 'error',
          ml_service: mlServiceHealth.success ? 'healthy' : 'error'
        }
      },
      health_checks: {
        ai_worker: aiWorkerHealth.success ? aiWorkerHealth.data : { error: aiWorkerHealth.error },
        ml_service: mlServiceHealth.success ? mlServiceHealth.data : { error: mlServiceHealth.error }
      }
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// ========== 测试端点（简化后的单个测试端点）==========
app.get('/test/system-integration', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    const aiServices = createAIServices(c.env);
    const results: any = {};

    // 1. 数据库连接测试
    const [dbTest] = await db.select({ count: sql<number>`count(*)` }).from($articles);
    results.database = {
      status: 'connected',
      total_articles: Number(dbTest.count)
    };

    // 2. AI Worker测试
    const aiWorkerResponse = await aiServices.aiWorker.healthCheck();
    const aiWorkerResult = await handleServiceResponse(aiWorkerResponse, 'AI Worker test');
    results.ai_worker = {
      status: aiWorkerResult.success ? 'healthy' : 'error',
      result: aiWorkerResult.success ? aiWorkerResult.data : aiWorkerResult.error
    };

    // 3. ML Service测试
    const mlServiceResponse = await aiServices.mlService.healthCheck();
    const mlServiceResult = await handleServiceResponse(mlServiceResponse, 'ML Service test');
    results.ml_service = {
      status: mlServiceResult.success ? 'healthy' : 'error',
      result: mlServiceResult.success ? mlServiceResult.data : mlServiceResult.error
    };

    // 4. 简单的嵌入生成测试
    const embeddingResponse = await aiServices.aiWorker.generateEmbedding('测试文本');
    const embeddingResult = await handleServiceResponse<{success: boolean; data: Array<{embedding: number[]}>}>(embeddingResponse, 'Embedding test');
    results.embedding_generation = {
      status: embeddingResult.success && embeddingResult.data?.success ? 'success' : 'error',
      dimensions: embeddingResult.success && embeddingResult.data?.data?.[0]?.embedding ? embeddingResult.data.data[0].embedding.length : null,
      error: embeddingResult.success ? null : embeddingResult.error
    };

    return c.json({
      success: true,
      message: '系统集成测试完成',
      results,
      overall_status: Object.values(results).every((r: any) => 
        ['connected', 'healthy', 'success'].includes(r.status)
      ) ? 'all_systems_operational' : 'some_issues_detected'
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// ========== 端到端工作流测试 ==========
app.post('/test/end-to-end-workflow', async (c) => {
  try {
    const body = await c.req.json();
    const { 
      sourceId = 1, // 默认使用Hacker News
      forceNewScrape = false,
      testBriefGeneration = true,
      maxWaitSeconds = 120,
      minImportance = 2 // 用于简报生成的重要性阈值
    } = body;

    const db = getDb(c.env.HYPERDRIVE);
    const results: any = {
      test_id: crypto.randomUUID(),
      started_at: new Date().toISOString(),
      steps: {}
    };

    console.log(`[E2E Test] 开始端到端工作流测试, 测试ID: ${results.test_id}`);

    // 步骤1: 验证源存在
    results.steps.source_validation = { started_at: new Date().toISOString() };
    
    const source = await db.select().from($sources).where(eq($sources.id, sourceId));
    if (source.length === 0) {
      results.steps.source_validation.status = 'failed';
      results.steps.source_validation.error = `源ID ${sourceId} 不存在`;
      return c.json({ success: false, results }, 404);
    }

    results.steps.source_validation.status = 'success';
    results.steps.source_validation.source = source[0];
    results.steps.source_validation.completed_at = new Date().toISOString();

    // 步骤2: 手动触发RSS抓取（如果需要）
    if (forceNewScrape) {
      results.steps.rss_scrape = { started_at: new Date().toISOString() };
      
      try {
        // 通过DO触发RSS抓取
        const doId = c.env.SOURCE_SCRAPER.idFromName(source[0].url);
        const stub = c.env.SOURCE_SCRAPER.get(doId);
        
        // 调用force-scrape
        const scrapeRequest = new Request('http://do/force-scrape', { method: 'POST' });
        const scrapeResponse = await stub.fetch(scrapeRequest);
        const scrapeResult = await scrapeResponse.json() as { success: boolean; message?: string; error?: string };
        
        results.steps.rss_scrape.status = scrapeResult.success ? 'success' : 'failed';
        results.steps.rss_scrape.result = scrapeResult;
        results.steps.rss_scrape.completed_at = new Date().toISOString();
        
        if (!scrapeResult.success) {
          return c.json({ success: false, results, error: 'RSS抓取失败' }, 500);
        }

        // 等待一点时间让文章进入队列
        await new Promise(resolve => setTimeout(resolve, 5000));

      } catch (error) {
        results.steps.rss_scrape.status = 'failed';
        results.steps.rss_scrape.error = error instanceof Error ? error.message : String(error);
        results.steps.rss_scrape.completed_at = new Date().toISOString();
        return c.json({ success: false, results, error: 'RSS抓取出错' }, 500);
      }
    }

    // 步骤3: 检查可用的已处理文章
    results.steps.article_check = { started_at: new Date().toISOString() };
    
    const processedArticles = await db.select({
      id: $articles.id,
      title: $articles.title,
      status: $articles.status,
      hasEmbedding: sql`CASE WHEN embedding IS NOT NULL THEN true ELSE false END`.as('hasEmbedding'),
      processedAt: $articles.processedAt
    })
    .from($articles)
    .where(
      and(
        eq($articles.sourceId, sourceId),
        eq($articles.status, 'PROCESSED'),
        isNotNull($articles.embedding),
        isNotNull($articles.contentFileKey)
      )
    )
    .orderBy(desc($articles.processedAt))
    .limit(10);

    results.steps.article_check.status = 'success';
    results.steps.article_check.processed_articles_count = processedArticles.length;
    results.steps.article_check.sample_articles = processedArticles.slice(0, 3);
    results.steps.article_check.completed_at = new Date().toISOString();

    // 步骤4: 验证AI服务
    results.steps.ai_services = { started_at: new Date().toISOString() };
    
    const aiServices = createAIServices(c.env);
    
    // 测试AI Worker
    const aiWorkerResponse = await aiServices.aiWorker.healthCheck();
    const aiWorkerResult = await handleServiceResponse(aiWorkerResponse, 'AI Worker check');
    
    // 测试ML Service
    const mlServiceResponse = await aiServices.mlService.healthCheck();
    const mlServiceResult = await handleServiceResponse(mlServiceResponse, 'ML Service check');
    
    // 测试嵌入生成
    const embeddingResponse = await aiServices.aiWorker.generateEmbedding('端到端测试文本');
    const embeddingResult = await handleServiceResponse<{success: boolean; data: Array<{embedding: number[]}>}>(embeddingResponse, 'Embedding test');
    
    results.steps.ai_services.ai_worker = {
      status: aiWorkerResult.success ? 'healthy' : 'error',
      result: aiWorkerResult.success ? aiWorkerResult.data : aiWorkerResult.error
    };
    
    results.steps.ai_services.ml_service = {
      status: mlServiceResult.success ? 'healthy' : 'error', 
      result: mlServiceResult.success ? mlServiceResult.data : mlServiceResult.error
    };
    
    results.steps.ai_services.embedding_test = {
      status: embeddingResult.success && embeddingResult.data?.success ? 'success' : 'error',
      dimensions: embeddingResult.success && embeddingResult.data?.data?.[0]?.embedding ? embeddingResult.data.data[0].embedding.length : null
    };
    
    results.steps.ai_services.status = 'success';
    results.steps.ai_services.completed_at = new Date().toISOString();

    // 步骤5: 触发简报生成（如果请求）
    if (testBriefGeneration && processedArticles.length >= 2) {
      results.steps.brief_generation = { started_at: new Date().toISOString() };
      
      try {
        const workflow = c.env.MY_WORKFLOW;
        const instance = await workflow.create({
          params: {
            triggeredBy: 'e2e_test',
            timeRangeDays: 7,
            articleLimit: Math.min(processedArticles.length, 20),
            maxStoriesToGenerate: 3,
            minImportance: minImportance // 使用传入的重要性阈值
          }
        });

        results.steps.brief_generation.status = 'triggered';
        results.steps.brief_generation.workflow_id = instance.id;
        results.steps.brief_generation.completed_at = new Date().toISOString();
        
        // 等待一小段时间，然后检查是否有简报生成
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        const recentReports = await db.select()
          .from($reports)
          .orderBy(desc($reports.createdAt))
          .limit(1);

        results.steps.brief_generation.recent_reports_check = {
          count: recentReports.length,
          latest: recentReports[0] || null
        };

      } catch (error) {
        results.steps.brief_generation.status = 'failed';
        results.steps.brief_generation.error = error instanceof Error ? error.message : String(error);
        results.steps.brief_generation.completed_at = new Date().toISOString();
      }
    } else if (processedArticles.length < 2) {
      results.steps.brief_generation = {
        status: 'skipped',
        reason: `需要至少2篇处理完成的文章，当前只有${processedArticles.length}篇`,
        completed_at: new Date().toISOString()
      };
    }

    // 最终结果评估
    results.completed_at = new Date().toISOString();
    results.duration_seconds = Math.round((new Date().getTime() - new Date(results.started_at).getTime()) / 1000);
    
    const stepStatuses = Object.values(results.steps).map((step: any) => step.status);
    const allSuccessful = stepStatuses.every(status => ['success', 'triggered', 'skipped'].includes(status));
    
    results.overall_status = allSuccessful ? 'success' : 'partial_failure';
    results.summary = {
      total_steps: Object.keys(results.steps).length,
      successful_steps: stepStatuses.filter(s => ['success', 'triggered'].includes(s)).length,
      failed_steps: stepStatuses.filter(s => s === 'failed').length,
      skipped_steps: stepStatuses.filter(s => s === 'skipped').length
    };

    console.log(`[E2E Test] 测试完成: ${results.overall_status}, 耗时: ${results.duration_seconds}秒`);

    return c.json({
      success: allSuccessful,
      message: allSuccessful ? '端到端工作流测试成功完成' : '端到端工作流测试部分失败',
      results
    });

  } catch (error) {
    console.error('[E2E Test] 测试失败:', error);
    return c.json({
      success: false,
      error: '端到端测试执行失败',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

/**
 * 测试文章内容的R2存储和智能分析使用情况
 */
app.post('/test-article-content-flow', async (c) => {
  try {
    const body = await c.req.json();
    const { 
      sourceId, 
      limitArticles = 5,
      testIntelligenceAnalysis = true 
    } = body;

    console.log(`[Article Content Test] 开始测试文章内容流程`);

    const db = getDb(c.env.HYPERDRIVE);
    const results: any = {
      test_id: crypto.randomUUID(),
      started_at: new Date().toISOString(),
      tests: {}
    };

    // 测试1: 检查已处理文章的R2存储情况
    results.tests.r2_storage_check = { started_at: new Date().toISOString() };
    
    let whereConditions = [
      eq($articles.status, 'PROCESSED'),
      isNotNull($articles.contentFileKey),
      isNotNull($articles.embedding)
    ];

    if (sourceId) {
      whereConditions.push(eq($articles.sourceId, sourceId));
    }

    const articles = await db.select({
      id: $articles.id,
      title: $articles.title,
      url: $articles.url,
      contentFileKey: $articles.contentFileKey,
      status: $articles.status,
      processedAt: $articles.processedAt,
      hasEmbedding: sql`CASE WHEN embedding IS NOT NULL THEN true ELSE false END`.as('hasEmbedding')
    })
    .from($articles)
    .where(and(...whereConditions))
    .orderBy(desc($articles.processedAt))
    .limit(limitArticles);
    
    if (articles.length === 0) {
      results.tests.r2_storage_check.status = 'failed';
      results.tests.r2_storage_check.error = '没有找到已处理的文章';
      results.completed_at = new Date().toISOString();
      return c.json({ success: false, results }, 404);
    }

    // 测试每篇文章的R2内容
    const contentTests = await Promise.allSettled(
      articles.map(async (article) => {
                 const articleTest: any = {
           article_id: article.id,
           title: article.title?.substring(0, 100) || '无标题',
           content_file_key: article.contentFileKey || ''
         };

        try {
                     // 从R2获取内容
           const obj = await c.env.ARTICLES_BUCKET.get(article.contentFileKey || '');
          if (obj) {
            const content = await obj.text();
            articleTest.r2_content_available = true;
            articleTest.content_length = content.length;
            articleTest.content_preview = content.substring(0, 200) + '...';
            articleTest.content_sample = content; // 保存完整内容用于后续测试
          } else {
            articleTest.r2_content_available = false;
            articleTest.error = 'R2对象不存在';
          }
        } catch (error) {
          articleTest.r2_content_available = false;
          articleTest.error = `R2读取失败: ${error instanceof Error ? error.message : String(error)}`;
        }

        return articleTest;
      })
    );

    const successfulContentTests = contentTests
      .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
      .map(result => result.value)
      .filter(test => test.r2_content_available);

    results.tests.r2_storage_check.status = 'success';
    results.tests.r2_storage_check.articles_tested = articles.length;
    results.tests.r2_storage_check.content_available_count = successfulContentTests.length;
    results.tests.r2_storage_check.articles_details = contentTests.map(result => 
      result.status === 'fulfilled' ? result.value : { error: result.reason }
    );
    results.tests.r2_storage_check.completed_at = new Date().toISOString();

    // 测试2: 验证智能分析是否使用了实际内容
    if (testIntelligenceAnalysis && successfulContentTests.length >= 2) {
      results.tests.intelligence_analysis = { started_at: new Date().toISOString() };
      
      try {
        // 选择前2篇有内容的文章进行测试
        const testArticles = successfulContentTests.slice(0, 2);
        
        // 构建测试用的聚类数据
        const testCluster = {
          id: 999,
          articles: testArticles.map((test, index) => ({
            id: test.article_id,
            title: test.title,
            url: articles.find(a => a.id === test.article_id)?.url || '',
            content: test.content_sample,
            publish_date: new Date().toISOString(),
            contentFileKey: test.content_file_key
          })),
          similarity_score: 0.8
        };

        const testStory = {
          storyId: 999,
          analysis: {
            summary: '测试故事：验证内容使用情况',
            key_themes: ['内容测试', '智能分析验证'],
            importance: 5,
            story_type: 'test'
          }
        };

        console.log(`[Intelligence Test] 测试数据准备完成，文章数: ${testCluster.articles.length}`);
        console.log(`[Intelligence Test] 第一篇文章内容长度: ${testCluster.articles[0].content.length}`);

        // 构建智能分析请求
        const intelligenceRequest = {
          title: testStory.analysis.summary,
          articles_ids: testCluster.articles.map(a => a.id),
          articles_data: testCluster.articles.map(a => ({
            id: a.id,
            title: a.title,
            url: a.url,
            content: a.content,
            publishDate: a.publish_date
          }))
        };

        // 调用智能分析服务
        const request = new Request(`https://meridian-ai-worker/meridian/intelligence/analyze-story`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(intelligenceRequest)
        });

        const response = await c.env.AI_WORKER.fetch(request);
        const analysisResult = await handleServiceResponse<any>(response, 'Intelligence analysis test');
        
        if (analysisResult.success && analysisResult.data) {
          results.tests.intelligence_analysis.status = 'success';
          results.tests.intelligence_analysis.analysis_received = true;
          results.tests.intelligence_analysis.analysis_preview = {
            overview: analysisResult.data.overview?.substring(0, 200) + '...',
            key_developments_count: analysisResult.data.key_developments?.length || 0,
            stakeholders_count: analysisResult.data.stakeholders?.length || 0,
            implications_count: analysisResult.data.implications?.length || 0
          };
          results.tests.intelligence_analysis.content_length_verification = {
            input_article_1_length: testCluster.articles[0].content.length,
            input_article_2_length: testCluster.articles[1].content.length,
            total_content_chars: testCluster.articles.reduce((sum, a) => sum + a.content.length, 0)
          };
          
                     // 检查分析结果是否包含原文章的特定关键词
           const contentSample = testCluster.articles[0].content.substring(0, 500);
           const analysisText = JSON.stringify(analysisResult.data).toLowerCase();
           const articleWords = contentSample.toLowerCase().split(' ').filter((w: string) => w.length > 3).slice(0, 10);
           const foundWords = articleWords.filter((word: string) => analysisText.includes(word));
          
          results.tests.intelligence_analysis.content_usage_indicator = {
            sample_words_from_article: articleWords.slice(0, 5),
            words_found_in_analysis: foundWords.length,
            likely_used_content: foundWords.length > 0,
            analysis_length: analysisText.length
          };
          
        } else {
          results.tests.intelligence_analysis.status = 'failed';
          results.tests.intelligence_analysis.error = analysisResult.error || '分析失败';
        }
        
      } catch (error) {
        results.tests.intelligence_analysis.status = 'failed';
        results.tests.intelligence_analysis.error = error instanceof Error ? error.message : String(error);
      }
      
      results.tests.intelligence_analysis.completed_at = new Date().toISOString();
    } else {
      results.tests.intelligence_analysis = {
        status: 'skipped',
        reason: testIntelligenceAnalysis ? 
          `需要至少2篇有内容的文章，当前只有${successfulContentTests.length}篇` : 
          '智能分析测试被禁用',
        completed_at: new Date().toISOString()
      };
    }

    // 测试3: 验证工作流中的内容获取路径
    results.tests.workflow_content_path = { started_at: new Date().toISOString() };
    
    if (successfulContentTests.length > 0) {
      const testArticle = successfulContentTests[0];
      try {
        // 模拟工作流中的内容获取过程
        const obj = await c.env.ARTICLES_BUCKET.get(testArticle.content_file_key);
        if (obj) {
          const workflowContent = await obj.text();
          
          results.tests.workflow_content_path.status = 'success';
          results.tests.workflow_content_path.content_accessible = true;
          results.tests.workflow_content_path.content_length = workflowContent.length;
          results.tests.workflow_content_path.matches_stored_content = 
            workflowContent === testArticle.content_sample;
          results.tests.workflow_content_path.test_article_id = testArticle.article_id;
          
        } else {
          results.tests.workflow_content_path.status = 'failed';
          results.tests.workflow_content_path.error = '工作流无法访问R2内容';
        }
      } catch (error) {
        results.tests.workflow_content_path.status = 'failed';
        results.tests.workflow_content_path.error = `工作流内容获取失败: ${error instanceof Error ? error.message : String(error)}`;
      }
    } else {
      results.tests.workflow_content_path.status = 'skipped';
      results.tests.workflow_content_path.reason = '没有可用的测试文章';
    }
    
    results.tests.workflow_content_path.completed_at = new Date().toISOString();

    // 最终总结
    results.completed_at = new Date().toISOString();
    results.duration_seconds = Math.round((new Date().getTime() - new Date(results.started_at).getTime()) / 1000);
    
    const testStatuses = Object.values(results.tests).map((test: any) => test.status);
    const allSuccessful = testStatuses.every(status => ['success', 'skipped'].includes(status));
    const hasFailures = testStatuses.includes('failed');
    
    results.overall_status = allSuccessful ? 'success' : (hasFailures ? 'failed' : 'partial');
    results.summary = {
      r2_storage_working: results.tests.r2_storage_check.status === 'success',
      content_available_articles: results.tests.r2_storage_check.content_available_count || 0,
      intelligence_analysis_working: results.tests.intelligence_analysis.status === 'success',
      workflow_content_access_working: results.tests.workflow_content_path.status === 'success'
    };

    console.log(`[Article Content Test] 测试完成: ${results.overall_status}`);

    return c.json({
      success: allSuccessful,
      message: allSuccessful ? '文章内容流程测试全部通过' : 
               hasFailures ? '文章内容流程测试发现问题' : '文章内容流程测试部分完成',
      results
    });

  } catch (error) {
    console.error('[Article Content Test] 测试失败:', error);
    return c.json({
      success: false,
      error: '文章内容测试执行失败',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

/**
 * 查询R2存储中的文章统计信息
 */
app.get('/r2-articles-stats', async (c) => {
  try {
    console.log(`[R2 Stats] 开始查询R2存储中的文章统计`);

    const db = getDb(c.env.HYPERDRIVE);
    const results: any = {
      query_time: new Date().toISOString(),
      database_stats: {},
      r2_stats: {},
      status_breakdown: {}
    };

    // 1. 查询数据库中的文章统计
    console.log('[R2 Stats] 查询数据库统计...');
    
    // 总文章数
    const totalArticles = await db.select({ count: sql<number>`count(*)` })
      .from($articles);
    
    // 有contentFileKey的文章数（应该在R2中有内容）
    const articlesWithContentKey = await db.select({ count: sql<number>`count(*)` })
      .from($articles)
      .where(isNotNull($articles.contentFileKey));
    
    // 按状态分组统计
    const statusBreakdown = await db.select({
      status: $articles.status,
      count: sql<number>`count(*)`
    })
    .from($articles)
    .groupBy($articles.status);

    // 有嵌入向量的文章数
    const articlesWithEmbedding = await db.select({ count: sql<number>`count(*)` })
      .from($articles)
      .where(isNotNull($articles.embedding));

    // PROCESSED状态且有contentFileKey的文章（完全处理完成）
    const fullyProcessedArticles = await db.select({ count: sql<number>`count(*)` })
      .from($articles)
      .where(
        and(
          eq($articles.status, 'PROCESSED'),
          isNotNull($articles.contentFileKey),
          isNotNull($articles.embedding)
        )
      );

    results.database_stats = {
      total_articles: totalArticles[0].count,
      articles_with_content_key: articlesWithContentKey[0].count,
      articles_with_embedding: articlesWithEmbedding[0].count,
      fully_processed_articles: fullyProcessedArticles[0].count
    };

    results.status_breakdown = statusBreakdown.reduce((acc, item) => {
      acc[item.status || 'null'] = item.count;
      return acc;
    }, {} as Record<string, number>);

    // 2. 检查R2存储的实际情况（采样检查）
    console.log('[R2 Stats] 检查R2存储实际情况...');
    
    // 获取最近的一些有contentFileKey的文章进行采样检查
    const sampleArticles = await db.select({
      id: $articles.id,
      contentFileKey: $articles.contentFileKey,
      processedAt: $articles.processedAt
    })
    .from($articles)
    .where(isNotNull($articles.contentFileKey))
    .orderBy(desc($articles.processedAt))
    .limit(20);

    let r2AvailableCount = 0;
    let r2MissingCount = 0;
    const sampleResults = [];

    for (const article of sampleArticles) {
      try {
        const obj = await c.env.ARTICLES_BUCKET.get(article.contentFileKey!);
        if (obj) {
          const content = await obj.text();
          r2AvailableCount++;
          sampleResults.push({
            article_id: article.id,
            content_key: article.contentFileKey,
            content_length: content.length,
            available: true
          });
        } else {
          r2MissingCount++;
          sampleResults.push({
            article_id: article.id,
            content_key: article.contentFileKey,
            available: false,
            error: 'Object not found in R2'
          });
        }
      } catch (error) {
        r2MissingCount++;
        sampleResults.push({
          article_id: article.id,
          content_key: article.contentFileKey,
          available: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    results.r2_stats = {
      sample_size: sampleArticles.length,
      sample_available: r2AvailableCount,
      sample_missing: r2MissingCount,
      estimated_availability_rate: sampleArticles.length > 0 ? 
        (r2AvailableCount / sampleArticles.length * 100).toFixed(1) + '%' : 'N/A',
      sample_details: sampleResults
    };

    // 3. 按日期统计文章分布
    console.log('[R2 Stats] 统计文章日期分布...');
    
    const dateDistribution = await db.select({
      date: sql<string>`DATE(${$articles.processedAt})`,
      count: sql<number>`count(*)`
    })
    .from($articles)
    .where(
      and(
        isNotNull($articles.contentFileKey),
        isNotNull($articles.processedAt)
      )
    )
    .groupBy(sql`DATE(${$articles.processedAt})`)
    .orderBy(sql`DATE(${$articles.processedAt}) DESC`)
    .limit(10);

    results.recent_activity = {
      articles_by_date: dateDistribution
    };

    // 4. 估算R2总存储大小
    let totalEstimatedSize = 0;
    if (sampleResults.length > 0) {
              const validSamples = sampleResults.filter(s => s.available && typeof s.content_length === 'number');
        if (validSamples.length > 0) {
          const avgSize = validSamples.reduce((sum, s) => sum + (s.content_length || 0), 0) / validSamples.length;
        totalEstimatedSize = avgSize * results.database_stats.articles_with_content_key;
        
        results.storage_estimates = {
          average_article_size_bytes: Math.round(avgSize),
          average_article_size_kb: Math.round(avgSize / 1024),
          estimated_total_size_bytes: Math.round(totalEstimatedSize),
          estimated_total_size_mb: Math.round(totalEstimatedSize / (1024 * 1024)),
          estimated_total_size_gb: (totalEstimatedSize / (1024 * 1024 * 1024)).toFixed(2)
        };
      }
    }

    console.log(`[R2 Stats] 统计完成`);

    return c.json({
      success: true,
      message: `R2存储统计查询完成`,
      results
    });

  } catch (error) {
    console.error('[R2 Stats] 查询失败:', error);
    return c.json({
      success: false,
      error: 'R2存储统计查询失败',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export default app; 