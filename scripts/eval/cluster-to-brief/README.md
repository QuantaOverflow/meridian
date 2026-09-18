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

在 dev 上反复调,**heldout 只在最后报一次**。混用就是过拟合 —— 这条抄
`scripts/eval/article-quality/meta-eval.ts` 的设计(「迭代 prompt 时只对 dev 调,
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

**不许走(全部有据,理由见 `docs/knowledge/`)**

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
- **归属类错误看不见**。主体/日期搬错这类错,快档和慢档都召回 ≈ 0。
- **慢档的判官与写作层同族同模型**(glm-4.7-flash),self-preference 泄漏 →
  **只能臂间相对比较,不能当绝对门**。
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

# B. 组装判定包(零 LLM)
node build-judge-pack.mjs --arm=out/arm-a

# C. codex 读 judge-pack-c<cid>.md,把判定写进 verdict-c<cid>.json,然后:
node score-slow.mjs --arm=out/arm-a
```

`build-judge-pack.mjs` 把判定所需的材料摊成一份 markdown:事件清单(带分层)、成稿逐句编号、
**每句所引的原句全文**。codex 读它判两件事,写回:

```json
{
  "cluster": 36,
  "coverage": [ { "eventId": 1, "covered": true, "where": "b1s3" } ],
  "claims": [
    { "sentenceRef": "b1s3", "claim": "被核的那个断言", "verdict": "supported", "tier": "ok", "why": "一句话理由" }
  ]
}
```

`verdict` ∈ `supported`/`contradicted`/`not_found`;`tier` ∈ `fatal`/`hard`/`distortion`/`ok`。
`coverage` 必须盖满清单全部条目 —— 漏判会被 `score-slow.mjs` 拦住并 exit 2,因为漏判会让
覆盖率虚高(分母被悄悄缩小)。

**通过线**(沿用 `block-writer/RUBRIC.md` 第五节,只把核心层换成相对口径):致命错 = 0、
一般硬错 ≤ 1、核心层覆盖 ≥ 2/3。失真 ≤ 2 是软线,超了只报不否。

判不可写的簇(`verdict=not_a_single_event`)没有正文可判,`build-judge-pack.mjs` 直接写一份
`skipped` 的 verdict,不用人判 —— 它们的合格与否由快档的二元判据决定。

**判定包里写死了两条防 self-preference 的要求**:先核事实再读文风(顺序不能反);判不准的
归属类错误标 `ok` 并说明,不要硬猜造假 `hard`。

### 慢档的依赖

事件清单的跨批归并用**本地 e5-small**,不是 ai-worker 的 bge-m3 —— 前者与已缓存的四簇旧清单
同一向量空间(`embed.py` 明确不加 `query:`/`passage:` 前缀、`normalize=True`,与生产一致),
换成 1024 维的 bge-m3 会让归并阈值失去意义。所以慢档额外需要:

- `services/meridian-ml-service/.venv/bin/python`
- `services/meridian-ml-service/model-cache`(470MB,gitignored,新机器先跑 `bash download.sh`)

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

## 自测(改了 verifier 或判据就重跑)

```bash
# 快档
node scratch/make-synthetic-arm.mjs                      # 造两个已知答案的 arm
node verify.mjs --arm=out/_synthetic-pass --split=all     # 期望 exit 0,全绿
node verify.mjs --arm=out/_synthetic-fail --split=all     # 期望 exit 1,七簇全被抓

# 慢档:五个边界各碰一次(pass/fatal/hard/cov/gap → 0/1/1/1/2)
node scratch/selftest-slow.mjs                            # 期望 exit 0
# 它把伪造清单写进 out/_selftest-slow/,靠 score-slow 的 --checklists 指过去,
# 绝不碰 fixtures/checklists/ —— 会覆盖真基准的自测比没有自测更危险

# 切句必须与生产逐句一致,否则出处编号静默脱钩
node ../../../node_modules/.pnpm/tsx@4.19.3/node_modules/tsx/dist/cli.mjs scratch/split-cmp.ts
                                                          # 期望 296/296 零差异
```

**改了核心层口径之后**用这个重算分层,不必重抽清单(事件本身不变,零 LLM):

```bash
node build-checklist.mjs --retier    # 任一簇核心层仍为空就 exit 1
```

**一把永远返回通过的尺也会全绿**,所以 fail arm 那一半不能省。它应当逐项抓出:
杂质率超限(并点名引了哪篇杂质文章)、出处越界、三个袋簇的二元判据。

## 文件

```
FIXTURES.md          七簇声明:形态/期望行为/合格标准/不合格的样子(引真实失败样本)
expectations.json    机器可读判据 + 杂质 id 逐篇标注
lib.mjs              切句(与生产逐句一致)+ fixture 载入 + 数字提取
fetch-fixtures.mjs   从 /events 取全量正文,断点续跑,缺一篇即 exit 1
verify.mjs           快档 verifier
fixtures/            clusters.json · meta.json · content/(1.6M,gitignored,可由 fetch 重建)
scratch/             一次性工具:合成自测、切句比对
out/                 运行产物(gitignored)
```
