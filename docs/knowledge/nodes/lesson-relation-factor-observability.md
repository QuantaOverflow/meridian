---
{
  "id": "lesson-relation-factor-observability",
  "type": "lesson",
  "title": "核验因素诊断需区分断言覆盖、关系配对与解释忠实性",
  "date": "2026-09-17",
  "status": "superseded",
  "tasks": ["治事实关系错", "演化组合架构"],
  "scope": "practice-v1 已知错误输出的回顾；不是对模型内部过程或通用能力的结论",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/RELATION-ANALYSIS.md",
  "conditions": ["旧输出只保存锚点、引用、状态和理由，不单独保存两侧关系抽取"],
  "evidence_origin": "local_record",
  "relations": [{"type": "cautions", "to": "attempt-practice-risk-slots", "attributes": {"scope": "增加检查项不保证覆盖第二断言或保证跨字段关系一致；正确拒绝不保证理由接地"}}],
  "kind": "diagnostic_observation",
  "invalidates_when": "新接口在冻结对照和独立材料上记录完整忠实关系并证明改善；当前显式配对接口尚未运行"
}
---

词命中失败可细分为输出中缺少断言、方向/状态不等价仍被接受、单独成立属性被错接，另外存在正确拒绝但解释增添无证据身份的情况。现有可见输出不足以定位抽取、比较、最终决策的隐藏因果；显式配对用于增加可观察性仍是假设，不应先行融合。

2026-09-17补充：structured-v0.2的本地人工结构负控制显示，转换器漏第二断言却以整句span假报覆盖时，接口/代码比较仍可能pass；字节覆盖不能证明语义完整。真实NL转换尚未运行。人工参考图下代码可指出说话人、报告/事件状态与数量状态绑定差异，但p11/p20正常整句因未支持类型pending，不能把适用关系保留说成正常整体无损。新增证据见experiment-structured-verifier-local与其source。

随后真实部分烟测补充（experiment-structured-verifier-real-partial）：证据schema/精确引用通过仍可漏analysts warn报告fact、错听取者和重复报告；对齐合法仍可把不同实体/报告对应成equivalent。代码因此返回未知而非正确诊断原错误，baseline误放行仍在。独立转换与窄业务枚举未自动解决忠实性；本版1题完整无正常成绩，不作泛化断言。本地/真实结果分开，不删除前面条件下的事实。

2026-09-18补充：引用复制改整数span选择，两批共80新开发对照最终合同全部有效且正常无误拦，但各漏放2/20=10%。正确施事/数量出现在模型引用和理由中，仍能接受关系反向的候选。v0.19.1增加完整窄绑定键的机械归属比较，重复40条真LLM修补回归漏放0/20、忠实诊断失败1/20=5%；模型错误raw保留，独立代码诊断可修路由但不洗掉模型错误。引用harness问题与字段关系/解释忠实性问题已可分别观测；整句fallback、窄grammar事件限定和同事件材料相关性仍限制泛化。这不是完整独立结构化事实管线的成功证明。三实验及成本见experiment-factor-choice-dev、experiment-relation-confirm-dev、experiment-binding-repair-regression。

随后一次冻结heldout来源验证（experiment-heldout-binding-verifier）反例：60条最终合同全有效，仍漏放3/30=10%、忠实诊断失败4/30=13.3%。三实际漏点的正确源信息均已在模型理由/引用内，却没有与候选的生死否定、数量归属、条件halt否定比较；当前规则无增量拦截，开发回归5%不能证明迁移。不是连接不稳或缺少关键源上下文；窄语法表示未覆盖与整句fallback语义比较共同留下边界。c28/c51已经第一次揭示并消耗，不再是未接触heldout；主Codex冻结后自编控制、簇内及开发事件相关性意味着仅来源文章隔离，不是独立自然错误可靠性验收。
