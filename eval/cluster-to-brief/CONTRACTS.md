# eval 模块的接口契约（2026-09-20 定）

这份文件是 dataset / solver / scorer / judge 四者之间的唯一约定。改它等于改接口，要同步改实现与本文件。

**为什么要有它**：这一轮（v1→v6）里判据写成了「必须拆 ≥2 块」这种带架构假设的形状，架构一改判据就失效，读数只能作废。
以后判据只描述**输出的性质**，不描述实现结构；eval 只依赖 dataset 与输出契约，不依赖链路内部。

---

## 1. Dataset（输入侧，`datasets/<id>.json` 入 git，正文不入）

一份 dataset = 某次生产运行的**全量输入 + 标注**，不是某个架构的入口。

```json
{
  "id": "prod-0919",
  "source": { "workflowId": "cron-brief-1789822849701", "reportId": 98, "runDate": "2026-09-19" },
  "days": ["2026-09-17", "2026-09-18", "2026-09-19"],
  "clusterSnapshot": "observability/clustering/<workflowId>.json",
  "selection": "selected_for_intel",
  "split": "dev",
  "targetOf": "product",
  "labelBalance": { "eventGroups": 41, "impurities": 12 },
  "articles": { "<articleId>": { "title": "...", "url": "...", "publishDate": "...", "sourceId": 12 } },
  "clusters": {
    "<clusterId>": {
      "articleIds": [123, 456],
      "metadata": { "articles": 27, "productionTitle": "Ceuta", "routerStructure": "topic_bag" },
      "labels": {
        "impurities": [789],
        "eventGroups": { "<事件名>": [123, 456] }
      }
    }
  },
  "dropped": {
    "noise": [901, 902],
    "notSelected": { "<clusterId>": [903, 904] }
  },
  "consumed": [{ "at": "2026-09-20", "by": "exec-support-mech", "note": "首轮真实分布" }]
}
```

- `metadata` 用于**分层出表**（按簇大小、是否题材袋分别看失败率），scorer 不读它做判定。
- `labels` 是**判定用的 target**，挂在输入上，换架构不失效。`eventGroups` 只列 ≥2 篇的事件；未入组的文章视为单篇事件或杂质。
- 顶层 `articles` 是文章元数据，**随清单入 git**（2026-09-20 加）：`out/` 整目录 gitignore，元数据只放那里等于随时会丢，人工标注就失去依据；正文才是可重建的部分。
- 正文落 `out/_data/<id>/content/<articleId>.txt`（gitignore），由 `fetch-dataset.mjs --dataset=<id>` 按清单重建。
- **消耗记录**：`consumed` 只增不改；用过的 dataset 对该臂不再是未见过的数据。
- 清单写回一律 `JSON.stringify(ds, null, 1)` + 结尾换行。缩进不统一的代价不是难看：第一次记消耗就把整份重排版，
  `git diff` 炸成几千行，真正改的那一行淹在里面。

### 1.0 `split`：整份的分层（可选键，2026-09-20 加）

`split` 是 **dataset 的属性，不是样本的属性**——对齐 Inspect 的口径：那里的 `split` 是「载入哪一份数据集」
（`hf_dataset(..., split="test")`），`Sample` 上根本没有这个字段。

| 取值 | 用途 |
|---|---|
| `dev` | 随便看、随便调，读数不进对比表 |
| `validation` | 选方案、定阈值 |
| `test` | 最终读数。跑过就不再是未见过的数据（`consumed` 记着） |

- 整个键**可缺**：老清单（`prod-0919` / `fixtures-r94`）没有它照常合法，这是向后兼容的边界。
- 存在则必须是上面三个之一，`validateManifest` 当场拒绝。拼错一个字母不会让任何下游报错，
  只会让「这份是不是 holdout」永远答错。
- 现状：`d0916` = dev（47 簇）、`d0911` = validation（37 簇）、`d0906` = test（23 簇）。

**簇级 `metadata.split` 已废弃**（`prod-0919` 里全是 `"fresh"`，`fixtures-r94` 里是 `dev`/`heldout`）：
分层是整份的属性，簇级打标记是它之前的错误形状。既有值**保留不删**；按它过滤的
`datasetClusters(ds, {split})` 参数没有调用方，2026-09-25 删除。**新 dataset 不再写它**。

### 1.0.1 `targetOf` 与 `labelBalance`：这份考谁、正负怎么分（可选键，2026-09-22 加）

#### `targetOf`：solver 槽里坐的是谁

