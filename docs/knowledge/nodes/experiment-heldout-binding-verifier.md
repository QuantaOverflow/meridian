---
{
  "id":"experiment-heldout-binding-verifier",
  "type":"experiment",
  "title":"预留c28/c51冻结验收60条：漏放10%，忠实诊断失败13.3%，未达标",
  "date":"2026-09-18",
  "status":"recorded",
  "tasks":["治事实关系错","提高链路健壮性"],
  "scope":"用户授权打开预留c28/c51来源；30正常/30人工注入错误短语60控制；来源heldout但非独立盲写标签或自然错误金标，非生产验收",
  "source":"eval/cluster-to-brief/out/atomic-evidence/heldout-v0.19.1/HELDOUT-RESULT.md",
  "conditions":["核验组件逐项与v0.19.1回归冻结hash相同，先precommit再读来源再编写冻结60条；不按结果改prompt/schema/factor/routing，不删失败题，不重试语义错误", "每簇hash固定取15文章，原文半径2未截断，5风险类型目标均衡，997234无早期数量时调用前记录改归因，最终quantity5/actor7/polarity6/state6/scope6；未按规则coverage筛选", "glm-4.7-flash真Workers AI REST+Gateway skip-cache、thinking关闭、max_tokens5000、temperature0/合同修复0.1，batch2，35逻辑70HTTP110000tokens/单请求60秒，最多5单条修复，无远程judge", "主Codex本地先读所有源窗口再读全部60保留raw审计，结果与逐raw hash绑定；标签不进入请求。底层Pentagon战争等事件与开发文章可能相关，30文章不等于30独立事件；c28/c51现在已消费不得再称未接触heldout"],
  "evidence_origin":"local_record",
  "relations":[{"type":"yields","to":"lesson-relation-factor-observability"}],
  "kind":"prototype_evaluation",
  "outcome":"failed",
  "inputs":"60控制=30正常30错误短语/关系，30文章、两预留簇各15组；非既存自然错误金标，无旧版本同材料对照，不能作总体概率或纯架构因果结论",
  "evaluation":"主Codex非盲审计原文和完整输出；正确block但解释否认原文已有事实也保守算诊断失败，未知/合同失败不检出；113机械测试通过，项目typecheck exit0且4任务缓存命中，不当语义质量证明",
  "result":"错误漏放3/30=10%，忠实诊断未识别4/30=13.3%，正常误拦1/30=3.3%、正常放行29/30、总复核0/60，60最终合同有效。漏点为获救改死于获救前、33.4总/22.3弹药金额互换、Sacks条件性halt加入not；另零武器错误虽拦理由否认已有sustain a conflict。正常AI演员忠实描述误拦。规则本批无diagnosis/路由变化，无增量拦截；开发回归5%未稳定迁移，预注册严格<10%目标失败",
  "cost":"31逻辑31HTTP，45029已知tokens，150.232请求秒；1正常errorChoice合同错误反馈成功，无语义重试/连接失败/未知usage/远程judge；美元价未知，无生产修改/部署/提交，所有调用结束",
  "record_completeness":"complete"
}
---

precommit hash b290278a1b1ed31747942c4b11eb72a1a518e57a525d981693752c9821daeb42；plan hash 0b0651ee54bca5ce682103d8fc4bbad6ab708eee5d561013cff275e6acef90ab；results hash e21884abe6bbd3543f7a65673bfc26f95619ff4109d9e1bc1116df20362175ad。完整产物为source同目录。

来源首次打开不等于独立盲验：主Codex冻结后自编正常/错误控制，簇含离题与相关报道；材料中Pentagon费用事件与开发池相关，需收窄为来源文章隔离。将30错误假定iid时，双侧95%精确二项上端漏放26.5%、忠实诊断失败30.7%，但项目实际相关数据不能用此置信结论；无论如何没有证明总体稳定<10%。

三个实际漏放都在模型理由或exact receipt中有正确源信息，仍标相反候选supported。基础设施和最终schema在本批没有失败，残留是语义关系比较与窄规则完整性边界。引用选择有个别弱receipt，合法定位也不能自动证明引用充分性。后续迭代可以使用本批作为已知失败开发材料，但必须另预留未接触、跨事件验收集；不通过重跑或修题后回放将其重新命名heldout成功。
