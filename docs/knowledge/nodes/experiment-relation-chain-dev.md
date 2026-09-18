---
{
  "id": "experiment-relation-chain-dev",
  "type": "experiment",
  "title": "真实代词与配对接入代码比较：旧归因/警告完成态错误已定位，正常配对仍未知",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": ["治事实关系错", "提高链路健壮性"],
  "scope": "v0.10/v0.11复用真实抽取的四已知开发候选，主Codex非盲语义复核后代码比较，不是独立可靠性或整句通过",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/RELATION-CHAIN-RESULT.md",
  "conditions": ["复用v0.9原始真实抽取与v0.9.1确定性规范化，不重新抽取；固定Workers AI REST/glm，无heldout或远程judge", "每轮最多7逻辑/14HTTP/15000tokens，1次实际错误反馈；身份消歧与单命题配对独立，配对不见报告模式/说话人", "v0.11改编号选择/不透明候选ID及开发事件区分提示，非纯消融；本地审核hash门必须覆盖命题与身份，未知不计成功检错"],
  "evidence_origin": "local_record",
  "relations": [{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind": "prototype_evaluation",
  "outcome": "mixed",
  "inputs": "p11/p12两旧错误及两正常；1个He解析、6个候选报告配对，每轮固定同任务",
  "evaluation": "主Codex本地非盲复核5个命题对应与He→Meink，绑定结果/配对/解析hash；71运行测试，结构/语义与正常关系/整句分开",
  "result": "v0.10He编造ID且正常披露命题错配公告措辞；v0.11He解析正确，5/6命题忠实提案，正常p12配对未知。复核后代码定位p11-u两个Reporters/Meink说话人差异，以及p12-u confirm/warn与completed/future差异。正常p11两报告关系保留但would时间未知，正常p12未误拒但未保留成功；正常整句均pending，不宣称方案通过或独立2/2可靠性",
  "cost": "两轮17HTTP/7651已知tokens，无连接失败；v0.10 4143tokens/35.469累计请求秒，v0.11 3508tokens/34.238秒；本地复核重放0远程调用，金额未知",
  "record_completeness": "complete"
}
---

结构/锚点合法仍可配错事件；旧错误的机械差异必须以已复核语义对应和身份为前提。正常p12从v0.10可配到v0.11未知，提示/接口改变不保证正常关系稳定保留。停止本轮有限迭代，下一步对事件/参与者拆分做最小正常对照，不能将未知计正确拒绝或用本地judge答案填回模型结果。
