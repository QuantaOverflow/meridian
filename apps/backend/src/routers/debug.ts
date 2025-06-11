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


// ML Service 聚类服务诊断端点
app.post('/diagnose-clustering-service', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    
    console.log('[ClusterDiag] 开始诊断ML Service聚类服务...');
    
    // 步骤1: ML Service健康检查
    const healthResponse = await fetch('https://meridian-ml.pathsoflight.org/health', {
      method: 'GET',
      headers: {
        'X-API-Token': 'f10c0976a3e273a7829666c3c5af658e5d9aee790187617b98e8c6e5d35d6336'
      }
    });
    const healthData = await healthResponse.json();
    
    console.log('[ClusterDiag] ML Service健康检查:', healthResponse.status, healthData);

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
      metadata: {
        title: a.title,
        url: 'test-url',
        content: '',
        source: 'debug',
        publishDate: new Date().toISOString()
      }
    }));

    // 生成模拟嵌入向量 (已知能工作的)
    const mockEmbeddings = validArticles.slice(0, 3).map(a => ({
      id: a.id,
      embedding: new Array(384).fill(0).map(() => Math.random() * 0.1),
      metadata: {
        title: a.title,
        url: 'test-url',
        content: '',
        source: 'mock',
        publishDate: new Date().toISOString()
      }
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
        const clusterRequest = await fetch('https://meridian-ml.pathsoflight.org/clustering/auto', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-API-Token': 'f10c0976a3e273a7829666c3c5af658e5d9aee790187617b98e8c6e5d35d6336'
          },
          body: JSON.stringify({
            items: testCase.data,
            config: {
              umap_n_neighbors: Math.min(15, Math.max(3, testCase.data.length - 1)),
              umap_n_components: Math.min(10, testCase.data.length - 1),
              hdbscan_min_cluster_size: 2,
              hdbscan_min_samples: 2,
              normalize_embeddings: true
            },
            content_analysis: {
              enabled: true,
              top_n_per_cluster: 3,
              generate_themes: true,
              generate_summary: true
            }
          })
        });

        const result = await clusterRequest.json() as any;
        
        testResults.push({
          testCase: testCase.name,
          requestStatus: clusterRequest.status,
          responseOk: clusterRequest.ok,
          success: clusterRequest.ok && result && !result.error,
          result: result,
          articlesCount: testCase.data.length
        });

        console.log(`[ClusterDiag] ${testCase.name}测试完成:`, clusterRequest.status);
        
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
        mlServiceHealth: {
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
          "ML Service聚类服务正常工作" : 
          "ML Service聚类服务存在问题，需要检查配置"
      }
    });

  } catch (error) {
    console.error('ML Service聚类服务诊断失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export default app; 