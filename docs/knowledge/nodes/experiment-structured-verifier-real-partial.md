---
{
  "id": "experiment-structured-verifier-real-partial",
  "type": "experiment",
  "title": "真实结构核验部分烟测：证据漏报告关系、图错对齐，未知不算正确检错",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": ["治事实关系错", "演化组合架构"],
  "scope": "glm-4.7-flash，structured-v0.2/context-v2，p12-u完整与p11-u部分；计划6题未跑满，非盲开发诊断",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/REAL-RESULT.md",
  "conditions": ["用户要求真实LLM后审批通过，候选/证据独立转换；无参考图/标签入模型，无远程judge", "一次AI binding连接丢失后审计重启并最多恢复一次，未知usage留预算reserve；预算停止后服务关闭"],
  "evidence_origin": "local_record",
  "relations": [{"type": "yields", "to": "lesson-relation-factor-observability"}],
  "kind": "prototype_evaluation",
  "outcome": "failed",
  "inputs": "冻结6题opaque计划，实际8HTTP/6逻辑请求，1完整题/1部分题，4题未运行；temperature0及第二尝试0.1，max_tokens5000",
  "evaluation": "主Codex本地对照冻结原文与raw逐字段审查；契约通过不计语义通过；pending不计精确检错，无正常或数量模型结果",
  "result": "p12-u候选保留错误，但证据漏analysts warn报告fact、错recipient且重复；alignment错把Analysts与Troy Meink等同，fact配到部署报告。代码proposition_identity_required返回未知，baseline仍误放行。p11-u两候选尝试图指针/引文失败，证据覆盖失败。未证明解决旧核验问题，不扩大融合；拆小转换及ID命名空间化仅待验证候选",
  "cost": "8HTTP，其中7有usage共11537input/5623output=17160已知tokens；1失败usage未知。保守reserve15576，预算账32736达到30000停止线；累计请求123.187秒非墙钟/账单，美元金额未知",
  "record_completeness": "complete"
}
---

本地oracle通过与真实转换失败分别保存，不能将局部正确代码能力当成NL核验链路效果。主要新信号是字段转换和结构对应本身仍有不忠实问题；独立转换及窄枚举不足以自动建立可靠比较前提。未知仅避免了这一题被放行，不能证明错误诊断或正常保留。本轮服务关闭，无生产/heldout变化。
