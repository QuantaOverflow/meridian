---
{
  "id": "experiment-set-partition-literature-review",
  "type": "experiment",
  "title": "一手来源调研：BERTopic / TopicGPT / ClusterLLM / Event Registry / EventX(Story Forest) / EpiMine / GraphRAG 没有一个让 LLM 决定集合怎么切或相邻组要不要合并——几何/图论/统计负责切分，LLM 只对切好的组逐条判定或摘要",
  "date": "2026-09-02",
  "status": "recorded",
  "tasks": ["治故事过拆", "改聚类/切分链路"],
  "scope": "两份独立的一手文献调研：docs/engineering-notes/exhaustive-assignment-and-singleton-events.md（查『LLM 能否对集合做穷尽分配』，2026-08-20 前后）与 docs/engineering-notes/cluster-to-story-segmentation.md（查『topic cluster 切成 sub-event/story 该用几何还是语义』，2026-09-02，commit 79b468d）。两份笔记均标注了每条论断是【实验】还是【设计主张】，查不到的一手来源在文中明确写『没找到』",
  "source": "docs/engineering-notes/exhaustive-assignment-and-singleton-events.md:46-49（本地文件，未入 git）；docs/engineering-notes/cluster-to-story-segmentation.md:27-38, 430-460（本地文件，未入 git，由 commit 79b468d 引入后于 2026-09-12 前后随『调研笔记只留本地』的决定移出 git，可用 `git show 79b468d:docs/engineering-notes/cluster-to-story-segmentation.md` 恢复历史版本）；apps/backend/src/lib/core/candidate-grouping.ts:8-10 是这条结论的精简复述",
  "conditions": [
    "两份调研查的问题不完全相同：exhaustive-assignment 笔记的核心问题是『LLM 能否对一个 ~100 元素的集合做穷尽分配』（对应 story-validation 旧形态整簇送 LLM 的失败），cluster-to-story-segmentation 笔记的核心问题是『topic→event/story 的切分判据谁用几何谁用语义、切分深度怎么自适应』（更早于候选分组架构定型前的独立调研）；两者在『切分动作该不该交给 LLM』这一点上结论重合，本节点只记录重合部分",
    "调研方法为检索 arXiv/ACL Anthology/官方文档/开源项目源码并逐条标注读取深度（[已读全文]/[仅摘要]/『没找到』），不是本仓自己复现这些系统的实验，因此 evidence_origin 为外部文献",
    "candidate-grouping.ts 注释里点名的 BERTopic / TopicGPT / ClusterLLM / Event Registry / TDT 五个系统来自 exhaustive-assignment 笔记；cluster-to-story-segmentation 笔记额外核实了 EventX(Story Forest 核心)、EpiMine、Microsoft GraphRAG 三个系统，同样是零 LLM 切分",
    "两份笔记都明确指出：『几何粗切 + LLM 决定相邻组是否合并』这个具体模式，在检索到的所有一手来源里都没有先例（EpiMine、In-Context Clustering 综述、GraphRAG、TopicGPT、ClusterFusion、LITA、ClusterLLM 均查过，均未找到）——即本仓『候选组内再问 LLM』这一步本身也不是在照抄业界标准做法",
    "⚠️ 一条重要的附带发现，candidate-grouping.ts 的注释没有提到：cluster-to-story-segmentation 笔记 §7.1 同时指出，本仓 CANDIDATE_GROUP_THRESHOLD=0.90 这种『两两相似度阈值一刀切』的取值方式，在查到的所有一手来源里同样没有先例——EventX 用固定统计阈值（共现次数/条件概率）、Event Registry 用 BIC 这类模型选择准则，没有一个系统是『两两 cosine 一刀切』。这条不是对现有 0.90 取值的否定，而是标注了它的适用边界：0.90 是本仓自己拍的判据，不是业界验证过的判据形式"
  ],
  "evidence_origin": "external_literature_not_reproduced",
  "relations": [
    { "type": "yields", "to": "lesson-llm-cannot-partition-event-sets" }
  ],
  "kind": "literature_review",
  "outcome": "observed",
  "inputs": "对 BERTopic、TopicGPT、ClusterLLM、Event Registry、TDT、EventX/Story Forest、EpiMine、Microsoft GraphRAG 等系统的论文正文/官方文档/源码检索",
  "evaluation": "定性核实：每个系统的『切分』动作由什么承担（几何/图论/统计 vs LLM），LLM（如果参与）出现在流程的哪一步",
  "result": "所有查到的一手来源里，集合切分动作本身全部是几何/图论/统计方法（BERTopic 的 HDBSCAN+c-TF-IDF、TopicGPT 的逐篇分类、ClusterLLM 的成对/三元组约束聚类、Event Registry 的 bisecting k-means(k=2)+BIC、EventX 的图社区发现+SVM、EpiMine 的层次聚类、GraphRAG 的 Leiden 模块度递归），LLM 只在切分完成之后对已切好的组做逐条判定、命名或摘要，没有一个系统让 LLM 自己决定『这个集合该怎么划分』或『相邻两组要不要合并』。这与 experiment-candidate-grouping-prompt-model-scan 的排除性实测结论互相印证：一个是『做了会失败』的直接证据，一个是『没人这么做过』的间接证据。",
  "cost": "未知（文献检索本身未记录耗时；两份笔记提到调研工作由子 agent 完成，另有一次引文真实性抽验，抽验结论是『书目全部真实，具体数字只验到摘要级』）",
  "record_completeness": "summary_only"
}
---