| 取值 | 含义 |
|---|---|
| `product` | 考被测系统。target 是**输入的性质**（「这两篇是同一事件」），换架构不失效 |
| `judge` | 考判官本身。target 是人工判定，用来量判官的 TPR / TNR |

两者的 `{input, target}` 形状一样，差别只在 solver 槽里插的是产品链路还是判官。
分不出来的代价已经付过：一份判官金标里的 claim 是旧架构写出来的句子，**不管接到哪个 task 上**
都不代表当前系统会产出什么；而这件事只能靠翻文件、数证据覆盖率才看得出来
（2026-09-22 清理时就是这么判的 `intel-grounding` 与 `faithfulness` 的去留）。

- 整个键**可缺**，老清单照常合法。
- 存在则必须是 `product` / `judge` 之一，`validateManifest` 当场拒绝。
- 缺失时没有任何东西拦得住你把判官成绩当产品成绩报——这正是加它的理由。

Inspect 那边没有对应位置：`Sample` 有 `metadata`，但 `Dataset` 集合只有 `name` / `location` /
`shuffled`，没有数据集级别的自由字段。它表达数据集级别的事实靠的是「你载入了哪个文件」。
所以这不是偏离 Inspect，是填它留给 harness 的空位——与顶层 `split` 同一个论证。

#### `labelBalance`：让 κ 可解释

记 target 各取值的条数，例如 `{"supported": 78, "unsupported": 22}`。

依据是 Hamel Husain 对 LLM-as-judge 的警告：**agreement / κ 是陷阱指标**——样本不平衡时，
判官把少数类全判错也能拿到高一致率，而少数类恰恰是你在乎的那些失败。
所以单独一个 κ 数字无法解释，必须能看出正负比例，并优先看少数类那一侧的 TNR。

- 整个键**可缺**。
- 存在则必须是对象、每个值是非负整数，`validateManifest` 当场拒绝。
- **由产出这份 dataset 的脚本数出来写入，不靠人手填。** 校验只管形状，不与 `labels` 对账——
  对账要遍历全部标注，那是产出侧的责任。

### 1.1 `dropped`：丢弃池（可选键，2026-09-20 加）

`clusters` 只收 `selection`（现为 `selected_for_intel`）选中的那批。**漏报恰恰发生在没被选中的文章里**，
只标收录的部分，这份 dataset 从定义上就算不出漏报率——标多少遍都没用。`dropped` 就是补上那一半。

| 字段 | 语义 | 来源 |
|---|---|---|
| `dropped.noise` | 当天聚类判为噪声（`clusterId = -1`）的文章编号 | `clusterSnapshot` 指的 R2 快照里 `clusterId === -1` 那一项的 `articleIds` |
| `dropped.notSelected` | 成了簇、但该簇没进 `selection` —— 按簇编号分组 | 快照里 `clusterId >= 0` 且**不在** `clusters` 里的簇 |

硬约束（`validateManifest` 全部当场断言，违反即拒绝载入）：

- 整个 `dropped` 键**可缺**。老清单没有它照常合法，这是向后兼容的边界。
- 丢弃池与收录池**互斥**：`dropped` 里的文章编号不得出现在任何 `clusters[].articleIds` 里，池内也不得重复。
- `dropped.notSelected` 的簇编号不得与 `clusters` 的簇编号相同；噪声组不进 `notSelected`（它的编号是 -1，放 `noise`）。
- 丢弃池里每篇都必须在顶层 `articles` 里有元数据——取不到元数据就标不了，留个空编号等于没收录。
- 正文与收录的那批落同一个 `out/_data/<id>/content/` 目录，同样由 `fetch-dataset.mjs` 重建。

重建命令：`node fetch-dataset.mjs --dataset=<id> --include-dropped`（可加 `--snapshot=<本地快照.json>` 省一次 R2 往返）。
开关只管「从快照算出丢弃池并写进清单」；清单里**已经有** `dropped` 之后，不带开关的普通重建也会把它的正文一起补齐。
写入走 `recordDropped()`：**只补不覆盖**——只写 `dropped`，`articles` 里只补清单还没有的编号，既有元数据与 `labels` 一个字不碰。

### 1.2 Sample 视图（`sampleView`，2026-09-20 加）

**sample 是视图，不是数据本身。** 同一份 dataset 里「一个簇」和「一天的全部文章」都可以是一个 sample，
取决于要判什么。所以切分不落盘、不进清单，按需实例化——清单里只有成员与标注，
换一种判法只换一个视图，数据一个字不用改。反过来把粒度写死进清单，就等于把「判什么」焊在输入上，
换判法要重做数据。

