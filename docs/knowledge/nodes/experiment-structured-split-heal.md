---
{
  "id": "experiment-structured-split-heal",
  "type": "experiment",
  "title": "拆分角色与状态加错误反馈：五次自然修复两次接口通过，语义错误仍漏检",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": ["治事实关系错", "演化组合架构"],
  "scope": "split-heal-v0.3，p11/p12四候选与三源句；转换组件，不含自动对齐/整句接受，不读heldout",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/SPLIT-HEAL-RESULT.md",
  "conditions": ["TARGET逐句角色转换，独立逐报告状态转换，源句附原radius2上下文；代码分配来源命名空间ID", "实际代码校验错误加上次输出回传最多一次，无标准答案注入；主Codex本地非盲复核，无远程judge", "与v0.2接口/职责不同，且无无反馈消融，不能归因净收益"],
  "evidence_origin": "local_record",
  "relations": [{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind": "prototype_evaluation",
  "outcome": "mixed",
  "inputs": "7TARGET，真实glm-4.7-flash，temperature0/修复0.1，max_tokens5000；另1明确注入非原文引用测试",
  "evaluation": "主Codex逐字段对照raw/原文；接口与语义分别报告；没有整句成绩，注入故障与自然失败分开",
  "result": "自然5次初次契约失败，2次修复接口通过、3次失败；注入引用1次修复通过。p11说话人与听众差异可见，但would/完成主张误判negative、told误判warn、非报告命题误抽报告等仍接口通过。p12源句混入上下文且错误大小写/插入词，首错反馈后重复坏输出，无法完成旧警告核验。裸substring与fail-fast反馈边界暴露，不扩大融合",
  "cost": "18逻辑/23HTTP，15706input+1365output=17071tokens，全部usage已知；累计请求172.844秒非墙钟/金额，美元未知；服务关闭",
  "record_completeness": "complete"
}
---

真实结果仅支持部分接口错误可修；语义引用校验仍非忠实认证。有限动词/否定cue代码处理、词边界和全部错误反馈属于后续候选，尚未真实验证。34本地测试及typecheck成功不算语义成绩。
