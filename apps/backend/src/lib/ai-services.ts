/**
 * 轻量级AI服务协调器
 * 专注于服务调用和结果转发，不处理具体实现细节
 */

export interface AIWorkerEnv {
  AI_WORKER: {
    fetch(request: Request): Promise<Response>;
  };
  MERIDIAN_ML_SERVICE_URL: string;
  MERIDIAN_ML_SERVICE_API_KEY: string;
}

// AI Worker服务协调器
export class AIWorkerService {
  private readonly baseUrl = 'https://meridian-ai-worker';
  
  constructor(private env: AIWorkerEnv) {}

  /**
   * 生成嵌入向量
   */
  async generateEmbedding(text: string | string[]): Promise<Response> {
    const request = new Request(`${this.baseUrl}/meridian/embeddings/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        options: {
          provider: 'workers-ai',
          model: '@cf/baai/bge-small-en-v1.5'
        }
      })
    });

    return await this.env.AI_WORKER.fetch(request);
  }

  /**
   * 分析文章内容
   */
  async analyzeArticle(title: string, content: string, options?: any): Promise<Response> {
    const request = new Request(`${this.baseUrl}/meridian/article/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        content,
        options: options || {
          provider: 'google-ai-studio',
          model: 'gemini-2.0-flash'
        }
      })
    });

    return await this.env.AI_WORKER.fetch(request);
  }

  /**
   * 验证故事 (第一阶段LLM分析)
   */
  async validateStory(cluster: any, options?: any): Promise<Response> {
    const request = new Request(`${this.baseUrl}/meridian/story/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cluster,
        options: options || {
          provider: 'google-ai-studio',
          model: 'gemini-2.0-flash'
        }
      })
    });

    return await this.env.AI_WORKER.fetch(request);
  }

  /**
   * 分析故事情报 (第二阶段深度分析)
   */
  async analyzeStoryIntelligence(story: any, cluster: any, options?: any): Promise<Response> {
    const request = new Request(`${this.baseUrl}/meridian/intelligence/analyze-story`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        story,
        cluster,
        options: options || { analysis_depth: 'detailed' }
      })
    });

    return await this.env.AI_WORKER.fetch(request);
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<Response> {
    const request = new Request(`${this.baseUrl}/health`);
    return await this.env.AI_WORKER.fetch(request);
  }
}

// ML服务协调器
export class MLService {
  constructor(private env: AIWorkerEnv) {}

  /**
   * 聚类分析 - 兼容intelligence-pipeline.test.ts数据契约
   * 接受ArticleDataset格式，返回ClusteringResult格式
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
        umap_n_components: 10,
        umap_n_neighbors: 15,
        umap_min_dist: 0.0,
        umap_metric: 'cosine',
        hdbscan_min_cluster_size: 5,
        hdbscan_min_samples: 3,
        hdbscan_cluster_selection_epsilon: 0.2
      },
      return_embeddings: false,
      return_reduced_embeddings: false
    });

    if (!mlResponse.ok) {
      return mlResponse; // 直接返回错误响应
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
      
      // 转换ML服务响应为intelligence-pipeline.test.ts期望的格式
      const clusteringResult = {
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

      return new Response(JSON.stringify({
        success: true,
        data: clusteringResult
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: `Failed to parse ML service response: ${error instanceof Error ? error.message : String(error)}`
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * AI Worker格式聚类分析
   */
  async aiWorkerClustering(items: any[], options?: {
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
 * 创建AI服务实例的工厂函数
 */
export function createAIServices(env: AIWorkerEnv) {
  return {
    aiWorker: new AIWorkerService(env),
    mlService: new MLService(env)
  };
}

/**
 * 响应处理工具函数
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

/**
 * 聚类分析便捷函数 - 兼容intelligence-pipeline.test.ts数据契约
 * 
 * @param env 环境配置
 * @param dataset ArticleDataset格式的输入数据
 * @returns Promise<{ success: boolean; data?: ClusteringResult; error?: string }>
 */
export async function analyzeArticleClusters(
  env: AIWorkerEnv,
  dataset: {
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
): Promise<{ success: boolean; data?: any; error?: string }> {
  const mlService = new MLService(env);
  const response = await mlService.analyzeClusters(dataset);
  return await handleServiceResponse(response, 'Clustering analysis');
} 