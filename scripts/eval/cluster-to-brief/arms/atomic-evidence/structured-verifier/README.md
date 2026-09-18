# 结构转换驱动的核验原型

版本：structured-v0.2。**组件实现完成；真实 Workers AI 部分烟测已执行，未证明解决核验问题。** 最新结果见 [REAL-RESULT.md](REAL-RESULT.md)：仅1题完整，第2题转换契约失败，其余4题未运行；不扩大或融合。

后续机械接管版本 mechanical-v0.5：显式报告动词、受限单命题的否定与辅助动词时态由代码生成带规则/原文线索的字段；不再调用LLM状态分类。would时间与嵌套/未知语法保留unknown，不自动LLM回退。详见 [MECHANICAL-RESULT.md](MECHANICAL-RESULT.md)。本轮为已有真实输出离线回放，未新增远程请求、未融合生产。

后续真实重跑见 [MECHANICAL-REAL-RESULT.md](MECHANICAL-REAL-RESULT.md)：正常候选1句完成，源句连接丢失两次后停止，旧错误题未运行；552已知tokens+2失败usage未知，服务关闭，不能称完整核验已验证。

连接替代路径见 [CONNECTION-RESULT.md](CONNECTION-RESULT.md)：已有Wrangler登录会话经官方REST，短6/6、长4/5成功，最后3长请求连续成功，但一次401仍保留，不能保证长期稳定。rest-transport可传给runSplit，独立mechanical-rest-v0.5产物，不需要启动wrangler dev；整个REST核验计划尚未重跑。

随后真实REST前置方案测试完成7TARGET/10HTTP：4接口通过3失败，没有连接故障；重复引用不可表示、unsupported行为整句失败、源句上下文污染阻断两个旧错误核验。自动对应/整句聚合仍未实现，不宣称完整方案通过。历史结果见 [REST-SCHEME-RESULT.md](REST-SCHEME-RESULT.md)。

最新修复见 [ISOLATED-RESULT.md](ISOLATED-RESULT.md)：v0.6真实7目标/10HTTP，v0.6.1不改原始模型输出的机械回放解决重复said定位，保留遗漏declined义务，坏act不再拖垮合法兄弟；59测试通过。上下文污染未根治，非整句核验验收。

继续隔离与简化见 [TARGET-ONLY-RESULT.md](TARGET-ONLY-RESULT.md)：v0.7/v0.8/v0.9同7目标真实迭代，抽取只看TARGET，LLM只输出四个引用；机械字段、词面覆盖反馈及窄原文归一化交代码。最终v0.9.1原始真实输出回放7目标无引用/重叠/词面漏项错误，保留declined义务，64测试通过；身份消歧和整句核验仍未完成。

关系链路真实结果见 [RELATION-CHAIN-RESULT.md](RELATION-CHAIN-RESULT.md)：分别转换代词与命题配对，本地语义审查门后代码定位两旧错误；正常p11关系保留但时态待定，正常p12配对未知。71测试通过，未实现正常整句pass或独立可靠性验证。

最新 [EVENT-ARGUMENT-RESULT.md](EVENT-ARGUMENT-RESULT.md)：v0.12真实事件/参与者拆分失败（动作忠实、参与者仍跨报告层），v0.13复用真实动作由窄语法代码复制论元，本地核对后恢复正常p12配对、保留旧错误诊断。79测试通过；正常整句仍因would/限定语/覆盖待定，非独立核验通过。

漏错优先完整缓存记账见 [FULL-PRACTICE-RESULT.md](FULL-PRACTICE-RESULT.md)：连续数量状态绑定补丁修复第三旧漏点，回放全部60题/32原错误点；旧基线+已复核窄补丁放行29、拦截29、接口失败复核2，未再放行三个已知错误。它不是分解原型60题新真实运行或总体漏错0%；完整覆盖策略无人放行、31题需复核。87测试通过，下一步需冻结后新材料有限实验。

```sh
node scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/mechanical-replay.mjs
node scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/split-heal.mjs --mechanical
```

前者回放冻结历史raw，后者仅生成机械模式计划，均不联网。机械模式新增唯一词边界引用和受限报告动词校验，全部可检测错误一次回传。重复引用无法唯一定位仍为接口错误，不能当语义检错成功。带--remote仍仅运行角色转换，须单独授权/审批，不能把本轮离线回放冒充新真实运行。

一个 subagent 实现了上下文、契约、比较器、转换接口和runner初稿，随后用量限制中断；主agent接手修复比较/预算/基础设施故障处理，补齐测试和报告。无生产修改、commit、部署或heldout读取。

