import { Hono } from 'hono';
import type { Env as BaseEnv } from '../index';
import type { BriefGenerationParams } from '../workflows/auto-brief-generation';

// By extending the base Env, we can provide a more accurate type for the
// specific bindings used in this testing router.
type TestEnv = BaseEnv & {
    MY_WORKFLOW: any; // Use any to bypass complex workflow typing issues
};

const debugRouter = new Hono<{ Bindings: TestEnv }>();

/**
 * A debug endpoint to facilitate end-to-end testing of the brief generation workflow.
 * This endpoint will trigger the AutoBriefGenerationWorkflow, which will then operate
 * on the articles currently available in the database connected via Hyperdrive.
 */
debugRouter.post('/trigger-brief-workflow', async (c) => {
    try {
        const workflowId = `e2e-manual-trigger-${Date.now()}`;
        console.log(`[Debug] 创建新的工作流实例，ID: ${workflowId}`);

        // 构建符合 BriefGenerationParams 接口的参数
        const payload: BriefGenerationParams = {
            triggeredBy: 'debug-endpoint',
            timeRangeDays: 7, // 使用最近7天的数据
            articleLimit: 100, // 限制100篇文章用于测试
            minImportance: 3,
            maxStoriesToGenerate: 10,
            storyMinImportance: 0.1,
            // 使用正确的聚类参数结构
            clusteringOptions: {
                umapParams: {
                    n_neighbors: 15,
                    n_components: 5,
                    min_dist: 0.1,
                    metric: 'cosine'
                },
                hdbscanParams: {
                    min_cluster_size: 3,
                    min_samples: 1,
                    epsilon: 0.5
                }
            }
        };

        console.log('[Debug] 工作流参数:', JSON.stringify(payload, null, 2));

        // 使用 wrangler.jsonc 中配置的工作流绑定 'MY_WORKFLOW'
        const workflowInstance = await c.env.MY_WORKFLOW.create({
            id: workflowId,
            params: payload
        });

        console.log('[Debug] 工作流实例创建成功:', workflowInstance.id);

        return c.json({
            success: true,
            message: '自动简报生成工作流已创建并启动',
            workflowId: workflowInstance.id,
            payload: payload,
            note: "工作流正在运行中。请查看 wrangler dev 日志以监控进度，生成的简报将保存到数据库中。",
            debugInfo: {
                expectedArticles: "将从最近7天的已处理文章中选择最多100篇",
                processingSteps: [
                    "1. 准备文章数据集 (从数据库+R2获取)",
                    "2. 聚类分析 (ML Service)",
                    "3. 故事验证 (AI Worker)",
                    "4. 情报深度分析 (AI Worker)", 
                    "5. 简报生成+TLDR (AI Worker)",
                    "6. 保存到数据库"
                ]
            }
        });

    } catch (error) {
        console.error('[Debug] 创建工作流实例失败:', error);
        return c.json({
            success: false,
            message: '创建工作流实例失败',
            error: error instanceof Error ? error.message : String(error),
            workflowId: null
        }, 500);
    }
});

/**
 * A debug endpoint to check the status of a workflow instance
 */