```js
sampleView(ds, { view = 'cluster', scope } = {})
//  -> [{ id: 'c36', input: { clusterId, articleIds }, target: { eventGroups, impurities }, metadata }]
```

| 粒度 | 一个 sample 是 | target 是 | 判什么 | 状态 |
|---|---|---|---|---|
| `cluster` | 一个簇 | 该簇的 `labels`（`eventGroups` / `impurities`） | 给定这批文章，写出的简报有没有混事件、有没有杂质、出处对不对 | 可用 |
| `day` | 当天全部文章 | 当天的**全局事件清单** | 漏报：当天真实发生的事件，有几件没出现在任何簇里 | **留桩，直接 throw** |

- `input` 只给 `articleIds`，**不读正文**：视图只管切分，正文由 `loadClusterArticles` / `loadClusterFrom` 按需读。
  否则只为拿一份簇编号列表也要把几百篇正文全读进内存。
- `scope` 管范围：`{ clusters: [id...] }` 显式列表，不传 = 全部。
  点名了不存在的簇当场炸——抄错簇号不该静默少一个样本。
- `day` 为什么留桩：它的 target 是当天的全局事件清单，而**这份清单怎么造还没验过精度**。
  target 本身不可信，拿它判出来的读数只会把标注的错算成系统的。见 ADR 0003 已证伪清单第 6 条。
- 与 `datasetClusters` 的关系：后者只回簇编号，调用方还得自己再取标注与元数据，于是「一个 sample 是什么」
  在每个臂里各写一遍。`sampleView` 是它的上层。**后续新臂走 `sampleView`**；`datasetClusters`
  留给已有调用方。

## 1.3 Runner / Solver 的职责边界（`runner.mjs`，2026-09-20 加）

原来每个臂的 `main()` 里揉着三件事：求解逻辑、数据来源知识（`DEV` 簇号、`loadCluster` 还是
`loadClusterFrom`）、运行策略（范围选择、闸、产物目录命名、记消耗）。后两类不属于求解，
每加一个臂就重抄一遍，改一处要改四处。`runner.mjs` 把它们收走。

| | 归谁 |
|---|---|
| argv 解析（`--dataset` / `--cluster` / `--plan` / `--resume` / `--all`） | runner |
| 样本集合：dataset 模式走 `sampleView`，fixtures 模式走 `loadCluster` | runner |
| 正文加载（臂拿到的是已载好的 `{clusterId, articles}`） | runner |
| `DEV` 白名单 + `ALLOW_HELDOUT` 守卫 | runner |
| `FULL_RUN_MAX=3` 闸 + `--all` / `ALLOW_FULL_RUN` | runner |
| 产物**根目录**（dataset 模式加 `-<id>` 后缀，fixtures 模式不加） | runner |
| `recordConsumption`（`--plan` 不记） | runner |
| 切窗口 / 抽重点 / 写正文 / 判结构 | 臂 |
| 根目录**下面**怎么摆：窗口缓存、`--resume`、开关派生的子目录 | 臂 |

**判据**：臂的源码里搜不到 `dataset` / `fixtures` / `DEV` / `loadDataset` / `recordConsumption` /
`loadCluster` —— 搜得到就说明数据来源知识又漏回臂里了。

臂导出两样东西：

```js
export const meta = {
  name: 'direct-raw',            // 产物根目录名，也是 consumerId 的前缀
  consumerId() { ... },          // 记进 dataset.consumed 的 by：臂名 + 影响读数的开关
  resolveOutDir(base) { ... },   // 可选：根目录 → 成稿真正落的那一层，runner 只拿它打横幅
  fixtures: { ... },             // 可选，见下
};

export async function runSample(sample, options) { ... }
```

- `sample`：`{ id, input, target, metadata }`。`input` 是 `sampleView` 的 `{clusterId, articleIds}`
  **再加一个 runner 载好的 `cluster`**（`{clusterId, articles}`，与 `loadClusterFrom` 逐字同形）。
  选「runner 负责加载」而不是「只给 articleIds、臂自己读」：后者会把 `loadClusterFrom` 留在臂里，
  seam 就没抽干净。fixtures 模式没有标注，`target` 给 `null`（不是 `{}`，别让「没标注」看着像「标注是空的」）。
- `options`：`{ plan, resume, outDir }`。**runner 决定写哪里（`outDir`），臂决定写什么。**
- `runArm(arm, argv)` 回 `{ ids, outDir }`，给臂做收尾打印。

### 现存的臂

