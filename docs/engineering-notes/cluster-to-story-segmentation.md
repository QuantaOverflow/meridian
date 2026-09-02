# 把 topic cluster 切成互不重叠的 sub-event/story —— 一手来源调研

> **调研起因**：当前四段流水线里，第 2 步"候选分组"用簇内 complete-linkage + 文章两两余弦
> ≥0.90（纯几何、零 LLM）把 HDBSCAN 出的簇切碎，第 3 步 story-validation 才让 LLM 逐组判定
> "算不算一个真故事"。0.90 这个阈值**只按组内纯度调过，从没按"一个事件被切成几块"评过**：
> 152 条故事里 100 条恰好只有 2 篇文章，一个 49 篇的簇被切成 11 组，一场 91 篇报道的大灾
> 碎成 22 条故事、抢占 25 个情报名额里的 11 个；于是第 4 步又用**更严的阈值**（0.94，比的是
> story centroid 不是文章）把碎片粘回来。"先按 0.90 切、再按 0.94 粘"，中间没有一次 LLM
> 被问过"这组和隔壁组是不是同一件事"。
>
> **本文只用一手来源**：论文原文（arXiv / ACL Anthology / CEUR / NeurIPS / SIGIR）、官方文档、
> 开源库源码。每条标注 **【已读全文/已读】**（通过 WebFetch 抓取论文正文或官方文档并核对具体
> 段落/引用）、**【部分读取】**（PDF 解析不完整，只核实到部分段落）或
> **【未读全文，仅摘要】**（只有搜索摘要/二手确认，没有拿到正文逐字引用）。查不到一手来源的
> 明确写"没找到"。
>
> **与同目录另两份笔记的分工**：`exhaustive-assignment-and-singleton-events.md` 和
> `event-dedup-industry-patterns.md` 已经把"合"这一侧（LLM 穷尽分配的容量上限、pairwise 判决
> 聚合成簇的传递性问题、entity resolution 的 blocking-matching-clustering 三段架构）讲透，
> 本文**只讲"切"这一侧**，即"一个粗粒度 topic cluster 该在哪一层、用什么判据、切多细"。
> 两份旧笔记里已经验证过的引用（Event Registry 的 bisecting k-means+BIC、hdbscan 的
> leaf/EOM 参数说明、Story Forest 的架构梗概、RankGPT 滑窗、Araki et al. 的
> subevent/membership 划分）本文只做**指针引用 + 补充细节**，不重复贴引文全文。

---

## ⓪ 六句话结论

1. **"topic → event/story"这条切分链，业界查到的每一个一手来源，切分动作本身都是纯几何/图论/
   统计，LLM（如果有）只出现在切完之后**：EventX（Story Forest 的核心算法）两层都是
   betweenness centrality 图社区发现 + SVM，零 LLM；Event Registry 用 bisecting k-means(k=2)+BIC；
   EpiMine 用层次聚类（HAC）切 episode，LLM 只做逐个摘要/过滤；Microsoft GraphRAG 用 Leiden
   模块度社区发现递归切社区，LLM 只对切好的社区独立摘要。**没有一个系统让 LLM 决定"要不要切"
   或"切完的相邻两组要不要合并"**——这条直接回答 Q4/Q1 的核心问题。
2. **"切多深"在能查到的一手来源里几乎全部是经验调阈值或自动终止条件，不是本文想找的那种
   "按簇结构自适应"判据**：EventX 靠预设节点数阈值停止图社区发现；Matryoshka 三层的维度切点
   是在验证集上调 F1 调出来的固定值；只有 **GraphRAG 的 Leiden 递归是真正自动的**——
   "recursively detecting sub-communities until reaching leaf communities that can no longer
   be partitioned"，深度由模块度优化本身决定，不需要人工指定层数。
3. **hdbscan 官方文档确认 EOM 会丢弃"本来存在但不够稳定"的子结构，leaf 模式能拿到更细的切分，
   但库本身没有"对某一个已选中的簇单独取它内部子树"的一行 API**——condensed_tree_.to_pandas()
   能拿到完整树的表格，要提取某一个簇内部的子结构需要自己按 cluster_id 过滤，不是内置方法。
   经典层次聚类文献里的 inconsistency criterion（scipy 官方实现）、gap statistic、silhouette、
   eigengap 这几个"自适应切多深"的标准判据，**没有一个在查到的新闻/事件系统一手来源里被用在
   HDBSCAN 的 condensed tree 上**——这是一个文献空白，不是我们漏读了什么。
4. **"组内纯度 vs 事件完整性"这对权衡在文献里有对应的标准指标族，且已经在事件聚类任务上被
   实测报告过**：Story Forest 直接报告 homogeneity 0.960 / completeness 0.965 / V-measure
   0.962——homogeneity 惩罚"过度合并"（一个簇里混进多个真实事件），completeness 惩罚
   "过度切分"（一个真实事件的成员散落到多个簇），这正是我们要的那对指标。CDEC 领域另有一套
   （MUC/B-cubed/CEAF/BLANC/CoNLL F1），**但没有查到一篇论文明确报告"阈值调高、纯度上去、
   代价是碎片化"的量化权衡曲线**——最接近的是一篇 2025 年底的对话主题分割论文，方法论上主张
   "boundary density + purity/coverage 分开报告"，但领域是对话不是新闻事件。
