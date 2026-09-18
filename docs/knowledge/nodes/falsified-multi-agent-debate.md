---
{
  "id": "falsified-multi-agent-debate",
  "title": "多智能体辩论（多个 agent 互相质疑）不是让小模型逼近大模型的手段：等算力下弱于简单多数投票",
  "date": "2026-09-15",
  "status": "live",
  "source": "外部文献，本仓未复现 —— arXiv:2311.17371（ICML 2024）+ arXiv:2604.02460",
  "invalidates_when": "出现在开放式长文本生成（非推理题）上、等 token 预算下测出 MAD 优于单 agent 的实测",
  "type": "lesson",
  "tasks": [
    "治事实关系错",
    "提高写作层覆盖"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "external_literature_not_reproduced",
  "relations": [],
  "legacy_type": "falsified",
  "legacy_relations": {},
  "kind": "failure_or_literature_warning"
}
---
**结论**：不要加「多个 agent 互相质疑 / 辩论」这一层来提升便宜模型的效果。

《Should we be going MAD? A Look at Multi-Agent Debate Strategies for LLMs》(ICML 2024,
arXiv:2311.17371)：在**等推理算力**下，multi-agent debate **可靠地弱于**简单的
self-consistency 多数投票。后续《Single-Agent LLMs Outperform Multi-Agent Systems on
Multi-Hop Reasoning Under Equal Thinking Token Budgets》(arXiv:2604.02460) 进一步确认：
等 token 预算下单 agent 的强 prompting 常常打平甚至超过多 agent 讨论，且**异质 agent 辩论
有时反而拉低群体表现**。

**为什么对本项目重要**：「用工程 harness 让便宜模型逼近强模型」最容易想到的形态就是多开几个
agent 互评。这条路等于把预算花在错的地方——同样的 token 花在单次更好的 prompt 或更长的
单遍推理上，期望收益更高。

**边界**：两篇的任务都是推理题（多跳问答、数学），**不是开放式长文本生成**。所以严格说它否掉的是
「MAD 是通用的等预算增益手段」这个更强的说法。但在没有反例之前，不该拿本项目的预算去赌它在
摘要写作上反而成立。

**与本仓已有结论的关系**：同族的失效模式是 [[falsified-intrinsic-self-correction]]——
两者都指向「让模型互相看/自己看，而不引入外部证据，买不到质量」。
