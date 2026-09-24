/**
 * 核心常量定义
 * 统一管理项目中的常量值
 */

// 用户代理字符串配置
export const userAgents = [
  // iOS (发布商的黄金标准)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', // iPhone Safari (最佳整体表现)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.87 Mobile/15E148 Safari/604.1', // iPhone Chrome

  // Android (良好的替代方案)
  'Mozilla/5.0 (Linux; Android 14; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36', // Samsung 旗舰机
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36', // Pixel
];

// 数据库配置常量
export const DATABASE_CONFIG = {
  MAX_CONNECTIONS: 5,
  FETCH_TYPES: false,
} as const;

// 简报聚类参数。
// 单一真源:admin 手动触发与 cron 自动触发必须用同一组,否则两条路径产出不可比。
// auto-brief-generation 未收到 clusteringOptions 时也回落到这组值。
export const BRIEF_CLUSTERING_OPTIONS = {
  // 2026-09-05:UMAP+HDBSCAN → 不降维 + 余弦阈值凝聚(average linkage)。
  //
  // 读数不在这里存:这里存过一份三个多月没人核对、与 ADR 实测对不上的读数表,是本身
  // 就会过期的陷阱。现场跑 eval/clustering/product-score.ts 拿读数,权威口径
  // 与两窗金标结果见 docs/adr/0003-cluster-as-brief-block.md。
  //
  // umapParams/hdbscanParams 保留:算法开关切回 'umap_hdbscan' 时它们仍是生效参数(回滚路径)。
  clusteringAlgorithm: 'agglomerative_cosine',
  agglomerativeThreshold: 0.1,
  agglomerativeLinkage: 'average',
  // 3 而不是 2:2 篇的簇本来就进不了简报(选择层取前 25,两窗实测前 25 名里 2 篇的簇一个没有
  // ——第 25 名 blockScore 3.40/3.48,而 2 篇 2 源只有 2.38)。砍掉它们不损失会被读到的内容,
  // 却带走了大部分题材袋:F2 32→5 个、F1 15→0 个。详见 ml-service clustering.py 的注释。
  agglomerativeMinClusterSize: 3,
  umapParams: {
    n_neighbors: 15,
    n_components: 5,
    min_dist: 0.1,
    metric: 'cosine',
  },
  hdbscanParams: {
    min_cluster_size: 3,
    min_samples: 1,
    epsilon: 0.35,
  },
} as const;

// 每日定时简报参数。取值来自 2026-08-13 生产实测(report 54/55,端到端 664-897 秒)。
export const CRON_BRIEF_PARAMS = {
  // 2 → 1(2026-09-22,用户拍板)。旧值 2 的理由是「覆盖前一天全天,比 1 天窗口多留出抓取
  // 延迟的冗余」,那条理由仍然成立——**这次是明知代价地收窄**,两处变薄记在这里:
  //  · 抓取延迟的冗余没了:发布时间落在窗口外、抓取时间落在窗口内的文章会漏掉
  //  · 多源印证更容易配不成对:同一事件的两篇要都落进切片才算多源,切片越窄越难
  //    (2 天窗时 embedding 实测已有 13/149 篇「切片内无同事件伙伴、切片外有」,1 天窗更多)
  // 收窄的收益是每期只看真正的新新闻,不再把前一天已进过简报的文章重新过一遍。
  TIME_RANGE_DAYS: 1,
  // 取数是「窗口内按 publish_date 倒序取前 N 篇」,所以 N 太小会把时间窗**截短**:
  // 150 时 2 天窗口实际只覆盖 21.1 小时(08-15 run 实测:窗口内 327 篇合格,只取最新 149 篇,
  // 178 篇从未被看过)。
  //
  // 上限从哪来:跨 step 的只有轻量 articles(embeddings 已卸 R2),实测 263 字节/篇(最大 394),
  // 加 JSON 键名开销约 400 字节/篇 → CF Workflow 单 step ~1MB 对应约 2500 篇。
  //
  // 1500 → 1000(2026-09-22,随窗口收窄)。旧注释里「1000 会重新把窗口截短」那句是按
  // **2 天窗**算的(预估 600 篇/天 × 2 天 ≈ 1200 > 1000);窗口改 1 天后约 600 篇/天,
  // 1000 有约 1.7 倍余量,不会截短。若某天进稿量翻倍到 1000 以上,窗口会重新被截短——
  // 判别信号是取数 step 的 `⚠️ 取数取满上限` 警告(auto-brief-generation.ts,取满即报),
  // 出现就该调回。写这条注释时先写成「日志里 N 篇与 M 篇两数不等」,而那行日志并不存在,
  // 于是把信号补成了代码。
  ARTICLE_LIMIT: 1000,
  MIN_IMPORTANCE: 3,
  // 15 → 25(2026-08-22)。旧值卡住的是**召回**不是成本:08-20 全天 154 个候选故事里约 137 个
  // 是真事件,15 的帽子把约 123 个真故事挡在简报外,损失量级压过管线其余所有环节之和。
  // 名次段实测(人工严口径):1-15 精度 93%/imp 中位 7,16-20 100%/6,21-25 100%/6,
  // 26-30 100%/5,31 名后 imp 掉到 4 以下——内容价值的悬崖在 30 名附近,不在 15。
  // 上限按阅读预算定:08-21 新架构实测 1334 字符/条,25 条约 3.3 万字符 ≈ 5500 词。
  // 成本:情报分析每故事一次 LLM,并发 6 下 15 条约 3 分钟,25 条约 5 分钟(该步预算 30 分钟)。
  // 不撞 CF Workflow 单 step ~1MB 上限:情报报告已卸 R2、step 只回传 key(见 auto-brief-generation.ts)。
  MAX_STORIES_TO_GENERATE: 25,
  STORY_MIN_IMPORTANCE: 0.1,
  // 判定"上一次还在跑"的时间窗。单次实测 11-15 分钟,取 2 小时;
  // 超出此窗的 RUNNING 视为崩溃遗留(workflow 挂掉时不会回写终态),否则 cron 会被永久卡死。
  IN_FLIGHT_WINDOW_HOURS: 2,
} as const;