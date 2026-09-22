---
{
  "id": "experiment-minimal-fields",
  "type": "experiment",
  "title": "固定命题单字段诊断：显式否定仍漏检，混合任务也有局部干扰",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": ["治事实关系错", "演化组合架构"],
  "scope": "minimal-fields-v0.4；3真实开发命题与1明确合成否定对照，人类固定报告verb/命题，字段分类而非端到端",
  "source": "eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/MINIMAL-FIELDS-RESULT.md",
  "conditions": ["同一冻结输入单字段3请求与三字段组合1请求，另2polarity新请求重复，原文/radius2上下文保留", "先验参考本地测试冻结，提示含通用字段定义，无参考标签入模型；无self-heal、远程judge、heldout或融合", "would conditional/future有类别边界，不能与显式did not漏检混为同强度语义错"],
  "evidence_origin": "local_record",
  "relations": [{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind": "prototype_evaluation",
  "outcome": "mixed",
  "inputs": "真实glm-4.7-flash，18逻辑首次HTTP全部接口通过，temperature0，max_tokens5000；m1 warn/will，m2 confirmed/had already，m3 told/would undermine，m4合成said/did not",
  "evaluation": "主Codex本地对照原文和raw逐字段复核，预注册参考与边界争议分别记录，未提供自动整句成绩",
  "result": "单字段与组合均参考10/12；明确polarity错分别1/4与2/4。did not独立和组合均被判positive，最小任务错误存在；would undermine独立及一次重复positive正确，组合negative错误，局部支持任务混合干扰但无整体净胜证据。warn/future与confirm/completed固定输入均正确；窄代码对照12/12但不证明一般scope或端到端",
  "cost": "18HTTP/18逻辑，9887input+168output=10055tokens，全部usage已知，累计请求22.431秒非墙钟/金额，金额未知；服务关闭",
  "record_completeness": "complete"
}
---

当前模型/提示/schema条件下不能仅靠继续拆分保证可靠，不能外推所有LLM能力上限。代码能明确处理的词法字段优先机械化，开放语义与上游角色/命题抽取仍未解决。本轮不扩大融合，保留旧不同条件实验。
