# structured-v0.2：本地实现结果

2026-09-17。结论：**在人工参考结构/对齐正确的前提下，确定性比较能定位三个旧关系错误；LLM文本转换路线尚未验证，不能宣称核验问题解决。**

## 实际执行

- 新测试29项通过：接口/来源/上下文限制、独立两侧请求、精确引用定位、比较器、精确十进制、预算和基础设施处理、进程中断回执、模拟传输完整21逻辑调用链。
- runner dry-run实际执行：14题盘点、6题烟测、3个共享证据转换包；生成请求但不发送。
- oracle实际运行6题的人工相关结构切片；结构和对齐人工指定，锚点为相关整句，不能作为模型精细字段抽取准确性证据。
- 旧接口10测试、冻结60题结构检查通过；pnpm typecheck退出0、四项缓存命中，不覆盖新mjs业务语义。新mjs由上述实际测试覆盖。
- 新被测远程HTTP请求0、tokens0。模拟fetch回复来自本地人工fixture，不是模型输出或实测baseline。耗时/人工成本未计，无金额账单。

## 三个旧问题，代码是否具备处理能力

| 问题 | 人工参考结构下的代码回执 | 不能据此证明的部分 |
|---|---|---|
| p11-u：记者替代Meink作speaker | 两个speaker_edge explicit_conflict；整句conflict | LLM是否把两个报告行为完整、忠实抽出并正确对齐 |
| p12-u：warn will改成confirmed had already | reportMode与eventState分别not_established；整句pending | LLM是否区分军方部署确认和分析人士军备竞赛警告 |
| p20-u：562 damaged改成562 completely destroyed | 同measurement的state not_established；整句pending | LLM是否保住population/value/state绑定，且未按候选修正证据 |

这里pending伴随明确不支持字段回执，不是只有“模型不知道”。not_established不等于原文明示该事实绝对为假，不把缺乏支持夸大为矛盾。

正常参考结构：p12-s整句pass；p11-s/p20-s的已表示关系均entailed，但分别因later时序、非数值建筑元素状态从句未支持而整句pending。**正常整句只1/3通过，不是正常内容零损失。** 这些数字仅描述6个手工结构测试的结果，不是模型准确率、独立统计样本或泛化指标。

第二断言控制：显式声明未覆盖时pending；若转换器丢掉第二断言却以整句span假报完整，在未传手工预登记scope guard的比较器负控制中仍可pass（semanticCoverageVerified=false）。实际p11烟测聚合仍有预登记time残留而pending；该guard不证明第二断言被抽全，也不能普遍发现未预登记的遗漏。真实转换忠实性是下一步必须测的核心未知，而非被机械结构校验解决。

## 本轮实际发现并修复

初版quantity未知state/空unit可在“相等”对齐下pass，562和562.0又被视为不同。主agent的独立review测试先复现三项失败，随后修为未知/空值pending与精确十进制归一化。

初版让alignment模型判断unit/state等价，混入业务比较。v0.2移除fieldLinks；unit/state变为窄枚举，由代码比较。reportSource改为实体指针，其同一性仍需审查；不偷用字符串相似度。

基础设施HTTP200但success=false不再当契约失败重试；未知usage停止后续；持久化inflight标记避免重启后静默重复未知计费请求。全部对应测试实际通过。

## 后续与当前阻塞

远程烟测尚未执行：此前安全审查要求明确允许把新闻原句/人工候选发送到Cloudflare Workers AI。本轮用户要求完成原型，主agent提出了独立授权问题，但尚未收到明确发送同意；不绕过拒绝。

获得授权后按已生成版本协议跑同上下文整句对照与独立转换/对齐，主agent逐字段原文审查，分别报明确诊断、仅未知、契约失败、错误放行和正常整体损失。当前不扩大、不融合、不读heldout。Subagent因用量限制中断，主agent完成后续，不将其误报成全部由subagent完成。
