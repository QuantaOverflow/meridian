# 聚类 Gold 数据底座构建工作流

> 这把"语义参考划分(gold)"是聚类质量评估(B-cubed)的标准答案。本文记**怎么可靠地造它**。
> "为什么这样分工"见 [eval-design-principles.md](./eval-design-principles.md) 模式 A；
> harness 代码在 `scripts/eval/clustering/`。

## 核心问题:LLM 产 gold 不确定

直接让 qwen 分一次组当 gold 不行——**同一批文章跨重产剧烈抖动(实测 13~49 组)**。
根因是 LLM 非确定性(temp=0 也不保证,batch-invariance,云 API 控不了)。
所以不能"产一次就信",必须**多采样 + consensus 聚合 + 人工兜底 + 冻结**。

## 工作流(8 步)

每步防一个具体的坑:

```
① 源头过滤    Neon 按天 + category='news'(滤掉 HN 技术单篇)
② 取详情      backend /admin/articles/by-ids → title + event_summary_points
③ raw 固化    并行 N 次 qwen-long 分组 → 缓存 raw-{key}.json(贵且抖,只产一次)
④ consensus   co-association 矩阵 + average-linkage 凝聚聚类,切 tau=0.75(确定性)
⑤ 后处理      全局去重 + 剔幻觉id + 近重复标题强制并组 + 剔 <2 篇组(确定性)
⑥ calibration 人工 audit → 双向修订:drop / add / merge(按锚 id 鲁棒)
⑦ recall 审计 recall-audit.ts 从 raw 低共识对挖召回池(pooling)补漏 + 全量人工分组捞盲区
⑧ freeze      --freeze 锁死 frozen:true(无视 refresh/tau/prompt 变动)
最终打分:B-cubed(score.ts,纯集合运算,零 LLM)对照任意聚类输出
```

每步防什么:①防技术单篇污染 ③防 LLM 非确定性 ④防 single-linkage 桥接 ⑤防脏数据
⑥防 LLM 残留离群/漏分 ⑦防召回盲区 ⑧防抖动覆盖。

## 文件布局(`eval-reports/clustering/`)

按"源 vs 派生"分,**只有源需要人产/保存,派生随时可重算**:

| 文件 | 角色 | 说明 |
|---|---|---|
| `raw-{key}.json` | **源**(贵) | N 次 qwen 原始分组 + `{model, hash}`。改 tau/calibration **不**重产它 |
| `calibration-{key}.json` | **源**(人工) | drop/add/merge 修订列表,按 id 鲁棒 |
| `reference-{key}.json` | **派生** | 最终冻结 gold。可从 raw+calibration 随时重算 |

`key` 约定 = `news-YYYY-MM-DD`(按天)或 `admin-brief-{workflowId}`(按 run)。

## 关键算法点(踩过的坑)

- **大样本必须 `--model qwen-long`**:qwen-max 输入上限 ~30k token,357 篇直接 400 InternalError。
- **prompt 只列 ≥2 篇的组**,单篇省略 → 代码自动当单例。否则输出 JSON 撑爆 8k token 上限被截断。
- **consensus 必须 average-linkage,不能 single-linkage/连通分量**:后者一条桥边就把
  Ebola+Iran+BlueOrigin 焊成 31 篇 grab-bag。average-linkage 看"簇间平均共现",抗桥接。
- **co-association 同一次运行内一对只计一次**:否则 qwen 同 run 重复输出 id 会让 freq>1.0,
  average-linkage 过度合并。(这是已修的 bug,见 reference.ts:105)
- **坏运行污染 consensus**:某次 qwen 抽风产 136 组会拉低共识,靠加 N(N=5) + 提 tau 缓解。

## calibration 双向修订格式

```jsonc
{
  "key": "news-2026-06-01",
  "drop": [58487],                              // 剔组尾离群 → 强制单例
  "add":  [{ "into": 56970, "ids": [58197] }],  // 并入锚组(锚=该组某稳定成员 id)
  "merge":[[58306, 58547]]                      // 两个单例成新组(漏故事)
}
```

- **drop** 治"错分"(组内混入无关篇)。
- **add / merge** 治"漏分/漏故事"。**必须双向**:只有 drop 会出 06-01 那种副作用——
  剔离群时只看"它不该跟谁",漏看"它该跟谁"(57585 被 drop 却没注意真同伴 58548 也在单例)。
