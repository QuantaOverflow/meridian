---
{
  "id": "experiment-isolated-role-repair",
  "type": "experiment",
  "title": "角色接口修复：机械定位重复词、隔离坏行为并保留漏项义务",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": ["治事实关系错", "提高链路健壮性"],
  "scope": "v0.6七开发目标真实调用与v0.6.1离线原输出回放，非端到端或独立验证",
  "source": "eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/ISOLATED-RESULT.md",
  "conditions": ["固定Workers AI REST/glm，角色模型转换与代码字段处理，无heldout或远程judge", "v0.6一次全部错误反馈；v0.6.1不改原始真实输出，新增直接相邻精确命题定位与declined/refused窄词面守卫", "每行为隔离错误/未支持义务，保留原输出和失败历史，完整语义覆盖未知"],
  "evidence_origin": "local_record",
  "relations": [{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind": "prototype_evaluation",
  "outcome": "mixed",
  "inputs": "p11/p12四候选三源句，原radius2上下文，真实调用与未修改原输出回放",
  "evaluation": "主Codex本地查看原文/输出，59单元回归含正常对照和严格引用负例；人工schema迁移回归与无需人工修改的真实新输出回放分开",
  "result": "重复引用不可表示与坏/未支持act拖垮合法兄弟的已知设计失败消失；真实v0.6仍错序号和漏declined，v0.6.1机械回放定位两said且保留declined漏项义务。p12源保留1合法act和2上下文污染错误义务；污染未根治，完整覆盖/对应/整句判决未验收",
  "cost": "v0.6七逻辑十HTTP/11740tokens全部usage已知/累计请求75.31秒，零连接失败；v0.6.1回放新增远程调用0；金额未知",
  "record_completeness": "complete"
}
---

可机械定位的引用不应依赖模型正确数序号。隔离失败不等于完整成功；未支持和遗漏义务必须可见，不能通过删除难项自报修复。
