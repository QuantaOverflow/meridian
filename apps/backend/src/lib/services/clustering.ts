/**
 * 聚类服务模块：封装与 Meridian ML Service 的聚类分析交互。
 * 只给 ml 侧发 {id, embedding}；正文由下游工作流按需从 R2 取。
 */

import type { AIWorkerEnv } from './ai-services';

/**
 * 噪声标签（不足最小篇数的簇里的文章）。ml 侧把这一组也当普通簇返回，故它会出现在 clusters 里；
 * 判"是不是真簇"必须显式排除它，别再靠 clusters.length。
 */
const NOISE_CLUSTER_ID = -1;

/**
 * ml 侧响应顶层的镜像身份字段名（ml-service `src/main.py` 的 `BUILD_IDENTITY_FIELD` 同名）。
 *
 * 为什么必须有它：`configUsed` 只是 ml 侧把请求方传进去的 config 原样回显
 * （`clustering.py` 的 `config_used`），旧镜像只要还认识字段名就回显一样的值，所以
 * configSent/configUsed 比对永远相等，一次都拦不住"镜像没推成功"。
 * 2026-09-15 至 09-19 连续五天生产跑的是旧聚类算法（NO_EVENT 从 2% 涨到 52-54%，
 * 平均篇数 5.5→9.8），全程 brief_runs.status = COMPLETED。
 */
const ML_BUILD_IDENTITY_FIELD = 'build_identity';

/** ml 侧"没注入"的占位值（与 main.py 的 BUILD_NOT_INJECTED 同值）。 */
const ML_BUILD_NOT_INJECTED = 'not-injected';

/**
 * 期望的 ml 镜像 SHA 从哪读。
 *
 * 注意：`MERIDIAN_ML_EXPECTED_BUILD_SHA` 没在 `apps/backend/wrangler.jsonc` 的 vars
 * 与 `AIWorkerEnv` 里声明，所以这里走一次显式 cast 读。
 * 未配置时断言仍然有效，只是降一档：只能判"字段缺失 / 没注入"，判不了"不是本次部署的镜像"。
 */
