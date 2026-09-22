---
{
  "id": "experiment-selection-ndcg-baseline",
  "type": "experiment",
  "title": "选择层排序 NDCG@10=0.958（新 CoT importance rubric + 覆盖度对数加权），rubric 贡献 +0.068、覆盖度只贡献 +0.018",
  "date": "2026-06-06",
  "status": "recorded",
  "tasks": ["设计验收门"],
  "scope": "排序键 `importance + COVERAGE_WEIGHT·log2(1+独立源数)`，importance 来自当时的 story-validation LLM 4 维 CoT rubric；这把尺量的是**已退役**的排序键，不代表当前生产排序公式，见 [[lesson-selection-formula-never-measured]]",
  "source": "scripts/eval/selection/BASELINE.md；commit 0b43902（2026-06-06，feat(eval): 选择层工具转正 + NDCG 基线 0.958 + 防回归闸）；commit 4ebd969（feat(brief): importance 升级为 4 维 CoT rubric + 选择层 prompt eval 工具）",
  "conditions": [
    "gold 来源：5 run，2026-06-03~2026-06-04，gold 类型是「silver 派生」（人工快标而非独立精标），BASELINE.md 自陈「绝对值略乐观」",
    "gold 共 47 条 rel≥2 的强相关样本",
    "W(COVERAGE_WEIGHT)=1.0 处于最优平台，W∈[0.25,1.0] 区间 NDCG 完全相同，未做进一步校准",
    "0.958 由 rescore.ts 实时重打分算得（非离线冻结 CSV 分数），每次跑约 117 次 LLM 调用",
    "单点存疑：UK-Rwanda 遣返协议终止一条（gold rel=2），新 rubric 打 imp=2（对应文中 d=1001），全 47 条 rel≥2 里仅此 1 条不一致，n=1 无统计意义，BASELINE.md 明确写「不要动 rubric」",
    "回归闸用法：`tsx rescore.ts --baseline 0.958 --tolerance 0.02`，NDCG<0.938 时非零退出，用于防止 storyValidation.ts 的 importance prompt 回归"
  ],
  "evidence_origin": "local_record",
  "relations": [
    { "type": "yields", "to": "lesson-selection-formula-never-measured" }
  ],
  "kind": "probe",
  "outcome": "passed",
  "inputs": "5 run（2026-06-03~04）产出的候选 story 列表，人工快标 47 条 rel≥2 强相关金标（silver）",
  "evaluation": "NDCG@10 宏平均，对照三档排序键：纯旧 importance(W=0)、旧 importance+覆盖度、新 CoT rubric importance+覆盖度",
  "result": "纯旧 importance（无覆盖度）NDCG@10=0.872；旧 importance+覆盖度=0.890；新 CoT rubric importance+覆盖度（当时的当前配置）=**0.958**。分解贡献：rubric 本身贡献 +0.068（0.890→0.958 之外，需对照同一基线；BASELINE.md 原文直接给出这两个增量数字，rubric 是大头），覆盖度贡献 +0.018（0.872→0.890）。",
  "cost": "每次跑约 117 次 LLM 调用（rescore.ts 实时重打分），单次调用成本未记录",
  "record_completeness": "summary_only"
}
---

## 这把尺量的是什么、不量什么

NDCG@10=0.958 这个数字对应的排序键是 `importance + COVERAGE_WEIGHT·log2(1+独立源数)`，
其中 `importance` 来自 `storyValidation.ts` 的 LLM 4 维 CoT rubric（1-10 分）。这套排序键
在 2026-06 是生产配置。**它现在不是了**——见 [[lesson-selection-formula-never-measured]]。

## 贡献分解怎么读

BASELINE.md 给的三行对照表本身没有显式标出「相对谁的增量」，但按数值可以还原：
0.872（纯 importance）→0.890（+覆盖度，增量 +0.018）→0.958（旧 importance 换成新 CoT
rubric，同时保留覆盖度，增量 +0.068）。**rubric 换代的收益是覆盖度加权的将近 4 倍**，
这也是为什么 BASELINE.md 强调"大头是被删掉的那个"——见下一节点里 storyline.ts 代码注释
对这句话的呼应。

## 局限：这是 silver gold、单点样本量为 1

47 条 rel≥2 里只有 1 条 rubric 打分与 gold 不一致（UK-Rwanda 遣返协议），BASELINE.md
自己的结论是"n=1 无统计意义，不要因为这一条调 rubric"——这是一个值得记住的反面例子：
**单点分歧不构成调整依据**，尤其是在 gold 本身是"人工快标"而非独立精标、作者自陈"绝对值
略乐观"的前提下。
