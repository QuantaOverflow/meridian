# 聚类 → 简报:原型探索的 fixture 声明

固定这 7 个簇作为「聚类后 → 简报正文」这段的探索 fixture。**每份声明必须在跑任何原型之前写定**,
跑完之后不许回改——否则会把"现状能做到的"事后解释成"标准"。

数据来源:2026-09-15 那期生产运行(`cron-brief-1789477249362`,report 94)。
全量簇成员取自 R2 `observability/clustering/cron-brief-1789477249362.json`,
**不是 `brief_stories.article_ids`**(后者是 `pickSpreadArticles` 等距取样到 30 篇之后的结果)。

## 为什么用全量而不是截断后的 30 篇

生产链路有个 `DEFAULT_ARTICLE_CAP = 30` 的截断(理由是实测 91 篇 283k 字符会让单 step 300 秒超时)。
截断后 `china` 丢掉 86/116 篇(74%)、`houthi` 丢掉 52/82(63%)。作为**离线 fixture** 不受 workflow
step 超时约束,所以用全量——那才是聚类真实交给下游的东西。某个原型若想一次读完 116 篇,
它得自己解决延迟问题,**而那正是值得测的**。

## 契约(所有臂共用)

- **输入**:`{id, title, url, publishDate, content}[]`,该簇全量文章
- **输出**:markdown 正文 + **每句的出处** `articleId:sentence`

出处是强制的:三维判据里有两维(杂质率、数字核对)靠它,而它对内部架构不构成任何限制——
拆几步、传什么表示,都能标出处。

## 三维判据

| 维度 | 算法 | 成本 |
|---|---|---|
| 杂质率 | 成稿每句的出处文章,是否属于该簇的主导事件 | 纯机械,零 LLM |
| 覆盖 | 事件清单命中率,按支持篇数分层 | 需 LLM(清单可缓存) |
| 正确性 | 每个断言回原文核,分致命错/硬错/失真 | 需 LLM |

**已从主简报判据里摘掉的一档**:时效缺陷。候选簇的文章只跨 0913–0915 三天
(`TIME_RANGE_DAYS = 2` 决定),这一档天生没有触发机会,它属于 `/stories` 那条线。

## 判据的已知边界(必须写在任何读数旁边)

- **事实正确性由 codex 判**(慢档阶段 C),不是 LLM 自判。`glm-4.7-flash` 只用在阶段 A
  抽事件清单 —— 所以**覆盖率**的分母受它影响(它漏掉的事件永远不进清单),**错误判定**不受。
  2026-09-18 订正:此处原写「判官与写作层同族同模型(glm-4.7-flash)」,与 README 和
  `build-judge-pack.mjs` 的实现都不符,已改。
- self-preference 风险仍在,形态是 **codex 判 codex 写的稿** →
  **只能做臂间相对比较,不能当绝对门**。主要防线是 dev/heldout 分割
- 对「主体/日期搬错」这类归属错误召回低,**根因是判定包写死的保守规则**:「判不准的归属类
  错误标 `ok` 并说明,不要硬猜造假 `hard`」。拿不准就算对,而归属类最容易拿不准,所以报出来的
  硬错数是**下界**。2026-09-18 自然错误率实测:真实错误里 actor(主体/说话人搬错)占 60%,
  正是这把尺最看不见的那类。要下「达标」这种绝对结论,须另换不同家的判官复判归属类
- 判官自我一致性差:同一份稿隔轮再判结果会变,判完必须落逐条明细供复判对照

## dev / heldout 分割

在 dev 上反复调,**heldout 只在最后报一次**。混用就是过拟合
(`eval/article-quality/meta-eval.ts` 里那条设计:迭代只对 dev 调,最终读数只在 heldout 报)。

> **2026-09-18:heldout 两簇已被消耗。** `us airman` 28 与 `china` 51 的文章被
> `arms/atomic-evidence/structured-verifier/` 那条线拿去造人工注入题并跑过冻结验收
> (见 `out/atomic-evidence/heldout-v0.19.1/HELDOUT-RESULT.md`:「c28/c51 已经打开并使用,
> 以后不得称仍是未接触 heldout」)。**现在只剩 dev 五簇,最终验收没有干净的 heldout。**
> 要泛化证据得另取一批未接触、跨事件的簇。

**dev**:`houthi` 82 · `israel` 39 · `cambodia` 17 · `sweden` 20 · `space force` 6
**heldout**:`china` 116 · `us airman` 16

三种坏输入全在 dev,规模两端都有代表。

