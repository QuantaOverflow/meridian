/**
 * ML 服务（services/meridian-ml-service：e5-small embedding + 余弦凝聚聚类）的唯一客户端。
 * backend 直连 ml-service（不经 ai-worker）；URL、X-API-Token、x-trace-id 只在 post() 里拼。
 * 两个方法都返回 ServiceResult<T>（与 ai-services 同形），调用方施加自己的错误策略。
 *
 * 聚类只给 ml 侧发 {id, embedding}；正文由下游工作流按需从 R2 取。
 */

import { BRIEF_CLUSTERING_OPTIONS } from '../core/constants';
import type { ServiceResult } from './ai-services';

export interface MLServiceEnv {
  MERIDIAN_ML_SERVICE_URL: string;
  MERIDIAN_ML_SERVICE_API_KEY: string;
}

interface EmbeddingData {
  embeddings: Array<{ embedding: number[] }>;
}

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

/**
 * 镜像身份断言结果。
 *
 * - `missing`      响应里根本没有 build_identity 字段 → 跑的是加这个字段之前的旧镜像，
 *                  即"镜像没推成功"本身。**这是这道闸唯一必须抓到的东西**，零配置生效。
 * - `not_injected` 有字段但 injected=false：本地 `uv run` 直起服务，镜像里没有构建戳。不等于故障。
 * - `ok`           有字段且带构建戳：只表示"不是旧镜像"。"是不是本次部署的镜像"由部署时的
 *                  `scripts/check-container-deploy.sh` 核对（运行时的期望 SHA 比对 2026-09-25 删除：
 *                  两边都没配过，且与部署时那道检查重叠）。
 */
type BuildIdentityStatus = 'ok' | 'missing' | 'not_injected';

interface BuildIdentityAssertion {
  status: BuildIdentityStatus;
  /** true 仅当 status === 'ok'；调用方可以只看这一位做门禁。 */
  verified: boolean;
  reportedBuildTime?: string;
  /** 人读的判据说明，直接落观测文件用。 */
  detail: string;
}

/**
 * 从 ml 响应顶层解析并断言镜像身份。
 *
 * 关键：**字段缺失必须是一个可判别的状态**，不能 `?? 'unknown'` 吞掉——那等于把这道闸拆了。
 * 这个函数只产出信号；missing 由 workflow 并进 degradedReasons 记 DEGRADED。
 */
function assertBuildIdentity(raw: unknown): BuildIdentityAssertion {
  if (raw === undefined || raw === null) {
    return {
      status: 'missing',
      verified: false,
      detail:
        `ml 响应缺少顶层 ${ML_BUILD_IDENTITY_FIELD} 字段：运行的是加该字段之前构建的旧镜像` +
        `（镜像未推成功 / 未重建），与请求参数无关——configUsed 在这种情况下仍会正常回显。`,
    };
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      status: 'missing',
      verified: false,
      detail: `ml 响应的 ${ML_BUILD_IDENTITY_FIELD} 不是对象（实际 ${typeof raw}）：当作旧镜像/不可信身份处理。`,
    };
  }

  const obj = raw as Record<string, unknown>;
  const buildTime = typeof obj.build_time === 'string' ? obj.build_time : undefined;
  if (obj.injected !== true) {
    return {
      status: 'not_injected',
      verified: false,
      reportedBuildTime: buildTime,
      detail: `ml 侧 ${ML_BUILD_IDENTITY_FIELD}.injected=false：镜像里没有构建戳（本地直起服务）。本次跑的镜像身份不可证。`,
    };
  }

  return {
    status: 'ok',
    verified: true,
    reportedBuildTime: buildTime,
    detail: `ml 镜像已带构建戳：build_time=${buildTime ?? 'unknown'}（只验到"不是旧镜像"）。`,
  };
}

interface ArticleDataset {
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

/** ML 服务客户端 */
class MLService {
  constructor(private env: MLServiceEnv, private traceId?: string) {}