## 读数原文

`exhaustive-assignment-and-singleton-events.md:46-49`：

> 让 LLM 穷尽分配一个 ~100 元素的集合，没有任何一手来源支持它可行；最接近的同构任务
> （BERTopic 源码、TopicGPT、ClusterLLM、Event Registry、TDT/Story Forest）
> 没有一个让 LLM 去切分集合——几何负责分配，LLM 只做逐条判定或命名。

`cluster-to-story-segmentation.md:27-33`（⓪ 六句话结论第 1 条）：

> "topic → event/story"这条切分链，业界查到的每一个一手来源，切分动作本身都是纯几何/图论/
> 统计，LLM（如果有）只出现在切完之后：EventX（Story Forest 的核心算法）两层都是
> betweenness centrality 图社区发现 + SVM，零 LLM；Event Registry 用 bisecting k-means(k=2)+BIC；
> EpiMine 用层次聚类（HAC）切 episode，LLM 只做逐个摘要/过滤；Microsoft GraphRAG 用 Leiden
> 模块度社区发现递归切社区，LLM 只对切好的社区独立摘要。没有一个系统让 LLM 决定"要不要切"
> 或"切完的相邻两组要不要合并"。

`cluster-to-story-segmentation.md:441-446`（§7.1 表格结论）指出本仓自己的候选分组设计
在文献里『架构上说得通（几何做切分），但阈值选取方式（只按组内纯度调）在文献里没有先例』。

## 为什么这条读数不随架构死

这不是『这次调研查到了几个系统』的清单，而是一条关于任务分工的结构性事实：**集合切分
（决定一个数十到上百元素的集合该分成几份、边界在哪）是一个几何/组合优化问题，不是一个
语言理解问题**；LLM 的价值在切分之后的『这个子集是不是一件事』这种逐条判定上。换任何
prompt 范式、换任何模型、甚至换到完全不同的领域（新闻聚类之外的话题建模、社区发现），
业界的选择都指向同一个分工边界。这个边界不会因为本仓换掉 story-validation 的具体实现
而改变。

## 失效条件

若未来出现专门为『精确执行给定约束的集合划分』设计并验证过的模型或方法（例如结合了
约束求解器的 LLM 系统），或本仓在换用这类新方法后重新实测『整体切分交给模型』的召回
显著超过几何基线，则『LLM 不适合做集合切分』这一结论需要针对该新方法重新验证——目前的
证据只覆盖 2026-08/09 检索到的系统与本仓 2026-08 用过的模型/prompt。

## 关联

与 [[experiment-candidate-grouping-prompt-model-scan]] 共同产生
[[lesson-llm-cannot-partition-event-sets]]。0.90 阈值『两两一刀切无先例』这条附带发现，
与 [[lesson-candidate-group-threshold-090]] 记录的阈值扫描数据是同一个判据的两个侧面：
后者记录『0.90 在本仓数据上怎么标定出来的』，本节点记录『这种标定方式本身在文献里
站不站得住』——留作候选组阈值未来若要换成自适应判据（cluster-to-story-segmentation.md
§7.2 建议的 BIC 或 Leiden 路线）时的背景依据。