- 锚用**稳定 id**而非组序号(组序号会随重产变)。

## recall 审计:把"未知的漏"变成"可判的清单"

recall 的鸡生蛋难题:你没法直接数你不知道漏了什么。两个来源逼近:

1. **召回池(pooling,recall-audit.ts)**:consensus 用 tau=0.75 砍掉了"2/5、3/5 次共现但没达阈值"
   的对——这些正是 qwen 部分认为该合、被丢弃的**漏分候选**,纯算 co-association 就有,不花 LLM。
   分三类输出:漏并(单例该进组)/ 漏故事(两单例该成组)/ 组内可疑离群。
2. **全量人工分组**:逐篇细读当独立第二标注者。能捞出**召回池盲区**——qwen 5 次全没共现(freq=0)
   或只 1 次(<下界)的真合并,pooling 探不到。06-01 就靠这个捞出"埃塞俄比亚大选""Board of Peace
   资金"两个漏故事(召回池完全看不见)。

## 常用命令

```bash
# tsx(离线时借 story-validation 已装好的 binary)
TSX=scripts/eval/story-validation/node_modules/.bin/tsx

# 产某天 gold(N=5,qwen-long,产出即冻结)
$TSX scripts/eval/clustering/build-gold-by-day.ts \
  --key news-2026-06-01 --ids "56970,57381,..." --model qwen-long --runs 5 --freeze

# audit 列组人工核查 / recall 审计挖漏
$TSX scripts/eval/clustering/audit.ts        --key news-2026-06-01
$TSX scripts/eval/clustering/recall-audit.ts --key news-2026-06-01

# B-cubed 打分(对照聚类快照)
$TSX scripts/eval/clustering/score.ts <workflowId> --model qwen-long
```

### 重产已冻结的某天(改了 calibration 后)

冻结后 reference 会短路直接返回。要应用新 calibration:**删掉派生的 reference 文件**
(raw + calibration 才是源),再带 `--freeze` 重跑——会**复用 raw 缓存(零 LLM 调用)**、
重算 consensus、应用 calibration、重新冻结。前提:ids 集与 raw 一致(promptHash 才命中)。

```bash
rm eval-reports/clustering/reference-news-2026-06-01.json
$TSX scripts/eval/clustering/build-gold-by-day.ts --key news-2026-06-01 --ids "..." --model qwen-long --freeze
```

## 当前底座状态(2026-06-01)

| 日期 | 组 | 成组率 | calibration | 校准程度 |
|---|---|---|---|---|
| 05-29 | 16 | 32% | drop8 | 仅剔错分 |
| 05-30 | 14 | 40% | drop3 | 仅剔错分 |
| 05-31 | 13 | 37% | drop1(**N=4**) | 仅剔错分 |
| 06-01 | 8 | 39% | drop1 add3 merge3 | **剔+补+全量人工** |

## 质量结论(诚实)

**对标业界优秀实践**:"固化 raw + consensus 抗非确定性 + 确定性指标 + 人工兜底 + 冻结版本化"
是数据集构建的标准范式,consensus clustering 应对 LLM 抖动是教科书做法。骨架对。

**能确定的**:precision 高(无 grab-bag、组内纯)、一致性/稳定性好(0.85–0.99)、n=4 不再过拟合。

**仍是缺口**:
1. **校准不一致**:只有 06-01 走完整循环(补漏+全量人工);05-29/30/31 只剔错分,recall 未量化,
   且可能藏着同类召回池盲区漏故事。
2. **N 不统一**:05-31 是 N=4(一次失败),其余 N=5。
3. **无真·独立人工 ground-truth**:audit/全量分组都是 Claude 做的,本质仍是 LLM 第二意见,
   不是第三方人工 + inter-annotator agreement。
4. **尺子还没被用**:在这 4 天干净 gold 上的 HDBSCAN B-cubed 一次都没算(缺"重聚类"——对纯新闻
   文章离线跑 ml-service UMAP+HDBSCAN 得 predicted)。现有 P=0.092 是含 HN 旧样本的旧数。

**一句话**:工作流清晰、方法对标业界、precision/稳定性可信;用于**粗判过度合并**够格,
要当**精调基准**还差:3 天补漏对齐 + 重聚类拿干净 B-cubed + 一点真人工锚定。

