# cluster-to-brief —— 「聚类后 → 简报正文」这段的原型探索 harness

给**异向原型并行探索**用的固定输入与自动判据。目标不是"把正文写得更漂亮",而是:

> 给定纯度 0.80、题材袋率 10–18% 的真实簇,怎么产出好简报。

## 为什么判据只看输入和输出

召回率、票数、候选纯度这类读数**全是架构绑定的**,异向原型之间没法比。只有「给定同一批簇原文,
产出的成稿好不好」是跨架构的。所以:

- **输入** = 该簇全量文章(原文 + 发表时间 + 来源),固定不变
- **输出** = markdown 正文 + **每句的出处**
- 中间怎么走(拆几步、传什么表示、调几次模型)完全不管

这也是 `block-writer/scratch/rubric.ts` 的既有设计意图 —— 它的注释写着「覆盖率的基准**从原文
独立抽**,不拿情报报告当基准:拿报告当基准只能量到写作段丢了多少,量不到抽取段丢了多少,
**而且是循环论证**」。

## 快开始

```bash
# 1. 取 fixture(一次即可,296 篇全量正文;已有则跳过)
node fetch-fixtures.mjs

# 2. 原型把每簇的输出写成 <armDir>/c<clusterId>.json(契约见下)

# 3. 快档验收 —— 零 LLM、秒级
node verify.mjs --arm=out/arm-a                  # dev 五簇
node verify.mjs --arm=out/arm-a --split=heldout  # heldout 两簇,只在最后跑
node verify.mjs --arm=out/arm-a --cluster=36     # 单簇
```

**退出码**(实测三态):

| 码 | 含义 |
|---|---|
| 0 | 全部簇通过 |
| 1 | 有簇不合格 —— 逐项原因会打出来,并落 `out/verify-<arm>-<split>.json` |
| 2 | 环境/数据问题(缺 fixture、缺输出、schema 不合规)—— 先修环境,不是质量问题 |

⚠️ 读退出码时**别用管道**。`node verify.mjs ... | tail` 拿到的是 `tail` 的状态,不是 verifier 的。

## 输出契约

每簇一个文件 `<armDir>/c<clusterId>.json`:

```json
{
  "cluster": 36,
  "verdict": "written",
  "blocks": [
    {
      "title": "...",
      "sentences": [
        { "text": "...", "sources": [ { "articleId": 1009385, "sentence": 12 } ] }
      ]
    }
  ]
}
```

判定这个簇「不是一件事」时:

```json
{ "cluster": 43, "verdict": "not_a_single_event", "reason": "...", "blocks": [] }
```

**出处是强制的**,三项判据里两项靠它。它对内部架构不构成任何限制——拆几步、传什么表示都能标出处。

`sources[].sentence` 是 **1-based**,编号来自 `lib.mjs` 的 `splitSentences`。原型必须用同一个函数
(`import { loadCluster } from './lib.mjs'` 拿到的 `articles[].sentences` 就是它切的),否则编号
对不上。该函数与生产 `utils/report-v3.ts` **逐句一致,296/296 篇实测零差异** —— 改它之前先读那边。

## 快档判什么

| 项 | 判据 | 成本 |
|---|---|---|
| schema | verdict 合法;written 时 blocks 非空;not_a_single_event 时 reason 必填 | 零 |
| 出处可解析 | 每句至少一个出处,且 `articleId` 在簇内、`sentence` 不越界 | 零 |
| 杂质率 | 引了 `expectations.json` 里 `impurities` 的句子占比 | 零 |
| 二元判据 | 题材袋/多数派错位簇必须拆 ≥N 块或判不可写 | 零 |
| 数字有无出处 | 句中非日期数字是否出现在所引原句里 —— **只报读数,不设门** | 零 |

**覆盖率与事实正确性不在快档**,它们要 LLM(慢档,见下)。所以快档全绿 ≠ 质量合格,
它只说明"没有杂质、出处能对上、该拆的拆了"。

## 七个 fixture 簇

