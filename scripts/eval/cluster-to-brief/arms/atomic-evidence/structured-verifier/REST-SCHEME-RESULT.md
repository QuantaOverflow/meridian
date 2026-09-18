# mechanical-rest-v0.5：真实开发方案诊断完整执行

2026-09-17，用户要求开始方案测试。真实Workers AI glm-4.7-flash通过官方REST，现有Wrangler会话凭证只进程内使用，指定AI Gateway/skip-cache，thinking off。模型仅角色/命题转换；受限字段代码生成，不调用远程judge。7TARGET均执行（4候选+3源句），不是7道独立核验题。主Codex非盲开发语义复核，没有生产/heldout/部署/commit。

## 实际执行

7逻辑/10HTTP，全HTTP200，usage全已知，8353input+912output=9265tokens，累计请求34.098秒非墙钟/金额，美元未知。4TARGET接口通过、3失败。3次完整错误列表反馈后均未恢复完整接口通过；其中p12源句有局部修改但仍失败，不能说模型完全没改。没有故障注入、网络恢复或扩大请求。

## 正常对照与旧错误

| 目标 | 角色结果 | 代码字段／未完成事项 |
| --- | --- | --- |
| p11正常候选 | 两报告完整，Meink说话，reporters听众 | 两say/positive正确；was worded completed；would时间unknown |
| p11源句3 | declined与said两个行为，两次都含declined | 词典不支持declined，整个转换失败，无said字段结果 |
| p11源句5 | He解析Meink，reporters为听众，忠实 | say/positive正确，would时间unknown |
| p11错误候选 | 原始输出忠实保留Reporters为说话人及两said | said出现两次，schema没有occurrence，唯一引用校验拒绝；反馈后仍重复，不能计正确检错 |
| p12正常候选 | Analysts warned及命题完整 | warn/positive正确，would时间unknown |
| p12源句 | 两次都混入CONTEXT其他句报告；The US military大小写不精确，插入that/括号 | 全错误反馈后仅去除部分插入，仍失败；没有源warn/future可比较字段 |
| p12错误候选 | 忠实保留Analysts confirmed/had already accelerated | confirm/completed/positive正确，但源失败，未形成错误核验 |

通过4TARGET共5报告、15代码字段，12确定值在本地逐字段复核中合理、3would时间未知。told→warn和负面结果→negative这些旧模型分类错误在代码路径中未出现。但这是条件于抽取通过的局部结果，有选择偏差，不是整个方案检错率。

两正常候选抽取忠实，不代表正常整句保留：源失败/时间unknown尚未聚合。两个错误候选分别被引用接口和源文接口失败阻断，均没有完整自动语义检错结论。没有将contract_error/pending计unsupported。p11说话人差异在raw与源句5可由主Codex看出，但不是运行器自动发现；p12警告状态差异同样不能借人工修理的源图算自动成功。

## 设计与模型失败分开

1. **接口不可表示重复引用**：p11错误候选两said是真实原文，精确quote没有occurrence字段却要求唯一。模型在不删断言/不改原文前提下无法修复该接口错误，不应归责LLM。这是已确认的设计缺陷。
2. **不支持类型拖累整体**：declined可能表达拒绝沟通行为，但有限词典不支持；整个源句转换失败让合法said也无法比较。应该保留未支持义务同时处理可支持部分，而不是叫模型删掉原文行为或擅自改词。该路由/聚合修订本轮未实现。
3. **TARGET/CONTEXT边界混淆与非精确输出**：p12源句混入其他句及改写引用，完整错误信息未充分修复。这是模型转换错误，也是当前接口/任务隔离未解决的风险；不能仅靠放宽引用校验通过。
4. **端到端模块缺口仍在**：机械模式没有自动实体/命题对应与整句接受/拒绝。实际results明确wholeClaimVerdict=not_implemented；本轮完整执行的是方案前置转换链诊断，不是已实现完整核验器的端到端评测。旧错误被准确识别及正常整句保留两项验收未达到，不能说方案通过。

下一候选工作：优先可重复引用的occurrence/代码分配span候选接口，保留不支持行为的residual而非拖垮整句；TARGET与CONTEXT有明确来源类型并只允许TARGET输出。之后补自动对应/聚合并验证，才能得到完整核验成绩。不在本轮中途换规则或继续采样。当前不扩大/融合。

## 证据

out/atomic-evidence/mechanical-rest-v0.5/plan.json、calls.jsonl、cache/*请求/schema/raw/attempt messages、results.json、run-state.json。运行器结果保持semanticReview=not_performed，本报告为主Codex本地独立于被测输出的复核，不是独立heldout验收。51本地测试通过，pnpm typecheck退出0、4缓存命中，不认证模型语义或新mjs。
