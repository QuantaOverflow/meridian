# minimal-fields-v0.4：固定命题、单字段与组合字段

2026-09-17。真实Workers AI @cf/zai-org/glm-4.7-flash。18请求全部首次返回接口通过；无self-heal或契约重试，无远程judge。主Codex本地非盲复核。9887input+168output=10055tokens，usage全部已知，累计请求22.431秒非墙钟/金额，金额未知。服务已关闭，无生产/heldout变更。

## 唯一未知与对照

旧split-heal-v0.3状态接口同时做三分类和引用生成，角色也含共指/报告识别；不能直接归因最小分类能力。本轮人类固定verb与proposition，原句与原radius2上下文保留；去掉角色、图、引用、覆盖、对齐任务。4条输入各跑3个独立字段及1个三字段组合请求，加2次独立polarity原样新请求（仅缓存键repeat不同，模型输入相同、skipCache true）。共18逻辑，上限36HTTP/12000已知tokens，每次120秒。

3条真实开发输入：p12源句analysts warn will accelerate；p12-u错误候选Analysts confirmed had already accelerated；p11源句He told reporters revealing more would undermine。第4条是明确合成对照Meink said that revealing more did not undermine deterrence，不是新真实样例或heldout。

本轮参考值在运行前由本地代码测试冻结，未注入正误标签。提示明确通用字段定义（包括典型动词、did not、would等），因此是充分说明的小样本开发诊断，不是未见语言泛化。人类固定命题绕过上游抽取，不能外推端到端。

## 本地逐字段复核

| 输入 | 单独报告类型 | 单独时间状态 | 单独否定 | 三字段组合 |
| --- | --- | --- | --- | --- |
| warn / will accelerate | warn正确 | future正确 | positive正确 | 三项正确 |
| confirmed / had already accelerated | confirm正确 | completed正确 | positive正确 | 三项正确 |
| told / would undermine | say正确 | conditional，参考future，有分类边界争议 | positive正确 | say/future正确，negative明确错误 |
| said / did not undermine（合成） | say正确 | completed正确 | positive明确错误 | say/completed正确，positive明确错误 |

两个重复请求（had already accelerated及would undermine单独polarity）均返回positive，与首次一致。它们不能说明did not错误可重复，因为没有重复该输入。

按预注册参考值单字段10/12、组合字段10/12；单字段的would→conditional是预测/隐含条件的类别边界，不能当成与明确否定漏检同强度的语义失败。明确否定错误：独立1/4，组合2/4。整体无单字段净胜证据；同一would undermine的独立positive与组合negative差异仅局部支持混合任务干扰，不是因果/可靠性证明。

## 结论与可用边界

不能把问题全归为复杂度未拆够：即便固定命题只输出polarity，did not也被误判positive。这只说明当前模型/提示/schema调用条件存在最小任务错误，不代表所有LLM的能力上限。

也不能忽略设计：would undermine从独立正确到组合错误，原型负担会影响结果。warn/future与confirm/completed在固定输入上均能正确表达，先前失败不意味着这些字段本身完全做不了，上游报告识别/命题边界仍是未解决环节。

窄代码对照：显式warn/confirmed/told/said词典，did not等有限否定词及will/would/had already/did时态规则，在4条冻结输入与预注册参考值上12/12一致；不具备一般否定scope、反事实、嵌套及开放词汇语义保证。代码控制成功不是完整核验成功。本版保留实验，不扩大融合；下一步优先将已确定可机械处理字段交代码，LLM只处理无法确定的片段并保留未知。

37本地测试通过，pnpm typecheck退出0（4缓存命中，不覆盖新mjs语义）。产物out/atomic-evidence/minimal-fields-v0.4/：plan.json（条件和固定输入）、cache/*（请求/schema/raw/attempt messages）、calls.jsonl、results.json、run-state.json。results.json保留运行器semanticReview=not_performed；本报告为本地复核，不改被测答案。
