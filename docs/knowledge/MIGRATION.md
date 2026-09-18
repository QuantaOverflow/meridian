# 2026-09-17：六实体探索历史图谱迁移

## 保留与转换

迁移开始时有 41 个旧节点（包含本轮检查时新增的 specialist 与 auto-risk 记录）。全部保留 id、文件路径、原正文、日期、source 与失效条件，避免现有 ADR、GOAL 和文档链接断裂。

| 旧 type                           | 新实体              | 原因                                                   |
| --------------------------------- | ------------------- | ------------------------------------------------------ |
| falsified / measurement           | lesson              | 原节点通常混合观察与解释，并非一份完整运行记录         |
| claim-anchor-not-rewrite          | attempt             | 具体未执行的锚点方案                                   |
| claim-minimal-unit-representation | mechanism           | 表示与归属建模设计，不能被降本失败整体否定             |
| 其余 claim                        | lesson              | 研究主张、领域规律或历史假设，不虚构已经提出的原型方案 |
| invariant                         | goal（constraint）  | 明确适用目标下的约束，而非普遍真理                     |
| method                            | mechanism（method） | 可复用的开发方法                                       |
| decision                          | decision            | 保留历史决定与状态记录；不由 live 推断已经部署         |

原 type 与关系保存在 `legacy_type` / `legacy_relations`，仅供追溯，不作为活动图的关系。旧 measured_by 转为 based_on，避免间接依据被解读为已直接测试。旧 supports 指向方法时转为方法的 justified_by；旧 depends_on 按目标/方法/经验分别转为 constrained_by/requires/based_on。

旧 refutes 转为带范围的 cautions：最小单元表示的降本失败、便宜模型的槽位抽取失败，以及固定位置截断失败，均不能证明整个表示或新闻倒金字塔规律错误。原结论正文不改，图上不再作无条件否定。

## 补充历史

- 对旧本地失败干预补出历史 attempt，并连接证据摘要 experiment。
- 旧观察、分析和外部文献补出 retrospective_analysis / literature_review 证据摘要；没有执行证据时不虚构本地尝试。
- 所有复原摘要标 `record_completeness: summary_only`。它们不等于一次精确可复现运行；缺失配置、版本、输入清单和成本均记未知。
- 近期三臂 c36 对照、证据隔离八句/30 句/v5、人工窄风险八例、自动问题四例分别记录，保留早期通过与后续失败。
- 从三臂提炼机制但明确归因与泛化尚未验证；受约束风险槽和 plan → verify → backfill 组合仍是 proposed，没有 evaluated_by。
- 风险核验的人工问题、非盲评、正常对照、成本与未执行的下游步骤保留，避免把结构通过误读为语义达标。

本次共 102 个实体。数量增长包含历史证据摘要与职责节点，不表示完成了 102 次实验。

## 存储与生成

Markdown 的 JSON frontmatter 为维护源，正文仍是可读解释。`scripts/knowledge/schema.json` 定义类型、必填字段、关系方向与属性；生成器在输出前拒绝重复 id、悬空关系、错误端点与缺失属性。

INDEX.md 按任务、时间线与六类实体组织，同时展示适用范围、生命周期、实验 outcome、历史完整性与带属性的双向关系。graph.json 为确定性机器导出，不手改。

详细产物保留原有本地/gitignore 策略；本次仅迁移记录与维护流程，未调用 LLM、未重跑领域实验、未改生产链路、未读取 heldout。
