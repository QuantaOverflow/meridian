# 目标句隔离与机械接口修复

2026-09-17。同一7目标的有限开发迭代；没有扩样、heldout、生产融合或远程judge。

## 真实调用历史

|版本|改变|HTTP/tokens|观察|
|---|---|---|---|
|v0.7|抽取只看TARGET，消歧暂缓|10 / 6568|未再混入邻句，但复制speakerResolved失败、大小写改写和漏报告仍在|
|v0.8|LLM只给speaker/recipient/verb/proposition四个原文引用，代码生成其他字段|7 / 2641|复制字段故障消失，但漏独立报告、角色包含报告词；窄词面守卫已保留义务|
|v0.9|代码报告词清单提供上下文，遗漏/自身报告词重叠作为真实错误反馈一次|8 / 3842|重复said恢复，declined不拖垮said；6目标无引用错误，1源句The/the错误未修复；正常句第一命题仍跨入兄弟报告|

三轮零连接故障，usage均已知，合计25 HTTP/13051 tokens。v0.9累计请求38.567秒（非墙钟/金额），美元未知。原始条件/输出分版本存放 `out/atomic-evidence/target-only-roles-v0.{7,8,9}/`，不覆盖失败历史。

## v0.9.1：无需再让模型完成的机械修复

对v0.9原始模型文本不作人工编辑，离线运行最终处理器：

- 唯一、长度保持的大小写匹配可由代码恢复TARGET的精确原文；记录modelQuotes/canonicalQuotes。歧义、增删词、大小写折叠改变长度仍拒绝。底层精确引用校验未放宽。
- 仅对原始speaker绑定相同、已有合法兄弟报告、明确` and later `结构，代码截取第一报告的原文命题；保留原quote、规则和兄弟ID。没有删掉第二报告，不作一般句法/语义推断。
- 每个行为独立处理；未知、错误、遗漏均可见。代码偏移/报告词清单不是语义验收。

回放7目标全部无引用/重叠/词面漏项错误，共10个合法报告act；declined保留1个unsupported obligation。同句said继续处理。主Codex本地核对关键原文：两said保留Reporters归因，不修正候选错误；源句military confirmed与analysts warn分别保留；正常Meink的said/told边界分开。

证据：`out/atomic-evidence/target-only-roles-v0.9/replay-target-only-roles-v0.9.1.json`。

运行：`node scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/isolated-replay.mjs --target-only`。64单元回归全部通过，涵盖唯一大小写还原、实质改写/歧义拒绝、共享原主语边界拆分、角色/报告词重叠和漏项反馈；历史正常/负例保留。

## 尚未完成

这是修复已复现接口/工作流故障的开发证据，不是独立可靠性或整句核验通过。最终机械补丁是对真实输出的离线回放，不冒充v0.9.1全新远程调用。代词He身份消歧明确not_performed；完整抽取覆盖、自动对应、wholeClaimVerdict仍未实现。已知unsupported declined仍是待处理项，不被转成通过或正确拒绝。