## 运行

根目录：

```sh
node --test scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/*.test.mjs
node scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/runner.mjs
node scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/oracle.mjs
```

分别是本地测试、**不联网的计划与请求生成**、**人工参考结构比较测试**。产物写 `out/atomic-evidence/structured-v0.2/`，oracle 写其子目录；与旧实践和v0产物隔离。

真实实验需要人工明确允许向Cloudflare Workers AI发送冻结新闻上下文和候选文本，再启动本地worker，执行：

```sh
STRUCTURED_VERIFIER_REMOTE_AUTHORIZED=yes node scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/runner.mjs --remote
```

这个标志只是程序误操作防护，**不替代用户授权或managed安全审批**。用户随后明确要求跑真实LLM，本轮执行审批通过。当前运行已在预算停止线结束，不能简单重跑冒充新实验。被测模型固定glm-4.7-flash；无远程judge。

## 文件职责

- context-store：仅按冻结来源坐标取文，校验hash，生成14题适用性盘点和6题手工路由组件诊断计划；窗口±2句，不截断溢出包。
- interfaces/contracts：两个窄业务转换器（speech/scoped_quantity）分别抽取候选与证据；精确引文由代码定位offset；图引用、类型与字节覆盖检查不证明语义完整。
- alignment：独立接口只表达实体/核心命题/统计对象对应关系，不比较单位、状态或数值、不改图。语义对齐仍需要本地原文审查，不能称为确定性保证。
- comparator/numeric：在对齐前提成立时，代码比较报告模式、极性、事件状态、窄单位/损伤状态枚举、精确十进制与数量范围。other/unknown不因相等而通过；不存在通用状态强弱本体。
- runner：证据单独缓存；6候选+3证据+6对齐+6整句对照，最多21逻辑调用/42 HTTP尝试；到30000已知tokens停止后续请求、每请求120秒。累计阈值可能被最后一个请求跨过，不是计费总量硬保证。使用量缺失/进程中断/基础设施失败停止而非计成语义拒绝；缓存包含版本/prompt/schema/model/参数。
- 若人工审计明确一次基础设施失败，最多允许剩余第二尝试；未知usage保留并计保守reserve到预算，不擦日志、不按0费用计。inflight未知状态仍禁止静默重发。
- oracle/tests：人工结构仅用于代码测试和模拟传输，不进入真实模型请求。

## 当前未完成边界

最新40条真实扩大测试见 [EXPANDED-DEV-RESULT.md](EXPANDED-DEV-RESULT.md)：来源引用由代码绑定、逐条隔离、自愈具体字段反馈已实现，旧保存输出引用回归8/8。新20错误中实际漏放5/20、语义未识别6/20，总复核7/40；原文转换及整句语义门仍失败，不是完整分解链路验收。入口 `expanded-dev.mjs`，冻结调用条件/输出在out/atomic-evidence/expanded-dev-v0.16.1，`expanded-score.mjs` 要求绑定当前本地审计后复算，无新增调用。

2026-09-18 新材料冻结真实探针见 [FRESH-DEV-RESULT.md](FRESH-DEV-RESULT.md)：八父句原始状态一致，但两来源编号错使两个batch全转复核；现有数量窄规则未覆盖新类型。非完整分解端到端或独立验证。`fresh-dev.mjs` 支持离线冻结/`--remote`明确授权运行，`fresh-dev-review.mjs` 从保存真实原始输出重建本地诊断，不新增调用。

自动routing、嵌套报告链、完整时序/角色职位/动作范围核验、工具扩文后的自动重转、独立验证、60题扩大与完整组合均未完成。needsContext返回pending；可登记取全文的窗口工具已实现，但并无模型自动调用闭环。

speech proposition与population的内部意义仍由带锚点的label表示，并由独立对齐转换提出对应；这是最小业务切片，尚不是完整论元图。当前不能证明转换不会遗漏、错绑或猜测细节。所有pass都标记semanticCoverageVerified=false；生产准入不能把它当已独立验收。

重要已展示边界：第二断言被模型遗漏但错误地用整句span声称已覆盖时，机械接口检查/比较仍可能通过。只有独立语义审查发现此错误；测试专门保留了这个负控制，不宣称核验漏洞整体已解决。

结果见 [LOCAL-RESULT.md](LOCAL-RESULT.md)，设计见 [方案](../STRUCTURED-VERIFIER-DESIGN.md)，独立审查协议见 [复核协议](../STRUCTURED-REVIEW-PROTOCOL.md)。
