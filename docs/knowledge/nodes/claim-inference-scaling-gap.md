---
{
  "id": "claim-inference-scaling-gap",
  "title": "「小模型 + 更多推理步骤 ≈ 大模型单次」在无 verifier 的开放式生成上是文献空白，抄不到结论",
  "date": "2026-09-15",
  "status": "live",
  "source": "外部文献调研 —— arXiv:2408.03314 (Snell et al. 2024) + arXiv:2305.05176 (FrugalGPT)",
  "invalidates_when": "出现在开放式长文本生成（无可验证正确性信号）上的 test-time compute scaling 实测",
  "type": "lesson",
  "tasks": [
    "改报告层结构",
    "降低报告层成本"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "external_literature_not_reproduced",
  "relations": [],
  "legacy_type": "claim",
  "legacy_relations": {},
  "kind": "hypothesis_or_research_finding"
}
---
**本项目的核心假设**：用工程 harness（多次调用、任务分解、中间校验）让便宜模型逼近强模型的效果。

**文献状态：这条既没被证伪，也没被证实——它是空白。**

test-time compute scaling 的正面结果（Snell et al. 2024, arXiv:2408.03314：计算最优的测试时策略
可让小模型在匹配算力下超过 14 倍大的模型、效率提升 4 倍以上）**全部建立在数学/代码这类
有可验证 reward / verifier 的任务上**，且论文自己强调效果强烈依赖按题目难度自适应分配。

**摘要与叙事写作没有那样的 verifier。** 「多推理步骤能否把小模型顶上去」在无 verifier 的
开放式生成上没有对等实测。这意味着两件事：
1. **抄不到结论**，只能自己测；
2. 测出来是真增量——本项目相对文献的增量贡献可能就在这里。

**一个方向不同的已验证形态**：FrugalGPT(arXiv:2305.05176) 的 cascade 路由实测最高省 98% 成本
且维持/超过 GPT-4 准确率（某数据集只有 16.6% 查询升级到 GPT-4）；RouteLLM(arXiv:2406.18665)
在 MT-Bench 上省 85%+ 并保持 95% GPT-4 质量，路由自身开销 <0.4%。
**但这是答案级级联（整题重做），不是子任务级分解。** 它提示了一条与「拆成三级代理」
完全不同的资源分配轴：整簇直接问小模型 → 用便宜的自检信号判断是否需要升级到稍贵模型**重做整段**。
这条轴本仓从未试过。

**学术定位（供检索用）**：本问题是「推理期、预算受限的新闻多文档摘要」
(inference-time budget-constrained news MDS)。三个子判断的学名分别是
cross-document event coreference resolution（同一性）、content selection / salience（重要性）、
timeline summarization / narrative event ordering（叙事组织）。

**没有基准可用**：Multi-News 平均不到 3 篇/簇；WCEP 可达 100 篇但目标摘要只有 ~28–40 词
（更像标题生成）；DUC/TAC 是 10–30 篇、100–250 词但年代早、主用 ROUGE、**几乎不评关系正确性**。
**不存在同时满足「6–14 篇全文 + 数百至数千字符叙事 + 关系正确性标注 + 低成本」的基准。**
同理，现有事实一致性工具（SummaC、AggreFact）针对单文档幻觉，
**没有专门检测「跨事件关系错接」的检测器或基准**——这一侧要自建。