来源:`cron-brief-1789477249362`(2026-09-15 生产运行,report 94)。
簇成员取自 R2 冻结的聚类结果,**不是 `brief_stories.article_ids`** —— 后者被
`pickSpreadArticles` 等距取样到 30 篇,`china` 因此丢了 86/116 篇(74%)。

| 簇 | 篇数 | 形态 | split | 期望行为 |
|---|---:|---|---|---|
| `space force` 7 | 6 | 唯一零杂质的单一事件 | dev | 写成一块 |
| `sweden` 1 | 20 | 低杂质(4/20) | dev | 写成一块,剔掉科索沃/韩国/日本 |
| `us airman` 28 | 16 | 低杂质(2/16) | heldout | 写成一块 |
| `houthi` 36 | 82 | **被污染(19/82)** | dev | 写成一块,剔掉委内瑞拉/尼日尔/巴拿马 |
| `cambodia` 37 | 17 | 多数派错位(仅 4 篇柬泰) | dev | **拆 ≥2 块 或 判不可写** |
| `israel` 43 | 39 | 题材袋(8 篇与以色列无关) | dev | **拆 ≥2 块 或 判不可写** |
| `china` 51 | 116 | **超级袋(48 篇杂质)** | heldout | **拆 ≥3 块 或 判不可写** |

每簇的合格标准、判据理由、以及「不合格长什么样」(全部引 2026-09-15 成稿里真实发生的失败)
见 `FIXTURES.md` 与 `expectations.json`。

### dev / heldout 不许混用

> **2026-09-18:heldout 两簇(28 `us airman` / 51 `china`)已被消耗**,被
> `arms/atomic-evidence/structured-verifier/` 拿去造注入题跑过冻结验收
> (`out/atomic-evidence/heldout-v0.19.1/HELDOUT-RESULT.md`)。现在只剩 dev 五簇,
> **最终验收没有干净的 heldout**;要泛化证据须另取未接触、跨事件的簇。

在 dev 上反复调,**heldout 只在最后报一次**。混用就是过拟合 —— 这条抄
原 `eval/article-quality/meta-eval.ts`（已删）的设计(「迭代 prompt 时只对 dev 调,
最终 κ/召回只在 heldout 报」)。

### 一条贯穿全部簇的实测分界线

```
space force  6篇   杂质 0/6          → 生产成稿干净
us airman   16篇   杂质 2/16 = 13%   → 生产成稿剔掉了
sweden      20篇   杂质 4/20 = 20%   → 生产成稿剔掉了
houthi      82篇   杂质 19/82 = 23%  → 生产成稿没剔掉      ← 失效点
cambodia    17篇   杂质 13/17 = 76%  → 被多数派带跑成缅甸
china      116篇   杂质 48/116 = 41% → judge 判 NO_EVENT 仍放行
```

**现有链路在 13–20% 杂质下能剔干净,到 23% 就失效。** 任何原型要证明自己更好,
先在 `houthi` 上跨过这条线。而 `sweden`/`us airman` 已有生产达标记录,
是"线不是拍高的"的凭据 —— 四个臂全失败时,靠它们分辨"臂不行"还是"线太高"。

## 探索范围的约束

**不许走(全部有据)**

- multi-agent debate / 多 agent 互相质疑 —— 等算力下弱于简单多数投票(ICML 2024)
- 无外部证据的自我修正 —— 准确率反而下降(Huang 2023;本仓 RARR 误删 20/43)
- 生成后再修补输出 —— RARR、补漏 loop、长度重写,本仓全部失败
- 拿"引用可解析"当忠实证据 —— 57% 引用是事后合理化
- 逐级压缩、级间传代理 —— 独立文献观测到同一现象 + 本仓 12 条证伪

**鼓励但不强制**

- 改输入与任务定义(opinion-based prompting 治 unsupported 56%→6%)
- 级间传叙事散文而非压缩代理(NexusSum +30% BERTScore)
- 多次读原文,而不是读一次然后传压缩表示

## 已知边界(任何读数旁边都要写)