只剩 `direct-raw`（「切窗口 → 抽重点 → 最后一次写正文」）。当初一起迁进 runner 的 `structure-router`，
以及没迁的 `evidence-graph` / `atomic-evidence` 都已删除；为 structure-router 开的 `meta.fixtures`
口子（两臂 CLI 文案不同的妥协）随之收回，fixtures 模式的 dev 闸文案由 runner 统一给出。

## 2. Solver（被测系统）

solver 只需满足：给定一个簇的全量文章，产出下面的输出契约。内部拆几步、调几次模型、跑在哪，eval 一律不管。

### `runSample` 不可组合——已知限制，暂不改（2026-09-20 记）

我们的 solver 是 `runSample(sample, options) → 输出`，**输入与输出不同型**，因此不能把
solver 串成链。Inspect 的做法是 `Solver = (TaskState, generate) → TaskState`（官方文档
`solvers.html`：「Composite specifications for task execution; and Components that can be
chained together」），同型，所以 `system_message()` / `generate()` / `self_critique()` 这类
环节能互相接龙、跨 task 复用。

**这个限制现在已经在收代价**：direct-raw 的 v6 是六个环境开关堆出来的
（`SINGLE_BLOCK` / `WRITE_AT_END` / `WRITE_TIER` / `WRITE_SUPPORT` / `WRITE_REPAIR` / `ROUTE_GATE`），
它们本质上是**可选的处理环节**，用开关表达的后果是：组合数随开关指数增长、环节不能跨臂复用
（structure-router 的路由门只能靠读对方产物文件来"复用"，见上面的锋利边）、加一步要改主流程。

**为什么这轮不改**：① 同型要求所有环节共享一个状态结构，而现在各臂的中间产物形态完全不同
（窗口缓存 / 事件签名 / 证据图），统一是大工程；② Inspect 能这么设计是因为模型调用被收敛成
一个 `generate` 抽象，我们这边每个臂自己 fetch；③ 这轮的目标是切开 dataset↔solver，两件事
一起做会让出问题时分不清是哪一层。

**什么时候该重新评估**：臂的数量再涨一轮，或某个臂的开关组合数再翻一倍时。届时的判断依据是
「同一个环节是否已经在两个以上的臂里各写了一遍」——出现了就说明不可组合的代价已经超过改造成本。

- 原型 solver：`arms/<name>/*.mjs`（现状）。
- 生产 solver：HTTP 端点（迁移后）。
- 每次运行落 `out/<runId>/`。下面的 `run.json` **尚未实现**：现有 runner 不写它（2026-09-25 读它的分支已删，judge-alignment 的 epoch 改由 `--epoch` 显式传）；落地时按此形状实现：

```json
{
  "runId": "exec-support-mech@prod-0919#2",
  "dataset": "prod-0919",
  "solver": "direct-raw",
  "epoch": 2,
  "configHash": "sha256:abcd1234",
  "config": { "DIRECT_RAW_WRITE_TIER": "exec", "model": "@cf/zai-org/glm-4.7-flash" },
  "samples": { "<clusterId>": { "status": "ok|error|skipped", "error": "", "calls": 11, "elapsedS": 34.4 } }
}
```

- `configHash` 由 `config` 全部键值算出。两次运行 configHash 不同就**不可比**，出表时必须分列。
- 样本失败是**一等状态**：`status=error` 的样本不计入任何比例，出表时单独列出个数。不允许悄悄少一个样本。

## 3. 输出契约（简报，架构中立）

每簇一个文件 `out/<runId>/c<clusterId>.json`：

```json
{
  "cluster": 36,
  "verdict": "written" | "not_a_single_event",
  "reason": "判不可写时必填",
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

### `quote` 字段：2026-09-20 加了又撤（不要再加第三次）

`sources[]` **只有 `{articleId, sentence}`**，没有 `quote`。这里记为什么，免得下次看到「逐句出处」
又想当然地把原句补上。

原本的理由是：有 quote，scorer 就不必复制 solver 的切句逻辑，只要验 quote 是该文正文的子串。
2026-09-20 实做了一次，当天撤回。撤的理由三条，**都是实测不是推断**：

- **它解决的问题现在不存在。** `verify.mjs` 与 `direct-raw` 都 `import { sentenceOf } from lib.mjs`
  ——同一个切句器。两边口径不一致的风险要等评**生产 solver**（`report-v3` 自带切句器）时才出现。
- **它抓不到坐标错位。** 当时的 `verify.mjs` 验的是 `article.content.includes(quote)`——
  「这段文字在这篇文章的某处」，不是「在第 N 句」。模型把第 12 句标成第 11 句，两句都在正文里，
  照样通过。要抓错位得把检查改成比对 `sentence[n]` 本身，那是判定侧的改动，会让历史读数换口径。
- **代价是真的。** 每个出处多带一整句原文，输出体积约翻倍。实测 c23 写作步第一次就打满
  `max_tokens=8000`（`finish=length`，烧 125s）才重试成功。exec 档 5 句 × 最多 8 出处已经如此，
  `lead` 档（14 句）会更频繁。

实做那轮的读数（26 个出处，2 簇）：`sourceQuotesChecked` 从恒 0 变成 13+13，**抓到 2 条失败，
但两条都是引号字符归一**（模型把 `“ ”` 写成 `"`，或反向），**坐标全对，零个真错位**。

