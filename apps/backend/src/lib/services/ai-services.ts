/**
 * 轻量级AI服务协调器
 * 专注于服务调用和结果转发，不处理具体实现细节
 *
 * 跨 service 调用的接缝：brief workflow 相关方法（validateStory / analyzeStoryIntelligence /
 * generateEmbedding + generateFinalBrief / generateBriefTldr / faithfulnessCheck）返回
 * ServiceResult<T> —— 把「status 检查 / .json() / .success 检查 / dispose RPC stub」这套仪式
 * 收进模块内，调用方只拿判别式结果并施加自己的错误策略（throw / 跳过 / fail-open）。
 * 注：analyzeArticle / healthCheck 属文章管线 & 健康检查，返回 Response 不变（不在此接缝内）。
 */

// 跨 service 调用的判别式结果：成功给 value(+可选 metadata)，失败给 status+error。
// 各调用方据此施加自己的策略（validateStory throw / intelligence 跳过 / faithfulness fail-open），
// 故此处只报告结果、不代替调用方决定 throw 与否。
export type ServiceResult<T> =
  | { ok: true; value: T; metadata?: any }
  | { ok: false; status: number; error: string };

export interface EmbeddingData {
  embeddings: Array<{ embedding: number[] }>;
  model?: string;
  dimensions?: number;
}
export interface ValidatedStoriesData {
  stories: any[];
  rejectedClusters: any[];
}
export interface FinalBriefData {
  title: string;
  content: string;
  metadata?: any;
}
export interface BriefTldrData {
  tldr: string;
}

