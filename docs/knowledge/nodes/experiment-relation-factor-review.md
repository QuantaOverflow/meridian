---
{
  "id": "experiment-relation-factor-review",
  "type": "experiment",
  "title": "回读核验输出：断言遗漏、关系不等价、数值状态错拼与拒绝理由越界",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": ["治事实关系错", "演化组合架构"],
  "scope": "practice-v1 七个已知错误题的现有 baseline/rules 输出；非盲回顾，未新增模型调用",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/RELATION-ANALYSIS.md",
  "conditions": ["候选、原句和原模型输出均来自已完成练习；不能识别隐藏推理阶段"],
  "evidence_origin": "local_record",
  "relations": [{"type": "yields", "to": "lesson-relation-factor-observability"}],
  "kind": "retrospective_analysis",
  "outcome": "observed",
  "inputs": "p08/p11/p12/p14/p20/p21/p29 的错误句、冻结证据及两路线检查输出",
  "evaluation": "当前 Codex 直接回读原文和检查理由；没有新模型、远程 judge、独立样本或盲审",
  "result": "p14 未核验第二断言；p21/p12 关系不等价仍 supported；p20 分开支持数值与状态后错拼；p08 正确拒绝但理由加入无证据 Lloyd Austin。候选/证据关系抽取未单独记录，架构/提示词/能力归因未解。14题三臂新探针已写但被安全审批拦截，未运行",
  "cost": "新增被测模型请求0、token0；本地实现与阅读耗时未计，金额未知",
  "record_completeness": "complete"
}
---

详见 source。探针接口三项测试和 fixture 检查通过，typecheck 四项缓存命中；这些不证明关系接口有效。未改生产、未提交部署、未读 heldout。
