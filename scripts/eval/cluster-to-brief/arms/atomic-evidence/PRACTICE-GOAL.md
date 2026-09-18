# 核验层扩展练习迭代

2026-09-17。此前八例是熟悉的 c36 调优材料；30 父句扩展已有漏判和误杀。现在使用 practice-risk-v1 的 60 道人工练习，以免继续只围绕八例设计。

## 本轮未知

在扩大后的练习材料上，受约束槽与代码问题模板是否比简短整句支持核验更少漏错，且不增加正常题误杀？若没有净收益，不因为设计看起来合理而采用。

## 接口与对照

- baseline：简短整句支持核验，一句返回一个整体支持状态。是本轮新建的通用对照接口，不是重跑旧版 atomization+gate 或自由全维度 alignment。最初尝试的长 alignment 输出契约失败已留 calls.jsonl，不能计入语义成绩。
- slots：规划器仅见候选，返回固定类别与精确 span；代码生成问题；另一次模型请求逐槽判断。没有人工风险问题或参考答案输入。
- rules：后续变化是代码用通用英文显式词选择归因、时序、数量、模态、动作或因果检查，并保留完整支持兜底；不调用模型规划。不做实体名、簇号或题号特判。每维度首个词仅是问题锚点，问题仍需读取完整候选；这是浅规则，不保证复合句风险定位完整。
- 两路线使用相同冻结候选和证据、同一 glm-4.7-flash 模型、相同混排顺序及不暴露标签的 item id。槽顺序由规划输出确定。正常/错误参考标签不传模型。
- `uncertain` 不放行；引用仅允许严格子串匹配及去掉边界省略号，原始返回保留。子串可解析仍不等于语义支持。

## 评价与成本

模型仅运行被测模块；当前 Codex 根据原句、输出与参考错误点做语义评判，无远程 judge。整句误放行与正常题拒绝由程序汇总；逐错误检出需要另存 Codex 判定，不用父句至少拒一项替代。

每路线 15 个四题 batch。槽路线最多额外 15 次规划；共享 chatJson 的格式失败最多重试一次、temperature 0/0.1。串行，成功产物缓存复用；内部错误不算语义失败，不无限重试。不读取 heldout 或访问生产 R2。

实际早期中断并恢复造成 baseline-b11 有四次失败调用，均记入成本，不以“最多两次”掩盖恢复开销。模型填槽路线在第一批出现缺失时序、数量与假归因；第二批规划又在两次尝试后不满足精确 span 契约，停止扩大。代码选槽规则冻结后全批运行。契约失败时保留末次 raw，逐候选保留仍满足契约的输出，其余标 unavailable，不再重问同一版本。

这批全部是人工练习，30 对照组、18 事件组，不是 60 个独立验证样本。即便全通过，不声称泛化、统计显著性或完整组合达标。正常事实误杀、错误检出、输出契约和成本分开报告。独立验证与端到端组合仍未完成。

## 复现

```sh
node --test scripts/eval/cluster-to-brief/arms/atomic-evidence/practice-iterate.test.mjs
node scripts/eval/cluster-to-brief/arms/atomic-evidence/practice-iterate.mjs
node scripts/eval/cluster-to-brief/arms/atomic-evidence/practice-iterate.mjs --slots
node scripts/eval/cluster-to-brief/arms/atomic-evidence/practice-iterate.mjs --rules
node scripts/eval/cluster-to-brief/arms/atomic-evidence/practice-review.mjs
```

模型运行需已授权的本地 Workers AI 开发服务。输出在 `out/atomic-evidence/practice-v1/`，调用记录包含失败和成本。默认只复用同版缓存，改变接口后需另设版本输出目录，不把旧缓存当新实验。
