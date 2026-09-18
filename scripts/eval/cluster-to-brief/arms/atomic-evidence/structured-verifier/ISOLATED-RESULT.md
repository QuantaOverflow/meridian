# 隔离式角色工作流修复

2026-09-17。开发回归，未融合生产、未使用 heldout，无远程 judge。

## 已实施

- v0.6 为原文重复引用增加 occurrence/source ID；每个 act 独立验证，不支持和错误 act 保留 obligation，合法兄弟继续处理。
- v0.6.1 把可机械确定的重复 verb 定位交回代码：仅在唯一、精确命题与报告词直接相邻（空白/that）时定位，并记录 rule/modelOccurrence。不使用“最近词”等推断；其他情况仍严格验证。
- declined/refused 的窄词面遗漏检查产生待复核 obligation，不推断其报告角色和命题，也不宣称完整覆盖。
- self-heal 保留各次原输出、全部错误和部分结果；修复历史需独立复核。无整句支持结论。

## 验证与真实失败

59 个单元/回归测试全部通过；包含旧真实输出、正常对照、歧义/越界/词内/大小写改写负例、错误兄弟隔离、遗漏 unsupported cue。旧输出转换新增 schema 的回归显式人工添加 selectors/source ID，不是模型自行修复的证据。

v0.6 真实 Workers AI REST：7 TARGET /10 HTTP，11740 已知 tokens，累计请求75.31秒，无连接失败。输出与条件见 `out/atomic-evidence/isolated-roles-v0.6/{plan,calls,results,run-state}`。模型仍把重复 said 序号填错，漏 declined；上下文抽取污染仍发生。不能将新 schema 本身视为解决。

随后 v0.6.1 对这轮原始真实输出做不修改文本、不人工填序号的离线回放，增加远程调用0：

- candidate:p11-u 的两 said 全部定位，保留 Reporters 的原始归因错误；没有通过改写候选消除故障。
- source-1007986-3 的 said 正常继续，模型漏掉的 declined 被代码保留为待复核义务。
- source-1009708-1 留下1个合法 act；2个来自上下文的非法 act 保留错误义务，没有拖垮合法 act，也未被当成正确拒绝。
- 其他4目标无锚点错误；这是结构处理观察，不是独立语义验收。结果见 `replay-v0.6.1.json`。

运行：`node scripts/eval/cluster-to-brief/arms/atomic-evidence/structured-verifier/isolated-replay.mjs`。

## 边界

修掉了重复引用不可表示、unsupported/坏 act 整句阻断及窄词面漏项无记录的问题。上下文污染尚未根治，完整抽取覆盖未证明，自动对应及整句聚合仍未实现。v0.6.1 为真实输出的确定性回放，尚无它自身的全新远程输出；不宣称核验方案已通过。
