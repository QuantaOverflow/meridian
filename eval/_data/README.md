# eval/_data —— 金标语料

人工标注的语料放这里，**不放在 harness 目录下**。

## 为什么分开

harness 是为回答一个问题建的，答完就退役；金标是人力资产。放同一个目录等于同生共死，
而删除的单位是目录。2026-09-22 清理时 `intel-grounding/gold/` 就差一步随整个目录被删，
是临时查了证据覆盖率才捞回来的。

更早一次没这么幸运：2026-09-12 有一批 94 条人工金标被「调研产物不入 git」的落位规则
连带扫走，而它标定出来的归并阈值 0.94 至今还在生产里跑，没有可复现的标定依据。

分开之后还有个实用收益：金标能被统一清点和机械校验。此前回答「我们有哪些金标、
各多少条、还能不能用」要一个个翻目录、读文件头、数证据条数。

## 一份金标是一个包

缺任何一件都不可用：

| | 缺了会怎样 |
|---|---|
| `labels.jsonl`（或 manifest 指定的文件） | — |
| 证据（快照或重建方式） | 判定无法复现 |
| `rubric.md` | 标签无法解释 |
| `manifest.json` | 不知道它考谁的、还适不适用 |

**`rubric.md` 必须自包含**，不许引用别的目录的 rubric——被引目录随时可能随 harness
一起删掉。`intel-grounding` 的 rubric 原本就是半截的，判据主体在 `faithfulness/rubric.md` 里，
那份差一步被删。

## 校验

```
node eval/_data/check.mjs
```

检查每份是否自解释，不合规非零退出。要点：

- `targetOf` 必填 `product`（考被测系统）或 `judge`（考判官本身）。
  两者的 `{input, target}` 形状一样，差别只在 solver 槽里坐的是谁。缺了它，
  没有任何东西拦得住把判官成绩当产品成绩报。
- `labelBalance` 与实际标签**逐类对账**。依据是 Hamel Husain 对 LLM-as-judge 的警告：
  agreement / κ 是陷阱指标，样本不平衡时判官把少数类全判错也能拿高一致率。
  `labelField` 声明标签字段名（字符串 / 数组 / `null` 表示不是逐条分类）。
- `evidence.kind` 必填：
  - `raw_source` —— 外部素材（原始文章等），换架构仍有效，长期保留
  - `retired_intermediate` —— 系统的中间产物，架构一变即废。**允许存在但必须自己标出来**，
    因为它决定了这份是资产还是消耗品（用完蒸馏读数，语料不必留）

## 现有金标

| set | 考谁 | 条数 | 证据 | 备注 |
|---|---|---|---|---|
| `clustering-F1` | product | 119 事件 | raw_source | 调参集，已耗尽 |
| `clustering-F2` | product | 130 事件 | raw_source | holdout，用过一次 |
| `intel-grounding-v1` | judge | 100 | raw_source | 88% 是同一类，κ 不能当硬读数 |
| `article-quality-v1` | judge | 73 | raw_source | meta-eval 实调 LLM，读数不可复现 |
| `scrape-quality-v1` | product | 73 | raw_source | 判定是确定性代码，读数可复现 |
| `scorer-recall-v1` | judge | 15 | retired_intermediate | 语料已丢，只能读不能跑 |
| `ctb-citation-support-v1` | judge | 60 | retired_intermediate | 29 pass / 31 fail，带完整对齐读数 |
| `ctb-practice-risk-v1` | judge | 60 | raw_source | 练习集，不作验收 |

## 不在这里的：cluster-to-brief 的 datasets/

`eval/cluster-to-brief/datasets/` **有意留在原地**，不是漏了。

它和判官金标不是一回事：那是**产品数据集**，有自己的 schema（`clusters` / `articles` /
`dropped` / `consumed`）、`validateManifest` 校验、以及 `sampleView` 视图层。
本目录的 `check.mjs` 是那套的简化版，搬过去等于用弱的换强的。

该 harness 的**判官金标**已经迁过来了（`ctb-citation-support-v1` 与 `ctb-practice-risk-v1`）——
那两份和这里其余六份同类，形状一致。

契约见 `eval/cluster-to-brief/CONTRACTS.md` §1。两套 manifest 要不要合并是一轮独立的
设计工作，没有塞进这次搬家。