## 一条贯穿全部声明的实测分界线

```
space force  6篇   杂质 0/6          → 成稿干净
us airman   16篇   杂质 2/16 = 13%   → 成稿剔掉了杂质
sweden      20篇   杂质 4/20 = 20%   → 成稿剔掉了杂质
houthi      82篇   杂质 ≥ 23%        → 成稿没剔掉      ← 失效点在这里
cambodia    17篇   杂质 13/17 = 76%  → 被多数派带跑
china      116篇   抽样 14 篇 ≥5 无关 → judge 判 NO_EVENT 仍放行
```

**现有链路在 13–20% 杂质下能剔干净,到 23% 或大簇就失效。** 任何原型要证明自己更好,
首先要在 `houthi` 上跨过这条线。

---

# 1. `space force` — cluster 7

```
全量篇数      6
形态          真正的单一事件(唯一一个零杂质的簇)
输入杂质率    0/6 = 0%
分层          6 篇的簇,一个事件最多 6 篇支持
```

**期望行为**:写成一块,把这件事写清。

**合格标准**
- 致命错 = 0
- 杂质率 = 0(输入就没有杂质,成稿出现簇外文章即为编造)
- 覆盖:该簇核心事件全中。核心层按相对口径定(支持篇数 ≥ 簇篇数 30% = ≥2 篇)

**不合格的样子**
- 出现任何簇外的事实(这个簇零杂质,所以任何簇外内容都是编造或串源)
- 只写一句话就收(参照 `emmy awards` 那条:8 篇文章写出一句话,干净但太薄)

**证据**:6 篇标题全是同一条消息的不同报道 ——
`US has weapons deployed in orbit, Space Force says` / `United States Space Force says US has weapons in orbit` /
`US Space Force confirms weapons deployed in space for first time` / `US confirms for first time it has deployed space weapons` /
`Satellites, missiles or something else? US admits it has 'on-orbit'` / `US confirms for first time it has deployed weapons into space`

**这个簇的作用**:它是底线。任何原型在这里都该满分;做不到就是原型本身有问题,与输入无关。

---

# 2. `sweden` — cluster 1

```
全量篇数      20
形态          低杂质的单一事态(瑞典大选)
输入杂质率    4/20 = 20%
```

**期望行为**:写成一块,只写瑞典大选,剔掉那 4 篇别国政治。

**合格标准**
- 致命错 = 0,硬错 ≤ 1
- **杂质率 < 20%**(严格低于输入杂质率 —— 这一步存在的意义就是筛)
- 覆盖 ≥ 2/3 核心层(核心层 = 支持篇数 ≥ 6)

**不合格的样子**
- 正文出现科索沃组阁、韩国内阁改组、日本中间派实验
- 用 "In other news" / "Meanwhile" 把它们缝进来(参照 `houthi` 那条的真实失败段落)

**证据**:20 篇里 4 篇与瑞典大选无关 ——
`Kosovo gets new government but political impasse persists`、`Kosovo approves new government after months of political deadlock`、
`Lee's cabinet overhaul unravels as South Korea gender minister`、`Japan's Failed Centrist Experiment`

**已知可达标**:2026-09-15 生产成稿在这个簇上**做到了** —— 正文只写瑞典
(Andersson 微弱领先、Kristersson 阵营落后三席、瑞典民主党跌至第三、分析师 Mats Knutson 警告组阁僵局),
科索沃/韩国/日本一个字没写。所以这条线不是空想,**它是现状已经达到的水位**。

---

# 3. `us airman` — cluster 28 【heldout】

```
全量篇数      16
形态          低杂质的单一事态(美伊战争中飞行员生还与弹药短缺)
输入杂质率    2/16 = 13%
```

**期望行为**:写成一块,剔掉那 2 篇无关的。

**合格标准**:同 `sweden`,杂质率 < 13%。

**不合格的样子**
- 正文出现「70 岁徒步者在荒岛失踪获救」或「坦克进入战场 110 年史」

**证据**:16 篇里 2 篇无关 ——
`Missing US hiker, 70, found injured on remote island after weeks`、`110 years since tanks entered the battlefield; how they have e...`

**已知可达标**:生产成稿做到了(只写国防工业转入战时状态、$33.4bn/$22.3bn 支出、
Hegseth 描述营救、Parnell 否认 CNN 报道),徒步者和坦克史都没进。

---

# 4. `cambodia-thailand` — cluster 37

