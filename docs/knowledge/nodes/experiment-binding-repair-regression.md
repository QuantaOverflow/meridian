---
{
  "id":"experiment-binding-repair-regression",
  "type":"experiment",
  "title":"v0.19.1机械归属补齐40真LLM修补回归：漏放0%，忠实诊断失败5%",
  "date":"2026-09-18",
  "status":"recorded",
  "tasks":["治事实关系错","提高链路健壮性"],
  "scope":"重复v0.18的40条开发修补回归，NOT新材料/独立验证；仅窄显式语法原型，非生产核验层",
  "source":"scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/FACTOR-ITERATION-RESULT.md",
  "conditions":["额外窄schema：地点绑定同damage事件的homes/vehicles数量；明确Iran judiciary同seizure people/accounts两槽；相同完整25年协议patient+purpose的terminated actor；不存在完整绑定不猜测", "沿用v0.18全文/整数span选择和整句模型fallback，不把代码覆盖误当完整语义覆盖；新冻结版本skip-cache重新调用真Workers AI，无远程judge，heldout仍未读", "最多25逻辑50HTTP90000tokens/60秒每请求，batch2最多5单条修复；v0.19未执行仅测试发现前缀边界缺陷，保留未运行plan，修复后另冻v0.19.1，不覆盖历史"],
  "evidence_origin":"local_record",
  "relations":[{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind":"prototype_evaluation",
  "outcome":"passed",
  "inputs":"v0.18重复40条：20正常20注入错误；不能算40新样本或独立泛化证据",
  "evaluation":"主Codex本地原文/raw/独立机械factor receipts逐条审计、结果与raw hash绑定；111机械测试通过，不代表语义验收",
  "result":"开发修补回归忠实诊断失败1/20=5%严格低于10%，实际漏放0/20，正常误拦/复核0/20，总复核0/40，20正常全放行20错误全拦。40最终合同有效2修复成功。模型再次错误接受Cambodia施事，代码精确定位拦住；Iran理由仍数量反向但两typed slots独立正确定位；homes/vehicles本次模型正确拒绝且代码也检测。Gulf仍有错误否认金额的理由，正确拦截不当全语义通过。此前新材料漏放两批均10%，因此新材料稳定低于10%尚未证明",
  "cost":"22逻辑22HTTP，30821已知tokens，58.218累计请求秒；本轮三实验总64逻辑64HTTP92884tokens254.669秒，美元价未知；无生产修改/部署/提交，全部远程调用结束",
  "record_completeness":"complete"
}
---

results hash 90108a75742981d87c196eb5ecb66ecf6153198b38e16a455042f5d037aea861。产物在scripts/eval/cluster-to-brief/out/atomic-evidence/binding-retest-v0.19.1。新事件、别名、作用域、跨句、自然错误及整句LLM未覆盖因素未验证；不能推广事件特定窄grammar到生产，也不能用这次修补零漏放取代之前扩大失败事实。下一步冻结当前机制，换不参与修补的跨事件材料检验，而不是继续补已知文章刷零。
