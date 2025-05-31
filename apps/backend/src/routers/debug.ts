import { Hono } from 'hono';
import { getDb } from '../lib/utils';
import { $articles, $sources, $reports, eq, isNotNull, and, gte, sql, desc } from '@meridian/database';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

// 数据库文章状态检查
app.get('/check-articles', async (c) => {
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

    // 获取最近处理的文章样本
    const recentProcessed = await db
      .select({
        id: $articles.id,
        title: $articles.title,
        status: $articles.status,
        processedAt: $articles.processedAt,
        hasEmbedding: sql`CASE WHEN embedding IS NOT NULL THEN true ELSE false END`.as('hasEmbedding'),
        embeddingLength: sql`array_length(embedding, 1)`.as('embeddingLength'),
      })
      .from($articles)
      .where(eq($articles.status, 'PROCESSED'))
      .orderBy(desc($articles.processedAt))
      .limit(5);

    return c.json({
      success: true,
      data: {
        statusCounts: statusCounts,
        embeddingCount: embeddingCount[0]?.count || 0,
        processedWithEmbedding: readyCount,
        recentProcessedSample: recentProcessed,
        analysis: {
          totalArticles: statusCounts.reduce((sum, item) => sum + Number(item.count), 0),
          readyForBriefing: readyCount,
          recommendation: readyCount >= 2 ? 
            "有足够文章生成简报" : 
            `需要至少2篇PROCESSED文章，当前只有${readyCount}篇`
        }
      }
    });
  } catch (error) {
    console.error('检查文章状态失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// 简报生成调试端点
app.post('/debug-brief-generation', async (c) => {
  try {
    const body = await c.req.json();
    const { 
      dryRun = true,
      articleLimit = 10,
      useSimulatedEmbeddings = false
    } = body;

    console.log('[BriefDebug] 开始简报生成调试');

    const db = getDb(c.env.HYPERDRIVE);
    
    // 获取测试文章
    const articlesQuery = await db
      .select({
        id: $articles.id,
        title: $articles.title,
        embedding: $articles.embedding,
      })
      .from($articles)
      .where(
        and(
          eq($articles.status, 'PROCESSED'),
          isNotNull($articles.embedding),
          isNotNull($articles.contentFileKey)
        )
      )
      .orderBy(desc($articles.processedAt))
      .limit(articleLimit);

    if (articlesQuery.length < 2) {
      return c.json({
        success: false,
        error: `文章数量不足：需要至少2篇，实际${articlesQuery.length}篇`
      });
    }

    // 准备测试数据
    let testArticles = articlesQuery;
    
    if (useSimulatedEmbeddings) {
      // 使用模拟嵌入向量
      testArticles = articlesQuery.map(article => ({
        ...article,
        embedding: new Array(384).fill(0).map(() => Math.random() * 0.1)
      }));
    }

    // 验证嵌入向量质量
    const embeddingAnalysis = testArticles.map(article => {
      const embedding = article.embedding;
      return {
        id: article.id,
        title: article.title,
        embeddingInfo: {
          isValid: Array.isArray(embedding) && embedding.length === 384,
          length: Array.isArray(embedding) ? embedding.length : 'N/A',
          hasValidNumbers: Array.isArray(embedding) ? 
            embedding.every(val => typeof val === 'number' && !isNaN(val)) : false,
          sampleValues: Array.isArray(embedding) ? embedding.slice(0, 3) : []
        }
      };
    });

    const validArticles = embeddingAnalysis.filter(a => a.embeddingInfo.isValid);

    if (dryRun) {
      return c.json({
        success: true,
        dryRun: true,
        analysis: {
          totalArticles: testArticles.length,
          validEmbeddings: validArticles.length,
          readyForClustering: validArticles.length >= 2,
          embeddingAnalysis: embeddingAnalysis
        }
      });
    }

    // 实际执行聚类测试
    const articlesForClustering = validArticles.map(a => ({
      id: a.id,
      embedding: testArticles.find(t => t.id === a.id)?.embedding
    }));

    console.log('[BriefDebug] 执行聚类测试...');
    
    const clusterRequest = new Request('https://meridian-ai-worker/meridian/clustering/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        articles: articlesForClustering,
        options: {
          umap: {
            n_neighbors: Math.min(15, Math.max(2, validArticles.length - 1)),
            n_components: Math.min(10, Math.max(2, validArticles.length - 1)),
            min_dist: 0.0,
            metric: 'cosine'
          },
          hdbscan: {
            min_cluster_size: Math.max(2, Math.floor(validArticles.length / 5)),
            min_samples: Math.max(2, Math.floor(validArticles.length / 10)),
            cluster_selection_epsilon: 0.3,
            metric: 'euclidean'
          },
          preprocessing: 'abs_normalize',
          strategy: 'adaptive_threshold',
          enable_quality_check: true,
          min_quality_score: 0.2,
          enable_fallback: true
        }
      })
    });

    const response = await c.env.AI_WORKER.fetch(clusterRequest);
    const clusterResult = await response.json();

    return c.json({
      success: true,
      dryRun: false,
      clusteringTest: {
        requestStatus: response.status,
        responseOk: response.ok,
        result: clusterResult,
        articlesUsed: validArticles.length
      }
    });

  } catch (error) {
    console.error('简报生成调试失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// 检查嵌入向量的实际内容
app.post('/analyze-embeddings', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    
    // 获取一篇有嵌入向量的文章
    const articlesWithEmbeddings = await db
      .select({
        id: $articles.id,
        title: $articles.title,
        embedding: $articles.embedding,
      })
      .from($articles)
      .where(
        and(
          eq($articles.status, 'PROCESSED'),
          isNotNull($articles.embedding)
        )
      )
      .limit(5);

    if (articlesWithEmbeddings.length === 0) {
      return c.json({
        success: false,
        error: '没有找到带嵌入向量的文章'
      });
    }

    const embeddingAnalysis = articlesWithEmbeddings.map(article => {
      const embedding = article.embedding;
      
      return {
        id: article.id,
        title: article.title,
        embeddingInfo: {
          type: Array.isArray(embedding) ? 'array' : typeof embedding,
          length: Array.isArray(embedding) ? embedding.length : 'N/A',
          isEmptyArray: Array.isArray(embedding) && embedding.length === 0,
          firstFewValues: Array.isArray(embedding) ? embedding.slice(0, 5) : 'N/A',
          hasValidNumbers: Array.isArray(embedding) ? 
            embedding.every(val => typeof val === 'number' && !isNaN(val)) : false,
          vectorStats: Array.isArray(embedding) ? {
            min: Math.min(...embedding),
            max: Math.max(...embedding),
            mean: embedding.reduce((sum, val) => sum + val, 0) / embedding.length,
            sparsity: embedding.filter(val => val === 0).length / embedding.length
          } : null
        }
      };
    });

    return c.json({
      success: true,
      articlesAnalyzed: articlesWithEmbeddings.length,
      embeddingAnalysis: embeddingAnalysis
    });

  } catch (error) {
    console.error('检查嵌入向量失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// AI Worker聚类服务诊断端点
app.post('/diagnose-clustering-service', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    
    console.log('[ClusterDiag] 开始诊断AI Worker聚类服务...');
    
    // 步骤1: AI Worker健康检查
    const healthRequest = new Request('https://meridian-ai-worker/health', {
      method: 'GET'
    });
    
    const healthResponse = await c.env.AI_WORKER.fetch(healthRequest);
    const healthData = await healthResponse.json();
    
    console.log('[ClusterDiag] AI Worker健康检查:', healthResponse.status, healthData);

    // 步骤2: 获取少量真实文章数据
    const articlesQuery = await db
      .select({
        id: $articles.id,
        title: $articles.title,
        embedding: $articles.embedding,
      })
      .from($articles)
      .where(
        and(
          eq($articles.status, 'PROCESSED'),
          isNotNull($articles.embedding),
          isNotNull($articles.contentFileKey)
        )
      )
      .orderBy(desc($articles.processedAt))
      .limit(6);

    console.log('[ClusterDiag] 获取到真实文章数量:', articlesQuery.length);

    if (articlesQuery.length < 3) {
      return c.json({
        success: false,
        error: '真实文章数量不足进行诊断',
        healthCheck: { status: healthResponse.status, data: healthData }
      });
    }

    const validArticles = articlesQuery.filter(article => {
      const embedding = article.embedding;
      return embedding && 
             Array.isArray(embedding) && 
             embedding.length === 384 &&
             embedding.every(val => typeof val === 'number' && !isNaN(val) && isFinite(val));
    });

    console.log('[ClusterDiag] 有效真实嵌入向量数量:', validArticles.length);

    // 准备测试数据
    const realEmbeddings = validArticles.slice(0, 3).map(a => ({
      id: a.id,
      embedding: a.embedding,
      title: a.title
    }));

    // 生成模拟嵌入向量 (已知能工作的)
    const mockEmbeddings = validArticles.slice(0, 3).map(a => ({
      id: a.id,
      embedding: new Array(384).fill(0).map(() => Math.random() * 0.1),
      title: a.title
    }));

    // 步骤3: 测试聚类功能
    const testCases = [
      { name: '模拟嵌入向量', data: mockEmbeddings },
      { name: '真实嵌入向量', data: realEmbeddings }
    ];

    const testResults = [];

    for (const testCase of testCases) {
      if (testCase.data.length < 2) continue;

      try {
        const clusterRequest = new Request('https://meridian-ai-worker/meridian/clustering/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            articles: testCase.data,
            options: {
              umap: {
                n_neighbors: Math.min(15, testCase.data.length - 1),
                n_components: Math.min(10, testCase.data.length - 1),
                min_dist: 0.0,
                metric: 'cosine'
              },
              hdbscan: {
                min_cluster_size: 2,
                min_samples: 2,
                cluster_selection_epsilon: 0.3,
                metric: 'euclidean'
              },
              preprocessing: 'abs_normalize',
              strategy: 'adaptive_threshold',
              enable_quality_check: true,
              min_quality_score: 0.2,
              enable_fallback: true
            }
          })
        });

        const response = await c.env.AI_WORKER.fetch(clusterRequest);
        const result = await response.json() as any;
        
        testResults.push({
          testCase: testCase.name,
          requestStatus: response.status,
          responseOk: response.ok,
          success: response.ok && result && !result.error,
          result: result,
          articlesCount: testCase.data.length
        });

        console.log(`[ClusterDiag] ${testCase.name}测试完成:`, response.status);
        
      } catch (error) {
        testResults.push({
          testCase: testCase.name,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return c.json({
      success: true,
      diagnosis: {
        aiWorkerHealth: {
          status: healthResponse.status,
          ok: healthResponse.ok,
          data: healthData
        },
        dataAvailable: {
          totalArticles: articlesQuery.length,
          validEmbeddings: validArticles.length,
          sufficient: validArticles.length >= 2
        },
        clusteringTests: testResults,
        recommendation: testResults.some(t => t.success) ? 
          "聚类服务正常工作" : 
          "聚类服务存在问题，需要检查配置"
      }
    });

  } catch (error) {
    console.error('聚类服务诊断失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export default app; 