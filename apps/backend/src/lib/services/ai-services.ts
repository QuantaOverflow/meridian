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
/** b′ 骨架：因果主线章节 + 独立事态。`i` 是 1 基的 story 序号（与 reportKeys 下标差 1）。 */
export interface BriefSkeletonData {
  main: Array<{ heading: string; causalLink: string; reports: Array<{ i: number; title: string }> }>;
  isolated: Array<{ i: number; title: string }>;
  /** 规划完全没提到、由 ai-worker 侧代码补进独立事态的 story 序号。非空即说明规划步不完整。 */
  repaired: number[];
}

/** 一个写好的简报块。`verified:false` = 这块没经过 RARR 核验，不是"核过且干净"。 */
export interface BriefBlockData {
  index: number;
  title: string;
  text: string;
  verified: boolean;
  edits: number;
  applied: number;
  skipped: number;
  blocked: Record<'noop' | 'bad_delete' | 'graft' | 'bloat', number>;
}

/** 报告层 v3：一个簇的原文 → 带出处的事实 / 当事方 / 分歧。report 形状见 ai-worker utils/report-v3.ts。 */
export interface ReportV3Data {
  report: Record<string, any>;
  trace: {
    facts: number;
    skeleton: number;
    parties: number;
    conflicts: number;
    llmCalls: number;
    /** 这一簇全部 LLM 调用的 neurons 合计，成本对账读它 */
    neurons: number;
    [k: string]: any;
  };
}

/** 写作层 v3 的一块。marks 是代码检查器的标记：**只进内部观测与管理页，不给读者看**。 */
export interface BlockV3Data {
  text: string;
  marks: Array<{ sentence: string; reasons: Array<Record<string, any>> }>;
  trace: {
    points: number;
    relations: number;
    llmCalls: number;
    neurons: number;
    marks: { sentences: number; checked: number; abstained: number; marked: number };
    [k: string]: any;
  };
}

/**
 * 简报块 v6 的一块。与 ai-worker `src/services/brief-block-v6.ts` 的 `BriefBlockV6Result`
 * 对齐（跨 package 不能直接 import，这里是镜像；那份 TS 类型是唯一真源）。
 */
export interface BriefBlockV6Sentence {
  text: string;
  sources: Array<{ articleId: number; sentence: number }>;
}
export interface BriefBlockV6Data {
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

export interface BriefTitleData {
  title: string;
  neurons: number;
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
   * 去重层：确认两条 story 是不是同一个发生 + 给合并后的故事起标题。
   * 两条一组时 ai-worker 会做确认；≥3 条只起标题（组的成立由上游多条边支撑）。
   */
  async checkStoryMerge(
    candidates: Array<{ title: string; articleTitles: string[] }>,
    callIndex?: number
  ): Promise<ServiceResult<{ same_occurrence: boolean; title: string; reason: string }>> {
    // 观测性：一次 workflow 有 10+ 个合并组，不带序号则 R2 日志 key 恒为 story_merge-000.json，
    // 只留得下最后一组。这一层的判决（两条是不是同一个发生）恰恰是最需要人工回看的。
    const extra: Record<string, string> = {};
    if (typeof callIndex === 'number') extra['x-call-index'] = String(callIndex);
    const request = new Request(`${this.baseUrl}/meridian/story/merge-check`, {
      method: 'POST',
      headers: this.buildHeaders(extra),
      body: JSON.stringify({ candidates }),
    });
    return await this.callJson<{ same_occurrence: boolean; title: string; reason: string }>(request);
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
   * b′ 步骤 1：规划简报骨架（因果主线章节 + 块标题）。
   *
   * 三个 b′ 端点都只收 `reportKeys`：情报报告全文已卸在 R2，ai-worker 自己读回。
   * 不内联传是因为 RARR 校验必须看全量源，逐块内联 = 每份简报把 ~158KB 的报告
   * 在 service binding 上搬 25 遍。
   */
  async planBriefSkeleton(reportKeys: string[]): Promise<ServiceResult<BriefSkeletonData>> {
    const request = new Request(`${this.baseUrl}/meridian/plan-brief-skeleton`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ reportKeys })
    });

