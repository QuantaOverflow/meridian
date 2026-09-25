/**
 * 轻量级AI服务协调器
 * 专注于服务调用和结果转发，不处理具体实现细节
 *
 * 跨 service 调用的接缝：全部方法（analyzeArticle / rankStories / judgeCluster /
 * briefBlockV6 / briefTitle / generateBriefSummary）返回
 * ServiceResult<T> —— 把「status 检查 / .json() / .success 检查 / dispose RPC stub」这套仪式
 * 收进模块内，调用方只拿判别式结果并施加自己的错误策略（throw / 跳过 / fail-open）。
 * 请求/响应数据类型在 @meridian/contracts（与 ai-worker 共用一份）。
 * ML 服务（embedding / 聚类）不经 ai-worker，客户端在 ./ml-service.ts。
 */

import type {
  ArticleAnalysis,
  ArticleAnalyzeRequest,
  BriefBlockV6Request,
  BriefBlockV6Result,
  BriefSummaryRequest,
  BriefSummaryResult,
  BriefTier,
  BriefTitleRequest,
  BriefTitleResult,
  ClusterJudgeRequest,
  ClusterJudgeResult,
  JudgeArticle,
  RankCandidate,
  StoryRankRequest,
  StoryRankResult,
} from '@meridian/contracts';

// 跨 service 调用的判别式结果：成功给 value，失败给 status+error。
// 各调用方据此施加自己的策略（validateStory throw / intelligence 跳过 / faithfulness fail-open），
// 故此处只报告结果、不代替调用方决定 throw 与否。
export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

interface AIWorkerEnv {
  AI_WORKER: {
    fetch(request: Request): Promise<Response>;
  };
}

// AI Worker服务协调器
class AIWorkerService {
  private readonly baseUrl = 'https://meridian-ai-worker';

  constructor(private env: AIWorkerEnv, private traceId?: string) {}

