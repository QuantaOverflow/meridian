---
{
  "id": "experiment-mechanical-rest-scheme",
  "type": "experiment",
  "title": "REST机械方案诊断：七目标执行，重复引用不可表示及源抽取阻断旧核验",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": ["治事实关系错", "演化组合架构", "提高链路健壮性"],
  "scope": "mechanical-rest-v0.5，4既有候选+3源句TARGET，完整执行前置转换链，非端到端核验或独立验证",
  "source": "eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/REST-SCHEME-RESULT.md",
  "conditions": ["真实Workers AI REST/现有Wrangler会话，固定glm/thinking off，角色模型转换、受限字段机械生成，无远程judge/heldout", "每次最多一次全部错误反馈；规则冻结，无中途修订或后续扩采样", "引用要求唯一但schema缺occurrence，不支持报告词整句失败，自动对应/整句聚合尚未实现"],
  "evidence_origin": "local_record",
  "relations": [{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind": "prototype_evaluation",
  "outcome": "failed",
  "inputs": "p11/p12四候选与三源句，原radius2上下文；7逻辑/10HTTP，temperature0/修复0.1，max_tokens5000",
  "evaluation": "主Codex本地非盲对照原文/raw逐字段复核，contract_error与语义检错、正常抽取与正常整句保留分开；不将未知/接口失败计正确拒绝",
  "result": "无连接失败，4TARGET接口通过/3失败，3次反馈均未完整修复。通过5报告12确定字段正确/3would时间未知。p11-u抽取忠实但两said无法唯一引用，是接口不可表示缺陷；source3不支持declined拖垮said；p12源句上下文污染/改写引用未修好。两个旧错误均无完整自动检错结果，正常整句保留未验；自动对应/聚合未实现，方案验收未通过，不扩大融合",
  "cost": "10HTTP，8353input+912output=9265tokens，全部usage已知；累计请求34.098秒非墙钟/金额，美元未知；无后台worker",
  "record_completeness": "complete"
}
---

有限字段接管在条件成立时有效，但引用接口必须能够表达重复原文，不能让self-heal修复不可表示的合法内容。未支持行为要保留义务，不能将删除断言当修复。REST小样本连通不等于长期SLA或语义达标。