function readExpectedBuildSha(env: AIWorkerEnv): string | undefined {
  const raw = (env as unknown as Record<string, unknown>).MERIDIAN_ML_EXPECTED_BUILD_SHA;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

/**
 * 镜像身份断言结果。
 *
 * - `missing`     响应里根本没有 build_identity 字段 → 跑的是加这个字段之前的旧镜像，
 *                 即"镜像没推成功"本身。**这是这道闸唯一必须抓到的东西**，零配置生效。
 * - `not_injected` 有字段但 injected=false（本地 `uv run` 直起服务，镜像里连构建戳都没有），
 *                 或者配了期望 SHA 而 ml 侧只回了构建时刻、没法比对。不等于故障，
 *                 但也不构成"这是本次部署的镜像"的证据。
 * - `mismatch`    有字段、SHA 有效，但与 MERIDIAN_ML_EXPECTED_BUILD_SHA 不符 → 镜像是新的，
 *                 但不是本次部署的那个。
 * - `ok`          有字段且已注入：配了期望 SHA 时表示 SHA 相符；没配时只表示"不是旧镜像"
 *                 （build_sha 可能仍是占位符，构建时刻来自镜像层构建戳）。
 */
type BuildIdentityStatus = 'ok' | 'missing' | 'not_injected' | 'mismatch';

interface BuildIdentityAssertion {
  status: BuildIdentityStatus;
  /** true 仅当 status === 'ok'；调用方可以只看这一位做门禁。 */
  verified: boolean;
  reportedSha?: string;
  reportedBuildTime?: string;
  reportedBuildTimeSource?: string;
  expectedSha?: string;
  /** 人读的判据说明，直接落观测文件用。 */
  detail: string;
}

/**
 * 从 ml 响应顶层解析并断言镜像身份。
 *
 * 关键：**字段缺失必须是一个可判别的状态**，不能 `?? 'unknown'` 吞掉——那等于把这道闸拆了。
 * 这个函数只产出信号；missing / mismatch 由 workflow 并进 degradedReasons 记 DEGRADED。
 */
function assertBuildIdentity(raw: unknown, expectedSha?: string): BuildIdentityAssertion {
  if (raw === undefined || raw === null) {
    return {
      status: 'missing',
      verified: false,
      expectedSha,
      detail:
        `ml 响应缺少顶层 ${ML_BUILD_IDENTITY_FIELD} 字段：运行的是加该字段之前构建的旧镜像` +
        `（镜像未推成功 / 未重建），与请求参数无关——configUsed 在这种情况下仍会正常回显。`,
    };
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      status: 'missing',
      verified: false,
      expectedSha,
      detail: `ml 响应的 ${ML_BUILD_IDENTITY_FIELD} 不是对象（实际 ${typeof raw}）：当作旧镜像/不可信身份处理。`,
    };
  }

  const obj = raw as Record<string, unknown>;
  const sha = typeof obj.build_sha === 'string' ? obj.build_sha : undefined;
  const buildTime = typeof obj.build_time === 'string' ? obj.build_time : undefined;
  const buildTimeSource = typeof obj.build_time_source === 'string' ? obj.build_time_source : undefined;
  const injected = obj.injected === true;
  const shaUsable = !!sha && sha !== ML_BUILD_NOT_INJECTED;

  const base = {
    reportedSha: sha,
    reportedBuildTime: buildTime,
    reportedBuildTimeSource: buildTimeSource,
    expectedSha,
  };

  if (!injected) {
    return {
      ...base,
      status: 'not_injected',
      verified: false,
      detail:
        `ml 侧 ${ML_BUILD_IDENTITY_FIELD}.injected=false：构建标识没注入（本地直起服务，或构建时没带 ` +
        `--build-arg MERIDIAN_ML_BUILD_SHA/TIME）。本次跑的镜像身份不可证。`,
    };
  }

  if (expectedSha && !shaUsable) {
    return {
      ...base,
      status: 'not_injected',
      verified: false,
      detail:
        `已配置期望 SHA (${expectedSha})，但 ml 侧只回了构建时刻（build_sha=${sha ?? 'undefined'}）：` +
        `无法比对镜像身份，构建时请带 --build-arg MERIDIAN_ML_BUILD_SHA。`,
    };
  }

  if (expectedSha && shaUsable && sha !== expectedSha) {
    return {
      ...base,
      status: 'mismatch',
      verified: false,
      detail:
        `ml 镜像 SHA 不符：期望 ${expectedSha}，实际 ${sha}（build_time=${buildTime ?? 'unknown'}）。` +
        `镜像是新的，但不是本次部署的那个。`,
    };
  }

  return {
    ...base,
    status: 'ok',
    verified: true,
    detail: expectedSha
      ? `ml 镜像身份符合期望：${sha}（build_time=${buildTime ?? 'unknown'}）。`
      : `ml 镜像已带构建标识：sha=${sha}，build_time=${buildTime ?? 'unknown'}（来源 ${buildTimeSource ?? 'unknown'}）；` +
        `未配置 MERIDIAN_ML_EXPECTED_BUILD_SHA，故只验到"不是旧镜像"，没验"是本次部署的镜像"。`,
  };
}

export interface ArticleDataset {
  articles: Array<{ id: number }>;
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
  statistics: {
    totalClusters: number;
    noisePoints: number;
    totalArticles: number;
  };
  /**
   * ml 侧回传的 config_used **原样**保留（不挑字段）。
   *
   * 2026-09 教训：这里原本只挑几个字段，漏掉的恰是算法开关。于是生产镜像停在 6-25、
   * 聚类算法换了却没生效，落盘的观测文件里没有任何"实际生效的配置"可对，
   * 三个半月无人发现。
   */
  configUsed?: Record<string, any>;
  /** ml 侧 clustering_stats 原样保留。**只作诊断旁证**，不得替换 statistics（原因见下方注释）。 */
  clusteringStats?: Record<string, any>;
  /**
   * 镜像身份断言结果。**恒有值**（缺字段时 status='missing'），调用方不必判 undefined。
   * 这里只暴露信号，是否把 run 判成 DEGRADED 由 workflow 决定。
   */
  buildIdentityCheck: BuildIdentityAssertion;
}

export interface ClusteringServiceResponse {
  success: boolean;
  data?: ClusteringResult;
  error?: string;
}

