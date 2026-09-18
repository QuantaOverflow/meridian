---
{
  "id": "claim-anchor-not-rewrite",
  "title": "报告层应只给「锚点」（哪几句重要 + 票数 + 出处），不改写；写作层按出处直取原句来写",
  "date": "2026-09-15",
  "status": "proposed",
  "source": "2026-09-15 会话推演，未实测",
  "invalidates_when": "实测显示原句直喂让关系错或覆盖变差，或写作层抄袭记者措辞的比例不可接受",
  "type": "attempt",
  "tasks": [
    "改报告层结构",
    "治事实关系错"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "proposal",
  "relations": [
    {
      "type": "based_on",
      "to": "measure-writer-input-anatomy",
      "attributes": {
        "scope": "提出或解释结论的已有依据；不表示该方案已经直接测试"
      }
    },
    {
      "type": "based_on",
      "to": "falsified-minimal-unit-compression",
      "attributes": {
        "scope": "提出或解释结论的已有依据；不表示该方案已经直接测试"
      }
    },
    {
      "type": "constrained_by",
      "to": "invariant-citation-resolvable"
    },
    {
      "type": "constrained_by",
      "to": "invariant-support-count"
    }
  ],
  "legacy_type": "claim",
  "legacy_relations": {
    "measured_by": [
      "measure-writer-input-anatomy",
      "falsified-minimal-unit-compression"
    ],
    "depends_on": [
      "invariant-citation-resolvable",
      "invariant-support-count"
    ]
  },
  "verification": "proposed",
  "hypothesis": "以重要性锚点与原句出处替代二手事实改写，提高覆盖与可核对性",
  "changes": "写作层按锚点坐标读取原句，标签不进写作 prompt",
  "reason": "减少模型转述层数；此前降本失败不等于质量方向失败",
  "next_unknown": "端到端覆盖、关系错、记者措辞复用与输入成本是否改善"
}
---
**主张**：抽取这一步从「读 20 句、改写成自足事实句」改成「读 20 句、指出哪几句承载重要事实，
各给一个短标签」。标签只用于去重判同一性，**不进写作 prompt**。去重照旧计票。报告产出变成锚点列表——
每条是票数 + 一组出处，写作层按出处**直取原句**（不是相似度检索）。同一件事被三篇报道，
写作层就看到三条原句互相补充。

这样 LLM 转述从两次降到一次，写作层看到的是记者原话而非二手改写。接地校验也变平凡——用的就是原句。

**为什么现在能提这条（之前不能）**：`falsified-minimal-unit-compression` 判「不改写」路线证伪，
理由是产出比自由句还长（52–56% vs 40–50%），**但同一条节点写着「召回更好」（c18 24/30 vs 生产 20–22），
且失效条件明写「目标从省 token 换成提质量/可核对性——那时这条结论不适用」**。
本主张正是这个转向，所以那条证伪不适用。

**与另外两条证伪不冲突**：`falsified-retrieval-gapfill-loop` 否掉的是「按与成稿相似度检索」，
天然捞回已写过的；锚点方案是按出处直取，不是检索。`falsified-five-slot-srl` 否掉的是强迫逐字摘抄
五槽论元，锚点不需要结构化论元，只要句号 + 短标签。

**已知风险，需在实验里量**：
1. 原句里的记者措辞被抄进正文（本仓栽过：流水线措辞漏进正文、复读 80 遍漏进正文）——保留现有代码级检查器
2. 写作层输入变长（原句是改写句的 1.33–1.87 倍），省下的输出成本会有一部分变成输入成本
3. 约一成原句以代词/连接词开头，不自足
4. `falsified-minimal-unit-compression` 那轮遗留的真问题：8–17 条 fact 混着 said/told，归属没分干净
   （锚点方案不需要分离归属——原句里谁说的本来就写着，此项风险降低但要复核）

**验证方式**：四簇 fixture 上做对照，一边现行改写版、一边锚点版，都走到成稿，
用现成判据比——清单召回、骨架事实数、关系错每十句、越界引用。`accept.ts` 冻结可直接用，
只需新写锚点版的抽取 prompt 与报告渲染。