debugRouter.get('/workflow-status/:workflowId', async (c) => {
    try {
        const workflowId = c.req.param('workflowId');
        
        // Note: Workflow status checking might not be directly available
        // This is a placeholder for potential future functionality
        return c.json({
            success: true,
            workflowId: workflowId,
            status: '状态检查功能尚未实现',
            note: '请查看 wrangler dev 日志以监控工作流进度'
        });
    } catch (error) {
        console.error('[Debug] 获取工作流状态失败:', error);
        return c.json({
            success: false,
            message: '获取工作流状态失败',
            error: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});

/**
 * 获取数据库统计信息的调试端点
 */
debugRouter.get('/db-stats', async (c) => {
    try {
        const { getDb } = await import('../lib/utils');
        const { $articles, $reports, gte, eq, and, isNotNull, desc, sql } = await import('@meridian/database');
        
        const db = getDb(c.env.HYPERDRIVE);
        
        // 获取基本统计
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        
        const [
            totalArticles,
            processedArticles, 
            recentArticles,
            totalReports
        ] = await Promise.all([
            db.select({ count: sql`count(*)`.as('count') }).from($articles),
            db.select({ count: sql`count(*)`.as('count') }).from($articles).where(eq($articles.status, 'PROCESSED')),
            db.select({ count: sql`count(*)`.as('count') }).from($articles).where(
                and(
                    gte($articles.publishDate, sevenDaysAgo),
                    eq($articles.status, 'PROCESSED'),
                    isNotNull($articles.embedding)
                )
            ),
            db.select({ count: sql`count(*)`.as('count') }).from($reports)
        ]);

        // 获取最新的已处理文章示例
        const recentProcessedArticles = await db
            .select({
                id: $articles.id,
                title: $articles.title,
                publishDate: $articles.publishDate,
                status: $articles.status
            })
            .from($articles)
            .where(
                and(
                    gte($articles.publishDate, sevenDaysAgo),
                    eq($articles.status, 'PROCESSED'),
                    isNotNull($articles.embedding)
                )
            )
            .orderBy(desc($articles.publishDate))
            .limit(10);

        return c.json({
            success: true,
            stats: {
                totalArticles: totalArticles[0].count,
                processedArticles: processedArticles[0].count,
                recentProcessedArticles: recentArticles[0].count,
                totalReports: totalReports[0].count
            },
            recentArticlesSample: recentProcessedArticles,
            note: `在最近7天内找到 ${recentArticles[0].count} 篇已处理且有嵌入向量的文章可用于工作流`
        });

    } catch (error) {
        console.error('[Debug] 获取数据库统计失败:', error);
        return c.json({
            success: false,
            message: '获取数据库统计失败',
            error: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

/**
 * 检查R2存储中文章内容的可用性
 */
debugRouter.get('/r2-content-check', async (c) => {
    try {
        const { getDb } = await import('../lib/utils');
        const { $articles, gte, eq, and, isNotNull, desc } = await import('@meridian/database');
        
        const db = getDb(c.env.HYPERDRIVE);
        
        // 获取最近的10篇已处理文章
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const testArticles = await db
            .select({
                id: $articles.id,
                title: $articles.title,
                contentFileKey: $articles.contentFileKey,
                publishDate: $articles.publishDate,
                status: $articles.status
            })
            .from($articles)
            .where(
                and(
                    gte($articles.publishDate, sevenDaysAgo),
                    eq($articles.status, 'PROCESSED'),
                    isNotNull($articles.embedding)
                )
            )
            .orderBy(desc($articles.publishDate))
            .limit(10);

        console.log(`[Debug] 检查 ${testArticles.length} 篇文章的R2内容`);

        const contentCheck = [];
        for (const article of testArticles) {
            let contentStatus = 'missing';
            let contentLength = 0;
            let error = null;

            if (article.contentFileKey) {
                try {
                    const contentObject = await c.env.ARTICLES_BUCKET.get(article.contentFileKey);
                    if (contentObject) {
                        const content = await contentObject.text();
                        contentStatus = 'found';
                        contentLength = content.length;
                    } else {
                        contentStatus = 'not_found';
                    }
                } catch (err) {
                    contentStatus = 'error';
                    error = err instanceof Error ? err.message : String(err);
                }
            } else {
                contentStatus = 'no_key';
            }

            contentCheck.push({
                id: article.id,
                title: article.title.substring(0, 50) + '...',
                contentFileKey: article.contentFileKey,
                contentStatus,
                contentLength,
                error
            });
        }

        const summary = {
            total: contentCheck.length,
            found: contentCheck.filter(c => c.contentStatus === 'found').length,
            not_found: contentCheck.filter(c => c.contentStatus === 'not_found').length,
            no_key: contentCheck.filter(c => c.contentStatus === 'no_key').length,
            error: contentCheck.filter(c => c.contentStatus === 'error').length
        };

        return c.json({
            success: true,
            summary,
            details: contentCheck,
            note: 'R2内容可用性检查完成'
        });

    } catch (error) {
        console.error('[Debug] R2内容检查失败:', error);
        return c.json({
            success: false,
            message: 'R2内容检查失败',
            error: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

/**
 * 测试故事验证逻辑，调试为什么返回0个有效故事
 */
debugRouter.post('/test-story-validation', async (c) => {
    try {
        const { getDb } = await import('../lib/utils');
        const { $articles, gte, eq, and, isNotNull, desc } = await import('@meridian/database');
        const { createClusteringService } = await import('../lib/clustering-service');
        const { createAIServices } = await import('../lib/ai-services');
        
        const db = getDb(c.env.HYPERDRIVE);
        
        // 获取测试数据：最近5篇文章
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const testArticles = await db
            .select({
                id: $articles.id,
                title: $articles.title,
                url: $articles.url,
                contentFileKey: $articles.contentFileKey,
                publish_date: $articles.publishDate,
                embedding: $articles.embedding,
                event_summary_points: $articles.event_summary_points
            })
            .from($articles)
            .where(
                and(
                    gte($articles.publishDate, sevenDaysAgo),
                    eq($articles.status, 'PROCESSED'),
                    isNotNull($articles.embedding)
                )
            )
            .orderBy(desc($articles.publishDate))
            .limit(5);

        if (testArticles.length < 2) {
            return c.json({
                success: false,
                message: '测试数据不足，需要至少2篇文章'
            });
        }

        console.log(`[Debug] 使用 ${testArticles.length} 篇文章测试故事验证`);

        // 构建测试数据集
        const articles = testArticles.map(article => ({
            id: article.id,
            title: article.title,
            content: article.title, // 使用标题作为内容，避免R2问题
            publishDate: article.publish_date?.toISOString() || new Date().toISOString(),
            url: article.url,
            summary: (article.event_summary_points as string[])?.[0] || article.title
        }));

        const embeddings = testArticles.map(article => ({
            articleId: article.id,
            embedding: article.embedding as number[]
        }));

        const dataset = { articles, embeddings };

        // 步骤1: 聚类分析
        const clusteringService = createClusteringService(c.env);
        const clusteringOptions = {
            umapParams: {
                n_neighbors: 3,
                n_components: 2,
                min_dist: 0.1,
                metric: 'cosine'
            },
            hdbscanParams: {
                min_cluster_size: 2,
                min_samples: 1,
                epsilon: 0.5
            }
        };

        const clusteringResponse = await clusteringService.analyzeClusters(dataset, clusteringOptions);
        
        if (!clusteringResponse.success) {
            return c.json({
                success: false,
                message: '聚类分析失败',
                error: clusteringResponse.error
            });
        }

        const clusteringResult = clusteringResponse.data!;
        console.log(`[Debug] 聚类分析完成: ${clusteringResult.clusters.length} 个聚类`);

        // 步骤2: 故事验证
        const aiServices = createAIServices(c.env);
        
        const articlesData = dataset.articles.map(article => ({
            id: article.id,
            title: article.title,
            url: article.url,
            event_summary_points: [article.summary]
        }));

        console.log(`[Debug] 发送到AI Worker的数据:`, JSON.stringify({
            clusters: clusteringResult.clusters.map(c => ({
                clusterId: c.clusterId,
                size: c.articleIds.length,
                articleIds: c.articleIds.slice(0, 2) // 只显示前2篇文章
            })),
            articlesCount: articlesData.length
        }, null, 2));

        const validationResponse = await aiServices.aiWorker.validateStory(
            clusteringResult,
            articlesData,
            {
                useAI: true,
                aiOptions: {
                    provider: 'google-ai-studio',
                    model: 'gemini-2.0-flash'
                }
            }
        );

        if (validationResponse.status !== 200) {
            const errorText = await validationResponse.text();
            return c.json({
                success: false,
                message: `故事验证失败: HTTP ${validationResponse.status}`,
                error: errorText
            });
        }

        const validationData = await validationResponse.json() as any;
        
        return c.json({
            success: true,
            data: {
                clustering: {
                    clustersFound: clusteringResult.clusters.length,
                    totalArticles: clusteringResult.statistics.totalArticles,
                    noisePoints: clusteringResult.statistics.noisePoints,
                    clusters: clusteringResult.clusters.map(c => ({
                        clusterId: c.clusterId,
                        size: c.articleIds.length,
                        articleTitles: c.articleIds.map((aid: number) => 
                            articles.find(a => a.id === aid)?.title || `Article ${aid}`
                        )
                    }))
                },
                validation: {
                    success: validationData.success,
                    validStories: validationData.data?.stories?.length || 0,
                    rejectedClusters: validationData.data?.rejectedClusters?.length || 0,
                    details: validationData.data || validationData.error
                }
            },
            note: '故事验证测试完成'
        });

    } catch (error) {
        console.error('[Debug] 故事验证测试失败:', error);
        return c.json({
            success: false,
            message: '故事验证测试失败',
            error: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

/**
 * 查看最新简报的详细信息
 */
debugRouter.get('/latest-brief-details', async (c) => {
    try {
        const { getDb } = await import('../lib/utils');
        const { $reports, desc, sql } = await import('@meridian/database');
        
        const db = getDb(c.env.HYPERDRIVE);
        
        // 获取最新的简报
        const latestBrief = await db
            .select({
                id: $reports.id,
                title: $reports.title,
                tldr: $reports.tldr,
                content: sql`substr(${$reports.content}, 1, 500)`.as('content_preview'),
                totalArticles: $reports.totalArticles,
                usedArticles: $reports.usedArticles,
                totalSources: $reports.totalSources,
                usedSources: $reports.usedSources,
                clustering_params: $reports.clustering_params,
                model_author: $reports.model_author,
                createdAt: $reports.createdAt
            })
            .from($reports)
            .orderBy(desc($reports.createdAt))
            .limit(1);

        if (latestBrief.length === 0) {
            return c.json({
                success: false,
                message: '没有找到简报'
            });
        }

        const brief = latestBrief[0];
        
        return c.json({
            success: true,
            data: {
                id: brief.id,
                title: brief.title,
                tldr: brief.tldr,
                contentPreview: brief.content as string,
                stats: {
                    totalArticles: brief.totalArticles,
                    usedArticles: brief.usedArticles,
                    totalSources: brief.totalSources,
                    usedSources: brief.usedSources
                },
                metadata: {
                    model_author: brief.model_author,
                    createdAt: brief.createdAt,
                    clustering_params: brief.clustering_params
                }
            },
            note: '最新简报详细信息'
        });

    } catch (error) {
        console.error('[Debug] 获取简报详情失败:', error);
        return c.json({
            success: false,
            message: '获取简报详情失败',
            error: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

/**
 * 检查数据库文章数据的实际类型，特别是event_summary_points
 */
debugRouter.get('/check-article-data-types', async (c) => {
    try {
        const { getDb } = await import('../lib/utils');
        const { $articles, gte, eq, and, isNotNull, desc } = await import('@meridian/database');
        
        const db = getDb(c.env.HYPERDRIVE);
        
        // 获取5篇测试文章
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const testArticles = await db
            .select({
                id: $articles.id,
                title: $articles.title,
                url: $articles.url,
                event_summary_points: $articles.event_summary_points,
                thematic_keywords: $articles.thematic_keywords,
                key_entities: $articles.key_entities,
                publish_date: $articles.publishDate
            })
            .from($articles)
            .where(
                and(
                    gte($articles.publishDate, sevenDaysAgo),
                    eq($articles.status, 'PROCESSED'),
                    isNotNull($articles.embedding)
                )
            )
            .orderBy(desc($articles.publishDate))
            .limit(5);

        const dataTypeAnalysis = testArticles.map(article => ({
            id: article.id,
            title: article.title.substring(0, 50) + '...',
            
            // 检查event_summary_points的实际类型和内容
            event_summary_points: {
                raw_value: article.event_summary_points,
                type: typeof article.event_summary_points,
                is_array: Array.isArray(article.event_summary_points),
                length: Array.isArray(article.event_summary_points) ? article.event_summary_points.length : 'N/A',
                first_item: Array.isArray(article.event_summary_points) && article.event_summary_points.length > 0 
                    ? article.event_summary_points[0] 
                    : 'N/A',
                first_item_type: Array.isArray(article.event_summary_points) && article.event_summary_points.length > 0 
                    ? typeof article.event_summary_points[0] 
                    : 'N/A'
            },
            
            // 检查其他字段
            thematic_keywords: {
                type: typeof article.thematic_keywords,
                is_array: Array.isArray(article.thematic_keywords),
                length: Array.isArray(article.thematic_keywords) ? article.thematic_keywords.length : 'N/A'
            },
            
            key_entities: {
                type: typeof article.key_entities,
                is_array: Array.isArray(article.key_entities),
                length: Array.isArray(article.key_entities) ? article.key_entities.length : 'N/A'
            },
            
            // 模拟故事验证所需的MinimalArticleInfo格式
            minimal_article_format: {
                id: article.id,
                title: article.title,
                url: article.url,
                event_summary_points: Array.isArray(article.event_summary_points) 
                    ? article.event_summary_points as string[]
                    : article.event_summary_points 
                        ? [String(article.event_summary_points)] 
                        : [article.title] // 回退到标题
            }
        }));

        return c.json({
            success: true,
            data: {
                total_articles: testArticles.length,
                type_analysis: dataTypeAnalysis
            },
            note: '数据类型分析完成 - 检查event_summary_points的实际格式'
        });

    } catch (error) {
        console.error('[Debug] 数据类型检查失败:', error);
        return c.json({
            success: false,
            message: '数据类型检查失败',
            error: error instanceof Error ? error.message : String(error)
        }, 500);
    }
});

export default debugRouter; 