/** 聚类服务类 */
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
      /** 凝聚聚类合并阈值,作用在余弦距离 1-cos 上 */
      agglomerativeThreshold?: number;
      agglomerativeLinkage?: string;
      /** 成簇最小篇数,低于此数整簇记为噪声(不进简报) */
      agglomerativeMinClusterSize?: number;
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

      // ml 侧只读 id 与 embedding（多余字段会被忽略），只发这两个
      // 上面已校验每篇都有 embedding
      const items = dataset.articles.map(article => ({
        id: article.id,
        embedding: dataset.embeddings.find(e => e.articleId === article.id)!.embedding,
      }));

              // 调用ML服务的AI Worker聚类端点
      const mlResponse = await this.aiWorkerClustering(items, {
        config: {
          // ?? 而不是 ||:阈值 0 虽不合法,但 || 会把它悄悄换成默认值,
          // 与本仓库「失败不静默降级」的口径冲突,让 ml-service 的 pydantic 去拒绝更好。
          agglomerative_threshold: options?.agglomerativeThreshold ?? 0.1,
          agglomerative_linkage: options?.agglomerativeLinkage ?? 'average',
          agglomerative_min_cluster_size: options?.agglomerativeMinClusterSize ?? 3
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
        }
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
          // 不挑字段：ml 侧回传的是"实际生效的配置"，不能因为类型里没写到就在解析时丢掉。
          config_used?: Record<string, unknown>;
          clustering_stats?: {
            n_clusters?: number;
            n_outliers?: number;
            n_samples?: number;
            [key: string]: unknown;
          };
          /**
           * 镜像身份。**声明成可选是因为旧镜像真的不会回传它**——这正是要抓的信号，
           * 所以下面不允许用 `?? 'unknown'` 之类把缺失抹平（2026-09 教训：解析时挑漏字段，
           * 配置漂了三个半月无人发现；这次连"字段在不在"都是判据）。
           */
          build_identity?: {
            build_sha?: string;
            build_time?: string;
            build_time_source?: string;
            injected?: boolean;
            [key: string]: unknown;
          };
        };
        

        
        // 转换ML服务响应为ClusteringResult格式
        const clusters = mlResult.clusters.map((cluster) => ({
          clusterId: cluster.cluster_id,
          articleIds: cluster.items.map((item: any) => item.id),
          size: cluster.size
        }));

        // ml 侧把"不属于任何簇"的点标成 cluster_id = -1，并把它当一个簇返回。
        // 这一组**继续下传**给故事验证：它不是垃圾堆——2026-08-15 run 里 54 篇噪声中被验证
        // 层认出一条真故事（韩朝会谈），并进了第 59 期简报。删掉它会直接丢新闻。
        // 但它不能算进"簇数"，也必须作为噪声量被看见。
        const noiseCluster = clusters.find(c => c.clusterId === NOISE_CLUSTER_ID);

        const clusteringResult: ClusteringResult = {
          clusters,
          // totalClusters / noisePoints 从 clusters 自身推导，不再取 ml 侧的旁路统计字段。
          // 2026-08（HDBSCAN 时代）四次生产 run 实测 clustering_stats.n_outliers 与真实 -1 组
          // 差约 8 倍；现行凝聚聚类下两者同源（golden 实测 15 = 15），但下游真正消费的是
          // clusters 数组，指标仍与它同源，不依赖 ml 侧旁路统计。
          statistics: {
            totalClusters: clusters.filter(c => c.clusterId !== NOISE_CLUSTER_ID).length,
            noisePoints: noiseCluster?.articleIds.length ?? 0,
            totalArticles: mlResult.clustering_stats?.n_samples || dataset.articles.length
          },
          // 运行身份：ml 侧回传什么就原样带什么，不挑字段。挑字段等于提前替调用方决定
          // "哪些配置值得看"——而这次没生效的恰恰是没被挑中的 clustering_algorithm。
          // clusteringStats 只是诊断旁证（见上），
          // 不能拿来替换 statistics。
          configUsed: mlResult.config_used,
          clusteringStats: mlResult.clustering_stats,
          // 镜像身份：与 configUsed 分开。configUsed 是请求回显（旧镜像也能回显得一模一样），
          // 这个字段的值来自 ml 镜像构建时注入的环境变量，源码里没有字面量。
          buildIdentityCheck: assertBuildIdentity(
            mlResult.build_identity,
            readExpectedBuildSha(this.env)
          )
        };

        if (!clusteringResult.buildIdentityCheck.verified) {
          // 只打日志 + 往上报结构化信号，不在这里改流程：status 归 workflow。
          console.warn(
            `[Clustering] ml 镜像身份未通过断言 status=${clusteringResult.buildIdentityCheck.status} ` +
            `detail=${clusteringResult.buildIdentityCheck.detail}`
          );
        }

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
  }): Promise<Response> {
    const url = new URL(`${this.env.MERIDIAN_ML_SERVICE_URL}/ai-worker/clustering`);

    const request = new Request(url.toString(), {
      method: 'POST',
      headers: this.buildHeaders({ 'X-API-Token': this.env.MERIDIAN_ML_SERVICE_API_KEY }),
      body: JSON.stringify({
        items,
        config: options?.config
      })
    });

    return await fetch(request);
  }
}

/**
 * 便捷函数：创建聚类服务实例
 */
export function createClusteringService(env: AIWorkerEnv, traceId?: string): ClusteringService {
  return new ClusteringService(env, traceId);
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