- **快档不判覆盖与正确性**。全绿只代表机械项通过。
- **杂质标注只依据标题、未读正文**,所以杂质率是**下界**。
- **归属类错误召回低**。主体/日期搬错这类错,快档看不见,慢档也系统性少报 —— 根因是判定包
  写死的保守规则「判不准的归属类错误标 `ok`,不要硬猜造假 `hard`」。所以硬错数是**下界**。
  2026-09-18 实测:自然错误里 actor(主体/说话人搬错)占 60%,正是这把尺最看不见的那类。
- **慢档的事实正确性由 codex 判**,不是 LLM 自判;`glm-4.7-flash` 只抽事件清单(阶段 A),
  所以它影响覆盖率的分母、不影响错误判定。self-preference 风险的形态是 **codex 判 codex
  写的稿** → **只能臂间相对比较,不能当绝对门**。
  (2026-09-18 订正:此处原写「判官与写作层同族同模型(glm-4.7-flash)」,与下文第
  「判定环节换了主体」一节及 `build-judge-pack.mjs` 都不符。)
- **事实证据由检索给,不是成稿引的那句**(2026-09-19 起)。好处是与成稿引了谁无关,
  代价是检索没捞到时判官会把"判不出来"记成正确性问题 —— 所以每次都要连着看
  `pack.citedNotInEvidence`。c43 实测 direct-raw 4/50、direct-raw-grounded 1/34。
- **事件清单已去杂质**(`--depurify`,2026-09-19)。旧清单的分母里混着只有杂质文章报道的事件,
  于是**正确剔掉杂质的臂反而被扣覆盖分**。后置过滤,事件措辞未重抽,残余偏差是二阶的。
- **时效缺陷这一档已摘掉**。fixture 文章只跨 0913–0915 三天(`TIME_RANGE_DAYS=2` 决定),
  这一档天生没有触发机会,它属于 `/stories` 那条线。
- `houthi` 82 篇 264k 字符,逼近生产实测的超时线(91 篇 283k → 300 秒硬失败)。
  想一次读完它的臂要自己解决延迟。

## 慢档

覆盖率 + 事实正确性。分工是:**能机械判的归脚本,需要读懂语义的归 codex** —— codex 就在迭代
会话里,不必走 MCP。所以慢档不是"跑完给个分数"的黑盒,而是三步:

```bash
# A. 抽事件清单(唯一花钱的一步,按簇缓存,已有则跳过)
#    前置:本地 ai-worker 在 8787
#    cd services/meridian-ai-worker && \
#      nohup ../../apps/backend/node_modules/.bin/wrangler dev --port 8787 > /tmp/aiworker.log 2>&1 &
node build-checklist.mjs --cluster=7      # 先拿最小的簇冒烟
node build-checklist.mjs                  # 全部 7 簇
node build-checklist.mjs --depurify       # 把杂质文章从清单里剔掉(零 LLM,已做过则跳过)

# B. 组装判定包(零远程调用,本地 e5-small 做证据检索)
node build-judge-pack.mjs --arm=out/arm-a

# C. 判官读 judge-pack-c<cid>.md,把判定写进 verdict-c<cid>.json,然后:
node score-slow.mjs --arm=out/arm-a

# D. 改了 scorer 就量一次信度:同一份判定包判两遍,比两份判定
node compare-verdicts.mjs out/arm-a/verdict-c43.judgeA.json out/arm-a/verdict-c43.judgeB.json
```

`build-judge-pack.mjs` 把判定所需的材料摊成一份 markdown:事件清单(带分层)、成稿逐句编号,
每句下面**两组**材料 —— 「声称的出处」与「全簇检索证据 top-8」。判官读它判三件事,写回:

```json
{
  "cluster": 36,
  "coverage": [ { "eventId": 1, "covered": true, "where": "b1s3" } ],
  "claims": [
    { "sentenceRef": "b1s3", "claim": "被核的那个断言", "verdict": "supported", "tier": "ok",
      "citedSentenceSuffices": true, "why": "一句话理由" }
  ],
  "packDefects": []
}
```

`verdict` ∈ `supported`/`contradicted`/`not_found`;`tier` ∈ `fatal`/`hard`/`distortion`/`ok`。
`coverage` 必须盖满清单全部条目 —— 漏判会被 `score-slow.mjs` 拦住并 exit 2,因为漏判会让
覆盖率虚高(分母被悄悄缩小)。`citedSentenceSuffices` 每条必填,缺了同样 exit 2。

