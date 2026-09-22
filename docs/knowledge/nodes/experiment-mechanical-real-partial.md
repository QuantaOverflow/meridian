---
{
  "id": "experiment-mechanical-real-partial",
  "type": "experiment",
  "title": "机械接管真实部分运行：正常句字段路径连通，两次连接失败后停止",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": ["治事实关系错", "演化组合架构"],
  "scope": "mechanical-v0.5真实glm；计划7开发TARGET，仅p11正常候选完成，源句两次基础设施失败，5未运行",
  "source": "eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/MECHANICAL-REAL-RESULT.md",
  "conditions": ["用户明确要求真实重跑，角色由LLM抽取，受限字段由代码生成，不调用远程judge/heldout", "首个Network connection lost审计预留并重启一次，剩余第二尝试仍失败即停，不再恢复；服务关闭"],
  "evidence_origin": "local_record",
  "relations": [{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind": "prototype_evaluation",
  "outcome": "not_evaluated",
  "inputs": "冻结p11/p12七TARGET角色请求与radius2源上下文；真实glm-4.7-flash，temperature0/恢复0.1，max_tokens5000",
  "evaluation": "主Codex对唯一正常候选结果逐字段复核；无源句对应/整句接受模块或错误题结果，基础设施失败不计模型质量失败",
  "result": "p11正常候选两个报告角色忠实，reporters为听众，机械told/said均say、两命题positive、would时间unknown、was worded completed。source sentence3两次HTTP500 Workers AI binding Network connection lost，旧错误题及其余源文未运行，不能估核验收益或self-heal效果；不扩大融合",
  "cost": "3HTTP/2逻辑，唯一成功478input+74output=552已知tokens；2失败usage未知，第一次预算预留11292非实测/可靠上界，第二次未知未恢复，账11844非总usage；累计请求14.399秒非墙钟，金额未知",
  "record_completeness": "complete"
}
---

本轮只验证真实角色请求与机械字段路径实际连通，未验证旧错误检测。一次连接故障恢复后再次失败停止，保留环境故障事实，不将其写成方案语义淘汰依据。