  // 传输只写这一处：POST JSON，带 X-API-Token，自动注入 x-trace-id 以贯通跨 service 日志
  private async post(path: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Token': this.env.MERIDIAN_ML_SERVICE_API_KEY,
    };
    if (this.traceId) headers['x-trace-id'] = this.traceId;
    return await fetch(`${this.env.MERIDIAN_ML_SERVICE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  /**
   * 生成嵌入向量。
   * 直接调用本地/远端 ML Service (multilingual-e5-small, 384维)，跳过 ai-worker 这层中间转发。
   * 与数据库 schema (vector(384)) 和历史 embedding 的向量空间保持一致。
   */
  async generateEmbedding(text: string | string[]): Promise<ServiceResult<EmbeddingData>> {
    const texts = Array.isArray(text) ? text : [text];
    const mlResp = await this.post('/embeddings', { texts });

    if (!mlResp.ok) {
      const errorText = await mlResp.text().catch(() => '<unreadable>');
      return { ok: false, status: mlResp.status, error: `ML embedding failed: ${mlResp.status} - ${errorText}` };
    }

    const ml = (await mlResp.json()) as { embeddings: number[][] };

    return {
      ok: true,
      value: {
        embeddings: ml.embeddings.map((emb) => ({ embedding: emb })),
      },
    };
  }

  /**
   * 执行聚类分析
   * 
   * @param dataset 文章数据集，包含文章信息和嵌入向量
   * @param options 可选的聚类配置参数；缺的字段取 BRIEF_CLUSTERING_OPTIONS
   * @returns 聚类分析结果。失败的 status：HTTP 失败 = ml 侧状态码，本地校验失败 / 调用抛异常 = 0
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
  ): Promise<ServiceResult<ClusteringResult>> {
    try {
      // 验证输入数据
      if (!dataset.articles.length || !dataset.embeddings.length) {
        return {
          ok: false,
          status: 0,
          error: "Dataset is empty"
        };
      }

      // 验证文章和嵌入向量的对应关系
      const articleIds = new Set(dataset.articles.map(a => a.id));
      const embeddingIds = new Set(dataset.embeddings.map(e => e.articleId));
      
      if (articleIds.size !== embeddingIds.size) {
        return {
          ok: false,
          status: 0,
          error: "Mismatch between articles and embeddings count"
        };
      }

      for (const articleId of articleIds) {
        if (!embeddingIds.has(articleId)) {
          return {
            ok: false,
            status: 0,
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
      const mlResponse = await this.post('/ai-worker/clustering', {
        items,
        config: {
          // ?? 而不是 ||:阈值 0 虽不合法,但 || 会把它悄悄换成默认值,
          // 与本仓库「失败不静默降级」的口径冲突,让 ml-service 的 pydantic 去拒绝更好。
          // 兜底取 BRIEF_CLUSTERING_OPTIONS（backend 唯一一份默认值），三个参数总是显式发给 ml 侧。
          agglomerative_threshold: options?.agglomerativeThreshold ?? BRIEF_CLUSTERING_OPTIONS.agglomerativeThreshold,
          agglomerative_linkage: options?.agglomerativeLinkage ?? BRIEF_CLUSTERING_OPTIONS.agglomerativeLinkage,
          agglomerative_min_cluster_size: options?.agglomerativeMinClusterSize ?? BRIEF_CLUSTERING_OPTIONS.agglomerativeMinClusterSize
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
          ok: false,
          status: mlResponse.status,
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
            build_time?: string;
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
        // 这一组留在 clusters 里原样交给 workflow，但**不进簇判定、不进简报**：簇判定显式跳过
        // clusterId < 0（auto-brief-generation.ts），文章去向表把这些文章记为 noise。
        // （旧注释说它「继续下传给故事验证」——那是故事验证层时代的行为，该层已退役。）
        // 它不能算进"簇数"，也必须作为噪声量被看见。
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
          buildIdentityCheck: assertBuildIdentity(mlResult.build_identity)
        };

        if (!clusteringResult.buildIdentityCheck.verified) {
          // 只打日志 + 往上报结构化信号，不在这里改流程：status 归 workflow。
          console.warn(
            `[Clustering] ml 镜像身份未通过断言 status=${clusteringResult.buildIdentityCheck.status} ` +
            `detail=${clusteringResult.buildIdentityCheck.detail}`
          );
        }

        return {
          ok: true,
          value: clusteringResult
        };

      } catch (error) {
        return {
          ok: false,
          status: mlResponse.status,
          error: `Failed to parse ML service response: ${error instanceof Error ? error.message : String(error)}`
        };
      }

    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: `Clustering service error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

/**
 * 创建 ML 服务客户端
 * @param traceId 可选；传入后请求自动带 x-trace-id header，用于跨 service 日志关联
 */
export function createMLService(env: MLServiceEnv, traceId?: string): MLService {
  return new MLService(env, traceId);
}