  // 统一构建 outbound headers，自动注入 x-trace-id 以贯通跨 service 日志
  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...(extra || {}) };
    if (this.traceId) h['x-trace-id'] = this.traceId;
    return h;
  }

  // 跨 service 调用的仪式单一真源：发请求 → status 检查 → 解析 {success,data,error}
  // → dispose RPC stub。成功回 {ok,value:data}，失败回 {ok:false,status,error}。
  // 失败 error 保留与旧调用点一致的措辞：非 200 = "HTTP <s>: <body>"，success:false = "success:false: <e>"。
  private async callJson<T>(request: Request): Promise<ServiceResult<T>> {
    const response = await this.env.AI_WORKER.fetch(request);
    try {
      if (response.status !== 200) {
        const body = await response.text().catch(() => '<unreadable>');
        return { ok: false, status: response.status, error: `HTTP ${response.status}: ${body.slice(0, 300)}` };
      }
      const data = (await response.json()) as { success?: boolean; data?: T; error?: string };
      if (!data.success) {
        return { ok: false, status: response.status, error: `success:false: ${data.error}` };
      }
      return { ok: true, value: data.data as T };
    } finally {
      if (response && typeof (response as any).dispose === 'function') {
        (response as any).dispose();
      }
    }
  }

  /**
   * 分析文章内容（文章管线用）
   */
  async analyzeArticle(title: string, content: string, callIndex?: number): Promise<ServiceResult<ArticleAnalysis>> {
    // 观测性：同一 workflow 会并行分析多篇文章，用 call index 避免 R2 LLM 日志 key 互相覆盖。
    const extra: Record<string, string> = {};
    if (typeof callIndex === 'number') extra['x-call-index'] = String(callIndex);
    const request = new Request(`${this.baseUrl}/meridian/article/analyze`, {
      method: 'POST',
      headers: this.buildHeaders(extra),
      body: JSON.stringify({ title, content } satisfies ArticleAnalyzeRequest)
    });

    return await this.callJson<ArticleAnalysis>(request);
  }

  /**
   * 故事重要性排序：一次请求里跑三轮洗牌 + Borda，返回前 12。
   *
   * **必须对当期全部候选调用，不能只喂选材后的子集**：选材层用的是机械热度分，
   * 2026-09-20 那期实测，最终前 12 里有两条（美批 27 亿乌防空、沙特断供原油）落在
   * 机械 top-25 之外，接在选材后面就永远看不到它们。
   *
   * `articles` 是必填字段，缺了端点回 400。理由见 @meridian/contracts 的 RankCandidate 注释。
   *
   * 三轮全败才回 ok:false，**不会**退化成机械序——那会让「排序没生效」和「排序生效了
   * 但结果一样」无法分辨。部分轮次失败时 roundsOk < 3，调用方据此决定信不信。
   */
  async rankStories(candidates: RankCandidate[]): Promise<ServiceResult<StoryRankResult>> {
    const body: StoryRankRequest = { candidates };
    const request = new Request(`${this.baseUrl}/meridian/stories/rank`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
    return await this.callJson<StoryRankResult>(request);
  }

  /**
   * 簇判定：一个聚类簇 = 简报里的一条。一次调用同时判「是不是一件事」与起名。
   *
   * 失败（含解析失败）回 ok:false，**不会**伪装成 NO_EVENT——调用方据此走退化路径
   * （整簇保留成一块），而不是把一条真新闻毙掉。
   */
  async judgeCluster(articles: JudgeArticle[], callIndex?: number): Promise<ServiceResult<ClusterJudgeResult>> {
    const extra: Record<string, string> = {};
    if (typeof callIndex === 'number') extra['x-call-index'] = String(callIndex);
    const request = new Request(`${this.baseUrl}/meridian/cluster/judge`, {
      method: 'POST',
      headers: this.buildHeaders(extra),
      body: JSON.stringify({ articles } satisfies ClusterJudgeRequest),
    });
    return await this.callJson<ClusterJudgeResult>(request);
  }

  /**
   * 简报块 v6：一个簇的原文 → 一块逐句带出处的高管简报（报告层 + 写作层合成一步）。
   *
   * `tier` 决定篇幅：'lead' = 5–7 句，'more' = 3–5 句，'brief' = 一句。
   * 句数由 ai-worker 侧写作 schema 的 `sentences.maxItems` 硬约束，字数只写在 prompt 里
   * 不强制（2026-09-21 实测：句数一个不差，字数三档全超标，故不拿字数当判据）。
   * 因此分层必须发生在调用之前。
   *
   * @param callIndex 故事序号，进 x-call-index 让同一 trace 下的 R2 观测记录不互相覆盖
   */
  async briefBlockV6(
    articles: BriefBlockV6Request['articles'],
    tier: BriefTier,
    callIndex?: number
  ): Promise<ServiceResult<BriefBlockV6Result>> {
    const request = new Request(`${this.baseUrl}/meridian/brief-block-v6`, {
      method: 'POST',
      headers: this.buildHeaders(callIndex != null ? { 'x-call-index': String(callIndex) } : undefined),
      body: JSON.stringify({ articles, tier } satisfies BriefBlockV6Request),
    });

    return await this.callJson<BriefBlockV6Result>(request);
  }

  /** v3 步骤 3：给整篇简报起标题（v3 的拼装在 backend 用代码做，只剩这一次调用）。 */
  async briefTitle(content: string): Promise<ServiceResult<BriefTitleResult>> {
    const request = new Request(`${this.baseUrl}/meridian/brief-title`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ content } satisfies BriefTitleRequest),
    });

    return await this.callJson<BriefTitleResult>(request);
  }

  /**
   * 生成面向读者的散文摘要（reports.tldr_prose）：读者端展示的 2-3 句导语。
   */
  async generateBriefSummary(briefTitle: string, briefContent: string): Promise<ServiceResult<BriefSummaryResult>> {
    const request = new Request(`${this.baseUrl}/meridian/generate-brief-summary`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ briefTitle, briefContent } satisfies BriefSummaryRequest)
    });

    return await this.callJson<BriefSummaryResult>(request);
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
