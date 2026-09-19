---
{
  "id": "mechanism-shape-triage",
  "type": "mechanism",
  "title": "结构分诊，不直接控制最终选材",
  "date": "2026-09-17",
  "status": "candidate",
  "tasks": [
    "治事实关系错",
    "演化组合架构"
  ],
  "scope": "仅 c36 开发样本；未使用 heldout，不代表完整组合或生产验收",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/DESIGN.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "justified_by",
      "to": "lesson-three-arm-tradeoff"
    }
  ],
  "input": "簇内文章",
  "output": "单事件、多事件或不可写的结构判定",
  "limits": "从 router 提炼的新职责边界；不是旧取样控制器的已验证效果2026-09-19 heldout c51(116 篇、多主题混合的超级袋)判成 `single_story`(主导成分 62/116 = 53.4%、margin 50%)，而期望是拆 ≥3 块——**「是不是一件事」的判定在多主题混合的大簇上不可靠**。该轮无后果(拆块由写作层做，两个臂都拆了 5 块)，但若将来有链路把它的判定当结论而非建议，这里就是失效点。",
  "invalidates_when": "从 router 提炼的新职责边界；不是旧取样控制器的已验证效果",
  "verification": "development_signal_only"
}
---

从 router 提炼的新职责边界；不是旧取样控制器的已验证效果