### 派判官的 prompt 必须写死三条(2026-09-19 教训)

判官任务本身不复杂 —— 读几个判定包、逐句判、写 JSON。但 2026-09-19 那轮有两个判官
**自行再派了子 agent**(一个 +1、一个 +3)。触发它的是 prompt 里「依次读这四个包、**各判各的**」
这句话:读成「四个独立子任务」就成了并行的邀请。

这和 2026-08-28 那次(调研 agent 自拆 5 个、额度打到 92%)是同一个坑。所以判官 prompt 固定带三条:

```
- **不要再派任何子 agent。** 这几个包自己顺序读完、顺序判完。
- 只读本指令点名的那几个 pack 文件,不读目录里其他任何文件、不看 git 历史。
- 落盘文件名以本指令为准(包尾模板写的默认名不作数,多判官并行时会互相覆盖)。
```

第三条也是实测踩过的:包尾模板写死 `verdict-c43.json`,而多判官并行时要写
`verdict-c43.judgeA.json`,四个判官里有一个照模板写、覆盖了别人的结果。

### 判定包指纹:「判据变了旧读数作废」的机械形态(2026-09-19)

CONTEXT.md 写着「实现层中途不得改判据;判据变了就是新的一把尺,**旧读数作废**」。
在 2026-09-19 之前这只是一句 prose —— 换了证据通道之后,全靠人记得把旧 verdict 移走。
记不住的那一次,新旧读数会混在同一张表里比较,**而且不报错**:score-slow 照常算出一个看着正常的数。

现在是退出码。`scorer-id.mjs` 算两个指纹,各管一种失效:

| 指纹 | 是什么 | 抓什么 |
|---|---|---|
| `packId` | 判定包 markdown 的哈希 | **判官到底看到了什么**。守则改了、清单重抽了、检索结果变了、成稿变了 —— 包一变,旧判定就不对应这份材料 |
| `scorerSrcId` | grading instructions + `retrieval.mjs` + `topK` 的哈希 | 「尺改了但判定包没重建」。这时包内容还是旧的,`packId` 对得上,只有源码指纹能发现 |

两处动作:

- `build-judge-pack.mjs` 重建时,包内容变了就把该簇的旧 `verdict-c<cid>*.json` 搬到
  `<arm>/_stale-pack-<旧 packId>/`,并在 stderr 说明。**自动,不靠人记得。**
- `score-slow.mjs` 读不到指纹、指纹对不上包内容、或包的 `scorerSrcId` 与当前不符 → **exit 2**。

**指纹从内容算,不手写版本号** —— 手写的会忘记改,而忘记改恰好等于关掉这道闸。
**`score-slow.mjs` 不在指纹里**:判定的有效性取决于判官看到了什么,而 score-slow 只是事后汇总、
每次都从 verdict 重算;把它算进去会让"改一行汇总逻辑"作废掉一批还有效的判定。

grading instructions 因此被抽成独立模块 `grading-instructions.mjs` —— 它是 scorer 的身份,
`build-judge-pack.mjs` 是脚本、有顶层副作用,指纹没法从那里算。

自测覆盖这道闸的三种失效(`nometa` / `staleP` / `staleS`),见下面的自测一节。

### 为什么事实证据由脚本检索、不用成稿自己给的出处(2026-09-19)

旧做法把证据窗口锚在成稿引的那句上,于是**引得越宽的臂拿到越多证据**,而判官据此判事实对错
—— scorer 量的是引用行为,不是写得对不对。各臂实测每句出处 1.03~1.73 不等,这个差距会
原样搬进正确性读数,把搜索往"引得更宽"而不是"写得更准"的方向牵。

现在证据由 `retrieval.mjs` 拿成稿句去**整簇原文**检索 top-8(本地 e5-small,零远程调用),
与成稿引了谁完全无关 —— 各臂拿到同一把 scorer。成稿声称的出处另行呈现,只用来判新增的
`citedSentenceSuffices`(被引那句本身够不够),两维在判定包里分开摆、互不回改。

