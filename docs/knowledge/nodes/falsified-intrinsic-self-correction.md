---
{
  "id": "falsified-intrinsic-self-correction",
  "title": "无外部证据的自我修正会让质量下降（GSM8K 95.5%→91.5%）；自检必须挂到原文",
  "date": "2026-09-15",
  "status": "live",
  "source": "外部文献，本仓未复现 —— arXiv:2310.01798（Huang et al. 2023）",
  "invalidates_when": "自检环节被改成对着原文/检索证据判，且判官独立于生成模型——那时它不再是 intrinsic self-correction",
  "type": "lesson",
  "tasks": [
    "治事实关系错",
    "设计验收门"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "external_literature_not_reproduced",
  "relations": [
    {
      "type": "supports",
      "to": "falsified-rarr-default-on",
      "attributes": {
        "scope": "无外部证据的自我修正会让质量下降（GSM8K 95.5%→91.5%）；自检必须挂到原文；自检环节被改成对着原文/检索证据判，且判官独立于生成模型——那时它不再是 intrinsic self-correction"
      }
    }
  ],
  "legacy_type": "falsified",
  "legacy_relations": {
    "supports": [
      "falsified-rarr-default-on"
    ]
  },
  "kind": "failure_or_literature_warning"
}
---
**结论**：让模型在**没有外部 ground truth / 检索证据**的情况下审查并修改自己的输出，
准确率**反而下降**。《Large Language Models Cannot Self-Correct Reasoning Yet》
(arXiv:2310.01798) 实测 GSM8K 从 **95.5% 降到 91.5%**。

机制：LLM 缺乏**自主发现错误**的能力。错误被明确指出后它改得动，但让它自己找错就会开始改对的东西。

**为什么对本项目重要**：这解释了本仓在 RARR 上观测到的现象（43 条删除里 20 条是误删，
且加 prompt 约束反而更差；见 [[falsified-rarr-default-on]]）——那**不是本项目的个例，是一个
有名字的一般现象**在不同任务上的复现。同样地，写作层「自检找漏两段式」若做成纯自我审视，
文献预期它会伤质量；它必须对着原文判。

**可操作的推论**：任何「让模型回头检查自己写的东西」的步骤，都要先回答一个问题——
它手里有没有生成时没有的新信息（原文、检索结果、独立判官）。没有新信息就不要加这一步。

**边界**：实测任务是推理题（GSM8K 等），不是摘要。但本仓已在摘要侧独立观测到同向结果
（[[rarr-verification-overdeletion]]、[[falsified-rarr-default-on]]），两边互相印证。
