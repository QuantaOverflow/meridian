---
{
  "id":"experiment-factor-choice-dev",
  "type":"experiment",
  "title":"v0.17引用选择接口40新对照：漏放10%，忠实诊断失败15%",
  "date":"2026-09-18",
  "status":"recorded",
  "tasks":["治事实关系错","提高链路健壮性"],
  "scope":"20新开发文章正常错误40对照，主Codex编写非盲，窄语法字段比较+整句模型语义门；非完整分解或生产验收",
  "source":"scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/FACTOR-ITERATION-RESULT.md",
  "conditions":["源/候选窄因子独立抽取，哈希原文位置；完整事件键匹配后代码比较，coverageVerified始终false，未知不通过", "LLM输出代码原文chunk整数选择，不再复制quote或生成offset/sourceIndex；batch2并保留完整半径2上下文，每实验最多25逻辑50HTTP90000tokens，每请求60秒", "冻结前后本地审原文，无远程judge；glm-4.7-flash Workers AI REST+Gateway skip-cache且thinking关闭，max_tokens5000，temperature0，最终heldout未读；新文章但关联底层事件可能重叠"],
  "evidence_origin":"local_record",
  "relations":[{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind":"prototype_evaluation",
  "outcome":"failed",
  "inputs":"40条，20正常20单注入错误短语，来源未用于先前60/v0.15/v0.16.1；非自然错误或独立试验",
  "evaluation":"主Codex本地阅读原文和保留输出，results/逐条raw hash绑定；正确拦截与忠实诊断分开，理由包含错误事实保守算失败",
  "result":"漏放2/20=10%，忠实诊断失败3/20=15%，正常误拦/复核0/20，总复核0/40；40最终合同有效，无修复/基础设施失败。ASEAN偏好双分支与maritime面积单位漏放；UK all-goods被正确拦但错误宣称Ed Miliband不在引用。4新规则命中均是模型已正确拒绝，规则增量拦截0，整体改善不能归因单因素",
  "cost":"20逻辑20HTTP，31193已知tokens，133.754请求秒；美元价未知，无远程judge/生产修改/部署/提交",
  "record_completeness":"complete"
}
---

plan hash 4e06a78fe19239d9d23dc7262f4b89a92288ead77bdf59c63add7962cde0a094；results hash b8b05c918ac70bb7f7b4a836b3219fa3943799cd189e949285c27aca0254cbf3。原始请求、原文、对照、审计和score在scripts/eval/cluster-to-brief/out/atomic-evidence/factor-dev-v0.17。旧v0.16.1六漏点窄因子离线回放均能定位且无新增正常误拦，回放不是新材料证据。
