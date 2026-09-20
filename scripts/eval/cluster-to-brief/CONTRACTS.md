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
- **split 与消耗记录**：`consumed` 只增不改；用过的 dataset 对该臂不再是未见过的数据。

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

## 2. Solver（被测系统）

solver 只需满足：给定一个簇的全量文章，产出下面的输出契约。内部拆几步、调几次模型、跑在哪，eval 一律不管。

- 原型 solver：`arms/<name>/*.mjs`（现状）。
- 生产 solver：HTTP 端点（迁移后）。
- 每次运行落 `out/<runId>/`，含 `run.json`：

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
        { "text": "...", "sources": [ { "articleId": 1009385, "sentence": 12, "quote": "原句原文" } ] }
      ]
    }
  ]
}
```

- `quote` 是**新增的必填字段**：出处原句的逐字原文。有了它，scorer 不需要复制生产的切句逻辑，只要验证 quote 是该文章正文的子串；两边切句口径不一致的风险消失。
- 不含任何中间产物（重点、窗口、候选句）。中间产物可另落 `out/<runId>/debug/`，scorer 一律不读。

## 4. Scorer（判定侧）

**scorer 只输出事实，不输出「过/不过」**。通过线单独放 `policy.json`，产品目标变了只改它，历史判定不作废。

- 机械 scorer（零 LLM，`scorers/*.mjs`）：出处可解析、quote 对得上原文、出处编号是否漏进正文、句末是否截断、数字有无出处、引语有无出处、块内重复、杂质率、**块内是否跨事件**。
- 判官 scorer（LLM，见 §5）：出处支撑、编造事实、编造关系、主体搬错、强度方向、多事件混写。

评分产物 `out/<runId>/scores.json`：

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
- **判官必须先与人工标注对齐**：`gold/<axis>.json` 存人工标注，`judge-alignment.mjs` 报真阳率/真阴率。没对齐过的判官，其比例只能当量级参考，不能进对比表。

## 6. Epoch 与汇总

- 默认 k=3 次独立重复（solver 全程重跑，含窗口步）。
- 汇总报**均值与极差**；某一轴若要二元结论，归约规则写明（例：3 次全过才算过）。
- 单次运行的结论只能当假设，出表时标 `epochs=1`。
