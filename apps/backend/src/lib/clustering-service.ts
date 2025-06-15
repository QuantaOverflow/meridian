/**
 * 聚类服务模块
 * 封装与Meridian ML Service的聚类分析交互
 * 提供符合intelligence-pipeline.test.ts数据契约的接口
 */

import type { AIWorkerEnv } from './ai-services';

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
  constructor(private env: AIWorkerEnv) {}

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
      const items = dataset.articles.map(article => {
        const embedding = dataset.embeddings.find(e => e.articleId === article.id);
        if (!embedding) {
          throw new Error(`Missing embedding for article ${article.id}`);
        }
        
        return {
          id: article.id,
          title: article.title,
          content: article.content,
          url: article.url,
          embedding: embedding.embedding,
          publishDate: article.publishDate
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
        const clusteringResult: ClusteringResult = {
          clusters: mlResult.clusters.map((cluster) => ({
            clusterId: cluster.cluster_id,
            articleIds: cluster.items.map((item) => item.id),
            size: cluster.size
          })),
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
          statistics: {
            totalClusters: mlResult.clustering_stats?.n_clusters || 0,
            noisePoints: mlResult.clustering_stats?.n_outliers || 0,
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
      headers: { 
        'Content-Type': 'application/json',
        'X-API-Token': this.env.MERIDIAN_ML_SERVICE_API_KEY
      },
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
        headers: { 
          'X-API-Token': this.env.MERIDIAN_ML_SERVICE_API_KEY
        }
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
export function createClusteringService(env: AIWorkerEnv): ClusteringService {
  return new ClusteringService(env);
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