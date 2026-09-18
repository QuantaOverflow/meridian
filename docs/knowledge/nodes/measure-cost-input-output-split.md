---
{
  "id": "measure-cost-input-output-split",
  "title": "抽取这一步 62.2% 的 neurons 是输出；去重/各方/写作层反过来（输入 66–74%）",
  "date": "2026-09-14",
  "status": "live",
  "source": "apps/backend/prototypes/cost-split/out/REPORT.md",
  "invalidates_when": "换模型或换计价（公式里的两个 rate 常数就得重测）",
  "type": "lesson",
  "tasks": [
    "降低报告层成本",
    "降低写作层成本"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "supersedes",
      "to": "claim-output-bound-cost"
    }
  ],
  "legacy_type": "measurement",
  "legacy_relations": {
    "supersedes": [
      "claim-output-bound-cost"
    ]
  },
  "kind": "observation"
}
---
| 步骤 | 调用数 | 输入占比 | 输出占比 |
|---|---:|---:|---:|
| **extract** | 319 | **37.8%** | **62.2%** |
| dedup | 527 | 67.8% | 32.2% |
| voices | 18 | 72.5% | 27.5% |
| relations / write | 48 | 66–74% | 26–34% |

**这解释了为什么五次降本实验全部落空**：它们砍的都是输入，而抽取——报告层成本的一半——大头在输出。
旁证：另一套完全不同的抽取表示（srl-compress）输出占比 87.2%，说明这是**抽取任务本身的性质**
（模型要把选中的事实完整写出来），不是某套 prompt 措辞的偶然。

**换算公式可信**：`neurons ≈ prompt_tok × 0.00545 + completion_tok × 0.0364`，933 次调用逐条对账，
均值误差 −0.53%、标准差 0.16pp、最大 −0.85%。以后估成本直接用它，不必再跑实测。
固定指令开销占每次抽取 prompt 字符的 46.3%（≈486 token/次）。
