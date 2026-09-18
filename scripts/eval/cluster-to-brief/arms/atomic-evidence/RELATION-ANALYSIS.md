# 关系核验因素细分：现有输出的回顾分析

2026-09-17。未新增模型调用。relation-probe 的远程执行被 managed auto-review 拒绝，要求明确授权新闻原句/人工候选发送到 Workers AI；本地 worker 已关闭。新三臂探针尚未运行，无性能结果。

证据：practice-v1/baseline-summary.json 和 rules-summary.json 的七个已知漏判对应输出。当前 Codex 逐项读取候选、冻结原文、检查项和理由，非盲、已知失败选择，不是独立复测。

## 可观察的四个不同缺口

1. **完整断言覆盖**：p14-u rules 的 whole_claim 理由仅为 Iran's statement matches；其余锚点也只检查伊朗说法，未检查 Bahrain will not participate。问题不仅是“否定难”，还是第二个断言在输出中没有被核验。首个同类词锚点不能证明复合句完整覆盖。
2. **语义关系不等价仍判匹配**：p21-u 引用 After the coup 却放行 Before；time check 只引用 coup in February 2021。p12-u 把 warn will 用于支持 confirmed had already。定位到相关原句并非这里的充分条件。
3. **分开核验后非法拼接**：p20-u quantity 证明 562 damaged；action 证明 some elements completely destroyed；whole_claim 理由将二者组合成“562 completely destroyed”。独立检查数值与状态不能保证二者绑定同一对象集合。
4. **正确父句决策伴随不接地理由**：p08-u baseline 正确拒绝错误职位，但理由额外写 wrong person (Meink vs Lloyd Austin)，证据没有 Lloyd Austin。父句拒绝正确不代表解释正确，不可把该理由当修复指令。

这些是输出层面的行为归类，不是对隐藏推理阶段的识别。现有输出没有分别保存候选关系抽取与证据关系抽取，因此仍无法分清抽取错、比较错、决策错各自贡献。不能断言改工程架构一定解决，也不能宣称模型能力上限。

## 下一步诊断而非自动融合

RELATION-GOAL.md 固定14题三臂：原接口重跑、同接口强化比较指令、显式候选/证据关系配对。最后一路同时增加输出计算量，不是纯表示消融。运行后需本地核对关系忠实性和断言覆盖，不能只读 status；程序只能校验 span/quote，不能证明关系抽取完整正确。

本轮检查：relation-probe.test.mjs 三项通过；冻结60题结构检查通过；pnpm typecheck 退出0、四项缓存命中，不覆盖新 mjs 语义。远程探针未执行，新增被测请求/token为0；本地服务启动不等于模型调用，金额无账单。
