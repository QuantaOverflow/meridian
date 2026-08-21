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

// API 响应常量
export const API_CONSTANTS = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  MIN_PAGE_SIZE: 1,
} as const;

// 文章处理常量
export const ARTICLE_PROCESSING = {
  CONTENT_MIN_LENGTH: 100,
  TITLE_MIN_LENGTH: 5,
  DEFAULT_TIMEOUT: 30000,
} as const;

// 简报聚类参数。
// 单一真源:admin 手动触发与 cron 自动触发必须用同一组,否则两条路径产出不可比。
// 注意:auto-brief-generation 里"未传 clusteringOptions"不是走这组值,而是走按数据规模的
// 启发式分支(150 篇时 min_cluster_size 会算到 15),所以调用方必须显式传,不能省略。
export const BRIEF_CLUSTERING_OPTIONS = {
  umapParams: {
    n_neighbors: 15,
    n_components: 5,
    min_dist: 0.1,
    metric: 'cosine',
  },
  hdbscanParams: {
    // mcs/ms 经 2026-08-18 扫描确认现值即最优,不动:eps=0.35 下 mcs3 覆盖 95% vs mcs4 93%
    // (事件完整率同为 93.8%);ms=1 同事件保全 97.0% 优于 ms3 的 96.2%、ms5 的 90.7%。
    min_cluster_size: 3,
    min_samples: 1,
    // 0.5 → 0.35。0.5 把 43% 的文章粘成一个 332 篇巨团,一次 story-validation 调用吃不下,
    // 且它让质心失准、把剪枝放大成屠杀(见 clustering.ts 剪枝移除说明)。
    // 上限卡在 0.40 而非簇大小:0.40 会把「美伊战争」与「特朗普国内杂闻」并成一个 87 篇簇
    // ——两堆共享 Trump 这个强实体,模型于是有现成伞状标签可用,把 78/87 篇兜进一个
    // "Trump administration: Domestic policy, economy, and political fallout",十来件独立
    // 事件压成一段、只占 top-15 一个名额且无法拆回。同批 98 篇的簇(无共同实体)反而正常
    // ——所以约束是"别合并共享强实体的两条主线",不是"别让簇太大"。0.35 下两者分属独立簇。
    // 0.25-0.38 是一段 96-98% 同事件保全的宽平台(0.42 后掉崖),取 0.35 兼顾调用数(64 簇)。
    epsilon: 0.35,
  },
} as const;

// 簇内候选分组阈值(全链余弦)。story-validation 的判定单位由「整簇」改为「几何候选组」后引入,
// 见 lib/core/candidate-grouping.ts 的算法说明。
//
// 0.90 来自 2026-08-20/21 两天独立数据的扫描 + 人工严口径(scripts/eval/story-validation/rubric.md)复验:
//   0.85(原型初值,随手定) 严精度 58-60%,配复核后 85-87%,前15精度 33-53%
//   0.87                  严精度 70%
//   0.90                  严精度 76-84%,配复核后 89-92%,**前15精度两天都是 93.3%**
//   0.91 起掉崖:一次丢 4 个人工确认的真事件(4 篇的 Face the Nation 当期综述、3 篇的官员回应等)
// 上限卡在 0.90 的理由是「0.91 开始丢真事件」,不是「组太大」——0.90 下组中位 2 篇、最大 16 篇。
export const CANDIDATE_GROUP_THRESHOLD = 0.9;

// 每日定时简报参数。取值来自 2026-08-13 生产实测(report 54/55,端到端 664-897 秒)。
export const CRON_BRIEF_PARAMS = {
  TIME_RANGE_DAYS: 2, // 覆盖前一天全天,与 1 天窗口相比留出抓取延迟的冗余
  // 取数是「窗口内按 publish_date 倒序取前 N 篇」,所以 N 太小会把时间窗**截短**:
  // 150 时 2 天窗口实际只覆盖 21.1 小时(08-15 run 实测:窗口内 327 篇合格,只取最新 149 篇,
  // 178 篇从未被看过)。而多源印证要求同一事件的两篇都落在切片内,切片越窄越配不成对
  // ——embedding 实测有 13/149 篇「切片内无同事件伙伴、切片外有」。
  //
  // 上限从哪来:跨 step 的只有轻量 articles(embeddings 已卸 R2),实测 263 字节/篇(最大 394),
  // 加 JSON 键名开销约 400 字节/篇 → CF Workflow 单 step ~1MB 对应约 2500 篇。
  // 取值 1500(=600KB,占硬上限 60%):新增 4 源后预估进稿约 600 篇/天,2 天窗口约 1200 篇,
  // 1000 会重新把窗口截短。不取 2000 是因为 2500 这个天花板是估算值,而越界的后果是
  // WorkflowInternalError 硬失败(见 CLAUDE.md 已知坑),不值得为余量赌 80% 占用。
  ARTICLE_LIMIT: 1500,
  MIN_IMPORTANCE: 3,
  MAX_STORIES_TO_GENERATE: 15,
  STORY_MIN_IMPORTANCE: 0.1,
  // 判定"上一次还在跑"的时间窗。单次实测 11-15 分钟,取 2 小时;
  // 超出此窗的 RUNNING 视为崩溃遗留(workflow 挂掉时不会回写终态),否则 cron 会被永久卡死。
  IN_FLIGHT_WINDOW_HOURS: 2,
} as const;