5. **"几何粗切 + LLM 决定相邻组要不要合并"这个具体模式，本文检索到的所有一手来源里都没有找到**
   （EpiMine 没有、In-Context Clustering 综述没有、GraphRAG 没有、TopicGPT/ClusterFusion/LITA/
   ClusterLLM 都没有，均在此重新核实过）。这不是我们漏检索，是这个具体架构目前查不到先例——
   我们如果做这件事，是在做一件没有一手文献先例的事，不是在"补一个业界标准做法"。
6. **subevent 结构在学术界是被专门建模的维度**（Araki et al. LREC 2014：subevent relation /
   membership relation / full coreference 三分），**MMR/DPP 这类多样性配额机制在新闻多文档
   摘要里已经被现代 LLM pipeline 直接使用**（2025 年的一篇论文用 DPP 对 key point 做多样性
   选择，在 DiverseSumm 上报告了具体 coverage 数字），但这条路线解决的是"成品阶段挑多样",
   不解决"候选阶段切太碎"——详见 §6 和最后建议。

---

## ① Q1：topic → event → story 的分层判据，谁用几何谁用语义

### 1.1 TDT：event 和 topic 从定义上就是绑在一起的，不是两层

**[Topic Detection and Tracking Pilot Study: Final Report](https://maroo.cs.umass.edu/getpdf.php?id=14)**
（Allan, Carbonell, Doddington, Yamron, Yang, 1998, DARPA Broadcast News Transcription and
Understanding Workshop, pp.194–218）【未读全文，仅搜索摘要确认，未核到逐字定义】

搜索摘要给出的描述："topics are conceptualized as **events** rather than general subjects"，
每个 topic 用 what/where/when 三元组 + 描述 + 摘要来定义。TDT 的五个子任务
（segmentation / tracking / new event detection / first story detection / story link detection）
全部建立在"topic = event"这个前提上——**TDT 框架里根本没有"一个 topic 切成多个 sub-event"
这个动作**，因为它的最小单位本来就是 event 级别的。这点和我们"HDBSCAN 簇（语义 topic）
→ 再切 sub-event"的需求不同构：**TDT 没有回答我们的问题，因为它没有这一层**。

### 1.2 Story Forest / EventX：两层都是纯几何/统计，LLM 完全不参与切分【已读全文】

**[Growing Story Forest Online from Massive Breaking News](https://arxiv.org/pdf/1803.00189)**
（Zhang et al., CIKM 2017；期刊版 ACM TKDD 14(3), 2020，DOI:10.1145/3377939；本文用 arXiv 版
通过 WebFetch 抓取全文核对，与 memory `exhaustive-assignment-and-singleton-events.md` 已验证的
引用交叉核实一致）

核心算法 **EventX** 是把"关键词层"和"文档层"两次图社区发现叠起来，把一个粗粒度新闻话题切成
细粒度 event：

- **第一层（关键词图）**：先建关键词共现图，"Edges that satisfy two conditions will be kept...
  the times of co-occurrence shall be above a minimum threshold (we use 3)... the conditional
  probabilities... also need to be bigger than a predefined threshold (we use 0.15)"（§3.2）。
  切分用 **边介数（edge betweenness centrality）迭代删边**："Edges with high betweenness score
  will be removed iteratively to extract communities"，直到"子图节点数小于预设阈值"才停。
- **第二层（文档图，在每个关键词社区内部）**：训练一个 **SVM 分类器**判断两篇文档是否讲同一
  event，特征是"content TF-IDF/TF 向量余弦、title TF-IDF/TF 向量余弦、首句相似度"等文档对特征
  （§3.2）；然后**同一套边介数社区发现**再切一次，得到最终 event。
- **零 LLM、零神经语义模型**：全程 TF-IDF + 关键词共现计数 + 训练好的 SVM + 图社区发现。
- **量化的 event 级评测**（60GB 中文新闻数据、3,500 篇标注集，Table 2）：
  **V-measure 0.962 / homogeneity 0.960 / completeness 0.965**，显著优于 KeyGraph
  （V-measure 0.710）和 LDA+Affinity Propagation（0.749）。人工评测"纯事件"抽取准确率 84.7%。
- 上层"故事树"（event 之间的演化关系）才轮到判断"是不是同一 story 的后续"，这一步论文里也没有
  用 LLM（2017/2020 年的论文，架构上就没有这个选项），是另一套基于文档相似度的在线归并算法。

**直接回答 Q1**："两层都用几何/统计"是这篇论文能给出的最清楚答案：**topic → event 这一刀，
两层都不是语义模型切的，是关键词共现图 + 文档相似度图的社区发现切的**。

### 1.3 Event Registry：topic→event 的"是否要拆"由 BIC 判定，不是阈值一刀切（指针引用）

已在 `event-dedup-industry-patterns.md` 完整引用，本文只重复最相关的一句（CEUR Vol-1272
paper 19, Leban et al.，§3，【已读】）：

> "we want to reevaluate each cluster after a few updates in order to determine if it should be
> split into two clusters or merged with another cluster. In order to decide if the cluster should
> be split we apply a **bisecting k-means algorithm (with k = 2)** on the cluster. We then use a
> variant of the **Bayesian Information Criterion** to decide whether to accept the new split or not."

这是本次调研里**唯一一个查到的、把"要不要拆"做成显式模型选择判据（而不是固定阈值）的一手来源**：
先尝试拆成 2 份，再用 BIC 权衡"拆开后似然提升"和"多一个簇的复杂度代价"，拆不划算就不拆。
同一篇论文也明写了 min 5 篇的硬性门槛（【设计主张，无实验】，见旧笔记 §2.1），说明 Event Registry
自己也承认"拆不拆"和"够不够多源"是两件独立的事，前者用 BIC，后者用人数拍脑袋。

### 1.4 EpiMine：episode 级切分是层次聚类，且切分后 LLM 不做相邻合并【已读全文，补充 note1 细节】

**[EpiMine](https://arxiv.org/pdf/2408.04873)**（memory 已验证真实存在，本次重新抓取全文核对
切分机制细节，note1 当时只泛称"几何切分"）

- §4.2 的切分方法是 **hierarchical agglomerative clustering（HAC）**，在文档 embedding
  （sentence-BERT）距离上切 dendrogram，卡一个阈值得到候选 episode。**没有发现"簇越大切得
  越细"这类自适应/按规模调节的逻辑**——阈值是全局固定的，不随输入簇大小变化。
- §4.3–§4.4 的 LLM 调用**逐个 episode 独立处理**（摘要 + 低置信度过滤 + 排序），
  **通篇没有一步是"问 LLM 相邻两个 episode 要不要合并"**——这是本文对 EpiMine 唯一新增的核实
  结论，直接支持 ⓪-5 的负面发现。

### 1.5 Matryoshka 层次聚类：三层边界是验证集调出来的固定切点，不是自适应【已读全文】

**[Hierarchical Level-Wise News Article Clustering via Multilingual Matryoshka
Embeddings](https://arxiv.org/html/2506.00277)**（Hanley & Durumeric, ACL 2025；
memory 已确认真实存在，本次抓取全文核对分层机制）

- 三层直接对应 story / topic / theme，用 **embedding 维度截断**实现："we utilize the first
  d/4-dimensional representation for... themes"，topic 用 d/2 维，story 用全部 d 维。
- 每层的合并算法是 **Reciprocal Agglomerative Clustering (RAC)**："progressively merges
  clusters in distinct rounds if... clusters are each other's reciprocal nearest neighbor"。
- **每层的合并阈值 λ 是经验调出来的，不是自动判据**："we determine the λ_ℓ thresholds for
  combining RNNs empirically based on the value that achieves the highest F1 score...on the
  validation set"——**这条直接否定"这篇论文有自适应分层判据"的猜测，它就是三个手调超参**。
- 只报告了三层各自的 F1（SD/SS/VS 三个数据集，mat-mE5 RAC：0.849/0.816/0.795），
  **没有报告 B-cubed / homogeneity / completeness / V-measure**，也没有做显式的
  over-merging vs over-splitting 权衡分析。

### 1.6 Q1 小结：分层判据谱系

| 系统 | 切分执行者 | "切多细"的判据 | LLM 参与位置 |
|---|---|---|---|
| Story Forest/EventX | 图社区发现（betweenness centrality）×2 层 | 固定阈值（共现次数、条件概率、子图节点数） | 完全不参与切分 |
| Event Registry | bisecting k-means(k=2) | **BIC（模型选择准则，唯一自适应判据）** | 不参与切分 |
| EpiMine | HAC | 固定距离阈值 | 只在切完后逐个摘要/过滤 |
| Matryoshka | RAC + 维度截断 | 验证集 F1 调出的固定阈值 | 不参与（纯 embedding） |
| GraphRAG（见 §4.3） | Leiden 社区发现 | **模块度优化自动终止（唯一真正自适应）** | 只在切完后逐社区独立摘要 |

**没找到**任何一个把"语义/LLM 判断"放在切分决策本身里的一手来源。

---

## ② Q2：hierarchical clustering 的层级怎么选——有没有自适应判据，HDBSCAN 能不能自己给

### 2.1 HDBSCAN 官方文档：EOM 会丢弃子结构，leaf 能拿到更细的切分，但没有"单簇取子树"的 API【官方文档，已读】

**[How HDBSCAN Works](https://hdbscan.readthedocs.io/en/latest/how_hdbscan_works.html)** /
**[API Reference](https://hdbscan.readthedocs.io/en/latest/api.html)** /
**[Parameter Selection](https://hdbscan.readthedocs.io/en/latest/parameter_selection.html)**
（本文重新抓取核对，与 note1 §4.2 已引用内容一致，本次补充 API 细节）

- **EOM 的精确判据**（官方原话）："If the sum of the stabilities of the child clusters is
  greater than the stability of the cluster... we set the cluster stability to be the sum of
  the child stabilities. If... the cluster's stability is greater than the sum of its children
  then we declare the cluster to be a selected cluster and unselect all its descendants."
  ——**这是一个自底向上、逐簇比较的自适应判据**，但它的输出是"整个数据集的一份 flat
  clustering"，不是"针对某一个簇单独问它要不要再切"。
- **leaf 模式**："select 'leaf' as a cluster selection method... will select leaf nodes from
  the tree, producing many small homogeneous clusters"——这是 note1 §4.2 已经指出、我们还没用
  的旋钮：**对超大簇单独重跑一次 HDBSCAN 换成 leaf，等价于把 EOM 丢弃的子结构要回来**。
- **API 现状**：`condensed_tree_` 有 `.to_pandas()` / `.to_networkx()` / `.plot()`，
  `single_linkage_tree_` 有 `.get_clusters(cut_distance, min_cluster_size)`——但后者是对
  **整个数据集**在给定切割高度下求 flat clustering，**没有一个内置方法是"给我簇 X 内部的子树"**。
  要做"只对某个超大簇单独再问一次层级"，要么（a）用 `cluster_selection_method='leaf'` 对**全量
  数据**重跑一次 HDBSCAN（note1 建议的路线），要么（b）自己按 `cluster_id` 过滤
  `condensed_tree_.to_pandas()` 的表格手动取子树——**都不是一行调用能做到的**，是要写代码的。
- **stability 能不能当"这一个簇该不该再切"的判据**：官方文档没有把 stability 包装成这样一个
  显式旋钮，但 EOM 算法本身内部逐簇比较 stability 就是在做这件事——**只是它的粒度是"整棵树选
  一次"，不是"你问我一个簇我告诉你"**。

### 2.2 经典层次聚类文献里的四个自适应判据【均未直接读原始论文正文，仅官方文档/摘要确认】

- **Inconsistency criterion**（scipy 官方实现，**[官方文档，已读](https://docs.scipy.org/doc/scipy/reference/generated/scipy.cluster.hierarchy.fcluster.html)**）：
  "if a cluster node and all its descendants have an inconsistent value less than or equal to t,
  then all its leaf descendants belong to the same flat cluster"——本质是"这次合并的高度相对
  最近几次合并高度跳变有多大"，跳变大说明是"自然边界"。**没找到**这个判据在任何新闻/事件聚类
  一手来源里被使用的例子。
- **Gap statistic**（Tibshirani, Walther, Hastie, 2001, JRSS-B）【未读全文，仅搜索摘要确认】：
  比较簇内离散度曲线和均匀分布零假设下的对照曲线，取 gap 最大处为最优簇数。主要文献用于
  k-means，**没找到**它被用于新闻事件聚类或 HDBSCAN 之上的一手来源。
- **Silhouette**（Rousseeuw, 1987）【未直接读原文，标准方法，通用性无需重新验证】：
  s(i) = (b(i) − a(i)) / max(a(i), b(i))。**没找到**它被用来决定"HDBSCAN 某个簇该不该再切"的
  一手来源。
- **Eigengap heuristic**（谱聚类专用，[von Luxburg 2007 tutorial](https://arxiv.org/pdf/0711.0189)）
  【未读全文核对逐字引用，仅搜索摘要确认】：选 k 使得 λ_1...λ_k 都很小而 λ_{k+1} 明显变大；
  摘要转述的作者原话是"works well if the data contains very well pronounced clusters, but in
  ambiguous cases it also returns ambiguous results"——这是谱聚类专属方法，**不直接适用于
  HDBSCAN 的密度树结构**（没有特征值间隙这个概念）。

### 2.3 Q2 小结

**"HDBSCAN 本身能不能输出层级、让我们直接用 condensed tree 拿子簇"——能，但只到"整棵树"级别，
不到"对某一个已选中的簇单独问它内部还有没有结构"级别**。工程上可行的两条路：
（a）note1 已建议的"对超大簇整体重跑一次 HDBSCAN + leaf"；（b）自己解析
`condensed_tree_.to_pandas()` 按 cluster_id 过滤出子树（库没有帮你包装这个操作，但数据都在）。
**经典的 inconsistency/gap statistic/silhouette/eigengap 四个自适应判据，没有一个在查到的
新闻/事件系统一手来源里被真正用来决定"切多深"**——这四个方法本身有一手来源（官方文档/原始
论文），但"用它们配 HDBSCAN 做新闻事件分层"这个具体组合，**是文献空白，不是我们漏看**。
唯一在新闻/事件领域查到的、真正自适应（不需要预调阈值）的判据是 **Event Registry 的 BIC**
和 **GraphRAG 的 Leiden 模块度递归终止**——两个都不是 HDBSCAN 生态内的方法，是独立的图/统计
模型选择准则。

---

## ③ Q3："切太碎"怎么评：granularity 指标与权衡曲线

### 3.1 事件聚类领域确实有对应的指标族，且已被实测报告过【已读全文，见 §1.2】

Story Forest 的 **homogeneity / completeness / V-measure**（Table 2：0.960 / 0.965 / 0.962）
正是回答"组内纯度 vs 事件完整性"这对权衡的标准指标：

- **homogeneity** 惩罚"一个预测簇里混进多个真实类别"——对应我们说的"纯度"；
- **completeness** 惩罚"一个真实类别的成员散落到多个预测簇"——对应我们说的"事件完整性/
  碎片化"；
- **V-measure** 是两者的调和平均。

**这就是我们要的那对指标**，不需要另造新词：如果要给"0.90 阈值切得太碎"建一把尺，
homogeneity/completeness 分开报告（而不是只看 V-measure 合并值）就能同时看到"纯度有没有牺牲"
和"一个大事件被切成几份"。

### 3.2 CDEC 领域的标准指标族【未读原始定义论文，仅搜索摘要确认定义】

Cross-document event coreference resolution 标准报告 **MUC、B-cubed、CEAF、BLANC、
平均 CoNLL F1**（五个指标各有独立定义论文：Vilain et al. 1995 MUC；Bagga & Baldwin 1998
B-cubed；Luo 2005 CEAF；Recasens & Hovy 2011 BLANC；本文未逐篇读取原始定义论文正文，
只通过搜索摘要确认每个指标的名字和大致含义，具体公式未核对逐字引用，标注**未读全文**）。
搜索摘要给出的关键区分：**MUC 是纯 mention-pair link 计数，对"过度合并"不敏感**（合并越大的
簇、link 数越多，MUC 天然偏袒过度合并的系统）；**B-cubed 和 BLANC 是更平衡的指标，且 BLANC
显式把 singleton 计入评分**（对应我们的"单例故事该不该算"问题，和 memory
`exhaustive-assignment-and-singleton-events.md` §2 的讨论相关）。**CoNLL F1** 是
MUC/B-cubed/CEAF 三者平均，是 CDEC 领域事实上的主报告指标。

### 3.3 有没有论文明确报告"阈值调高提纯度、代价是碎片化"的权衡曲线——部分找到，但不在新闻领域

**[When F1 Fails: Granularity-Aware Evaluation for Dialogue Topic
Segmentation](https://arxiv.org/pdf/2512.17083)**（2025 年底论文）【部分读取，PDF 解析不完整，
只拿到方法论主张的转述，没拿到精确公式/表格数字】

这篇论文的方法论主张和我们的问题**高度同构**（虽然领域是对话分割，不是新闻事件切分）：
它提出 **BOR（Boundary Overlap Rate）区分过切分/欠切分**，**purity 和 coverage 分开报告**
（purity 对应"纯度"，coverage 对应"完整性"，和 Story Forest 的 homogeneity/completeness
是同一个思路的另一套命名），核心论点是**"单一操作点的 F1 会把过切分和欠切分的系统混成同一个
分数，掩盖了两者此消彼长的权衡"**——这正是我们"0.90 只按纯度调、没按碎片化评"这个问题的
方法论镜像。**没有拿到它论文里具体的阈值-purity-coverage 权衡表格数字**（PDF 解析限制），
但方法论框架本身可以直接借用：**给候选分组阈值扫一遍，同时报 purity 和 coverage（或
homogeneity/completeness），而不是只看一个合并后的分数**。

**没找到**任何一篇专门针对"新闻事件/topic cluster 切分"领域、明确报告"阈值-纯度-碎片化
三者权衡曲线"的论文。Story Forest 只报了一个操作点的三个数，不是一条随阈值变化的曲线；
Matryoshka 报了三层各自的 F1，但没有做同层内部的阈值扫描。

---

## ④ Q4：LLM 处理大集合容量问题的标准绕法——有没有"几何粗切 + LLM 决定相邻组合并"这种模式

本节大量证据已在 `exhaustive-assignment-and-singleton-events.md` §1/§4 建立（instance-count
容量退化曲线、RankGPT w=20 滑窗、TopicGPT/ClusterFusion/LITA/ClusterLLM 的"几何分配+LLM 判定/
命名"边界），本节**只回答本文新增的问题：有没有工作让 LLM 决定"相邻两个几何切出来的组要不要
合并"**。

### 4.1 直接检索的结论：没找到

本次针对性核实了以下几个最可能出现这个模式的地方，**全部没有找到**：

- **EpiMine**（§1.4，已读全文）：LLM 只逐个 episode 独立摘要/过滤，无合并步骤。
- **[In-Context Clustering with Large Language
  Models](https://arxiv.org/html/2510.08466v1)**（综述性论文）【已读，通过 WebFetch 确认】：
  论文讨论的三类方法——zero-shot LLM 聚类提示、微调 LLM 直接生成簇分配、用 LLM attention
  矩阵做谱聚类——**均不涉及"把已成型的候选簇交给 LLM 做相邻合并判定"这个模式**。
- **TopicGPT / ClusterFusion / LITA / ClusterLLM**（均见 note1 §4.3，本次未重新抓取，
  依赖已有核实结果）：全部是"LLM 判定单条记录属于哪个类"或"LLM 判定两条记录是否近重复"，
  **没有一个是"LLM 判定两个已成型的组是否应该合并"**。
- **Microsoft GraphRAG**（§4.3 详述）：LLM 只对 Leiden 切好的社区独立摘要，无合并判定。

**这是一个明确的负面发现，不是检索不足**：本文用了六个不同角度（新闻事件切分论文、通用
in-context clustering 综述、四篇 LLM 辅助聚类的具体系统论文、GraphRAG）去找这个模式，
一致查无此例。**"几何粗切 + LLM 决定相邻组合并"如果要做，是在做一件没有一手文献先例的事**——
这不代表它行不通，但意味着我们不能拿"业界标准做法"来为它背书，必须自己建 eval 验证。

### 4.2 分层归并/map-reduce 式处理大集合：GraphRAG 是最接近的一手先例【已读全文】

**[From Local to Global: A GraphRAG Approach to Query-Focused
Summarization](https://arxiv.org/html/2404.16130v2)**（Edge et al., Microsoft, 2024）

- **切分完全自动、零 LLM**：用 **Leiden 社区发现算法**（Traag et al. 2019）在实体图上做
  层次社区划分，"recursively detecting sub-communities within each detected community until
  reaching leaf communities that can no longer be partitioned"——**深度由模块度优化本身决定，
  不需要人工指定层数或阈值**，这是本次调研里唯一查到的、在真实生产系统里跑起来的、完全自动的
  层级判据。
- **切完之后是"分而治之"式独立摘要，不是合并判定**：每个社区独立生成摘要，"These summaries
  are independently useful as a way to understand the global structure and semantics of the
  dataset"（§3.1.5）；高层摘要通过"按 token 预算优先纳入下层社区摘要"的方式生成，
  **不是"问 LLM 两个兄弟社区要不要合并"**。
- 这个"map-reduce"结构（geometric 递归切分 → 每个叶子独立 LLM 处理 → 逐层向上聚合）
  和我们"HDBSCAN → 几何切组 → LLM 逐组判定"的骨架**高度同构**，唯一的区别是
  GraphRAG 的切分是**自动终止的递归**，我们的切分是**固定阈值一刀切**。

### 4.3 Q4 小结

大集合的标准绕法（滑窗 w=20、分块+并集+甄别、逐条独立分类）已在 note1 讲透，本文的增量结论是：
**"几何切分自动决定深度"有先例（GraphRAG 的 Leiden 递归），"LLM 决定相邻组合并"没有先例**。
如果要往这个方向改，性质上更接近"我们在设计一个新架构"而不是"抄一个业界方案"。

---

## ⑤ Q5：subevent 是不是独立事件——学术界的判据

**[Detecting Subevent Structure for Event Coreference
Resolution](https://aclanthology.org/L14-1725/)**（Araki, Liu, Hovy, Mitamura, LREC 2014,
pp.4553–4558）【未读全文——两次 WebFetch 均因 socket 中断失败，只拿到摘要页信息，
与 note2 已有的读取深度一致，未能补充新细节】

摘要页能确认的信息：论文把两个事件 mention 之间的关系拆成三类——**subevent relation**
（构成一个更大事件的、有先后顺序的阶段性事件序列）、**membership relation**（一个事件集合的
成员实例）、**full coreference**（完全同指）——并训练一个 **multiclass logistic regression**
模型同时判三类，比只判 full coreference 的基线在检测 subevent 关系上提升
**3.2 BLANC F1**。**没能核实到**：三类关系的具体判定特征/规则、多类模型的输入特征列表、
数据集规模——这些细节需要正文，本次两次尝试抓取 LREC 官方 PDF 都因网络问题中断。

**对我们的含义（不变，重申 note2 结论）**：subevent/membership 与 full coreference **在学术界
是三个专门分开建模的类别，不是靠"是不是同一事件"这一个模糊问题囊括的**。我们现在
story-validation 的一次性判定（"这组算不算一个真故事"）把"事件的不同侧面"（洪灾下的学校撤离/
水电站救援/外交争议）和"完全重复报道同一件事"混在一个问题里问，**这正是三类关系没有被分开
建模的直接后果**。但**没有一手来源给出可操作的判据公式**——三分类本身是学术共识，具体怎么分
需要正文，本文未能核实到。

**明确的"没找到"**：subevent 结构在**新闻聚合场景**（不是 ECB+ 这种通用新闻语料标注）下的
应用先例——ECB+ 是 43 个 topic 的封闭标注语料，不是流式新闻聚合系统，**没找到**把这套三分类
判据直接搬进生产级新闻聚合 pipeline 的一手来源。

---

## ⑥ Q6：成品配额/多样性机制——MMR、DPP、新闻聚合的 diversity 约束

### 6.1 MMR：1998 年的经典方法，定义清楚，新闻领域没找到官方部署细节

**[The Use of MMR, Diversity-Based Reranking for Reordering Documents and Producing
Summaries](https://people.eng.unimelb.edu.au/ammoffat/sigir98/abstracts/carbonell.html)**
（Carbonell & Goldstein, SIGIR '98, pp.335–336）【标题/摘要/公式经搜索确认，未直接读原文核对
逐字表述，但 MMR 公式本身是被后续文献反复转述验证过的标准公式，可信度高】：

MMR = argmax_{D_i ∈ R\S} [ λ·Sim₁(D_i, Q) − (1−λ)·max_{D_j ∈ S} Sim₂(D_i, D_j) ]

即"相关性 − 与已选集合的最大相似度"的加权差，逐个贪心选入。**这是一个成品阶段的选择/排序
机制，不是候选生成阶段的切分机制**——它假设候选池已经存在，要解决的是"从候选池里选一个
多样化子集"，不解决"候选池里的候选本身是不是切碎了"。

### 6.2 DPP：比 MMR 更"看全局"，工业界有真实部署案例

- **[Determinantal Point Processes for Machine Learning](https://arxiv.org/pdf/1207.6083)**
  （Kulesza & Taskar, 2012, Foundations and Trends in ML）【未读全文，仅搜索摘要确认】——
  DPP 定义子集选择的概率模型，用核矩阵的行列式同时刻画"质量"和"多样性"，**评估整个子集而不是
  贪心逐个比较**，这是它相对 MMR 的理论优势（搜索摘要转述："DPPs evaluate the whole set at
  once, catching overlaps that greedy methods like MMR might miss"）。
- **[Fast Greedy MAP Inference for Determinantal Point Process to Improve Recommendation
  Diversity](https://arxiv.org/abs/1709.05135)**（Chen, Zhang, Zhou, NeurIPS 2018）
  【未读全文，仅搜索摘要确认】——**工业界真实部署案例**：论文明确提到"verified by online
  A/B testing"，把 DPP 的 MAP 推断加速到能在真实推荐系统里实时跑，"adapts to scenarios where
  repulsion is only required among nearby few items in the result sequence"（滑窗式局部多样性，
  和我们"故事之间不需要全局互斥、只需要局部不重复"的场景相似）。

### 6.3 DPP 在新闻多文档摘要里的最新应用【已读，通过 WebFetch 确认，含具体数字】

**[Principled Content Selection to Generate Diverse and Personalized Multi-Document
Summaries](https://arxiv.org/html/2505.21859)**（Padmakumar et al., 2025）

- §3.2.1–3.2.2：用 DPP 对"key point"（从多篇源文章抽取出的信息点）做多样性选择，
  "Each key point... is first embedded... These embeddings are then used to construct a
  kernel matrix L... computed through a kernel function"。
- §3.2.3 还给了 query-focused 变体，把用户相关性权重乘进核矩阵：
  L′ = R·L·Rᵀ，其中每项按 f_rel(v|q_user) 加权。
- **Table 1 实测数字**（DiverseSumm 数据集，coverage 指标）：LLM+DPP 达到 **0.4706
  (GPT-3.5) / 0.5805 (GPT-4o) / 0.5923 (Claude)**，全面优于"LLM 直接选 key point"的基线。

配套的 **[DiverseSumm benchmark](https://arxiv.org/html/2309.09369)**【未读全文，仅摘要确认】：
245 个新闻故事、每个配 10 篇源文章，发现 **GPT-4 在没有专门多样性机制时，平均只能覆盖不到
40% 的多样信息点**——这条说明"让 LLM 自己在生成时兼顾多样性"本身就不可靠，需要专门的选择机制
（DPP 或 MMR）介入，这和我们环节 2/3 让 LLM 自己判断分组边界会有类似的可靠性问题是同一个教训。

### 6.4 新闻聚合产品的 diversity 约束：查不到官方机制细节

Google News 的 diversity 相关公开信息全部来自**第三方审计**，不是官方机制说明：

- **[Auditing Google's Search Algorithm: Measuring News Diversity Across Brazil, the UK, and
  the US](https://arxiv.org/pdf/2410.23842)**【未读全文，仅摘要确认】——发现"a high degree of
  homogeneity in news search results, with legacy media brands dominating"，是外部黑盒审计
  结果，**不是 Google 公开的 diversity 算法细节**。
- Google News 专利（US7568148B1，已在 note2 §5.1 核实）只讲了聚类怎么做（centroid+TFIDF+HAC），
  **完全没有提到成品阶段的多样性/配额机制**。

**没找到**任何一手来源公开描述"新闻聚合产品在最终展示/推送阶段如何做事件多样性配额"的具体算法
——这条工业实践在我们查到的范围内是黑盒。

### 6.5 Q6 小结：能不能兜底"候选已经碎片化"这个前提

**不能，且这不是配额机制的锅**。MMR/DPP 解决的是"从一批候选里挑出内容不重复的子集"，
它们的输入假设是"候选之间的相似度/多样性能被正确度量"。如果候选本身是**同一个大事件被切成
22 份**（我们的真实观测），MMR/DPP 会把这 22 份**互相都判定为"多样"**（因为它们讨论的是
洪灾的不同侧面——学校撤离 vs 水电站救援 vs 外交争议，embedding 距离确实不近），
于是**把配额浪费在同一场灾难的不同碎片上，而不是覆盖到其他事件**——这正是我们观测到的
"25 个名额里 11 个被同一场灾难占用"的机制解释。**多样性机制不能替代"先把碎片粘回一个事件"
这一步，两者是流水线的不同环节，顺序不能倒**：应该先解决 §1/§4 的切分/合并问题，
再谈成品阶段的 MMR/DPP 配额。

---

## ⑦ 对我们的直接建议

### 7.1 我们现在这套在文献里对应什么、是不是标准做法

| 我们的设计 | 文献对应 | 评价 |
|---|---|---|
| HDBSCAN(eps=0.35) 出簇 | 标准聚类前端，各系统通用 | 无问题 |
| 簇内 complete-linkage + cos≥0.90 切候选组 | **没有直接对应物**——EventX/EpiMine/Event Registry 都不是"文章两两 complete-linkage 切组"，是图社区发现/HAC/bisecting k-means | 架构上说得通（几何做切分，见⓪-1），但**阈值选取方式**（只按组内纯度调）在文献里没有先例——所有查到的系统要么用固定统计阈值（EventX 的共现次数/条件概率）要么用模型选择准则（BIC），**没有一个是"两两相似度阈值一刀切"** |
| story-validation 逐组一次 LLM 判定 | 对应 EpiMine/GraphRAG 的"每个几何切好的组独立过 LLM" | **架构上是标准做法** |
| centroid cos≥0.94 粘回（第 4 步） | 对应 note2 已论证的 ER pairwise matching + clustering | 架构标准，但没回答"切错了怎么粘对"的问题——见下 |

### 7.2「切」这一步该不该存在

**该存在**，且⓪-1 已经证明"几何做切分、LLM 做判定"这个大方向是所有查到的一手来源的共同选择，
不是我们的权宜之计。**问题不在"要不要切"，在"切的判据和切的深度"**：

1. **阈值 0.90 应该换成一个自适应/模型选择式的判据，而不是继续一刀切。**
   最接近可落地的两条：
   - **Event Registry 的 BIC 式判据**（§1.3）：对超过某个规模的簇，先尝试 bisecting
     （二分），用 BIC（或更简单的：拆开后组内平均相似度提升是否超过拆分本身的复杂度代价）
     决定要不要接受这次拆分，接受了再递归。**这是查到的唯一一个"自适应决定切不切"的
     一手先例**，且实现成本低（k-means k=2 + 拟合优度比较，纯 Python/numpy）。
   - **GraphRAG 的 Leiden 递归终止**（§4.2）：如果我们的候选组问题本质是图问题（文章是节点，
     相似度是边权），可以直接换成模块度优化的社区发现，深度自动终止，不需要调 0.90 这个数字。
     代价是要把"两两 cosine 矩阵"重新框成"加权图"，工程改动比 BIC 路线大。
2. **"切多深"不该按簇大小之外的任何东西自适应吗？**——**该按簇大小自适应，但文献没有给出
   "按簇大小自适应"的现成公式**（EventX/EpiMine/Matryoshka 全部是固定阈值，没有查到任何一个
   系统的切分阈值是簇大小的函数）。这意味着如果我们要做"大簇切得更细、小簇不切"，**是在做一个
   文献没有直接先例的设计**，但方向本身有间接支持：note1 已经证明 LLM 的容量上限在 n≈20–100
   开始退化，所以"切出来的组大小应该有一个上限"这个目标是有实验支撑的（note1 §1.1），
   只是"怎么切到这个上限以内、同时不牺牲事件完整性"没有现成公式，需要自己设计+测。
3. **该不该由 HDBSCAN 的层级直接给出？**——**技术上可行但要自己写代码，库不直接给**（§2.1）。
   两条路线成本对比：
   - 对超大簇整体重跑 HDBSCAN + `cluster_selection_method='leaf'`（note1 已建议）：
     改动最小，直接复用现有 ml-service 的 HDBSCAN 调用，只是给超大簇加一个"再跑一次、换参数"
     的分支。**推荐优先验证这条**。
   - 手动解析 `condensed_tree_.to_pandas()` 拿到某个 EOM 簇内部被丢弃的子结构：
     更精细（不需要重新聚类，直接从已有的树里"捞回"被 EOM 忽略的部分），但没有库函数包装，
     要自己写树遍历逻辑，工程量更大。**只有 leaf 方案效果不够时才值得投入**。

### 7.3 中间那次"这组和隔壁组是不是一件事"该不该问 LLM

**⓪-5 已经证明这个具体模式在文献里找不到先例**，所以这不是"抄一个业界方案"能回答的问题，
只能自己设计+测。给三个可以借鉴的**间接**思路（均需自建 eval 验证，不能直接照搬）：

- **借 note1 §4.3 的"逐篇独立分类"框架，但换成"逐组独立打标签"**：先用几何/一次 LLM 调用
  给切出来的组分配一个粗粒度事件标签（比如"XX 洪灾"），再让"标签相同"的组自动合并，
  而不是逐对问"要不要合并"——这样合并判定退化成字符串/embedding 匹配问题，不需要新增
  O(n²) 或 O(n) 的 LLM 调用。
- **借 §1.3 Event Registry 的 BIC 思路**：如果切分本身换成 BIC 判据，"切多细"的问题在切分阶段
  就解决了，第 4 步的"粘回"可能根本不再需要——这是更根本的修法，但改动面更大。
- **如果一定要保留"LLM 判断相邻组是否同一事件"这一步**：note2 §4.1 已经论证"selecting"/
  "in-context clustering"这类"群体"范式在结构化记录匹配上有实证支持，但**明确标注对"确认一个
  预先给定的分组"这种场景没有验证过**（note2 §4.1 原话）。要用的话，**必须先做小样本 A/B
  验证"整组问"和"两两问"在这个具体子问题上谁更准，不能假设文献里"群体范式更省钱"的结论能
  平移过来**——这条和 note1 的核心教训（不要假设容量退化曲线能跨任务平移）是同一类风险。

### 7.4 不适用的部分（附原因）

- **inconsistency criterion / gap statistic / silhouette / eigengap**（§2.2）：
  有一手来源支持它们本身是合法的统计判据，但**没有查到任何新闻/事件聚类系统用过它们**，
  且部分（eigengap）是谱聚类专属，概念上不兼容 HDBSCAN 的密度树结构。**不建议作为下一步
  首选**，优先级低于 leaf 模式和 BIC。
- **MMR/DPP 配额机制**（§6.5）：不能解决候选碎片化问题，只能在候选已经正确切分/合并之后，
  用于"25 个名额该分给哪些不同事件"这个下游选择问题（对应 `maxStoriesToGenerate=15` 的瓶颈，
  memory `source-pool-dead-feeds`）。**这是另一个环节的工具，别指望它兜底切分错误**。
- **TDT 的 event/topic 一体化框架**（§1.1）：因为 TDT 里没有"topic 切 event"这个动作，
  它回答不了我们的问题，只能当背景知识用（"topic 应该是 event 级别的"这个前提本身没有
  错，但不提供切分算法）。
- **subevent 三分类**（§5）：判据方向正确、但没有一手来源给出可操作的判定规则或特征列表，
  照搬不了，只能当作"应该把 story-validation 的一次性判断拆成至少两个维度问"这个设计方向的
  背书，具体怎么拆需要自己设计。
