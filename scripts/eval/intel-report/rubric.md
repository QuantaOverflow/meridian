# 情报报告（新五格 schema）质量 rubric

标注规范。判「一份中间情报报告本身好不好」，不判下游简报写得好不好。

被评对象 = `apps/backend/prototypes/intel-pipeline/` 产出的 `merged-c<簇>.json`，五格：
`whatThisIs` / `mechanisms` / `timeline` / `actors[].statements` / `disputes` / `gaps`。

真相源 = 该报告引用的那些文章全文（`prototypes/intel-pipeline/.cache/content/`）。

> **状态：未验收。** 本 rubric 尚未在真人标注上跑过一致性检验，任何用它产出的读数
> 在完成第七节的锚定之前都不得当作可信。

---

## 一、这把尺判什么，不判什么

**不判**（已有确定性代码通道，重复造只会引入噪声）：

| 项 | 现成通道 | 当前读数 |
|---|---|---|
| `articleId` 越界 | `merge.ts` 校验 | 三臂全 0 |
| 一条引用超过 3 篇 | `merge.ts` 硬截断 | 截断后 0 |
| `quote` 是否原文逐字 | 逐字比对 | 85–87% |
| `dateSource` 是否原文逐字 | 逐字比对 | 伪造率 7.7% |
| 相对日期归一（"周四"→ 日历日） | `merge.ts` 日期规则 v2 | 相对措辞 100% 归一 |
| 跨格字面重复 | 内容词 Jaccard ≥ 0.5 | 5.9% |
| 哪些文章一条都没被引用 | 覆盖对账 | 未被引 16–21% |
| 归属可疑（quote 前后 200 字符无人名） | 归属告警 | 告警率 12–18% |

**判**（代码测不了，只能靠人读原文）：五个轴，见第三节。

**本 rubric 不覆盖召回。** 「该有而报告里没有」需要金标，不是靠读报告能标出来的。
召回侧现有材料：簇 82 的 16 条人工金标（`prototypes/block-writer/out/armR/`）+ 覆盖对账代码通道。

---

## 二、标注单元

一条 = 一个可独立成立的陈述：

| 格 | 一条是什么 | 一 rep × 四簇的量 |
|---|---|---|
| `mechanisms` | 数组的一个元素 | 31 |
| `timeline` | 数组的一个元素 | 46 |
| `actors[].statements` | 一个 statement（不是一个 actor） | 138 |
| `disputes` | 一个 `positions[]` 元素 | 44 |
| `gaps` | 一条声明 | 29 |
| `whatThisIs` | 整份一条 | 4 |

单 rep 四簇合计约 290 条。

每格适用的轴不同：

| 轴 | mechanisms | timeline | statements | disputes | gaps | whatThisIs |
|---|---|---|---|---|---|---|
| 1 有据 | ✓ | ✓ | ✓ | ✓ | 特殊，见 3.1 | ✓ |
| 2 归属 | — | — | ✓ | ✓ | — | — |
| 3 落格 | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| 4 事件时间 | — | ✓ | — | — | — | — |
| 5 值不值得进简报 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 6 冗余 | ✓ | ✓ | ✓ | ✓ | ✓ | — |

---

## 三、五轴判据

### 3.1 轴一 · 有据（grounded）

判：这条 `text` 说的内容，在它 `articleIds` 指的那几篇原文里成不成立。

判据与档位**直接复用** `../intel-grounding/rubric.md`（同一套 `supported` /
`unsupported` / `contradicted` 定义、同一套 decontextualization 规则）。核心原则同样是
「标的是相对 SOURCE 是否成立，不是相对真实世界」。

新 schema 特有的两条补充：

- **判 `text` 不判 `quote`**。`quote` 是否逐字已由代码通道覆盖。轴一判的是转述后的
  `text` 有没有在转述中失真。这两者会分开：quote 逐字命中而 text 失真是本轴要抓的主要形态。
