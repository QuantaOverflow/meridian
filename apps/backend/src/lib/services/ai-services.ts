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
type ServiceResult<T> =
  | { ok: true; value: T; metadata?: any }
  | { ok: false; status: number; error: string };

interface EmbeddingData {
  embeddings: Array<{ embedding: number[] }>;
  model?: string;
  dimensions?: number;
}
interface BriefTldrData {
  tldr: string;
}

interface BriefSummaryData {
  tldrProse: string;
}
/**
 * 简报块 v6 的一块。与 ai-worker `src/services/brief-block-v6.ts` 的 `BriefBlockV6Result`
 * 对齐（跨 package 不能直接 import，这里是镜像；那份 TS 类型是唯一真源）。
 */
export interface BriefBlockV6Sentence {
  text: string;
  sources: Array<{ articleId: number; sentence: number }>;
}
interface BriefBlockV6Data {
  verdict: 'written' | 'not_a_single_event';
  reason?: string;
  block: null | { title: string; sentences: BriefBlockV6Sentence[] };
  /** articleId → 切句表（**整簇原文**，很大）。见 briefBlockV6 上的告警。 */
  sentences: Record<string, string[]>;
  trace: {
    articles: number;
    windows: number;
    anchors: number;
    citationsRepaired: number;
    /** 三次尝试全失败、被跳过的窗口数。>0 意味着这块的材料不完整。 */
    windowFailures: number;
    repetitionRetries: number;
    /** 写作步每次被确定性校验拒收的原因。空数组 = 一次过。 */
    writeRejects: string[];
    llmCalls: number;
    neurons: number;
    model: string;
    windowChars: number;
    /** 这一块实际用的篇幅档（lead/more = exec 档，brief = 1–2 句短档） */
    tier: string;
    [k: string]: any;
  };
}

interface BriefTitleData {
  title: string;
  neurons: number;
}

export interface AIWorkerEnv {
  AI_WORKER: {
    fetch(request: Request): Promise<Response>;
  };
  MERIDIAN_ML_SERVICE_URL: string;
  MERIDIAN_ML_SERVICE_API_KEY: string;
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
  // options 当前被端点忽略（/meridian/article/analyze 只解构 { title, content }）；保留参数与默认值不改动。
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
   * 故事重要性排序：一次请求里跑三轮洗牌 + Borda，返回前 12。
   *
   * **必须对当期全部候选调用，不能只喂选材后的子集**：选材层用的是机械热度分，
   * 2026-09-20 那期实测，最终前 12 里有两条（美批 27 亿乌防空、沙特断供原油）落在
   * 机械 top-25 之外，接在选材后面就永远看不到它们。
   *
   * `articles` 是必填字段，缺了端点回 400。理由见 ai-worker 侧 RankCandidate 的注释。
   *
   * 三轮全败才回 ok:false，**不会**退化成机械序——那会让「排序没生效」和「排序生效了
   * 但结果一样」无法分辨。部分轮次失败时 roundsOk < 3，调用方据此决定信不信。
   */
  async rankStories(
    candidates: Array<{ id: number; title: string; articles: number }>
  ): Promise<
    ServiceResult<{
      picks: Array<{ id: number; eventKey: string; category: string; why: string; borda: number; timesSelected: number }>;
      nearMisses: Array<{ id: number; why: string; times: number }>;
      rounds: Array<{ round: number; ok: boolean; error?: string; selectedIds: number[]; duplicates: number; outOfRange: number; eventKeyDupes: number; retried: boolean }>;
      roundsOk: number;
      intersectionSize: number;
    }>
  > {
    const request = new Request(`${this.baseUrl}/meridian/stories/rank`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ candidates }),
    });
    return await this.callJson(request);
  }

  /**
   * 簇判定：一个聚类簇 = 简报里的一条。一次调用同时判「是不是一件事」与起名。
   *
   * 失败（含解析失败）回 ok:false，**不会**伪装成 NO_EVENT——调用方据此走退化路径
   * （整簇保留成一块），而不是把一条真新闻毙掉。
   */
  async judgeCluster(
    articles: Array<{ id: number; title: string }>,
    callIndex?: number
  ): Promise<ServiceResult<{ verdict: 'EVENT' | 'NO_EVENT' | 'UNSURE'; title: string; event: string; reason: string }>> {
    const extra: Record<string, string> = {};
    if (typeof callIndex === 'number') extra['x-call-index'] = String(callIndex);
    const request = new Request(`${this.baseUrl}/meridian/cluster/judge`, {
      method: 'POST',
      headers: this.buildHeaders(extra),
      body: JSON.stringify({ articles }),
    });
    return await this.callJson<{ verdict: 'EVENT' | 'NO_EVENT' | 'UNSURE'; title: string; event: string; reason: string }>(request);
  }

  /**
   * 简报块 v6：一个簇的原文 → 一块逐句带出处的高管简报（报告层 + 写作层合成一步）。
   * 请求体与 /meridian/report-v3 逐字同构（多一个 tier），故同一份材料可直接复用。
   *
   * `tier` 决定篇幅：'lead' = 5–7 句，'more' = 3–5 句，'brief' = 一句。
   * 句数由 ai-worker 侧写作 schema 的 `sentences.maxItems` 硬约束，字数只写在 prompt 里
   * 不强制（2026-09-21 实测：句数一个不差，字数三档全超标，故不拿字数当判据）。
   * 因此分层必须发生在调用之前。
   *
   * ⚠️ 响应里的 `sentences`（切句表）是**整簇原文**，一个大簇几千句。调用方拿到后只能就地用，
   * **不许**把它放进 CF Workflow 的 step 返回值（单 step 输出约 1MB 上限）。
   *
   * @param callIndex 故事序号，进 x-call-index 让同一 trace 下的 R2 观测记录不互相覆盖
   */
  async briefBlockV6(
    title: string,
    articles: Array<{ id: number; title: string; url?: string; publishDate?: string; content: string }>,
    tier: 'lead' | 'more' | 'brief',
    callIndex?: number
  ): Promise<ServiceResult<BriefBlockV6Data>> {
    const request = new Request(`${this.baseUrl}/meridian/brief-block-v6`, {
      method: 'POST',
      headers: this.buildHeaders(callIndex != null ? { 'x-call-index': String(callIndex) } : undefined),
      body: JSON.stringify({ title, articles, tier, skipCache: true }),
    });

    return await this.callJson<BriefBlockV6Data>(request);
  }

  /** v3 步骤 3：给整篇简报起标题（v3 的拼装在 backend 用代码做，只剩这一次调用）。 */
  async briefTitle(content: string): Promise<ServiceResult<BriefTitleData>> {
    const request = new Request(`${this.baseUrl}/meridian/brief-title`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ content }),
    });

    return await this.callJson<BriefTitleData>(request);
  }

  /**
   * 生成简报 TLDR
   */
  async generateBriefTldr(briefTitle: string, briefContent: string): Promise<ServiceResult<BriefTldrData>> {
    const request = new Request(`${this.baseUrl}/meridian/generate-brief-tldr`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        briefTitle,
        briefContent
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
  async generateBriefSummary(briefTitle: string, briefContent: string): Promise<ServiceResult<BriefSummaryData>> {
    const request = new Request(`${this.baseUrl}/meridian/generate-brief-summary`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ briefTitle, briefContent })
    });

    return await this.callJson<BriefSummaryData>(request);
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
