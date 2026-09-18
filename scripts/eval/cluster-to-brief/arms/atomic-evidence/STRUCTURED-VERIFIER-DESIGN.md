# 结构转换驱动的核验原型探索 v0

日期：2026-09-17。状态：**proposed，只有设计，未实现/测试/远程运行**。

以上及下文为设计时状态记录。最新状态：structured-v0.2组件已实现，29项本地测试、dry-run与人工参考结构比较已实际执行；真实Workers AI路线仍未运行。实施差异、结果和范围见 [LOCAL-RESULT.md](structured-verifier/LOCAL-RESULT.md) 与 [README.md](structured-verifier/README.md)，不得把本地oracle结果当模型验证。

## 目标与历史变化

用户原则：上下文充足；确定性职责交给代码与工具；LLM 只把自然语言转成结构接口；按业务依赖拆复杂度，不把多种复杂工作塞进同一 prompt。

历史依据：PRACTICE-RESULT.md、RELATION-ANALYSIS.md，以及知识节点 lesson-practice-typed-anchors / lesson-relation-factor-observability。旧风险槽只绑定词，漏第二断言和数量作用域；旧单次配对探针仍让模型同时理解两侧并判断支持。本方案替代该探针作为下一轮探索方向，但保留旧文件与未执行状态。

本轮唯一未知：**独立、忠实的业务结构转换，能否给确定性比较提供足够输入，减少已知关系漏判而不大量把正常事实变成未知？** 不检验通用知识图谱，不宣称结构化自动解决小模型能力问题。

## 最小业务切片

先做两个业务族，而非为七种错误建立七套 pipeline：

| 族 | 一个紧密关联的业务对象 | 本轮要表达的关系 |
|---|---|---|
| speech | 一次报道/陈述及其嵌套命题 | speaker、recipient、proposition、归因层级、命题极性、警告/预测/完成状态 |
| scoped_quantity | 一次统计观测 | value、unit、population、对象位置/时期、state、total/subset、统计出处 |

speech 的状态必须绑定到具体 proposition，不能成为整句一个 modality 字段；quantity 的状态与数量必须绑定同一个 population 节点，不能在独立字段表中自由拼接。一个正常完整句可能包含多个同族对象，须全部转换。

time、身份职位、动作强度等未支持族保留为 residual obligations，不伪装成已验收。最小切片没有覆盖的细节使整句 pending，不能默默删掉后放行。未来是否增加族由业务覆盖与成本结果决定。

## 职责与数据流

```text
冻结候选 / 原文坐标
  → 代码 ContextStore：装包、hash、出处、预算和局部取文工具
  → 候选转换器 [LLM，只见完整候选，不见证据]
  → 证据转换器 [LLM，只见完整证据上下文，不见候选]
  → 代码接口校验：span、坐标、类型、引用、图引用完整性
  → 对齐转换器 [LLM，仅提出两侧节点对应关系，不改图、不判支持]
  → 代码业务比较器：在可审计的对齐前提下执行规则
  → 代码整句聚合：pass / conflict / pending / contract_error
```

各族用不同窄 prompt/schema；不让模型输出 supported、最终 verdict 或改写修复文本。证据转换按 evidenceHash + family + contextVersion 缓存，两个对照候选共用同一份证据结构，避免候选诱导证据转换。

自动 routing 是后续单独待验的转换接口（全句→所有业务 obligations + residual），不是靠每类首个词匹配。初始烟测按预注册的业务族调度，是人工指定路由的组件诊断，不是自动全链路结果。不可拿人工路由成绩宣传端到端达标。

## 上下文协议与工具边界