- **`articleIds` 已被截到 3 篇，`allIds` 是截断前的全集。** 判有据时以 `allIds` 为准；
  若 `allIds` 里成立而 `articleIds` 那 3 篇里不成立，记 `supported` 并另打标记
  `trimmed_evidence`（这是「引 3 篇上限」这条规则的真实代价，要单独看得见）。

`gaps` 的有据判法相反：`gaps` 声明的是「在已处理的 N/M 篇里未找到关于 X 的陈述」，
所以标注者要去原文里**找反例**——找到一篇明确写了 X，这条 gaps 就是 `contradicted`；
遍历完没找到就是 `supported`。

**锚例**

- `supported` — mechanisms「Texas law requires release after 90 days of detention」。
  7/7 篇原文都写了（`grep -i "90 days"` 全命中）。
- `contradicted` — 生成式 `whatThisIs`「A federal judge blocks Texas from extraditing an
  ICE agent」。原文是法官**驳回了明尼苏达要求德州引渡的请求**，方向反了。
  （此形态已由「④ 改成从标题里选」修掉，留作锚例。）

### 3.2 轴二 · 归属（attribution）

只对 `actors[].statements` 与 `disputes[].positions[]` 适用。判：这句话/这个动作，
是不是 `name`（或 `who`）这个人做的、说的。

| 档 | 判据 |
|---|---|
| `correct` | 原文明确把这句话/动作系于此人 |
| `wrong_person` | 原文把它系于**另一个具名主体** |
| `generic` | 原文有具名主体，但报告写成了泛称 |
| `alias_split` | 归属对，但同一人在同一份报告里以两个不同 `name` 出现，未被归一 |
| `unattributable` | 原文本身就没写是谁（如"官员表示"），报告也照抄，不算错 |

`alias_split` 与 `wrong_person` 的区别很重要，两者现在混在同一个「重复归属」计数里：

**锚例**

- `wrong_person` — 簇 82 rep2：`Keith Ellison｜said there is nothing legally left for them
  to investigate`。这句话是 Svendsen 在庭上说的，Ellison 是明尼苏达州总检察长，不是发言人。
  rep3 又把同一句归给了 `Trevor W. Ezell`。
- `alias_split` — `MEA spokesperson Randhir Jaiswal` 与 `Randhir Jaiswal` 各挂一条同样的话；
  `Abi Narayan Kafle` 与 `Nepal police spokesperson Abi Narayan Kafle`；
  `The United Nations International Residual Mechanism for Criminal Tribunals` 与
  `UN tribunal for war crimes`。这三对全是代码归一能修的，不是模型错。
- `generic` — 「Climate experts」（原文明写的是环境史学家 Ruth Gamble）。

### 3.3 轴三 · 落格（field placement）

判：这条该不该在它现在这一格。

各格的收容判据（写死，不留裁量）：

- **`mechanisms`** 收**不属于任何主体的结构性事实**：法律规则、期限、门槛、准入条件、
  因果链。凡是「某人说 / 某人做」的，不属于本格。
- **`timeline`** 收**有发生时刻的离散事件**。状态描述、持续状况不属于本格。
- **`actors[].statements`** 收**某个具名主体的言或行**。人物属性（年龄、职务、国籍）
  不是言行，不属于本格。
- **`disputes`** 收**两方或多方对同一命题给出不相容说法**。单方表态、双方只是各说各话
  但不冲突，不属于本格。
- **`gaps`** 收**有界的覆盖声明**。

| 档 | 判据 |
|---|---|
| `correct` | 符合该格收容判据 |
| `wrong_field` | 应在另一格；标注者写出应在哪格 |
| `not_an_item` | 五格都不该收，是属性/背景/脚手架 |

**锚例**

- `wrong_field` — mechanisms 里的「The 90-day deadline falls on Thursday」是 timeline 事件，
  不是规则。同一份报告里的「The court lacks subject matter jurisdiction because the case
  is not ripe」是法官 Rodriguez 的裁定理由，属 statements（跨格 Jaccard 0.60 已抓到这一对）；
  「The governor has not yet officially decided…」是 Abbott 的状态，属 statements（Jaccard 0.77）。
  簇 82 的 mechanisms 只有 4 条，其中 3 条落错格。
