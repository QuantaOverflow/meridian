---
{
  "id":"experiment-relation-confirm-dev",
  "type":"experiment",
  "title":"v0.18补单位偏好后40另批真LLM：漏放仍10%，忠实诊断失败20%",
  "date":"2026-09-18",
  "status":"recorded",
  "tasks":["治事实关系错","提高链路健壮性"],
  "scope":"20另批新开发文章正常错误40对照，固定开发池非盲，自然错误与跨事件泛化未知",
  "source":"eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/FACTOR-ITERATION-RESULT.md",
  "conditions":["v0.17全部接口沿用，新增完整population+unit数量比较、显式配对偏好分支、actor+import-ban范围、同完整proposition报告者；不存在的表示不当检出，coverageVerified仍false", "v0.18代码材料运行前冻结，文章未用于此前测试；事件相关性可能存在，heldout未读，不宣称20独立事件", "glm-4.7-flash真Workers AI REST+Gateway skip-cache，完整半径2原文，batch2，25逻辑/50HTTP/90000tokens/60秒单请求上限，最多5单条合同修复；无远程judge"],
  "evidence_origin":"local_record",
  "relations":[{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind":"prototype_evaluation",
  "outcome":"failed",
  "inputs":"40条20正常20单注入错误短语，与v0.17不同文章，非独立自然错误可靠性样本",
  "evaluation":"主Codex本地读完整原文/raw，按错误本身忠实解释保守审计，结果及每条raw哈希绑定；正确路由不等于正确诊断",
  "result":"漏放2/20=10%，忠实诊断失败4/20=20%，正常误拦/复核0/20，总复核0/40；40最终合同有效，2单条修复成功。错接受Cambodia而非Thailand终止协议、two homes/seven vehicles数量反向；Iran人/账户虽拦理由数量反向，Gulf虽拒绝已交付理由错误否认4trillion。新增规则本批只有报告者可比较且模型已正确拦，增量0。先前单位偏好漏点离线修复不代表这批达标",
  "cost":"22逻辑22HTTP，30870已知tokens，62.697累计请求秒；无基础设施/未知usage/远程judge，美元价未知，无生产修改/部署/提交",
  "record_completeness":"complete"
}
---

plan hash ea1cf39e862404cad7a7c8205d9034cb0493025040f2d3b08c2875c757706604；results hash 047e9a4fd3575a4cac16cd8a3b8d56ed6862f614bc0fb55ec9eaffe063c69307。产物在eval/cluster-to-brief/out/atomic-evidence/confirm-dev-v0.18。与旧失败机制相同：模型可以引用正确主体/数量同时判断错误候选supported；引用接地不保证关系一致。
