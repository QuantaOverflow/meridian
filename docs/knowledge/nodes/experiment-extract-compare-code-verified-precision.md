---
{
  "id": "experiment-extract-compare-code-verified-precision",
  "type": "experiment",
  "title": "代码坐实的数字/日期硬冲突（extract-compare 通道）精度实测 0.833~1.0，真金标修 3 弄坏 0",
  "date": "2026-07-11",
  "status": "recorded",
  "tasks": ["治事实关系写错", "设计验收门"],
  "scope": "extract-compare.ts 的 LLM 抽取（逐字引用、禁算术）+ 代码比对（区间相交判冲突）通道；对照对象是 intel-grounding 金标集（真实）与另一份合成集",
  "source": "services/meridian-ai-worker/src/services/extract-compare.ts:10-12；services/meridian-ai-worker/src/services/faithfulness-check.ts:18-19（门 F 条款 C 引用同一读数：「精度 0.833~1.0」）",
  "conditions": [
    "真金标集与合成集的具体样本量、来源脚本未在本文件中给出，标记未知（extract-compare.ts 注释指向 scripts/eval/intel-grounding/extract-compare-eval.ts，本轮未核实该脚本是否仍存在）",
    "0.833~1.0 是两个数据集上精度的区间描述，不是单一精确值——本节点原样保留区间，不折算成单点"
  ],
  "evidence_origin": "local_record",
  "relations": [
    { "type": "yields", "to": "lesson-veto-power-must-match-evidence-certainty" }
  ],
  "kind": "probe",
  "outcome": "passed",
  "inputs": "intel-grounding 真金标集 + 一份合成金标集，跑 extract-compare 通道产出的硬冲突判定",
  "evaluation": "对比通道判定的硬冲突数与金标标注冲突数，统计『修对多少条、弄坏多少条』（fix/break）与精度",
  "result": "真金标：修 3 条弄坏 0 条；contradicted 召回从 0.25 升到 0.625；supported 精度同时反升（说明修正不是靠放宽标准换来的）。合成集：修 3 条弄坏 0 条，精度保持 1.0。综合精度实测区间 0.833~1.0。",
  "cost": "未知",
  "record_completeness": "summary_only"
}
---

## 读数原文

`extract-compare.ts:10-12`：

> 只在代码坐实硬冲突且抽取自报 high confidence 时产出 conflict（单向信号，只用于把
> 判定推向 contradicted，绝不反向"洗白"）。离线验证（2026-07-11，intel-grounding 金标）：
> 真金标修 3 弄坏 0（contra 召回 0.25→0.625、supported 精度反升），合成集修 3 弄坏 0、
> 精度保 1.0。

`faithfulness-check.ts:18-19`（门 F 条款 C 引用同一批读数作为单票否决的依据）：

> 硬冲突（extract-compare 通道），确定性证据允许单票否决——离线实测修 6 弄坏 0、
> 精度 0.833~1.0，恢复 6-25 双阈牺牲掉的孤条真矛盾灵敏度

注：两处引用的「修 3 弄坏 0」（真金标+合成集分别各 3 条，合计 6）与门 F 条款 C 引用的
「修 6 弄坏 0」对得上（两个数据集的修复条数相加）。

## 为什么这条不随架构死

这条读数说的是一种通用模式：**当判定依据能被拆成「LLM 只做检索/抽取（不判断、不算术）+
代码做确定性比对」时，比对结果的精度可以远高于让 LLM 直接给判决**。这里的分工反转
（LLM 找『同一事实的对应值』，代码做区间相交判断）之所以有效，是因为它把 LLM 最弱的环节
（数值心算/大小比较）整个移出了判定链路。这个思路不依赖 faithfulness 这一具体场景，
换任何『LLM 判断两个数值是否冲突』的任务都能复用。

## 关联

与 [[experiment-faithfulness-single-vote-veto-risk]] 一起产生
[[lesson-veto-power-must-match-evidence-certainty]]：同样是单票否决，这里的确定性证据配得上，
纯 LLM 判决配不上。