---

## 聚类质量评估发现 (2026-06-02)

上面"缺口"里的 1(校准不一致)和 4(尺子没用)已补齐:**4 天 + 跨天层全部 recall 审计补漏**,
并搭出 prod 规模的重聚类评估,拿到了第一个干净结论。

### 新增工具
- `tier2-xday.ts` — 两层 consensus 的第二层:把每个 per-day 故事抽象成摘要 item,再跑一次
  consensus 产出跨天合并组。**解决 qwen-long 在 634 篇一次性分组会触发 8k 输出截断的问题**
  (单巨调用 5 次只活 1 次且退化;两层把每层输入压到模型装得下)。
- `build-pooled-gold.ts` — per-day gold 并集 + 应用跨天合并组 → 合池 gold(确定性,零 LLM)。
- `recluster.ts` — 对 gold 同一批文章用存储 embedding 跑 ml-service UMAP+HDBSCAN 得 predicted,
  与 gold 算 B-cubed。`--emb-key` 可换嵌入缓存做模型 A/B;config 全可覆盖。
- `tune.ts` — 2 天窗口 × 参数网格扫参,跨窗口对 B-cubed 取平均(抗单窗口噪声)。

### 合池基线(634 篇 = 4 天纯新闻,prod 规模)
全量 B-cubed:**P≈0.40 / R≈0.93**。HDBSCAN 看似"中度过度合并"。

### 但全量 B-cubed P 对**高单例新闻流**是误导性指标(关键洞察)
逐项排查,**所有后端旋钮都撼不动 P~0.45**:嵌入模型强弱(text-embedding-v4 MTEB榜首 vs
e5-small,都 ~0.41-0.45)、e5 前缀、喂什么文本、HDBSCAN min_cluster_size/min_samples/epsilon、
UMAP n_components —— 全部无效或微调(封顶 ~0.46)。

**precision 损失分解**:74% 来自 **gold 单例被吸进簇**,仅 26% 来自真事件互相合并。
根因:这个新闻流 **59% 是一次性单例**(gold 单例),HDBSCAN 没把它们当噪声留住,而是凑成
"杂物簇"或掺进真簇;每个被聚的单例精度≈0(它的故事就它自己),又是多数 → 把全量平均 P 摁到 0.45。
**这是高单例流 + B-cubed 重罚单例聚集的度量假象,不是聚类缺陷。**

### 改用故事级指标(只在多篇 gold 故事上算)→ 真相是生产级
| 指标 | 值 | 衡量 |
|---|---|---|
| 全量 B-cubed P(含单例) | 0.475 | 被单例拖累 |
| 真故事 P(分母只算其他真故事) | **0.859** | 真事件互不污染 → 生产级(业界 0.82-0.90) |
| 真故事 recall(故事聚齐率) | **0.953** | 真事件不被拆散 |

**真·多篇事件聚得很好(0.86/0.95)。** 真事件之间的污染(那 26%)有规律——**语义相邻的不同事件
被合并**(如所有俄乌战争消息揉成一超级簇;肯尼亚校火+缅甸爆炸+达拉斯气爆按"爆炸"事件类型混一起),
这是嵌入的本质局限(主题相似 ≠ 事件同一),连最强嵌入也分不开,但属少数。

### 结论与建议
1. **别迁移嵌入模型**:v4(最强)实测 P 不优于 e5-small,迁移到 bge-m3/v4 不会改善(已 A/B 验证)。
2. **别追全量 B-cubed P=0.8**:对高单例流是错的优化目标。**该盯"故事级 P/R"**(只在多篇故事上算),
   我们已达标。把这个作为聚类质量的主指标。
3. **杂物簇(单例被凑成簇)若影响简报,在下游治**:story-validation 拒掉 / 加簇内一致性过滤,
   不靠改聚类。
4. **可顺手的微调**:`min_cluster_size=5, min_samples=5`(全量 P 0.40→0.46,免费),非必须。

> 评估方法论沉淀:**对单例占比高的语料,全量 B-cubed/聚类指标会被"该独处的项被聚集"主导,失真。
> 应把指标限定在"有标准答案的成组项"上(故事级),才对齐业务语义(简报只关心真事件聚得对不对)。**
> 见 [eval-design-principles.md](./eval-design-principles.md) 第四原则。
