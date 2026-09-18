---
{
  "id":"experiment-event-kernel-split",
  "type":"experiment",
  "title":"真实动作与参与者拆分：动作忠实，事件参与者仍混入报告层",
  "date":"2026-09-18",
  "status":"recorded",
  "tasks":["治事实关系错", "提高链路健壮性"],
  "scope":"v0.12四p12候选/源事件的真实拆分转换，既有开发样本，非独立验证",
  "source":"scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/EVENT-ARGUMENT-RESULT.md",
  "conditions":["固定Workers AI REST/glm，动作仅命题、参与者命题及原同句，无邻句/兄弟候选/远程judge/heldout", "8逻辑/16HTTP/12000tokens上限，单请求60秒，1次实际引用错误反馈；p11配对/解析复用旧输出", "代码要求动作词形和两参与者唯一对应，精确引用不计语义验收"],
  "evidence_origin":"local_record",
  "relations":[{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind":"prototype_evaluation",
  "outcome":"failed",
  "inputs":"p12正常/错误候选、源句部署/加速报告，共四事件八转换任务",
  "evaluation":"主Codex本地非盲原文与原始输出复核，语义错/接口错/未知分开；未执行独立准确率估计",
  "result":"四动作均忠实；四参与者仅部署正确，正常候选Analysts/announcement角色错，源加速The US主语错且对象过宽；错误候选额外字面引号反馈后仍接口失败。两个p12均不能配对；拆成动作与参与者未自动解决报告层/事件层混淆",
  "cost":"8逻辑/9HTTP/1787已知tokens/累计请求24.781秒，零连接失败；金额未知",
  "record_completeness":"complete"
}
---

自然语言引用合法仍可把报告者当事件主体；不能将拆小或模型自报作为改进证据。只证明本条件下参与者路径未成功，不直接归因模型一般能力或上下文工程的单一原因。