```
全量篇数      17(未被截断,这就是真实规模)
形态          多数派错位 —— 主题名来自少数派
输入杂质率    13/17 = 76%
```

**期望行为**:**二元判据**。合格有两条路,任选其一:
- (a) 只写柬泰争端那 4 篇的事,其余 13 篇一律不进正文;或
- (b) 输出「这不是一件事」的判定,不产出单块正文

**合格标准**
- 走 (a):杂质率 ≤ 4/17,且正文主体是柬泰边境/UN 调解
- 走 (b):明确的不可写判定 + 理由

**不合格的样子**(这是已发生的真实失败)
- 顶着 `cambodia-thailand border dispute and un conciliation` 这个标题,
  **正文全篇写缅甸 UN 代表权**(Min Aung Hlaing 被多国接待、Kyaw Moe Tun 倒戈、
  信任状委员会 9 月 8 日再度推迟),柬泰一个字没写

**证据**:17 篇里柬泰相关仅 4 篇(`Thailand Accuses Cambodia of Stationing Troops`、
`Cambodia, Thailand Begin Compulsory Conciliation`、`Thailand and Cambodia begin UN conciliation process`、
`Cambodia, Thailand take US$300 billion seabed dispute`);其余为缅甸 2 篇、印尼 3 篇、
新加坡访华、东南亚数字银行、LNG、印度撤销恐怖指控、雇佣兵、最高薪领导人加薪。

**这个簇测什么**:当簇名来自少数派时,原型会不会被多数派带跑。现有链路被带跑了。

---

# 5. `houthi` — cluster 36

```
全量篇数      82(生产截断到 30,丢 52 篇)
形态          被污染的 EVENT 簇 —— 主线清楚,但搭了一堆便车
输入杂质率    截断后 30 篇里 ≥7 篇无关(≥23%);全量 82 篇待测
```

**期望行为**:写成一块,只写红海危机主线,剔掉搭便车的。

**合格标准**
- 致命错 = 0,硬错 ≤ 1
- **杂质率 < 输入杂质率**(全量口径要在生成事件清单时实测)
- 覆盖 ≥ 2/3 核心层

**不合格的样子**(这是已发生的真实失败,原文照抄)
> In other regional news, Oman postponed a meeting with Iran to discuss the Strait of Hormuz...
> Ryan Cummings, head analyst at Signal Risk, said "The insurrection indicates discord within the
> Nigerien armed forces" after mutineers attacked Air Base 101 at Niamey's international airport
> and killed at least 27 people. Meanwhile, Venezuela's interim President Delcy Rodriguez launched
> a campaign featuring bright blue banners with the motto "Venezuela renace"...

**尼日尔兵变和委内瑞拉竞选口号不是红海危机的地区新闻。** 用 "In other regional news" 和
"Meanwhile" 把三件事缝进一段,是这个簇最典型的失败形态。

**证据**(截断后 30 篇里的杂质,全量会更多):
`As Chavez and Maduro images disappear, is Venezuela...`、`Niger mutiny exposes growing reliance on Russia`、
`Protests erupt across Syria over sharp fuel price hikes`(2 篇)、
`Panama canal traffic to be cut again as drought...`、`The midterms might be won or lost on a single issue`、
`Down to Earth - Countries turn to coal to avoid ship...`

**这个簇是主判例**。现有链路在 13–20% 杂质下能剔干净,在这里失效。
任何原型要证明自己更好,**首先要在这里跨过那条线**。

---

# 6. `israel` — cluster 43

```
全量篇数      39(生产截断到 30)
形态          题材袋 —— 「所有提到 Israel 的文章」
输入杂质率    高(截断后 30 篇里至少 2 篇完全无关,另有 5-6 个互不相同的事件)
```

**期望行为**:**二元判据**。这个簇**不该被写成一块**。合格有两条路:
- (a) 拆成 ≥2 块,每块是一件事(加沙军事行动 / 黎巴嫩战事 / B'Tselem 报告 /
  NAZA 纪录片争议 / 西岸定居点制裁);或
- (b) 输出「这不是一件事」的判定

**合格标准**
- 走 (a):每个子块内部杂质率 < 输入杂质率,且子块之间事件不重叠
- 走 (b):明确的不可写判定 + 指出它包含哪几件事

**不合格的样子**(这是已发生的真实失败)
- 顶着单词标题 `israel`,四段各讲一件事:加沙孕妇被杀 → B'Tselem 报告与西岸失业率 →
  威尼斯电影节 NAZA 获奖与吊销公民权威胁 → UN 警告瓦砾下的战争罪