**什么条件下再加**（满足其一再动，并且要连检查方式一起改）：

1. 要评**生产 solver**——切句器不同，坐标会静默指向别的句子；
2. `citation-support` 判官轴上线——它需要区分「事实在簇内别处有、只是不在被引句里」（指错句）
   与「整篇都没有」（编造），而这两种的修法完全不同（见 ADR 0006 §6，4 倍虚高的根因）。

**再加时用前缀，不要整句**：实测 d0916 的 665 篇 / 14869 句，前 6 个词能在该文内唯一定位 **98.9%**
（前 8 词 99.1%，收益已饱和；而句子本身短于前缀的比例 6 词时 2.7%、8 词时 5.8%）。
剩下约 1% 定位不到唯一的是同篇内开头重复的句子（滚动直播时间戳、重复图注），那些跳过不判。

- 不含任何中间产物（重点、窗口、候选句）。中间产物可另落 `out/<runId>/debug/`，scorer 一律不读。
## 4. Scorer（判定侧）

**scorer 只输出事实，不输出「过/不过」**。通过线单独放 `policy.json`，产品目标变了只改它，历史判定不作废。

- 机械 scorer（零 LLM，现为 `verify.mjs` 一个文件）：出处可解析、出处编号是否漏进正文、句末是否截断、数字有无出处、引语有无出处、块内重复、杂质率、**块内是否跨事件**。
- 判官 scorer（LLM，见 §5）：出处支撑、编造事实、编造关系、主体搬错、强度方向、多事件混写。

评分产物 `out/<runId>/scores.json`（**尚未实现**，现在 verify.mjs 直接打印读数与 findings）：

```json
{
  "runId": "...", "scorerVersion": "mech@1", "at": "2026-09-20T...",
  "samples": { "<clusterId>": { "status": "ok", "readings": { "sentences": 5, "unresolvedSources": 0 },
                                "findings": [ { "axis": "citation-support", "ref": "b1s3", "detail": "..." } ] } }
}
```

- **评分与生成分离**：scorer 只读 `out/<runId>/` 里的产物，任何时候都能重跑，不需要重新生成简报（Inspect 的 offline scoring 同此）。

### 判据写法（硬规矩）

判据只描述输出性质，**不得出现结构词**（块数、step、窗口、调用次数）：

- ❌ `requireSplitOrReject: 必须拆 ≥2 块` —— 假定了多块架构
- ✅ `noEventMixing: 每个块引用的文章必须落在同一个 eventGroup 内` —— 谁来实现都适用；一簇一块、拆多块、判不可写都能满足

## 5. Judge（LLM 判官）

- 每一轴一个规格文件 `judges/<axis>.md`，里面写死：任务、判定口径、输出 schema、落盘路径，以及三条硬规矩（不准再派子 agent、只读点名文件、落盘文件名以指令为准）。
- 判官产物落 `out/<runId>/verdicts/<axis>-c<clusterId>.json`，带 `promptId`（规格文件哈希）。`promptId` 不同的判定**不可混用**。
- 派完必须跑 `collect-verdicts.mjs --run=<runId> --axis=<axis>` 验收：文件在不在、schema 合不合、样本覆盖全不全。不过就 exit≠0，结果一律不采用。
  （2026-09-20 教训：一个判官自报完成、文件根本没落盘，差点直接采用它报的比例。）
- **判官必须先与人工标注对齐**：`eval/_data/ctb-<axis>-v1/labels.json` 存人工标注，`judge-alignment.mjs` 报真阳率/真阴率。没对齐过的判官，其比例只能当量级参考，不能进对比表。

## 6. Epoch 与汇总

- 默认 k=3 次独立重复（solver 全程重跑，含窗口步）。
- 汇总报**均值与极差**；某一轴若要二元结论，归约规则写明（例：3 次全过才算过）。
- 单次运行的结论只能当假设，出表时标 `epochs=1`。
