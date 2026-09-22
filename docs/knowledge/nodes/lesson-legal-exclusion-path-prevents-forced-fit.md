---
{
  "id": "lesson-legal-exclusion-path-prevents-forced-fit",
  "type": "lesson",
  "title": "分类/分组任务里如果模型没有『合法排除某成员』的出口，就会被逼着硬凑（伞状糊）而不是正确地拒绝",
  "date": "2026-08-20",
  "status": "recorded",
  "tasks": ["治故事过拆", "设计验收门"],
  "scope": "任何让 LLM 对一组候选项做分组/归类判断、且存在『部分候选项其实不该被分进任何组』这种可能性的任务 schema 设计",
  "source": "services/meridian-ai-worker/src/prompts/storyValidation.ts:1-19（旧 single_story/collection_of_stories 二分支设计的结构性缺陷说明）；scripts/eval/story-validation/rubric.md（HEAD 版本，见 experiment-story-validation-architecture-error-taxonomy 的 source 说明）第 1 节 umbrella/wrongPair 实测",
  "conditions": [
    "旧架构（『整簇丢给模型自己判 single_story/collection_of_stories 并划出所有子故事』）的 outliers 数组只存在于 single_story 分支——collection_of_stories 分支没有任何合法位置安放『不属于任何故事的成员』",
    "2026-08-18 生产实测：这一结构性缺陷下，352/967 篇进簇文章走的是『默默不提』这条路——模型选择的三条路径（硬配对/整簇丢弃/默默不提）全部是错误应对",
    "新架构给判官加了『部分覆盖是合法输出，不属于任何事件的文章直接不列』的显式出口后，同一批错误类型的分布从 86% umbrella 变成对照组（几何预分组）下 80–100% wrongPair——即『没有出口』被消灭后，模型确实停止了硬凑同一批文章的行为"
  ],
  "evidence_origin": "local_record",
  "relations": [],
  "kind": "failure_mechanism",
  "invalidates_when": "换模型或换 prompt 后，若模型在有合法排除出口的情况下仍然倾向于强行归组（即『给出口没用』），说明这条机制对新模型不适用，需要用新的实测数据重新验证——目前的证据只覆盖 kimi-k2.6 与本项目使用的判官模型"
}
---

## 现象与根因

旧版 story-validation prompt 只给模型两个分支：`single_story`（一个故事，允许有 `outliers`
排除不相关成员）和 `collection_of_stories`（一堆故事，但**没有**类似 `outliers` 的合法出口）。
`storyValidation.ts:7-11` 引用 kimi-k2.6 的思维链原文点破了这一点：

> "This implies that for collection_of_stories, you may NOT exclude articles... Thus
> pure_noise is correct."

模型发现自己被架构逼进了死角——面对『这堆文章里有几篇不属于任何故事』的真实情况，
schema 里没有表达这个事实的合法位置——于是只剩三条路，**全部是错误应对**：硬配对、
整簇丢弃、或默默不提（2026-08-18 生产实测 352/967 篇走的是这条路）。

新架构给判官加了显式规则「A group may hold more than one event」「An article that
shares no event with any other article here is simply left out」（同文件 128-136 行），
umbrella 错误率随之从 86% 降到基本消灭（[[experiment-story-validation-architecture-error-taxonomy]]）。

## 为什么这条不随架构死

这不是『story-validation 这一版 prompt 写得好』，而是一条更一般的 prompt/schema 设计原则：
**当任务的真实分布里存在『某些候选项本就不该被归入任何类别』这种情况时，输出 schema
必须提供一个成本对称的『合法排除』出口**——否则模型不会神奇地『知道该拒绝』，
它会被迫在几个同样错误的选项里选一个看起来损失最小的（这里是硬凑成伞状标签，
因为『编不出故事』比『留白』在表面上更像完成了任务）。这个原则适用于任何让 LLM
做分组/分类/抽取的任务，跟具体是新闻聚类还是别的领域无关。

## 代价没有消失，只是换了形状

给出口不是免费的：几何预分组这条路径消灭了 umbrella，但把错误类型换成了 wrongPair
（[[experiment-story-validation-architecture-error-taxonomy]] 里 80–100% 的新架构错误
属于这一类）——语义相近但非同一发生的候选组被硬凑，是几何相似度筛选本身引入的新噪声，
不是 prompt 设计能单独解决的。这条经验只解释了『为什么消灭了 umbrella』，不代表新架构
没有自己的错误来源。