- 原始 practice-risk-v1 的标签针对 supplied evidence bundle；不能扩文后照搬旧标签。保留 evidence-core 协议与原结果，不修改冻结文件。
- 建 context-v2：仅按 sources 中已有 articleId/sentence 从本地 dev fixture 取原文，以原句±2句作为起点，保留标题/发布时间/文章边界。需要指代或归因上下文时允许 get_source_window 扩大一次到该来源全文；超预算返回 context_overflow，不截断冒充充足。给候选原完整句，不剪掉后半断言。
- 所有组装由代码完成，不做语义近邻检索或调用生产 R2。工具只接受已登记来源 ID 与整数范围，不接受任意 URL、文件路径、shell 或网络目的地。
- 分离正文工具返回与系统指令；新闻正文只作数据，不能产生额外工具权限。
- LLM 可输出 needs_context={sourceId,span,reasonCode}，代码校验请求范围并执行；工具只取文，不替模型判断语义。若上下文扩展后仍不明，保留 ambiguous；不得用低置信度字段充当确定事实。
- 初始两个族获得同一冻结 context-v2 包，不按候选错误类型挑“有利证据”。本地 Codex 对 context-v2 重审参考判断并记录上下文是否足够，不能证明全文必然解决歧义。
- 原整句对照也接收同一 context-v2，必须新版本运行；原缓存仅作历史定位，不能当同上下文的公平对照。

## 接口契约（示意，实施前需冻结 JSON schema）

共同 envelope：{version, opaqueItemId, family, sourceHash, nodes, relations, unresolvedSpans, needs_context}。

每个值/关系有 provenance={sourceId,start,end,text}；offset 在原始工具返回文本中定位，text 必须逐字一致。推导或指代解释用 anchors[] 保留多处来源，并显式标 inferred/ambiguous，不能伪造逐字片段。候选图不能引用证据，证据图不能引用候选。

speech 示意：report R→speaker E1、recipient E2、proposition P；P→predicate、arguments、polarity、eventState。嵌套 reporting 通过 report→proposition/report 表达；谓词和主体的语义规范化属于模型转换职责，需要独立验收。

quantity 示意：observation Q→value/unit、population G、period、reportSource；G→objectType/location/state；subsetOf 只在原文明示且锚点可解析时提出，缺失关系不能由代码猜出。

对齐输出：{candidateNodeId,evidenceNodeIds,relationKind,anchors,unresolved}。允许零个或多个对应项；代码验证 IDs 和来源、禁止在对齐阶段修改两侧抽取字段。候选和证据节点对应的同一性仍是语义判断，不能因 JSON 合法就信任。其准确性必须单独计分。

禁止依赖字符串相等/相似度断言两个 proposition 相同；代码只做 Unicode/空白等无语义格式规范化。业务同义、指代、主体同一性等均保留为可审计转换输出，含糊就 pending。

## 确定性比较与聚合

| 代码可做 | 前提及不能偷偷承担的语义职责 |
|---|---|
| 数值、单位、边界比较 | 同一已对齐统计对象、状态、时期；禁止跨 population 拼数值与状态 |
| speaker/recipient 边比较 | 已对齐同一命题，实体对应已解析；不能用名字出现推出说话人 |
| 否定、事件状态比较 | 已对齐同一命题/作用域；不能对整句全局套一个极性 |
| 归因层级和引用链检查 | 检查报告行为，不把被引述命题当外部真值 |
| 聚合与审计回执 | 所有 obligations 都有有效映射才可能 pass；残留/歧义/不支持族 pending |

规则输出区分 entailed、explicit_conflict、not_established、unresolved、contract_error。比如 warn/future 不支持 confirmed/completed，未必证明后者事实上为假；damaged 的总数不能证明 destroyed 的子集数，也不证明子集数必定不同。代码不得添加未审查的通用模态强弱排序或损伤状态本体。

每个结果带 ruleId、两侧节点/边、provenance、reasonCode，解释由代码模板生成，不允许模型理由引入 Lloyd Austin 一类无来源事实。

全句 pass 需要完整义务账本且全部 entailed；有明确 conflict 返回 conflict；未建立支持、缺上下文、残留义务等返回 pending；接口失败单列 contract_error。pending/contract_error 在发布策略上可不放行，但不得冒充语义检错成功。

