---
{
  "id": "experiment-structured-verifier-local",
  "type": "experiment",
  "title": "结构核验组件本地测试：代码可诊断三类参考错误，但真实转换未验且两正常整句pending",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": ["治事实关系错", "演化组合架构"],
  "scope": "structured-v0.2，6题人工参考结构与29本地测试；非模型准确率、非独立验证，不读heldout",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/LOCAL-RESULT.md",
  "conditions": ["参考结构与对齐人工指定，不进入模型；真实Workers AI调用因缺明确数据发送授权尚未运行", "候选/证据context-v2参考判断由主Codex非盲本地复核"],
  "evidence_origin": "local_record",
  "relations": [{"type": "yields", "to": "lesson-relation-factor-observability"}],
  "kind": "prototype_evaluation",
  "outcome": "observed",
  "inputs": "p11/p12/p20正常/错误对，人工相关结构切片；14题适用性盘点；synthetic接口/边界控制与mocked fetch",
  "evaluation": "实际node --test 29项通过，runner dry-run和oracle实际运行；主agent逐项核对，人工图测试与真实NL转换分账",
  "result": "人工结构下说话人换位输出speaker冲突，状态强化和数量状态错接输出字段not_established。三正常已表示义务保留，仅p12整体pass，p11/p20因scope残留pending。负控制显示转换器遗漏第二断言却假报整句覆盖可导致code pass；semanticCoverageVerified始终false。未知状态/空单位误放行和十进制误差已复现修复；模型结构忠实性、独立验证与完整组合未测",
  "cost": "新远程被测请求0/token0；mock21逻辑调用仅测传输编排，不是模型用量；人工与本地耗时未计，金额未知",
  "record_completeness": "complete"
}
---

不能称旧核验问题已解决：本轮只证明在人工参考结构条件下的窄业务代码能力。正常scope pending和未声明的语义遗漏仍是边界。下一步须获数据发送授权，冻结版本后跑真实转换与同上下文对照；pending不计为语义检错成功。
