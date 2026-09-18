---
{
  "id": "experiment-target-only-role-repair",
  "type": "experiment",
  "title": "目标句隔离、四引用接口与机械规范化消除既有转换阻断",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": ["治事实关系错", "提高链路健壮性"],
  "scope": "v0.7/v0.8/v0.9同七开发目标真实迭代与v0.9.1真实原输出离线回放，非独立验证或整句验收",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/TARGET-ONLY-RESULT.md",
  "conditions": ["抽取阶段仅TARGET，身份消歧独立暂缓；固定Workers AI REST/glm，无远程judge/heldout", "v0.8移除LLM复制与序号任务，四引用接口；v0.9代码报告词清单与遗漏/重叠真实错误反馈一次", "v0.9.1只对唯一长度保持大小写匹配还原原文及共享原主语明确and later兄弟报告截界，保留变换收据；底层精确校验不放宽"],
  "evidence_origin": "local_record",
  "relations": [{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind": "prototype_evaluation",
  "outcome": "mixed",
  "inputs": "p11/p12四既有候选三源句，同目标有限迭代，不扩大样本；各版原始失败保存",
  "evaluation": "主Codex本地原文/输出核对关键报告关系与64回归；未执行独立盲审或wholeClaimVerdict，词面守卫不证明语义完整",
  "result": "隔离后无邻句混入；v0.7仍复制字段错，v0.8仍漏独立报告/角色跨入报告词，v0.9恢复两said但源句大小写错及正常句命题跨界残留。v0.9.1不改原始模型输出回放七目标无锚点/重叠/词面漏项错误，十合法act、declined一未支持义务；身份消歧/完整覆盖/自动对应/整句验收未完成，非方案通过",
  "cost": "三真实轮共25HTTP/13051已知tokens，无连接失败；v0.9八HTTP/3842tokens/累计请求38.567秒；v0.9.1回放新增远程调用0，美元未知",
  "record_completeness": "complete"
}
---

先分离目标抽取与上下文消歧，避免供给更多上下文同时扩大抽取任务。机械复制、编号、窄原文规范化由代码接管；已知词面遗漏进入实际错误反馈，但不能据此证明全部语义覆盖。