代码能检查每段原文字节是否被标注，但字符覆盖不证明语义断言覆盖。结构转换遗漏必须由独立本地原文审查判定，不能用模型自报 complete 作保证。

## 分阶段对照与停止条件

1. **纯代码 comparator oracle**：本地 Codex 从原文编写参考结构，覆盖换说话人、状态强化、数量状态错接、漏第二断言、缺引用、歧义、未支持类型。运行正常与错误/未知控制测试。参考图只用于测试代码和定位组件上限，绝不进入被测模型输入，不算自然语言全链路表现。
2. **14题本地适用性盘点**：沿用 p08/p11/p12/p14/p20/p21/p29 的正常/错误对，登记上下文、义务与最小两族能覆盖的范围，不远程调用。预注册 unresolved 的其他族，不以实验结果筛样本。
3. **6题转换烟测**：p11、p12 的 speech 对与 p20 的 quantity 对。独立候选转换6次，证据包/族转换3次，对齐最多6次；原整句 context-v2 对照6次，均单题调用，不让正常/错误兄弟句同现。共最多21个逻辑调用，每次至多1次契约重试，总HTTP上限42。上下文扩展导致重转也计在此上限，超过则停止，不自动扩大预算。累计已知tokens到30000或单请求超120秒即停止后续；实现时独立受限 runner，不能沿用共享 chatJson 的600秒超时。金额无账单不估称实测成本。
4. **有信号才扩大**：至少两个不同业务族的已知错误得到正确结构解释与明确不匹配、对应正常关系正确保留，且无严重抽取/对齐遗漏，才考虑扩大。先可加 p14 对检查第二报告断言与否定，再考虑同协议扩展已有60题。p11 的 later 等未支持细节按盘点表预注册 out_of_scope，其正常整句可能 pending；这不计正常整句通过，也不能靠删除该细节达标。对预登记可完整覆盖的正常题，要求整句 pass；其他正常题分别记适用关系保留与整体pending。不得根据中途表现更改适用范围。仅因 fail closed 少放错不够；否则按转换、对齐或代码因素定位并停止，不无上限加 prompt。
5. 扩大前冻结 schema、prompt、上下文与比较规则、预算和判据；不把60题反复调优当独立验证。未参与设计的材料与完整组合验收另开阶段，heldout c28/c51 本轮不读取。

独立记录：断言/关系抽取忠实性与遗漏、对齐准确性、代码对参考图正确性、具体原错误被明确识别/仅pending/仍放行、正常 pass/pending/conflict/contract_error、调用及token和延迟。分母用共同有效材料；父句拒绝不等于逐错误诊断成功。模型status和机械验证都不是独立语义验收。

模型输入不含 labels、s/u 后缀、p 编号、人工风险问题、选样原因、旧输出/诊断、oracle图或人工对齐；各请求不包含正常/错误兄弟句。语义抽取参考图只在所有被测结构冻结后由本地 Codex 审查使用。代码 schema/类型说明提供业务语义，但不提供本题诊断。

## 实施落位与权限

下一步建议新建 structured-verifier/ 下的 context-store、speech-parser、quantity-parser、alignment-interface、comparators、runner 与测试，产物写 out/atomic-evidence/structured-v0/；不要覆盖 relation-v1 或 practice-v1 缓存。cache key 必含 source/context/schema/prompt/model 版本及参数。

本轮只形成设计与 proposed 知识节点。未实现 comparator/schema/runner，未启动服务或实验，未提交、部署、改生产。远程文本传输之前的审批拦截仍有效；未经用户明确同意发送材料不得启动 Workers AI，不通过其他命令绕开。

设计协作：structured_verifier_design subagent 只读审视职责、接口、上下文口径与停止条件；主 agent整合。Subagent建议先 frozen_bundle，以减少变量；主方案按用户充足上下文原则选择 context-v2，明确另审标签并让同期整句对照使用同上下文。Subagent建议15调用方案不含自动对齐模块；主方案把语义对应显式作为单独转换接口，增加6次，形成21调用上限。两者均非实测。