事实性评测文献一致的做法也是证据由评分方检索:AlignScore 切块逐句取最高、SummaC 全句对 NLI、
MiniCheck 句级分类器。但**不能换成整簇一次直读** —— 本仓 `measure-detection-ceiling` 实测
Workers AI 上整簇判官召回只有 26%。

配套三个只报不设门的读数:

| 读数 | 含义 | 为什么不设门 |
|---|---|---|
| `citation.insufficient` | `citedSentenceSuffices=false` 的条数 | 设了门就又变成一道卡引用行为的门 |
| `pack.citedNotInEvidence` | 成稿引的句子没进 top-8 检索证据的条数 | 它大时,正确性读数里混着"判官没看到"而不是"写错了" |
| `pack.inlineCitationsStripped` | 正文里泄漏的行内引用号(已剥掉) | 它 100% 可识别臂身份,必须在判定前剥;剥的数量本身是写作层的缺陷读数 |

**通过线**(沿用 `block-writer/RUBRIC.md` 第五节,只把核心层换成相对口径):致命错 = 0、
一般硬错 ≤ 1、核心层覆盖 ≥ 2/3。失真 ≤ 2 是软线,超了只报不否。

判不可写的簇(`verdict=not_a_single_event`)没有正文可判,`build-judge-pack.mjs` 直接写一份
`skipped` 的 verdict,不用人判 —— 它们的合格与否由快档的二元判据决定。

**判定包里写死了两条防 self-preference 的要求**:先核事实再读文风(顺序不能反);判不准的
归属类错误标 `ok` 并说明,不要硬猜造假 `hard`。

### 慢档的依赖

事件清单的跨批归并用**本地 e5-small**(与生产 embedding 同一模型)—— 与已缓存的四簇旧清单
同一向量空间(`embed.py` 明确不加 `query:`/`passage:` 前缀、`normalize=True`,与生产一致),
换成 1024 维的 bge-m3 会让归并阈值失去意义。所以慢档额外需要:

- `services/meridian-ml-service/.venv/bin/python`
- `services/meridian-ml-service/model-cache`(470MB,gitignored,新机器按 ml-service README「本地开发」一节下载)

归并阈值 `MERGE_TH = 0.90` 沿用 `rubric.ts` 的取值,**没有标定记录**——偏高会让同一事件
重复成两条(虚增分母、压低覆盖率),偏低会把不同事件并成一条。各臂共用同一份缓存清单,
所以它不影响臂间相对比较,只影响绝对值。已记为已知边界。

`embed.py` 有卫生断言:向量必须 384 维、模长均值 ≈1,否则直接 assert 失败(下游 `cos` 是裸点积,
非单位向量会让阈值静默失效)。`askJSON` 三次温度阶梯全败返回 null 并显式记账,不静默降级成空清单。
`build-checklist.mjs` 另有两道:分批不许丢文章;`articleIds` 越界的剔除、全越界的整条丢弃并记数。

## 与旧实现的差异(为什么不直接复用 rubric.ts)

慢档的前身是 `apps/backend/prototypes/block-writer/scratch/rubric.ts`(阶段 A 抽清单 +
cov/clm/vrd/rsc 四段自判)。本 harness 移植了它的**阶段 A 与判据定义**,但没有复用那个文件,
原因有两类。

**一、它在本 harness 上直接跑会崩或空跑,三处已改:**

| 旧实现 | 本 harness |
|---|---|
| 主循环里**无条件**读 `out/<SRCDIR>/c<n>/report.json` —— 本 harness 的簇没有这个文件,异向原型也未必产出"报告" | 取消这一依赖;归因维改为可选,覆盖与正确性两维不依赖任何中间产物 |
| `ARTS` 从 `out/<SRCDIR>/meta.tsv` 读、正文从 `intel-pipeline/.cache/content/` 读 | 全部指向本目录 `fixtures/`(`clusters.json` + `meta.json` + `content/`) |
| 核心层硬编码 `nArticles >= 6`、`TOPK = 20` | 核心层 = `ceil(该簇最大支持数 × 0.5)`(下限 2),清单不截断(`china` 的事件数会远超 20) |

