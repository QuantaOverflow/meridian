---
{
  "id": "experiment-candidate-grouping-prompt-model-scan",
  "type": "experiment",
  "title": "整簇送 LLM 切子故事：7 个 prompt 变体召回全落 16-23/31（不改基线 22 分最高），3 个高档模型硬配对全中、deepseek-v4-pro 最严重 52%",
  "date": "2026-08-21",
  "status": "recorded",
  "tasks": ["治故事过拆", "改聚类/切分链路"],
  "scope": "story-validation 旧形态（整簇送 LLM，模型自己在 ~100 篇的簇里划出所有子故事），2026-08-20/21 两天扫描；prompt 变体与模型对照均在同一批数据上做",
  "source": "commit 9bef77b（2026-08-21，feat(story-validation): 几何候选组 + 判官/复核两段式,替换整簇送 LLM）提交说明第二段；apps/backend/src/lib/core/candidate-grouping.ts:5-7",
  "conditions": [
    "『31』是本次评测口径下的真实事件总数，『22』是『什么都不改』的基线召回，7 个变体（含加穷尽契约、加 unassigned 出口）无一超过 22",
    "『硬配对』指模型把不属于同一事件的成员强行配成一对/一组——三个模型（gpt-oss-120b / deepseek-v4-pro / kimi-k2.6）在同一批数据上全部出现这个失败，deepseek-v4-pro 最严重、发生率 52%",
    "commit message 未逐一列出 7 个 prompt 变体的具体差异，只说明其中包含『加穷尽契约』『加 unassigned 出口』两类；候选组内的病灶另见 storyValidation.ts 旧版关于 outliers 数组只存在于 single_story 分支的记录（该文件已随本次架构替换删除）",
    "根因判定引用了 kimi-k2.6 的思维链原文：'This implies that for collection_of_stories, you may NOT exclude articles... Thus pure_noise is correct.'——即模型在没有『部分覆盖』这个合法出口时，会把整簇判成全对或全错，这解释了为什么单纯加 unassigned 出口这个 prompt 变体也没能救回召回"
  ],
  "evidence_origin": "local_record",
  "relations": [
    { "type": "yields", "to": "lesson-llm-cannot-partition-event-sets" }
  ],
  "kind": "probe",
  "outcome": "failed",
  "inputs": "同一批含约 31 个真实事件的簇数据；7 个 story-validation prompt 变体（原版 + 6 个改动，含穷尽契约与 unassigned 出口两类）；3 个高档模型（gpt-oss-120b / deepseek-v4-pro / kimi-k2.6）与原判官模型的硬配对对照",
  "evaluation": "人工核对模型输出的事件划分是否与真实事件对应（召回=正确识别的事件数/31）；硬配对率=模型把不同事件的成员错误配对的发生率",
  "result": "prompt 层面：7 个变体召回全部落在 16-23/31 区间，无一超过『什么都不改』的基线 22——说明问题不是某个 prompt 细节缺失。模型层面：三个比原判官更高档的模型全部出现硬配对错误，其中 deepseek-v4-pro 最严重（52% 发生率）——说明问题也不是模型档次不够。两条对照共同排除了『prompt 问题』与『模型档次问题』两个最直接的假设，指向任务形态本身：让 LLM 对一个数十元素的集合做穷尽切分，是这个任务类型做不到的，不是某个实现细节的问题。",
  "cost": "未知（commit message 未记录本次扫描的调用量或费用）",
  "record_completeness": "summary_only"
}
---

## 读数原文

commit 9bef77b 提交说明：

> 这不是 prompt 或模型档次问题，已实测排除：七个 prompt 变体（含加穷尽契约、加 unassigned
> 出口）召回全落在 16-23/31，无一超过「什么都不改」的 22；gpt-oss-120b / deepseek-v4-pro /
> kimi-k2.6 三个高档模型硬配对全中，deepseek 最强也最严重（52%）。

`candidate-grouping.ts:5-7` 头注释是同一结论的精简复述，措辞把「deepseek 最强也最严重」
简化成「deepseek 最严重」——本节点以提交说明（更完整的原文）为准。

## 为什么两条对照要放在一起看

单独看任何一条都可能被解释成局部问题（『这个 prompt 没写好』或『模型不够强』），
只有两条同时失败、且都在同一批数据上做过对照，才能排除这两个最容易被想到的补救方向。
这正是排除替代解释的方法：先把最省成本的两种修法（改 prompt、换模型）都实测过、
都不起效，才有理由往『任务形态本身不适合 LLM』这个更深的结论走——否则很容易在
『再试一个 prompt』『再换一个模型』上无限打转。

## 关联

产生 [[lesson-llm-cannot-partition-event-sets]]。这条实验解决的『整簇送 LLM 切子故事』
架构问题，其替换方案（几何候选组 + 逐组判定）带来的『人工严口径精度 41.7%→89-92%』
已经在 [[experiment-story-validation-architecture-error-taxonomy]] 与
[[experiment-story-validation-verify-stage-tradeoff]] 中记录，本节点不重复那个数字，
只记录『为什么必须换架构』这一步的排除性证据。
