---
{
  "id": "lesson-llm-cannot-partition-event-sets",
  "type": "lesson",
  "title": "让 LLM 对一个数十到上百元素的集合做穷尽切分，换 prompt、换更强模型都救不了，业界也没人这么用——这是任务形态的边界，不是某个实现的成绩",
  "date": "2026-08-21",
  "status": "recorded",
  "tasks": ["治故事过拆", "改聚类/切分链路"],
  "scope": "『集合切分』特指：给模型一个数十到上百个元素的集合，要求它一次性决定这个集合该分成几份子集、每份的边界在哪（即 story-validation 旧形态『整簇送 LLM，模型自己划出所有子故事』）。不覆盖『集合已经切好之后，判断某个子集是不是一件事』这类逐条判定任务——后者是本仓现行架构里 LLM 仍在做的事，被这条经验认为是合适的分工",
  "source": "apps/backend/src/lib/core/candidate-grouping.ts:1-14",
  "conditions": [
    "证据由两条独立来源共同支撑：直接排除性实测（7 个 prompt 变体召回 16-23/31 均低于基线、3 个高档模型硬配对全部失败）+ 一手文献调研（检索到的所有同构系统都不让 LLM 做这一步）",
    "『没人这么做』不是『不能这么做』的证明，只是『没有先例、若坚持这么做就是在做没人验证过的事』——这条边界本身也可能被未来专门设计的方法打破，见 invalidates_when"
  ],
  "evidence_origin": "local_record",
  "relations": [],
  "kind": "task_boundary",
  "invalidates_when": "出现专门为『在给定约束下精确执行集合划分』设计并验证过的模型或方法（例如结合约束求解器/程序化后处理的 LLM 系统），或本仓换用新方法后重新实测『整体切分交给模型』的召回显著超过几何基线；目前的证据只覆盖 2026-08 检索到的系统与本仓当时用过的模型/prompt/数据规模（~31 个真实事件、~100 篇量级的簇）"
}
---

## 结论

**集合切分是几何/组合优化问题，不是语言理解问题。** 本仓的实测（见
[[experiment-candidate-grouping-prompt-model-scan]]）与同期的一手文献调研（见
[[experiment-set-partition-literature-review]]）从两个独立方向指向同一个结论：

- 直接实测：7 个 prompt 变体（含穷尽契约、unassigned 出口）召回全部低于『什么都不改』；
  换成三个比原判官更高档的模型（gpt-oss-120b / deepseek-v4-pro / kimi-k2.6），硬配对错误
  一个没少，deepseek-v4-pro 反而最严重（52%）。
- 文献调研：BERTopic、TopicGPT、ClusterLLM、Event Registry、TDT、EventX(Story Forest)、
  EpiMine、Microsoft GraphRAG——检索到的每一个同构系统，切分动作本身都是几何/图论/统计，
  LLM（如果参与）只在切分完成之后对已经分好的组做逐条判定、命名或摘要。

两条证据互补：前者说明『做了会怎样失败』，后者说明『为什么没人这么做』。

## 为什么这条不随架构死

无论 story-validation 之后换成哪种具体实现（几何候选组、storyline 两段式命名、或未来
任何新设计），这条边界都规定了 LLM 该被放在流程的哪一步：**几何/统计负责决定『这堆东西
该怎么分』，LLM 负责回答『这个已经分好的子集是不是一件事』**。下一次任何设计想让模型
去做『把一批东西划分成组』或『把一个大集合拆成互不重叠的子集』这类任务时，都会撞上
同一堵墙——这正是本条经验要被复用的场景，不是本仓的聚类/切分链路专属。

## 什么仍然不确定

- 7 个 prompt 变体的具体差异未在源头逐一记录，只知道其中包含『加穷尽契约』与
  『加 unassigned 出口』两类；如果未来要在这条边界内部继续找 prompt 层面的改进空间，
  这批变体的具体设计已经丢失，需要重新构造。
- 结论覆盖的模型集合（gpt-oss-120b / deepseek-v4-pro / kimi-k2.6 三个高档模型 + 原判官）
  和当时的簇规模（~100 篇量级），不能自动外推到量级差异很大的场景（例如个位数元素的
  小集合，LLM 的容量退化曲线在小规模下可能根本没有触发）。

## 关联

由 [[experiment-candidate-grouping-prompt-model-scan]] 与
[[experiment-set-partition-literature-review]] 共同产生。与
[[lesson-legal-exclusion-path-prevents-forced-fit]]、
[[experiment-story-validation-architecture-error-taxonomy]]、
[[experiment-story-validation-verify-stage-tradeoff]] 是同一次架构替换
（2026-08-21，commit 9bef77b）留下的不同侧面记录：那几条讲『换成几何候选组 + 判官/复核
两段式之后表现如何』，本节点讲『为什么必须换掉整簇送 LLM 这个架构』。三者共享同一个
『41.7% → 89-92%』的头条数字，本节点不重复。
