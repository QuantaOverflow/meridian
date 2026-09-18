# structured-v0.2：真实 Workers AI 部分烟测

2026-09-17。**已调用真实glm-4.7-flash；未证明解决核验问题，本版不扩大或融合。** 用户在说明文本发送目的地后明确要求“跑真实llm”，执行审批通过。

## 运行与停止

限定计划6题，实际8次HTTP尝试/6个逻辑请求：仅p12-u完整跑完，p11-u转换部分执行；剩余4题未运行，数量族未测。全部串行，同冻结context-v2，无远程judge、heldout、生产修改/部署。

第一次证据请求发生Workers AI binding Network connection lost，HTTP500无usage；保留原记录并重启worker一次，人工核对后仅恢复剩余第二尝试。recovery-audit.json登记未知用量保留15576 tokens预算占位（请求UTF8 bytes9576+output cap5000+额外1000），是保守预算估算，不是实测用量或可靠计费上界。没有擦掉失败、假装零用量或无限重试。

7条有usage响应共11537 input / 5623 output=17160已知tokens；另1条失败实际usage未知。预算记账17160+15576=32736，达到原30000停止线后不再发送；最后一条完成的响应可跨越阈值。累计请求123.187秒，非总墙钟/金额。HTTP42尝试上限未达到。服务已关闭。

## 主Codex本地语义复核

### p12-u：未来警告被加强为已完成确认

- 候选转换有效：保留Analysts、confirm、completed，没有擅自修复错误候选。
- 证据转换结构有效但语义严重缺漏：原文明确analysts warn will accelerate，图中有arms-race event节点，却没有Analysts实体或warn→该命题的报告fact；首句覆盖错误地引用另一处的f2。Troy Meink与职位被拆成不同说话实体并重复建立报告行为，把Washington（命题主体）误当recipient；f3/f4重复同一陈述。
- 对齐结构有效但语义错误：Analysts→Troy Meink equivalent；China→Washington equivalent；Russia节点指向Troy Meink而锚点引用Washington；候选arms-race报告fact配到Meink的部署报告f2。候选和证据同样使用n编号，可观察到多处跨图同号错配，但尚未因果证明编号冲突是原因。
- 代码未放行：paired f2的proposition不是已链接的arms-race proposition，返回proposition_identity_required unresolved，整句pending。它没有正确诊断warn/future与confirm/completed差异；不能把该未知算语义检错成功。
- 同模型/同上下文整句baseline仍返回supported，引用含warn will的原句，重复旧漏判。

此题没有正常对照结果，不能估正常损失、净收益、架构优势或泛化。只观察到“旧baseline错误放行，结构路线错误转换/对齐后未知”。

### p11-u：记者替代Meink作为说话者

候选转换两次均契约失败：第一次speaker填Reporters自由文本、proposition填自由文本而非图节点ID；第二次仍有同样指针问题，并引用不存在的reveal more（原句revealing more）。不能当模型正确拒绝或比较器发现说话人错误。

其证据转换第一次coverage incomplete：未覆盖全部句子，重复将命题主语或行动对象当recipient，命题polarity也有误（undermine不等于句法否定）。到预算停止线，未作其第二契约尝试，没有alignment、baseline或完整整句结果。

## 结论与下一未知

确定性比较模块的人工图结果不能外推到真实NL链路。充足原句及±2上下文、严格schema和精确引用，仍未让当前业务图转换完整忠实。新增图对齐接口同样会作不可靠语义对应，不能因“没有最终verdict字段”就视为安全确定性接口。

本版保留失败产物，不扩大、不融合。若继续探索，先重新拆小转换契约（一个报告行为的角色与命题、再独立命题状态），由代码分配/命名空间化ID、生成可机械生成的覆盖账本并保留未解析义务；这些只是候选修订，尚未实现验证。不能靠放宽span/引用/图指针校验把坏输出判成功，不能消耗远程token补记录。

产物：out/atomic-evidence/structured-v0.2/ 的calls.jsonl、请求与cache/raw、results.json（只有1完整题）、run-state.json、recovery-audit.json及local-review.json。raw results仍保留semanticReview=not_performed（运行器生成时），本地独立review另存sidecar和本报告；不修改被测答案。

本地新增审计预算测试后30新测试通过；pnpm typecheck和知识库生成校验在本轮完成。它们不是模型语义达标。