- **无论这四段各自写得多准、文笔多好,只要它是一块,就判失败**

**证据**:30 篇里至少 6 个不同事件,外加两篇完全无关 ——
`UN experts say Belarus justice system used to target Lukashenko critics`(白俄罗斯)、
`Uncovering a Holocaust survival story`(大屠杀回忆,非当天新闻)

**judge 已经判对了,是下游放行的**:单词标题 `israel` 是 `dominantEntity` 兜底的指纹 ——
`judgeCluster` 按 prompt 在 NO_EVENT 时留空 title,`planBlocksFromJudgements` 的
`title.trim() || fallbackTitle()` 兜底成主导专名。而那条不变量明写
「NO_EVENT / UNSURE → 仍然出块,只进计数」。**所以这个簇测的是下游要不要执行 judge 的判定。**

---

# 7. `china` — cluster 51 【heldout】

```
全量篇数      116(生产截断到 30,丢 86 篇 = 74%)
形态          超大题材袋 —— 「AI 话题 + 中国话题」混合
输入杂质率    抽样 14 篇里 ≥5 篇无关
```

**期望行为**:同 `israel` 的二元判据,规模更极端。这个簇是 heldout 里最难的一个,用来验泛化。

**合格标准**:同 `israel`。外加一条规模相关的:
- 若原型选择一次读完 116 篇,必须在合理时间内完成(生产实测 91 篇会 300 秒超时,
  所以这条本身就是个真实的技术门槛)

**不合格的样子**(这是已发生的真实失败)
- 顶着单词标题 `china`,把 Trump 谈 AI 竞争、Amodei/Altman/Nadella 的表态、
  FRONTIER Act 与 AI Kill Switch Act、盖茨基金会 10 亿美元承诺缝成一块头条

**证据**(抽样 14/116 篇里的无关项):
`One of Sydney's largest councils joins ban on 'pervert' glasses`(悉尼眼镜禁令)、
`'Lazy economy': US$15 monthly rubbish services in China`(中国垃圾代收)、
`Clues in the Blood: Solving the Mystery of Cancer of Unknown Origin`(癌症研究)、
`After laying off 3,300 Uber employees`(Uber 裁员)、
`Why my interview with AI actor Tilly Norwood creeped me out`(AI 演员访谈)

---

## 每簇通过标准一览

| 簇 | 篇数 | 输入杂质 | 判据类型 | 通过标准 |
|---|---:|---|---|---|
| `space force` 7 | 6 | 0% | 写好一块 | 致命 0 · 杂质 0 · 核心全中 |
| `sweden` 1 | 20 | 20% | 写好一块 | 致命 0 · 硬错 ≤1 · 杂质 <20% · 覆盖 ≥2/3 |
| `us airman` 28 | 16 | 13% | 写好一块 | 致命 0 · 硬错 ≤1 · 杂质 <13% · 覆盖 ≥2/3 |
| `houthi` 36 | 82 | ≥23% | 写好一块 | 致命 0 · 硬错 ≤1 · **杂质 < 输入** · 覆盖 ≥2/3 |
| `cambodia` 37 | 17 | 76% | **二元** | 只写柬泰(杂质 ≤4/17) **或** 判不可写 |
| `israel` 43 | 39 | 高 | **二元** | 拆 ≥2 块 **或** 判不可写 |
| `china` 51 | 116 | 高 | **二元** | 拆成多块 **或** 判不可写 |

核心层按相对口径:**支持篇数 ≥ 簇篇数 × 30%**。绝对值(原 rubric 的 ≥6 篇)对 6 篇的簇算不出来、
对 116 篇的簇形同虚设。

## 还没做、但做之前不许跑原型的三件

1. **全量事件清单**:7 个簇各生成一份(`block-writer/scratch/rubric.ts` 的阶段 A,按簇缓存)。
   按 c2 那次的量级(16 次调用/196 秒/111k in_tok)估,7 簇约 25–35 次调用。
   **这是唯一花钱的一步。**
2. **输入杂质率实测**:现在 `houthi`/`israel`/`china` 的数字来自截断后的 30 篇抽样,
   全量口径要重算。杂质率的分母定义:该簇主导事件的文章集合(由事件清单的 articleIds 并集给出)。
3. **正文落盘**:7 簇全量约 296 篇从 R2 取出,按 `<id>.txt` 落到 rubric 能读的位置,
   并补 `meta.tsv` 行(id/cluster/pub/sourceId/title)。零 LLM。
