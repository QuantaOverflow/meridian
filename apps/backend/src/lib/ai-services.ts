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