---
{
  "id": "attempt-plan-verify-backfill",
  "type": "attempt",
  "title": "组合草案：先规划、按需核验、同槽补位",
  "date": "2026-09-17",
  "status": "proposed",
  "tasks": [
    "治事实关系错",
    "演化组合架构"
  ],
  "scope": "仅 c36 开发样本；未使用 heldout，不代表完整组合或生产验收",
  "source": "eval/cluster-to-brief/arms/atomic-evidence/DESIGN.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "addresses",
      "to": "goal-cluster-to-brief"
    },
    {
      "type": "incorporates",
      "to": "mechanism-raw-candidate-discovery",
      "attributes": {
        "adaptation": "从成稿器提炼为高召回素材池"
      }
    },
    {
      "type": "incorporates",
      "to": "mechanism-shape-triage",
      "attributes": {
        "adaptation": "从选材控制器调整为结构分诊"
      }
    },
    {
      "type": "incorporates",
      "to": "mechanism-support-ranking",
      "attributes": {
        "adaptation": "从多源硬准入改为重要性排序"
      }
    },
    {
      "type": "incorporates",
      "to": "mechanism-evidence-isolation",
      "attributes": {
        "adaptation": "只隔离入选候选；不能把隔离当作事实正确保证"
      }
    },
    {
      "type": "incorporates",
      "to": "mechanism-specialist-question-gate",
      "attributes": {
        "adaptation": "仅保留接口；自动问题规划未通过，暂不执行融合"
      }
    }
  ],
  "hypothesis": "保留候选覆盖，只核验拟入选候选，失败后从同事件槽替补",
  "changes": "把核验所有候选改为按需核验；融合职责而不是三个成稿",
  "reason": "八句核验已耗时约 100 秒，全量 156 候选核验代价高；各 gate 的泛化仍未达标",
  "next_unknown": "规划覆盖与替补是否可用；核验及完整组合是否达标",
  "verification": "proposed"
}
---

保留候选覆盖，只核验拟入选候选，失败后从同事件槽替补