- `not_an_item` — `Julio Cesar Sosa-Celis` 名下的 statement：`text: "24-year-old"`，
  `quote: "24-year-old Julio Cesar Sosa-Celis"`。这是年龄，不是言行。

### 3.4 轴四 · 事件时间（event date）

只对 `timeline` 适用。判：`dateNorm` 是不是这件事**真实发生**的日期。

| 档 | 判据 |
|---|---|
| `correct` | 与原文所述发生时刻一致 |
| `pubdate_leak` | `dateNorm` 等于某篇引用文章的发布日，而原文并未说事情发生在那天 |
| `miscomputed` | 原文说了相对时间，代码归一算错了 |
| `undecidable` | 原文本来就没给日历日（历史年份 `1995`、`2011` 之类），不算错 |

`pubdate_leak` 是这条线的头号形态，且**代码无从判断**：模型直接吐 ISO 日期时，代码不知道
它是抄的还是猜的。簇 78 的 timeline，B 臂 12 条里 10 条恰好等于某篇引用文章的发布日。

**锚例**

- `pubdate_leak` — 簇 82：`what: "Minnesota sues Texas to force extradition"`，
  `dateSource: "last week"`，`dateNorm: 2026-08-26`。8-26 是引用文章的发布日；
  "last week" 指的是 8-19 前后。归一把「上周」算成了「今天」。
- `correct` — 同一份里 `dateSource: "arrested Castro in Cameron County on May 29"` →
  `2026-05-29`。原文给了绝对日期，抄对了。

### 3.5 轴五 · 值不值得进简报（salience）

判：一个关心这条新闻的读者，会不会觉得这条该出现在简报里。

**这是唯一带主观的轴。** 三档的判据用「必答问题」写死：

一件事的必答问题 = 发生了什么 / 为什么会这样 / 谁负责 / 接下来会怎样 / 各方怎么说。

| 档 | 判据 |
|---|---|
| `core` | 这条回答了上述某个必答问题。删掉它，读者读完简报仍会问出这个问题 |
| `supporting` | 它不回答必答问题，但为某条 `core` 提供具体度：数字、日期、地点、直接引语、机构名 |
| `trivial` | 既不回答必答问题，也不为任何 `core` 提供具体度 |

**锚例**

- `core` — 「Texas law requires release after 90 days of detention」。回答「接下来会怎样」，
  且是全篇唯一解释他为什么会被放的东西。基线整簇一次读出来时漏了这条。
- `supporting` — 「Castro is arrested in Cameron County, Texas」+ `2026-05-29`。
  给「他为什么在德州」提供具体度。
- `trivial` — `Christian Castro｜talked about marrying her and buying a house in Mexico when
  he is released`。真的、有 quote、归属也对，但不回答任何必答问题，也不支撑任何 core。

轴五是**压产出量那一轮的判决尺**：条目砍掉 30% 之后，砍掉的是 `trivial` 还是 `core`。
没有这一轴，「条目更多是不是更好」永远读不出来。

### 3.6 轴六 · 冗余（redundancy）

判：这条和同一份报告里的另一条说的是不是同一件事。

代码通道（内容词 Jaccard ≥ 0.5）已抓字面重复，本轴补它漏掉的**同义转述**。

| 档 | 判据 |
|---|---|
| `unique` | 报告里没有第二条说同一件事 |
| `dup_of` | 与第 N 条说同一件事；标注者填 N，并标是否被 Jaccard 通道抓到 |

**已知的结构性冗余，标注时要分开记**：

`disputes` 本质上是「两个 actor 的 statements 冲突」的一个视图，所以
`actors × disputes` 的重复是**结构性的**，不是模型写坏了。run11 合并 `assessments` 进
`actors` 之后，剩下的跨格重复主要就是这一对（rep1 15 对里 9 对、rep2 14 对里 10 对、
rep3 21 对里 9 对）。