**二、判定环节换了主体。** 旧实现是 LLM 自判(`cov`/`clm`/`vrd`/`rsc` 四次调用/稿),而它自己的
文件头就记着那是**同族同模型**判官、只能相对比;那个文件里还留着 `EVENTS_ONLY=1` 开关,注释写
「判定改由人工判官做,不跑 LLM 自判」—— 说明这条路当时已被搁置。

本 harness 的判定交给 **codex 自己**(它就在迭代会话里,不必走 MCP),脚本只负责组装判定包和
机械汇总。所以 self-preference 的风险仍在(codex 判 codex 写的稿),缓解手段写死在判定包里:
先核事实再读文风、判不准的归属错误标 `ok` 不硬猜。**dev/heldout 分割是对这条风险的主要防线。**

外加两个维度旧实现没有:**杂质率**(快档,零 LLM)与**二元判据**(旧的 `DRAFTS` 是
`{cluster, run, text}` 一簇一稿,表达不了"拆成多块 / 判不可写")。

**启动成本**:7 簇事件清单一次生成,按 c2 那次的量级(16 次调用 / 196 秒 / 111k in_tok)估
约 25–35 次调用。这是唯一花钱的一步,之后永久缓存。

## 自测(改了 verifier、dataset 或判官协议就重跑)

```bash
node verify.test.mjs     # 快档 verifier:每条判据一个「必须抓到」+ 一个「必须放过」
node dataset.test.mjs    # dataset 层
node judges.test.mjs     # 判官协议的两个闸(失败路径 + 齐全时放行的反向对照)
```

三份都用临时目录里现造的合成数据,零 LLM、不联网、不依赖 out/,期望全部 exit 0。

**改了核心层口径之后**用这个重算分层,不必重抽清单(事件本身不变,零 LLM):

```bash
node build-checklist.mjs --retier    # 任一簇核心层仍为空就 exit 1
```

**一把永远返回通过的尺也会全绿**,所以 fail arm 那一半不能省。它应当逐项抓出:
杂质率超限(并点名引了哪篇杂质文章)、出处越界、三个袋簇的二元判据。

## 文件

```
CONTRACTS.md         各模块的字段与签名(参考手册)
FIXTURES.md          七簇声明:形态/期望行为/合格标准/不合格的样子(引真实失败样本)
expectations.json    机器可读判据 + 杂质 id 逐篇标注
policy.json          判据策略
dataset.mjs          dataset 层(CONTRACTS §1),输入侧唯一入口;datasets/ 是清单(入 git)
fetch-dataset.mjs    按 dataset 清单从 /events 重建正文(断点续跑,缺一篇即 exit 1)
fetch-fixtures.mjs   七簇 fixture 的正文重建
runner.mjs           跑哪些样本、数据从哪来、产物落哪、花了多少;arms/ 下是各臂(现只剩 direct-raw)
lib.mjs              切句(与生产逐句一致)+ fixture 载入 + 数字提取
verify.mjs           快档 verifier
build-checklist.mjs / audit-checklist.mjs / apply-audit.mjs / compare-audits.mjs
                     慢档事件清单:生成、核心层校核、应用校核结论、两模型校核对比
build-judge-pack.mjs / score-slow.mjs / prompts.mjs / slow-lib.mjs / embed.py / retrieval.mjs
                     慢档判定包与打分;embedding 走本地 e5-small(见「慢档的依赖」)
judges/              六类判官的判定说明;collect-verdicts.mjs 是判官产物的验收闸
grading-instructions.mjs  评分守则那一段。单独成模块,因为它是 scorer 的身份
scorer-id.mjs        判定包与尺的指纹 —— 「判据变了旧读数作废」的机械形态
compare-verdicts.mjs 两份独立判定的一致性 —— 改 scorer 时唯一的验收仪器
judge-alignment.mjs  判官 vs 人工金标的真阳率 / 真阴率 / 逐条分歧
analyze.mjs          多 epoch 汇总,零 LLM、只读
*.test.mjs           自测(见上一节)
fixtures/            clusters.json · meta.json · content/(gitignored,可由 fetch 重建)
out/                 运行产物(gitignored)
```
