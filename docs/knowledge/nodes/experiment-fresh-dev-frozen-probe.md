---
{
  "id":"experiment-fresh-dev-frozen-probe",
  "type":"experiment",
  "title":"四新开发事件真实冻结探针：父句状态一致，引用接口拖垮整批且窄规则未覆盖",
  "date":"2026-09-18",
  "status":"recorded",
  "tasks":["治事实关系错", "提高链路健壮性"],
  "scope":"四未使用开发文章/事件八正常错误对照的新整句基线与不变数量规则，三独立报告抽取诊断；非完整分解原型端到端、非独立可靠性验证",
  "source":"scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/FRESH-DEV-RESULT.md",
  "conditions":["相对旧60题缓存回放冻结组件代码/请求hash，改材料；开发文章1000985/1003362/1004976/1001409未在原练习使用，主Codex自编非盲，heldout c28/c51未读", "ContextStore半径2未截断，主Codex本地检查上下文足够，参考不进入请求；Workers AI仅被测模型，无远程judge", "glm-4.7-flash REST及Gateway，thinking关闭，max_tokens5000，温度0/修复0.1，每失败至多一次修复；最大5逻辑/10HTTP/18000token停止阈值/每请求60秒", "实际路由继承整批失败转复核；事后逐句6/8接口通过不追认放行，不修改冻结输出或用本地答案替代模型"],
  "evidence_origin":"local_record",
  "relations":[{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind":"prototype_evaluation",
  "outcome":"mixed",
  "inputs":"日本政党合并、印度季风预测、巴拿马日通行数量时期、苏丹援助崩溃风险四新事件，四正常/四错误短语变体；八上下文窗口；苏丹源句/两候选独立抽取",
  "evaluation":"主Codex本地非盲回读每最终输出及来源窗口；现有引用合同与事后逐句诊断分开；88机械回归通过，项目typecheck exit0且四任务缓存命中",
  "result":"模型原始父句状态8/8与参考一致，原始4错误未标supported、4正常未误判；但两错误句来源编号不匹配，各引用在包内唯一匹配其他来源，笼统validator自愈重复错误，两个四题batch均接口失败，实际0放行/0明确拦截/8复核，不能宣称漏报0%。事后逐句6/8接口通过，印度拒绝理由仍不完整；部分引用超过提示150字符而旧validator未强制。三报告抽取忠实且warn/confirm可机械区分，但eventState全unknown且新事件配对未接通；数量窄规则八题全部not_covered，包括新数量时期错配",
  "cost":"5逻辑调用/7HTTP，9025已知tokens，66.852累计请求秒；全HTTP200及usage已知，无基础设施故障，无远程judge；美元费未查询；所有调用已结束",
  "record_completeness":"complete"
}
---

这轮只改变材料/上下文窗口，不把旧补丁题号当新材料规则。冻结方案hash为588cf2e6b09cc5ce1fb0480626cdf144ad275a9e5e18313153d48e4b1d778dd7，完整plan/references/calls/results/local-review/run-state均在out/atomic-evidence/fresh-dev-v0.15。

新信号是harness来源绑定、笼统错误信息及batch故障扩散仍可复现；语义解释忠实性和通用覆盖也未解决。下一步优先代码唯一exact quote来源绑定、逐句隔离、具体字段反馈，先对保存真实raw做无新增调用回归，再另选新事件有限真调用。纠正来源编号不能自动证明印度理由成立，不扩大或揭示最终heldout来掩盖这些边界。