标这类时打 `structural: true`。它的修法不是再合并一格，而是让 `disputes` 只存指向
statement 的指针、不复制 `text`——这是 schema 改动，不是 prompt 问题。
`mechanisms × actors`（Jaccard 0.60 / 0.77 那两对）同理，但那是轴三的落格错，不是本轴。

---

## 四、报告级聚合读数

逐条标完后，一份报告出这些数（分格再出一遍）：

- **有据率** = `supported / 总条数`；另报 `contradicted` 的绝对条数（这个数不该用比率看）
- **归属错率** = `(wrong_person + generic) / 可归属条数`；`alias_split` 单列（代码可修）
- **落格错率** = `(wrong_field + not_an_item) / 总条数`
- **事件时间错率** = `(pubdate_leak + miscomputed) / (timeline 条数 - undecidable)`
- **条目构成** = `core : supporting : trivial` 的三分比
- **冗余率** = `dup_of / 总条数`，`structural` 单列
- **`trimmed_evidence` 条数** —— 引 3 篇上限的代价

跨臂比较时，**`core` 的绝对条数**是主指标，不是条目总数，也不是 `core` 占比。
理由与源池扩容那次相同：比率会被分母搅动，绝对量才是读者拿到的东西。

---

## 五、抽样方案

全标一 rep × 四簇 = 约 290 条，太重。分层：

1. **簇 82 全标**（39 条/rep）。7 篇原文已逐篇读过，是唯一有人工真值的簇，
   且已有 16 条金标清单可交叉核。
2. **其余三簇按格分层抽样**，每格抽 15 条，合计约 45 × 3 = 135 条。
   `mechanisms` 与 `disputes` 条数本来就少，全标。
3. **过采可疑样本要单列，不能混进比率**：归属告警命中的条目、`dateNorm` 恰好等于
   某篇发布日的 timeline 条目、Jaccard ≥ 0.5 的重复对，这三类各单独抽一批标，
   用来量它们的精度（告警的精度目前只有「7 真错 / 3 误报」这一个手工读数）。
   过采批的读数**不得当生产率报**。

---

## 六、已知的判据边界（标注时会撞上，先写死）

1. **一条 statement 同时是行动也是判断**——不再是问题。run11 已删掉
   `assessments` 格，两者都进 `statements`，轴三不再要求区分。
2. **`text` 是转述，`quote` 是原话，两者语义不完全一致时**——轴一以 `text` 为准。
   `quote` 只是证据指针，它的逐字性由代码通道管。
3. **同一件事被拆成多条**（一条写动作、一条写理由）——轴六标 `dup_of` 只在两条
   信息内容重合时用；拆成互补的两条不算冗余，但两条各自的轴五档位要独立打，
   经常其中一条是 `trivial`。
4. **`gaps` 的轴五**：一条 gaps 是 `core` 只在它指出的缺口会改变读者判断时；
   「未找到关于 X 的陈述」而 X 本来也不重要的，是 `trivial`。

---

## 七、这把尺自己怎么验

轴一到轴四有确定性判据，理论上可以交给 LLM 判官。但本项目在同类任务上的实测是
**国产判官全灭**（环 1 grounding：qwen κ 0.407、deepseek-v3 κ 0.285），
且逐 claim 判官对「方向错 / 身份错」的召回接近 0——而轴二（归属）恰好就是身份判定。

所以顺序固定为：

1. **先由人标簇 82 的一 rep**（39 条），把六个轴的档位定义在真实分歧上磨一遍，
   改判据不改数据。
2. 一人标两遍（间隔至少一天），算自身一致性。自身一致性上不去，判据没写清，
   回第 1 步，不要往下走。
3. 只有轴一到轴四考虑上 LLM 判官，且必须先在人工金标上过 κ 验收；
   **轴五（salience）不给 LLM**——它没有可核的外部真值，
   而模型对自己产出的偏好泄漏在本项目已经踩过。
4. 轴六优先用代码（Jaccard + 余弦），LLM 只补同义转述那一层，且不做逐对判定
   ——逐对判定已被证伪为纯位置偏置（交换 A/B 重问，41 对里 33 对翻转）。
