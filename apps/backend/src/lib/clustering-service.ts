/**
 * 聚类服务模块
 * 封装与Meridian ML Service的聚类分析交互
 * 提供符合intelligence-pipeline.test.ts数据契约的接口
 */

import { createAIServices, handleServiceResponse, type AIWorkerEnv } from './ai-services';

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

      // 使用MLService进行聚类分析
      const mlService = createAIServices(this.env).mlService;
      const response = await mlService.analyzeClusters(dataset);
      
      return await handleServiceResponse<ClusteringResult>(response, 'Clustering analysis');

    } catch (error) {
      return {
        success: false,
        error: `Clustering service error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<{ success: boolean; error?: string }> {
    try {
      const mlService = createAIServices(this.env).mlService;
      const response = await mlService.healthCheck();
      
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
 */
export async function analyzeArticleClusters(
  env: AIWorkerEnv,
  dataset: ArticleDataset
): Promise<ClusteringServiceResponse> {
  const service = new ClusteringService(env);
  return await service.analyzeClusters(dataset);
} 