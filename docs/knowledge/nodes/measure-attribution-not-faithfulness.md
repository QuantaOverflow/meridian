---
{
  "id": "measure-attribution-not-faithfulness",
  "title": "引用「正确」不等于生成「忠实」：实测高达 57% 的引用是事后合理化",
  "date": "2026-09-15",
  "status": "live",
  "source": "外部文献，本仓未复现 —— arXiv:2412.18004",
  "invalidates_when": "出现能验证「模型确实依据这条证据生成」的机制（而非只验证证据是否支持结论）",
  "type": "lesson",
  "tasks": [
    "治事实关系错",
    "设计验收门"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "external_literature_not_reproduced",
  "relations": [
    {
      "type": "constrained_by",
      "to": "invariant-citation-resolvable"
    }
  ],
  "legacy_type": "measurement",
  "legacy_relations": {
    "depends_on": [
      "invariant-citation-resolvable"
    ]
  },
  "kind": "observation"
}
---
**读数**：《Correctness is not Faithfulness in Retrieval Augmented Generation Attributions》
(arXiv:2412.18004) 实测发现，**高达 57% 的引用是事后合理化（post-rationalized）**——
引用指向的文档确实支持该断言（引用「正确」），但模型并不是靠这条证据生成的那句话（不「忠实」）。

**这条解释了本仓一个长期现象**：报告层的 `cite` 编号 100% 可解析、越界引用 0
（见 [[invariant-citation-resolvable]] 与 falsified-minimal-unit-compression 那轮的 257 条出处全解析），
**而关系错（时序、因果、名字数字接错事件）照旧发生**。两件事不矛盾：
可解析的引用只证明「这句原文存在且相关」，不证明「这句正文是从它来的」。

**可操作的推论**：
1. **「引用可解析」不能当忠实度证据用**，也不能当验收门里的质量信号——它只排除「编造出处」这一类错。
2. 开源同构项目 `elanthus/news-briefing` 的作者写下了同一件事的另一半：
   「验证器只查引用是否指回语料库真实存在的条目，**不检查摘要语义是否忠实于原文**」。
   本仓的 checkFact 是同一层级的检查器。
3. 要治关系错，检测器必须逐句比对**所引原句的内容**，而不是比对引用编号的合法性。

**风险的另一面**：也不要因此过度信任归因步骤本身去做删改——那会落进
[[falsified-intrinsic-self-correction]] 与 [[falsified-rarr-default-on]] 那一类误删
（RARR 43 条删除里 20 条是误删）。
