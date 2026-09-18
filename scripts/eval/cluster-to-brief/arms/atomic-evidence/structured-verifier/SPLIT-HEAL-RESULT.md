# split-heal-v0.3：拆分转换与校验错误反馈

2026-09-17，真实 @cf/zai-org/glm-4.7-flash，Workers AI。不是远程judge，主Codex本地逐字段审查，非盲既有开发题。无生产、heldout、融合或部署。

## 假设与改变

旧structured-v0.2证据漏报告关系、图错对齐，未知不是正确检错。本轮不建完整图：代码按冻结来源枚举7个TARGET句（p11/p12四候选及三源句）；每句保留原±2窗口CONTEXT但只转换TARGET。第一接口仅报告行为角色/原文命题，第二接口逐条冻结报告行为转换reportMode/eventState/polarity。代码分配带来源命名空间的ID，不让模型生成图指针或覆盖账本。没有自动语义对齐和整句接受模块，本轮仅评估转换组件。

真实校验失败最多一次修复：原请求/原文/schema + 上次输出 + 实际validator error送回模型；完整JSON再校验。每个attempt messages、raw、usage留存。外部文本和失败输出均是不可信数据，不注入参考图、正误标签或标准答案。确定性反馈不能发现所有语义错误；接口通过不是语义验收。

限24逻辑/32HTTP/24000已知tokens、每次120秒；实际18逻辑（含1故障注入）/23HTTP，15706input+1365output=17071tokens，usage全部已知。累计请求172.844秒非墙钟/金额，美元未知。完成7TARGET，服务关闭。results.json成本不含随后注入测试，最终成本以run-state.json为准。

## 自然反馈修复

5个初次契约失败，2个第二次接口通过，3个仍失败；不是有无反馈消融，不能归因净增益。

- p11正常/错误候选的第一报告命题缺stateQuote：反馈后分别补was，局部状态和引用合理。
- p11错误候选第二报告命题含would，首次completed且无依据；反馈后仍completed并从另一命题借was，代码拒绝。冻结命题本身未被修好。
- p12源句首次输出The US military而原文是the US military，还插入[that]并混入CONTEXT中的其他句报告。修复完全重复坏输出，仍拒绝，没有源句状态结果。校验目前fail-fast，仅反馈首错；这是已观测设计限制，尚未实现全错误清单反馈。
- p12错误候选错误新增had already accelerated作为第二报告行为；该伪行为状态引用had already不在其propositionQuote内，反馈后重复坏输出仍拒绝。上游角色转换语义错误却接口通过。

## 本地语义复核

改善信号：p11两个候选角色保留Meink与Reporters差异；source sentence5将He解析US Secretary of the Air Force Troy Meink，reporters正确为recipient。旧图指针接口失败在这些角色输出中未重现，但职责/样本不同，不能直接比较成功率。

仍有错误：p11正常候选told被分类warn；p11的would undermine、p12正常候选以及错误候选主报告被判negative（would/had already不是否定）。这些引用确实在原文，当前代码未检查cue与分类语义，因此接口通过。

source sentence3的speakerQuote he并不是独立原文指代词，裸includes匹配到了the等词内子串；verbQuote包含整个长分句，还将declined整块当报告，说明substring存在不等于合法语义片段。p12错误候选把非报告动作额外抽成报告。角色源句p12失败阻断了完整warn/future与confirm/completed比较，不能称旧核验问题已解决。

## 单独故障注入

将p12错误候选首报告的propositionQuote替换为INJECTED_NONEXISTENT_QUOTE，提供真实校验错误及原文，1次真实请求修复为原文完整命题，保留Analysts/confirmed。只有这项明确注入测试，不算自然错误修复率或独立验收；无无反馈对照。

## 后续边界

本版不扩大或融合。值得下一轮改变：反馈列出全部契约错误而不是首错；独立词边界/跨度定位；把可有限词典处理的显式报告动词和否定cue交代码，不让模型随意分类；对未解析、上下文污染和伪报告保留失败义务。上述未在本次冻结真实运行中实施，不能事后重算为通过。一般语义角色/共指仍不能靠词典保证。

34本地测试通过（含错误反馈messages断言）；pnpm typecheck退出0、4缓存命中，不代表新mjs的静态或语义认证。产物out/atomic-evidence/split-heal-v0.3/：plan.json、calls.jsonl、cache/*attempt-messages.json、results.json、run-state.json、injected-repair.json。本地复核是本报告，不更改被测答案。
