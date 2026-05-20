/**
 * 轻量级AI服务协调器
 * 专注于服务调用和结果转发，不处理具体实现细节
 * 
 * 注意：调用者需要确保在使用完返回的Response后调用 dispose() 方法释放RPC stub
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

  constructor(private env: AIWorkerEnv, private traceId?: string) {}

  // 统一构建 outbound headers，自动注入 x-trace-id 以贯通跨 service 日志
  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...(extra || {}) };
    if (this.traceId) h['x-trace-id'] = this.traceId;
    return h;
  }

  /**
   * 生成嵌入向量。
   * 直接调用本地/远端 ML Service (multilingual-e5-small, 384维)，跳过 ai-worker 这层中间转发。
   * 与数据库 schema (vector(384)) 和历史 embedding 的向量空间保持一致。
   * 返回结构包装成调用方期望的 {success, data: {embeddings: [{embedding}]}} 形式。
   */
  async generateEmbedding(text: string | string[]): Promise<Response> {
    const texts = Array.isArray(text) ? text : [text];
    const mlResp = await fetch(`${this.env.MERIDIAN_ML_SERVICE_URL}/embeddings`, {
      method: 'POST',
      headers: this.buildHeaders({ 'X-API-Token': this.env.MERIDIAN_ML_SERVICE_API_KEY }),
      body: JSON.stringify({ texts, normalize: true }),
    });

    if (!mlResp.ok) {
      const errorText = await mlResp.text();
      return new Response(
        JSON.stringify({
          success: false,
          error: `ML embedding failed: ${mlResp.status} - ${errorText}`,
        }),
        { status: mlResp.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const ml = (await mlResp.json()) as {
      embeddings: number[][];
      model_name: string;
      dimensions: number;
    };

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          embeddings: ml.embeddings.map((emb) => ({ embedding: emb })),
          model: ml.model_name,
          dimensions: ml.dimensions,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * 分析文章内容
   */
  async analyzeArticle(title: string, content: string, options?: any): Promise<Response> {
    const request = new Request(`${this.baseUrl}/meridian/article/analyze`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        title,
        content,
        options: options || {
          provider: 'workers-ai',
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
        }
      })
    });

    return await this.env.AI_WORKER.fetch(request);
  }

  /**
   * 验证故事 (第一阶段LLM分析) - 符合新数据契约
   */
  async validateStory(clusteringResult: any, articlesData: any, options?: any): Promise<Response> {
    const request = new Request(`${this.baseUrl}/meridian/story/validate`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        clusteringResult,
        articlesData,
        useAI: options?.useAI ?? true,
        options: options?.aiOptions || {
          provider: 'dashscope',
          model: 'qwen-plus'
        }
      })
    });

    return await this.env.AI_WORKER.fetch(request);
  }

  /**
   * 分析故事情报 (第二阶段深度分析)
   *
   * @param callIndex 在同一个 workflow 内的调用序号，用于 R2 中 LLM 调用日志的去重 key
   */
  async analyzeStoryIntelligence(story: any, cluster: any, options?: any, callIndex?: number): Promise<Response> {
    const extra: Record<string, string> = {};
    if (typeof callIndex === 'number') extra['x-call-index'] = String(callIndex);
    const request = new Request(`${this.baseUrl}/meridian/intelligence/analyze-single-story`, {
      method: 'POST',
      headers: this.buildHeaders(extra),
      body: JSON.stringify({
        story,
        articleData: cluster.articles,
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



/**
 * 创建AI服务实例的工厂函数
 * @param traceId 可选；传入后所有 outbound 请求自动带 x-trace-id header，用于跨 service 日志关联
 */
export function createAIServices(env: AIWorkerEnv, traceId?: string) {
  return {
    aiWorker: new AIWorkerService(env, traceId)
  };
}



 