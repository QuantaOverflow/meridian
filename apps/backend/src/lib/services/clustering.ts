/**
 * 聚类服务模块
 * 封装与Meridian ML Service的聚类分析交互
 * 提供符合intelligence-pipeline.test.ts数据契约的接口
 * 
 * 性能优化说明：
 * - 聚类请求中不再传递完整的文章内容(content)字段，以减少网络负载
 * - ML服务的聚类算法仅依赖embedding向量，不需要原始文章内容
 * - 下游工作流(如简报生成)通过R2存储按需获取完整文章内容
 */

import type { AIWorkerEnv } from './ai-services';

/**
 * HDBSCAN 的噪声标签。ml 侧把这一组也当普通簇返回，故它会出现在 clusters 里；
 * 判"是不是真簇"必须显式排除它，别再靠 clusters.length。
 */
export const NOISE_CLUSTER_ID = -1;

// 数据类型定义 - 与intelligence-pipeline.test.ts保持一致
export interface ArticleDataset {
  articles: Array<{
    id: number;
    title: string;
    content: string;
    publishDate: string;
    url: string;
    summary: string;
  }>;
  embeddings: Array<{
    articleId: number;
    embedding: number[];
  }>;
}

export interface ClusteringResult {
  clusters: Array<{
    clusterId: number;
    articleIds: number[];
    size: number;
  }>;
  parameters: {
    umapParams: {
      n_neighbors: number;
      n_components: number;
      min_dist: number;
      metric: string;
    };
    hdbscanParams: {
      min_cluster_size: number;
      min_samples: number;
      epsilon: number;
    };
  };
  statistics: {
    totalClusters: number;
    noisePoints: number;
    totalArticles: number;
  };
}

export interface ClusteringServiceResponse {
  success: boolean;
  data?: ClusteringResult;
  error?: string;
}

/**
 * 聚类服务类
 * 提供与intelligence-pipeline.test.ts兼容的聚类分析接口
 */
export class ClusteringService {
  constructor(private env: AIWorkerEnv, private traceId?: string) {}