interface BriefSummaryData {
  tldrProse: string;
}
// 情报报告 / 忠实度 verdict 载荷形态大且松，保持宽松类型（D 的收益在接缝仪式收敛，
// 非逐字段深类型化——那是另一件事）。
export type IntelligenceReportData = Record<string, any>;
export type FaithfulnessVerdict = Record<string, any>;

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

  // 跨 service 调用的仪式单一真源：发请求 → status 检查 → 解析 {success,data,metadata,error}
  // → dispose RPC stub。成功回 {ok,value:data,metadata}，失败回 {ok:false,status,error}。
  // 失败 error 保留与旧调用点一致的措辞：非 200 = "HTTP <s>: <body>"，success:false = "success:false: <e>"。
  private async callJson<T>(request: Request): Promise<ServiceResult<T>> {
    const response = await this.env.AI_WORKER.fetch(request);
    try {
      if (response.status !== 200) {
        const body = await response.text().catch(() => '<unreadable>');
        return { ok: false, status: response.status, error: `HTTP ${response.status}: ${body.slice(0, 300)}` };
      }
      const data = (await response.json()) as { success?: boolean; data?: T; metadata?: any; error?: string };
      if (!data.success) {
        return { ok: false, status: response.status, error: `success:false: ${data.error}` };
      }
      return { ok: true, value: data.data as T, metadata: data.metadata };
    } finally {
      if (response && typeof (response as any).dispose === 'function') {
        (response as any).dispose();
      }
    }
  }

  /**
   * 生成嵌入向量。
   * 直接调用本地/远端 ML Service (multilingual-e5-small, 384维)，跳过 ai-worker 这层中间转发。
   * 与数据库 schema (vector(384)) 和历史 embedding 的向量空间保持一致。
   */
  async generateEmbedding(text: string | string[]): Promise<ServiceResult<EmbeddingData>> {
    const texts = Array.isArray(text) ? text : [text];
    const mlResp = await fetch(`${this.env.MERIDIAN_ML_SERVICE_URL}/embeddings`, {
      method: 'POST',
      headers: this.buildHeaders({ 'X-API-Token': this.env.MERIDIAN_ML_SERVICE_API_KEY }),
      body: JSON.stringify({ texts, normalize: true }),
    });

    if (!mlResp.ok) {
      const errorText = await mlResp.text().catch(() => '<unreadable>');
      return { ok: false, status: mlResp.status, error: `ML embedding failed: ${mlResp.status} - ${errorText}` };
    }

    const ml = (await mlResp.json()) as {
      embeddings: number[][];
      model_name: string;
      dimensions: number;
    };

    return {
      ok: true,
      value: {
        embeddings: ml.embeddings.map((emb) => ({ embedding: emb })),
        model: ml.model_name,
        dimensions: ml.dimensions,
      },
    };
  }

  /**
   * 分析文章内容（文章管线用，非 brief 接缝——返回 Response 不变）
   */
  async analyzeArticle(title: string, content: string, options?: any, callIndex?: number): Promise<Response> {
    // 观测性：同一 workflow 会并行分析多篇文章，用 call index 避免 R2 LLM 日志 key 互相覆盖。
    const extra: Record<string, string> = {};
    if (typeof callIndex === 'number') extra['x-call-index'] = String(callIndex);
    const request = new Request(`${this.baseUrl}/meridian/article/analyze`, {
      method: 'POST',
      headers: this.buildHeaders(extra),
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
  async validateStory(clusteringResult: any, candidateGroups: any, articlesData: any, options?: any): Promise<ServiceResult<ValidatedStoriesData>> {
    const request = new Request(`${this.baseUrl}/meridian/story/validate`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        clusteringResult,
        // 几何候选组（backend lib/core/candidate-grouping.ts 算好传入）。2026-08-21 起是判定单位。
        candidateGroups,
        articlesData,
        // 不垫 provider/model 默认：由 ai-worker 的 PHASE_DEFAULTS 决定。垫在这里等于
        // 跨 service 开第二个配置真源，换 provider 时会把下游拽回旧 provider。
        options: options?.aiOptions
      })
    });

    return await this.callJson<ValidatedStoriesData>(request);
  }

  /**
   * 分析故事情报 (第二阶段深度分析)
   *
   * @param callIndex 在同一个 workflow 内的调用序号，用于 R2 中 LLM 调用日志的去重 key
   */
  async analyzeStoryIntelligence(story: any, articles: any[], options?: any, callIndex?: number): Promise<ServiceResult<IntelligenceReportData>> {
    const extra: Record<string, string> = {};
    if (typeof callIndex === 'number') extra['x-call-index'] = String(callIndex);
    const request = new Request(`${this.baseUrl}/meridian/intelligence/analyze-single-story`, {
      method: 'POST',
      headers: this.buildHeaders(extra),
      body: JSON.stringify({
        story,
        articleData: articles,
        options: options || { analysis_depth: 'detailed' }
      })
    });

    return await this.callJson<IntelligenceReportData>(request);
  }

  /**
   * 生成最终简报
   */
  async generateFinalBrief(analysisData: any[], previousBrief: any, options?: any): Promise<ServiceResult<FinalBriefData>> {
    const request = new Request(`${this.baseUrl}/meridian/generate-final-brief`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        analysisData,
        previousBrief,
        options // 同上：不垫 provider/model 默认
      })
    });

    return await this.callJson<FinalBriefData>(request);
  }

  /**
   * 生成简报 TLDR
   */
  async generateBriefTldr(briefTitle: string, briefContent: string, options?: any): Promise<ServiceResult<BriefTldrData>> {
    const request = new Request(`${this.baseUrl}/meridian/generate-brief-tldr`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        briefTitle,
        briefContent,
        options // 同上：不垫 provider/model 默认
      })
    });

    return await this.callJson<BriefTldrData>(request);
  }

  /**
   * 生成面向读者的散文摘要（reports.tldr_prose）
   *
   * 与 generateBriefTldr 是两件事：那个产出给次日模型读的机器格式记忆状态，
   * 这个产出读者端展示的 2-3 句导语。
   */
  async generateBriefSummary(briefTitle: string, briefContent: string, options?: any): Promise<ServiceResult<BriefSummaryData>> {
    const request = new Request(`${this.baseUrl}/meridian/generate-brief-summary`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ briefTitle, briefContent, options })
    });

    return await this.callJson<BriefSummaryData>(request);
  }

  /**
   * 忠实度门检查（线上只标记）
   */
  async faithfulnessCheck(sources: any[], brief: string): Promise<ServiceResult<FaithfulnessVerdict>> {
    const request = new Request(`${this.baseUrl}/meridian/faithfulness-check`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ sources, brief })
    });

    return await this.callJson<FaithfulnessVerdict>(request);
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
