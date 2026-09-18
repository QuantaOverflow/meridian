# 通用引用harness修复与40条新开发对照真实运行

2026-09-18，quote-gate-v0.16，expanded-dev-v0.16.1。之前0/4只代表小探针的父句状态，不是完整原型漏报率；本轮扩大后出现明显语义失败，不能沿用零漏报结论。

## 这轮改了什么

只新增本地eval组件，不改变生产或旧冻结实验。`quote-gate.mjs`让模型输出slot/status/errorSpan/quote strings/reason；ID、claim全文、来源编号和偏移由代码生成。每短引用在注册上下文精确匹配唯一来源文档，未知/歧义不猜。slot重复/缺失/坏引用按单条隔离，保留正常兄弟输出；对失败单条至多一次独立修复任务及一次实际字段错误反馈重试。长于150字符的引用明确失败，不截断或猜出处来通过。仍是语义判断由模型负责的整句核验门，不是完整分解语义代码验证器。

保存v0.15真实原始输出无新增调用回归：旧两来源编号错由exact quote机械定位修复，逐条8/8满足旧实际合同，语义输出不变。旧提示150字符未强制的事实仍保留，未用新合同追认老输出。印度旧拒绝理由不完整也没有机械“修好”。新引用接口增加了执行中的150字符硬限制。

## 材料与冻结条件

20个不同开发文章/事件各一正常和一错误短语变体，共40条、20错误短语。覆盖时序、归因/身份、否定、行动强度/排他、数量/单位/范围和计划/完成态、无依据因果。文章未在原60题或v0.15八题使用，固定开发池中包括离题文章以探测通用材料；这是主Codex自编非盲开发样本，不是自然错误分布或独立可靠性检验。最终heldout c28/c51未读。不能把事件/文章数理解为统计独立试验。

源句坐标/hash由ContextStore检查，半径2未截断，主Codex调用前本地读原文检查足够区分对照；调用前去掉正常句中未明示的after时间关系，初始未调用dry-run另存，最终plan hash `d30f135f7fa33b1bdd71592b5f0aa5b2000838c9725f4d6f14a050f115db6d9a`。参考和语义审计不进入模型请求，也未用标签影响路由；运行中不改组件/材料。

## 实际运行与结果

Workers AI `@cf/zai-org/glm-4.7-flash` REST及Gateway，thinking关闭，temperature0/修复0.1，max_tokens5000。10初始四题batch、最多10单条修复任务；预算20逻辑/40HTTP/60000已知token停止阈值，单请求60秒，基础设施或未知usage停止。

实际20逻辑/28HTTP，31180已知tokens、183.134累计请求秒，全HTTP200、usage已知，无远程judge。10单条修复任务3成功7失败；没有整batch丢失兄弟条目。全部40条完成，调用已停止；美元费用未查询。

主Codex本地逐条读40最终保留输出及原文，对每条raw hash、完整results hash绑定非盲审计。完整分母不剔除接口失败：

| 指标 | 结果 | 含义 |
| --- | --- | --- |
| 实际错误漏放 | 5/20 = 25% | 五错误句被工作流allow |
| 注入错误未识别 | 6/20 = 30% | 五漏放加一错误因引用接口失败转review；按原注入错误/理由本地审计 |
| 错误未明确拦截 | 7/20 = 35% | 五漏放加两错误review，不把review算检出拦截 |
| 正常误拦 | 0/20 = 0% | 有五正常review，不等于20正常均成功放行 |
| 正常复核 | 5/20 = 25% | 原文引用改写/截断失败 |
| 全部复核 | 7/40 = 17.5% | 五正常加两错误 |
| 全部路由 | 20allow / 13block / 7review | allow含15正常及5错误 |

五漏放分别：白俄罗斯报告to be presented→already presented；约旦at least11→exactly11；圭亚那does not want→wants；印尼总统执行→议会执行；Saab scheduled appearance→already appeared。第六语义未识别为Jenius offshoot→standalone，因引用文本不是原文而转review，不能算语义检出。另Myanmar only错误的理由正确，但坏引用转review。

直接诊断14/20只表示模型理由忠实指出注入错误，不宣称锚点和引用都完整：Singapore锚点定位speech而非完成态，但理由明确指出has completed；Holocaust理由指出American/Soviet差异，但所选精确引用缺少关键American troops，均在local-audit保留不足。接口准确性不能代替解释忠实及全断言覆盖。

现有数量状态窄规则仍40条全部not_covered，未因新样本扩语法或调漏点词规则。这轮没有验证新事件自动关系配对、完整分解链路或生产可靠性，不使用人工审计修正被测输出/路由。

## 证据及下一步

`out/atomic-evidence/expanded-dev-v0.16.1/`：plan/references/calls/results/run-state/old-binding-replay/local-audit/scores；results hash `710987358b3e52f4a803a2aeba09953c392d988a9df6eebdbfa586e25e6c418d`。`expanded-local-review.mjs`只绑定这轮已读快照，漂移便要求新本地审计；`expanded-score.mjs`要求逐条及完整hash一致后评分。无新的调用可复算。

机械回归95通过，项目typecheck exit0且4任务缓存命中，既存lockfile/deprecation警告。未提交、部署、修改生产或揭示最终heldout。

结论：来源编号与批次故障扩散机制已修，引用字符串忠实转换依旧有失败；更核心的是整句语义门把相关证据错当完整支持，遗漏否定、施事、界限及完成态，明显不能以这轮结果采用。下一步应将这几个语义维度落实为独立忠实字段转换/确定性比较及覆盖门，而不是修几个题的关键词让指标回零；组合后另用新材料验证。