  // 统一构建 outbound headers，自动注入 x-trace-id 以贯通跨 service 日志
  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...(extra || {}) };
    if (this.traceId) h['x-trace-id'] = this.traceId;
    return h;
  }

  /**
   * 执行聚类分析
   * 
   * @param dataset 文章数据集，包含文章信息和嵌入向量
   * @param options 可选的聚类配置参数
   * @returns 聚类分析结果
   */
  async analyzeClusters(
    dataset: ArticleDataset,
    options?: {
      umapParams?: {
        n_neighbors?: number;
        n_components?: number;
        min_dist?: number;
        metric?: string;
      };
      hdbscanParams?: {
        min_cluster_size?: number;
        min_samples?: number;
        epsilon?: number;
      };
    }
  ): Promise<ClusteringServiceResponse> {
    try {
      // 验证输入数据
      if (!dataset.articles.length || !dataset.embeddings.length) {
        return {
          success: false,
          error: "Dataset is empty"
        };
      }

      // 验证文章和嵌入向量的对应关系
      const articleIds = new Set(dataset.articles.map(a => a.id));
      const embeddingIds = new Set(dataset.embeddings.map(e => e.articleId));
      
      if (articleIds.size !== embeddingIds.size) {
        return {
          success: false,
          error: "Mismatch between articles and embeddings count"
        };
      }

      for (const articleId of articleIds) {
        if (!embeddingIds.has(articleId)) {
          return {
            success: false,
            error: `Missing embedding for article ${articleId}`
          };
        }
      }

      // 转换为ML服务期望的AI Worker格式
      // 优化：移除content字段以减少网络负载，ML服务的聚类算法只依赖embedding向量
      const items = dataset.articles.map(article => {
        const embedding = dataset.embeddings.find(e => e.articleId === article.id);
        if (!embedding) {
          throw new Error(`Missing embedding for article ${article.id}`);
        }
        
        return {
          id: article.id,
          title: article.title,
          // content: article.content, // 移除：聚类不需要完整内容，下游工作流通过R2按需获取
          url: article.url,
          embedding: embedding.embedding,
          publishDate: article.publishDate,
          summary: article.summary // 保留摘要信息，可能对ML服务有用
        };
      });

              // 调用ML服务的AI Worker聚类端点
      const mlResponse = await this.aiWorkerClustering(items, {
        config: {
          umap_n_components: options?.umapParams?.n_components || 10,
          umap_n_neighbors: options?.umapParams?.n_neighbors || 15,
          umap_min_dist: options?.umapParams?.min_dist || 0.0,
          umap_metric: options?.umapParams?.metric || 'cosine',
          hdbscan_min_cluster_size: options?.hdbscanParams?.min_cluster_size || 5,
          hdbscan_min_samples: options?.hdbscanParams?.min_samples || 3,
          hdbscan_cluster_selection_epsilon: options?.hdbscanParams?.epsilon || 0.2
          // 质心剪枝已移除(原 postprocess_prune_threshold: 0.92)。
          //
          // 它做的是"甄别故事",而甄别是 story-validation 的职责:剪枝按"成员到簇质心余弦"
          // 一刀切,而质心假设簇是单峰球形——一条主线天然多峰(美伊线=军事威胁+能源价格+
          // 外交进展三个叶团),侧翼被误判成噪声。run 78 实测被它剪掉的含"伊朗谈判代表宣布
          // 战胜美国""北约战机击落俄无人机"这类明显同主线的报道,而 LLM 不会犯这种错。
          //
          // 代价是量级的,不是边际的(run 78, 767 篇,τ=0.94 跨源同事件对构成的 48 个事件):
          //   剪枝前同事件保全 99.6% → 剪枝后 80.3%;损失 100% 来自这一步,HDBSCAN 无过。
          //   事件完整率 39.6% → 93.8%(生产下 10 个事件有 6 个被剪掉部分成员)。
          //   进簇文章 31% → 95%。整个"比利时史上最大野火"事件 7 篇全被剪进噪声而消失。
          //
          // 下游接得住:本地实测 4 个簇(29/31/37/64 篇)6 次真实调用 0 解析失败——
          // 31 篇的多国灾害桶被正确拆成印尼地震/哥伦比亚地震/津巴布韦渡轮/印第安纳洪水/
          // 韩菲暴雨 5 个独立故事;29 篇的簇剔除 9 篇亚太防务杂项后留下 20 篇韩美军演主线。
          //
          // 原 0.92 的标定注释(B-cubed P 0.45→0.83)标的是 mcs5/ms3——2025-06-18 起生产已
          // 换成 mcs3/ms1,阈值与它作用的对象早已不是一对;所用金标亦已归档。
        },
        return_embeddings: false,
        return_reduced_embeddings: false
      });

      if (!mlResponse.ok) {
        const errorText = await mlResponse.text();
        return {
          success: false,
          error: `ML service failed: ${mlResponse.status} - ${errorText}`
        };
      }

      try {
        const mlResult = await mlResponse.json() as {
          clusters: Array<{
            cluster_id: number;
            size: number;
            items: Array<{ id: number; [key: string]: any }>;
          }>;
          config_used?: {
            umap_n_neighbors?: number;
            umap_n_components?: number;
            umap_min_dist?: number;
            umap_metric?: string;
            hdbscan_min_cluster_size?: number;
            hdbscan_min_samples?: number;
            hdbscan_cluster_selection_epsilon?: number;
          };
          clustering_stats?: {
            n_clusters?: number;
            n_outliers?: number;
            n_samples?: number;
          };
        };
        

        
        // 转换ML服务响应为ClusteringResult格式
        const clusters = mlResult.clusters.map((cluster) => ({
          clusterId: cluster.cluster_id,
          articleIds: cluster.items.map((item: any) => item.metadata?.id || item.id),
          size: cluster.size
        }));

        // HDBSCAN 把"不属于任何簇"的点标成 cluster_id = -1，ml 侧照旧把它当一个簇返回。
        // 这一组**继续下传**给故事验证：它不是垃圾堆——2026-08-15 run 里 54 篇噪声中被验证
        // 层认出一条真故事（韩朝会谈），并进了第 59 期简报。删掉它会直接丢新闻。
        // 但它不能算进"簇数"，也必须作为噪声量被看见。
        const noiseCluster = clusters.find(c => c.clusterId === NOISE_CLUSTER_ID);

        const clusteringResult: ClusteringResult = {
          clusters,
          parameters: {
            umapParams: {
              n_neighbors: mlResult.config_used?.umap_n_neighbors || 15,
              n_components: mlResult.config_used?.umap_n_components || 10,
              min_dist: mlResult.config_used?.umap_min_dist || 0.0,
              metric: mlResult.config_used?.umap_metric || "cosine"
            },
            hdbscanParams: {
              min_cluster_size: mlResult.config_used?.hdbscan_min_cluster_size || 5,
              min_samples: mlResult.config_used?.hdbscan_min_samples || 3,
              epsilon: mlResult.config_used?.hdbscan_cluster_selection_epsilon || 0.2
            }
          },
          // totalClusters / noisePoints 从 clusters 自身推导，不再取 ml 侧的旁路统计字段。
          // 2026-08 四次生产 run 实测 clustering_stats.n_outliers 与真实 -1 组系统性差约 8 倍
          // （报 8/9/7/11，实际 71/70/59/54 = 输入的 36-47%）。ml 侧为何不一致尚未定位，
          // 但下游真正消费的是 clusters 数组，指标必须与它同源——否则观测面板显示"聚类几乎
          // 没丢东西"，而实际近一半文章在这一关就出局，没人看得见。
          statistics: {
            totalClusters: clusters.filter(c => c.clusterId !== NOISE_CLUSTER_ID).length,
            noisePoints: noiseCluster?.articleIds.length ?? 0,
            totalArticles: mlResult.clustering_stats?.n_samples || dataset.articles.length
          }
        };

        return {
          success: true,
          data: clusteringResult
        };

      } catch (error) {
        return {
          success: false,
          error: `Failed to parse ML service response: ${error instanceof Error ? error.message : String(error)}`
        };
      }

    } catch (error) {
      return {
        success: false,
        error: `Clustering service error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * AI Worker格式聚类分析
   */
  private async aiWorkerClustering(items: any[], options?: {
    config?: any;
    optimization?: any;
    content_analysis?: any;
    return_embeddings?: boolean;
    return_reduced_embeddings?: boolean;
  }): Promise<Response> {
    const url = new URL(`${this.env.MERIDIAN_ML_SERVICE_URL}/ai-worker/clustering`);
    
    if (options?.return_embeddings !== undefined) {
      url.searchParams.set('return_embeddings', String(options.return_embeddings));
    }
    if (options?.return_reduced_embeddings !== undefined) {
      url.searchParams.set('return_reduced_embeddings', String(options.return_reduced_embeddings));
    }

    const request = new Request(url.toString(), {
      method: 'POST',
      headers: this.buildHeaders({ 'X-API-Token': this.env.MERIDIAN_ML_SERVICE_API_KEY }),
      body: JSON.stringify({
        items,
        config: options?.config,
        optimization: options?.optimization,
        content_analysis: options?.content_analysis
      })
    });

    return await fetch(request);
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<{ success: boolean; error?: string }> {
    try {
      const request = new Request(`${this.env.MERIDIAN_ML_SERVICE_URL}/health`, {
        headers: this.buildHeaders({ 'X-API-Token': this.env.MERIDIAN_ML_SERVICE_API_KEY }),
      });

      const response = await fetch(request);
      
      if (response.ok) {
        return { success: true };
      } else {
        return { 
          success: false, 
          error: `ML service health check failed: ${response.status}` 
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Health check error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

/**
 * 便捷函数：创建聚类服务实例
 */
export function createClusteringService(env: AIWorkerEnv, traceId?: string): ClusteringService {
  return new ClusteringService(env, traceId);
}

/**
 * 便捷函数：直接执行聚类分析
 * 与intelligence-pipeline.test.ts中的MockClusteringService.analyzeClusters接口完全兼容
 * 保持与原ai-services.ts中相同的返回格式（双层嵌套）
 */
export async function analyzeArticleClusters(
  env: AIWorkerEnv,
  dataset: ArticleDataset
): Promise<{ success: boolean; data?: any; error?: string }> {
  const mlService = new MLService(env);
  const response = await mlService.analyzeClusters(dataset);
  return await handleServiceResponse(response, 'Clustering analysis');
}

/**
 * ML服务类 - 为了保持与ai-services.ts的接口兼容性
 * 内部委托给ClusteringService处理聚类相关功能
 */
export class MLService {
  constructor(private env: AIWorkerEnv) {}

  /**
   * 聚类分析 - 兼容intelligence-pipeline.test.ts数据契约
   * 接受ArticleDataset格式，返回Response格式
   */
  async analyzeClusters(dataset: {
    articles: Array<{
      id: number;
      title: string;
      content: string;
      publishDate: string;
      url: string;
      summary: string;
    }>;
    embeddings: Array<{
      articleId: number;
      embedding: number[];
    }>;
  }): Promise<Response> {
    // 验证输入数据
    if (!dataset.articles.length || !dataset.embeddings.length) {
      return new Response(JSON.stringify({
        success: false,
        error: "Dataset is empty"
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 委托给ClusteringService处理
    const clusteringService = new ClusteringService(this.env);
    const result = await clusteringService.analyzeClusters(dataset);
    
    if (result.success) {
      return new Response(JSON.stringify({
        success: true,
        data: result.data
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({
        success: false,
        error: result.error
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * 自动检测聚类分析
   */
  async autoCluster(request: any): Promise<Response> {
    const mlRequest = new Request(`${this.env.MERIDIAN_ML_SERVICE_URL}/clustering/auto`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-API-Token': this.env.MERIDIAN_ML_SERVICE_API_KEY
      },
      body: JSON.stringify(request)
    });

    return await fetch(mlRequest);
  }

  /**
   * 生成嵌入向量
   */
  async generateEmbeddings(texts: string[], options?: {
    model_name?: string;
    normalize?: boolean;
  }): Promise<Response> {
    const request = new Request(`${this.env.MERIDIAN_ML_SERVICE_URL}/embeddings`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-API-Token': this.env.MERIDIAN_ML_SERVICE_API_KEY
      },
      body: JSON.stringify({
        texts,
        model_name: options?.model_name,
        normalize: options?.normalize
      })
    });

    return await fetch(request);
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<Response> {
    const request = new Request(`${this.env.MERIDIAN_ML_SERVICE_URL}/health`, {
      headers: { 
        'X-API-Token': this.env.MERIDIAN_ML_SERVICE_API_KEY
      }
    });

    return await fetch(request);
  }
}

/**
 * 响应处理工具函数 - 用于处理Response对象
 */
export async function handleServiceResponse<T>(
  response: Response,
  context?: string
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `${context || 'Service'} failed: ${response.status} - ${errorText}`
      };
    }

    const data = await response.json() as T;
    return {
      success: true,
      data
    };
  } catch (error) {
    return {
      success: false,
      error: `${context || 'Service'} response parsing failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
} 