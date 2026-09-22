---
{
  "id": "experiment-faithfulness-single-vote-veto-risk",
  "type": "experiment",
  "title": "单条 claim 一票否决整篇简报：12 条 held-out 实测误拦 2/12，两条都是单条 claim 的判定噪声",
  "date": "2026-06-25",
  "status": "recorded",
  "tasks": ["治事实关系写错", "设计验收门"],
  "scope": "旧门 F 判据（改动前）：contradicted >= 1 即拦（单票否决），judge=qwen-max；评测对象是完整的 20K 字简报级 block/pass 决策，不是单条 claim 级判决",
  "source": "services/meridian-ai-worker/src/services/faithfulness-check.ts:24-28（【2026-06-25 改】段落）；同文件 490-521 行 gateDecision() 为改动后的实现",
  "conditions": [
    "12 条 held-out 样本的来源、抽样方法未在本文件中给出，标记未知",
    "RUNS=5 确定型（原文用语）：同一 brief 判定被重复跑 5 次以核实是否稳定复现同一误拦结果，具体复现率未给出数字，只给出定性结论「确定型」",
    "两条误拦案例的性质：数字子量消歧、转述归属——均属于事实通道内部的边界判定分歧，不是判官完全离谱的误判"
  ],
  "evidence_origin": "local_record",
  "relations": [
    { "type": "yields", "to": "lesson-veto-power-must-match-evidence-certainty" }
  ],
  "kind": "probe",
  "outcome": "failed",
  "inputs": "12 条 held-out 简报，套用旧判据（contradicted claim 计数 >=1 即 block）",
  "evaluation": "人工复核每条被 block 的简报，判定该次拦截是否为误拦（简报本身忠实，拦截由判官对单条 claim 的噪声判定触发）",
  "result": "12 条里 2 条被误拦，误拦原因均为单条 claim 被判 contradicted，且该判定不稳定（RUNS=5 下仍复现，属于系统性偏见而非随机抖动）；两条误拦案例分别是数字子量消歧和转述归属边界情况。据此把门判据从『contradicted>=1 即拦』改为『占比>=0.05 且 count>=2』的双阈。",
  "cost": "未知",
  "record_completeness": "summary_only"
}
---

## 读数原文

`faithfulness-check.ts:24-28`：

> 【2026-06-25 改】(A) 从「contradicted >= 1 单条即拦」改为占比+count>=2 双阈（FActScore/RAGAS
> 占比聚合 + RefChecker 三标签分别算 rate 的业界共识）。动因：12 条 held-out 实测误拦 2/12，两条
> 都是单条 claim（数字子量消歧 / 转述归属）否决整篇 20K 字简报，且 RUNS=5 确定型。一票否决 = 放大器。

## 这条实验证明了什么

不是『这批 judge 判得不准』，而是**任何基于单条 LLM 判决的一票否决机制，都会把该判决的噪声
放大成整个产出的生杀权**——12 条里 17%（2/12）因为一条边界判定就被拦掉一份 20K 字的合格简报，
放大倍数是「一条 claim 的错误」→「整篇被拒」。改双阈之后代价是「单条真矛盾暂时漏判」
（文件同段落原文承认），这是精度换鲁棒性的取舍，不是免费修复。

## 关联

产生 [[lesson-veto-power-must-match-evidence-certainty]]；与
[[experiment-extract-compare-code-verified-precision]] 的『确定性证据单票不牺牲精度』
形成对照——同样是单票否决，代码坐实的硬冲突配得上单票，LLM 单条判决配不上。
