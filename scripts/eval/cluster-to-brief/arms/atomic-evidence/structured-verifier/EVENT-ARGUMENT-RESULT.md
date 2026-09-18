# 事件/参与者拆分与窄语法接管

2026-09-18。目标：解决v0.11正常p12配对未知，同时不抹掉两个旧错误。只用同四开发候选及现有源句，未扩大样本、未读heldout、未融合生产；主Codex本地非盲复核，无远程judge。

本轮职责变化：不再同时配对整条命题；独立抽动作与事件参与者，再用代码要求动作/主语/对象唯一对应。未知、格式失败与语义错误分开记录；不是以接口通过替代验收。

## v0.12真实Workers AI

四事件（两个p12候选、源句武器部署及军备竞赛加速），动作与参与者各一任务。上限8逻辑/16HTTP/12000已知tokens/60秒单请求，一次实际错误反馈。固定REST/glm-4.7-flash/thinking off，动作只看命题；参与者看命题和原始同句，用于继承事件主语，不见邻句或兄弟候选。

实际8逻辑/9HTTP/1787已知tokens，累计请求24.781秒，无连接失败；美元未知。原始条件/输出保存在`out/atomic-evidence/event-kernel-v0.12/{plan,calls,kernels,results,run-state}`。

- 四个动作词均忠实：accelerate/deployed/accelerate/accelerated，代码只处理受限词形变化，不改时态字段。
- 参与者4任务只有部署事件正确；正常候选把Analysts当事件主语、announcement当对象；源句加速事件把The US当主语，并保留过大的宾语限定范围。这两项引用合法但语义错误。
- 错误候选参与者语义指向合理，却给字符串额外加字面引号，真实反馈两次仍未通过精确引用。它是接口失败，不计语义正确或正确拒绝。
- 所以两p12配对均未知，这版拆分未解决问题。不能据此声称模型通用能力上限；选中动作与报告上下文之间的任务隔离仍可能影响行为。

## v0.13确定性回放

保留以上失败，不修改模型文本或手填参与者。只复用真实动作结果，移除此窄语法范围内多余的LLM参与者任务：

1. 受限`主语 + will/would/has/have/had [already] + accelerate/deploy + 对象`结构直接复制原文主语/对象。
2. 仅对完全匹配的`in [NP] that [原报告speaker] [原报告verb] will/would [action] [对象]`关系结构复制NP，不做“找最近名词”推断。
3. 名词头只产生配对建议；完整主体NP、原文偏移、匹配规则和未比较的with/in后缀保留在receipt。相同名词头不证明指代相同，局部身份/命题复核门继续生效。
4. 未支持动词/语法、否定或协调参数、嵌套报告、模糊或重复引用返回未知。代码不分类报道真假，不将未支持内容删掉。

回放新增远程调用0。p11复用v0.11已保存真实配对/He解析；p12依据真实动作+代码论元生成唯一配对，不使用p12-u旧正确配对直接补正常题。主Codex对照原文复核两个新配对：事件主体是announcement，对象是high-risk arms race；不是Analysts报告行为或US部署武器。local-audit绑定完整结果、配对与解析hash。

|目标|复核后的关系结果|整句|
|---|---|---|
|p11-s正常|2报告保持正确对应，speaker/reportMode/polarity一致|pending，第2would未知及完整覆盖未验|
|p12-s正常|之前未知的配对恢复，speaker/reportMode/polarity一致|pending，would/future关系与完整限定语未验|
|p11-u旧错误|2个Reporters/Meink归因差异仍检出|注册证据内不支持，不作通用真假判断|
|p12-u旧错误|confirm/warn与completed/future差异仍检出|注册证据内不支持，不抹掉原错误|

正常3条报告均完成配对且适用关系无误拒，不等于正常整句全部通过。79回归测试全部通过，包括未知/重复引用、规则之外语法、嵌套报告、动作相同但参与者不同、唯一候选约束与本地语义复核门。typecheck4任务缓存通过，不替代mjs运行。

证据：`out/atomic-evidence/argument-router-v0.13/{plan,results,local-audit,reviewed-results}.json`。

复现：

```
node scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/argument-router.mjs
node scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/relation-review.mjs --arguments
node --test scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/*.test.mjs
```

## 限制与下一步

最终变化是对真实动作输出的离线语法处理，不冒充新一轮全链路远程运行或独立可靠性分数。窄规则来自已知开发材料，不泛化到其他结构；谓词仅accelerate/deploy词形，名词头仍需身份审查，限定语保留但未比较。所有正常整句仍pending，完整覆盖false，declined义务未删除。

本轮有限真实预算到此停止。下一步应单独处理报告语境中的would及限定范围，再决定是否做有限独立验证；不靠取消未知/审查门或将词面匹配当语义覆盖使正常题通过。