    return await this.callJson<BriefSkeletonData>(request);
  }

  /**
   * b′ 步骤 2：写一个简报块（写作 + RARR 接地校验 + 四条确定性守卫）。
   * 由 workflow 侧 fan-out 成 N 个 step —— 不能挤在一个 step 里跑（CF 约 2% invocation
   * 会被平台 canceled，一次抖动丢整期简报）。
   *
   * @param index 0 基，这个块对应 reportKeys 里的第几份
   */
  async writeBriefBlock(
    reportKeys: string[],
    index: number,
    title: string,
    section?: { heading: string; causalLink: string; siblingTitles: string[] },
    /**
     * 该块簇内文章的正文引用（`{id, key}`，key 就是 $articles.contentFileKey）。
     * 传了 ai-worker 才走证据链（声明判断→检索→写→自检找漏→检索→重写）；不传是此前行为。
     * 传引用不传正文：81 篇的簇正文约 30 万字符，会撞 CF Workflow 单 step 约 1MB 输出上限。
     */
    articleKeys?: Array<{ id: number; key: string }>,
    /**
     * 这条 story 原本有多少篇文章。**必须单独传**：articleKeys 是过滤掉没有
     * contentFileKey 的之后剩下的，ai-worker 拿不到原始篇数，span 里就分不清
     * 「材料本来就少」和「材料在路上丢了」。
     */
    articlesExpected?: number
  ): Promise<ServiceResult<BriefBlockData>> {
    const request = new Request(`${this.baseUrl}/meridian/write-brief-block`, {
      method: 'POST',
      headers: this.buildHeaders({ 'x-call-index': String(index) }),
      body: JSON.stringify({ reportKeys, index, title, section, articleKeys, articlesExpected })
    });

    return await this.callJson<BriefBlockData>(request);
  }

  /**
   * v3 步骤 1：一个簇的原文 → report-v3。正文必须内联传（ai-worker 侧要逐句切、逐批抽取），
   * 由 workflow 侧 fan-out 成 N 个 step。产出由调用方卸 R2，step 只回 key。
   *
   * @param callIndex 故事序号，进 x-call-index 让同一 trace 下的 R2 观测记录不互相覆盖
   */
  async buildReportV3(
    title: string,
    articles: Array<{ id: number; title: string; url?: string; publishDate?: string; content: string }>,
    callIndex?: number
  ): Promise<ServiceResult<ReportV3Data>> {
    const request = new Request(`${this.baseUrl}/meridian/report-v3`, {
      method: 'POST',
      headers: this.buildHeaders(callIndex != null ? { 'x-call-index': String(callIndex) } : undefined),
      body: JSON.stringify({ title, articles, skipCache: true }),
    });

    return await this.callJson<ReportV3Data>(request);
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

  /**
   * v3 步骤 2：一份 report-v3 → 一块正文（写 + 接地 + 代码检查器标记）。
   * 报告内联传：它是上一步的产物，backend 从 R2 读回后直接转发，ai-worker 不再读一次 R2。
   */
  async writeBlockV3(
    report: unknown,
    tier: 'lead' | 'more' | 'brief',
    callIndex?: number
  ): Promise<ServiceResult<BlockV3Data>> {
    const request = new Request(`${this.baseUrl}/meridian/write-block-v3`, {
      method: 'POST',
      headers: this.buildHeaders(callIndex != null ? { 'x-call-index': String(callIndex) } : undefined),
      body: JSON.stringify({ report, tier, skipCache: true }),
    });

    return await this.callJson<BlockV3Data>(request);
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
   * b′ 步骤 3：拼装成品简报（结构零 LLM，唯一调用是起整篇标题）+ 跑传感器。
   */
  async assembleBrief(
    reportKeys: string[],
    skeleton: BriefSkeletonData,
    blocks: Array<{ index: number; title: string; text: string }>
  ): Promise<ServiceResult<FinalBriefData>> {
    const request = new Request(`${this.baseUrl}/meridian/assemble-brief`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ reportKeys, skeleton, blocks })
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
