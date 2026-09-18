---
{
  "id": "measure-pipeline-cascade-loss",
  "title": "逐级有损压缩的流水线会系统性丢信息，这是独立文献观测到的现象，不是本仓孤例",
  "date": "2026-09-15",
  "status": "live",
  "source": "外部文献，本仓未复现 —— arXiv:2502.06617 + arXiv:2505.24575 (NexusSum, ACL 2025)",
  "invalidates_when": "级间传递改成无损形态（原文切片或叙事散文）后，仍然测出同等的级联损失",
  "type": "lesson",
  "tasks": [
    "改报告层结构"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "external_literature_not_reproduced",
  "relations": [],
  "legacy_type": "measurement",
  "legacy_relations": {
    "supports": [
      "method-two-fighting-readings"
    ]
  },
  "kind": "observation"
}
---
**读数**：《Scaling Multi-Document Event Summarization: Evaluating Compression vs. Full-Text
Approaches》(arXiv:2502.06617, 2025) 在「每个摘要约 100 篇源文档」的规模上对照两类系统——
全文/长上下文 vs 压缩流水线（检索增强、层级式、增量式三种）。结论：**压缩方法因多阶段流水线
加缺乏全局上下文而系统性损失信息**，论文明确把该现象归因为**级联误差**，并建议混合方法。

这是独立实测（非厂商自证），簇规模（~100 篇）比本项目（6–14 篇）更极端。

**理论背景**：「下游无法恢复上游丢弃的信息」在信息论里有形式化名字——
**data processing inequality**。所以本仓那条「收益守恒」的观察（在一处减少损失、它在另一处出现）
不是工程直觉，有形式化支撑。

**可抄的反面设计**：NexusSum(ACL 2025, arXiv:2505.24575) 的三段式流水线在长叙事摘要上相对基线
BERTScore F1 提升最高 30%，而它的关键取向是**各级之间始终传递叙事散文**，不把中间产物压成
事实条目或一个整数。本仓现行实现正相反：原文 → 无序事实句 → 一个整数票数 → 写作层只看压缩表示。

**可操作的推论**：**该改的是级间传什么，不是要不要分级。** 分级形态被
[[falsified-endtoend-longcontext-mds]] 支持（端到端更差），而级间的有损压缩被本条否定。
两条合起来指向：保留分级，把级间传递从「压缩代理」换成「原文切片或叙事散文」。

**边界**：2502.06617 是「压缩流水线整体 vs 全文整体」的类别对比，**不是逐级消融**——
没有「去掉某一级压缩、保留其余」的控制变量实验。所以它支持方向判断，但不能告诉我们
本仓哪一级损失最大。逐级归因（如 error-analysis-path2-attribution 那类）在文献里没有先例可抄。
