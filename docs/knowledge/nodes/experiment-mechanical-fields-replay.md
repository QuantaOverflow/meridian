---
{
  "id": "experiment-mechanical-fields-replay",
  "type": "experiment",
  "title": "机械字段接管回放：明确词法错误修复，would和复杂scope保留未知",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": ["治事实关系错", "演化组合架构"],
  "scope": "mechanical-v0.5，既有v0.4四固定命题和v0.3七角色目标离线回放；非独立或端到端验证",
  "source": "eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/MECHANICAL-RESULT.md",
  "conditions": ["reportMode/eventState/polarity由有限词典和受限英语单谓语模板代码生成，roles仍LLM，unknown不回退模型", "旧raw/原文保留；新增机械runner仅dry-run和模拟网络测试，未真实重跑角色prompt/错误反馈", "主Codex本地复核开发回放；would时间、嵌套、外部否定/未知语法保留unknown"],
  "evidence_origin": "local_record",
  "relations": [{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind": "prototype_evaluation",
  "outcome": "mixed",
  "inputs": "minimal-fields-v0.4真实results四固定命题（其中1合成）及split-heal-v0.3真实results/plan七目标；代码mechanical-v0.5",
  "evaluation": "代码回放与主Codex对照冻结原文逐字段复核；新增接口失败、语义错误修复与未知分别计；新增45总本地测试通过不算语义覆盖证书",
  "result": "固定12字段11确定正确/1would时间未知，修复旧3条明确polarity错误记录。七角色目标3通过新接口/3新增接口失败/1历史失败未恢复；拦he词内假锚点、长报告verb和伪报告动作；重复said无法唯一定位引入2引用错误，不计语义成功。新模式不发LLM状态请求；role覆盖/命题/整句核验仍未解决，未融合",
  "cost": "本轮0远程调用/0远程token；既有raw回放和本地测试，无新增账单",
  "record_completeness": "complete"
}
---

代码严格限定词法范围，并提供规则和原文线索；没有否定词不普遍等于肯定。机械字段能力不能证明上游语义抽取或端到端核验正确。新角色错误反馈全列表的真实效果仍待验。
