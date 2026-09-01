# 新闻事件去重 / 同事件多记录合并：业界与学术界解法调研

调研范围：entity resolution (ER) / record linkage 的 blocking-matching 分离、非传递判决的聚合方法、cross-document event coreference resolution (CDEC)、LLM 做 pairwise 匹配的近期工作、新闻去重工业实践、correlation clustering 的正经解法。

方法论说明：优先一手来源（论文/官方文档/开源库源码）。凡是"直接读了全文或核心章节"的论文，标注**[已读]**；仅通过搜索片段拿到标题/摘要/引用信息、未读全文的，标注**[未读全文，仅摘要]**；查不到一手来源的问题明说"未找到"。

---

## 1. Entity resolution 是否早就把 blocking 和 matching 分开？

**结论：是，这是 ER 领域从 1959 年就确立、现在所有主流工具都遵循的标准两阶段（严格说是三阶段：blocking → matching → clustering）架构，我们的"cos 生成候选 + LLM 判决"在这个框架里是完全标准的做法。**

### 证据

最早的自动化记录链接系统（Newcombe et al. 1959，链接不列颠哥伦比亚省的出生/婚姻记录）就已经是两步：先用 Soundex 编码做 blocking 缩小比较范围，再用似然比检验做 matching。Fellegi & Sunter (1969) 把这个流程形式化为决策理论框架（link / possibly link / not link 三档，通过似然比阈值 T_μ、T_λ 控制两类错误率）。这段历史直接引自 Binette & Steorts (2022) *"(Almost) All of Entity Resolution"*, arXiv:2008.04443（**[已读]**，第 11-14 页）。

现代综述明确用"blocking/indexing 降低 O(n²) 复杂度 + 独立的 matching 判定"来定义 ER 流程：
- Christen, P. (2011) *"A survey of indexing techniques for scalable record linkage and deduplication"*, IEEE TKDE — blocking/indexing 技术综述**[未读全文，仅摘要]**
- Christophides, V. et al. *"An overview of end-to-end entity resolution for big data"*, ACM Computing Surveys, arXiv:1905.06397 **[未读全文，仅摘要]**
- Papadakis, G. et al. (2020) *"Blocking and Filtering Techniques for Entity Resolution: A Survey"*, ACM Computing Surveys 53(2), DOI:10.1145/3377455 **[未读全文，仅摘要]**
- Getoor, L. & Machanavajjhala, A. (2012) *"Entity Resolution: Theory, Practice & Open Challenges"*, PVLDB 5(12):2018-2019（VLDB tutorial）**[未读全文，仅摘要]**

### 主流开源库怎么做

| 库 | Blocking 策略 | Matching | 备注来源 |
|---|---|---|---|
| **Splink**（英国司法部，Python/DuckDB/Spark） | Blocking rules = SQL 表达式（例如 `l.first_name = r.first_name`），可以写多条规则取并集；官方文档明确说"blocking rules 是决定运行速度的最重要因素" | 概率模型（Fellegi-Sunter 风格）算出 match_probability | [Splink 官方文档 — Blocking Rules](https://moj-analytical-services.github.io/splink/topic_guides/blocking/blocking_rules.html) **[已读]** |
| **dedupe**（Python） | Predicate blocks（字段前缀/token 等特征函数）+ index predicates（更慢但召回更高，可通过 `index_predicates=False` 关闭） | 训练一个分类器对候选对打分 | [dedupe 官方文档 — blocking.py](https://github.com/dedupeio/dedupe/blob/main/dedupe/blocking.py) **[已读官方文档片段]** |
| **py_entitymatching / Magellan**（威斯康星大学） | Blocking 阶段目标是"去掉明显不匹配的对，缩小 matching 要处理的集合" | 监督学习分类器对候选做二分类匹配 | Konda et al. (2016) *"Magellan: Toward Building Entity Matching Management Systems"*, PVLDB 9(12) & PVLDB Vol9 p1197/p1581 **[未读全文，仅摘要]** |
| **JedAI / pyJedAI**（雅典大学） | Block Building → Block Cleaning → Comparison Cleaning（即 meta-blocking，基于候选对的共现图裁剪冗余比较） | Entity Matching（成对相似度打分）→ **Entity Clustering**（见下节，7 种算法可选） | Papadakis et al. (2018) *"The return of jedAI"*, PVLDB 11(12):1950-1953；(2019) SIGMOD Record *"Domain- and Structure-Agnostic End-to-End ER with JedAI"*；[GitHub scify/JedAIToolkit](https://github.com/scify/JedAIToolkit) **[未读全文，仅摘要]** |

**关键点**：JedAI 是这几个库里唯一把"blocking → matching → **clustering**"三段都做成显式、可替换模块的（其他库要么把 clustering 丢给下游用户 Splink/dedupe 各自只内置了一种默认聚类方式），这点跟第 2 节直接相关。

---

## 2. 两两判决不满足传递性时，标准聚合方法是什么？

**结论：文献上把这个问题正式称为 "entity resolution as a clustering problem"（Monge & Elkan 1997 首倡），主流方法排一个谱系；但"哪个最好"没有唯一答案——2009 年唯一一篇专门做受控对比实验的论文（Hassanzadeh et al., VLDB'09）发现，我们现在用的方法（transitive closure / connected components，等价于单链聚合）恰恰是精度最差的一档，而看起来更"高级"的 correlation clustering 在他们的实验里也没跑赢简单的启发式方法。**

### 2.1 问题的标准框架

Binette & Steorts (2022)（**[已读]**，第 21-23 页，Section 6 "Entity Resolution as a Clustering Problem"）原文态度非常直接：

> "With the exception of Bayesian FS, these methods treat record pairs as being independent of one another, without accounting for the consequences of transitivity or other constraints on the linkage structure."

即：绝大多数 pairwise matcher（包括 LLM 判官）本身根本不管传递性，聚合传递性冲突是**后处理**（clustering）的职责，这是文献里公认的分工。

标准方法谱系（均引自 Binette & Steorts §6.1，交叉核对 Hassanzadeh et al. 2009）：

1. **Transitive closure / connected components**（Monge & Elkan 1997 首倡，称之为"dynamic connectivity problem"）——我们现在用的单链 union-find 属于这一类的等价形式。Binette & Steorts 明确指出：**single-linkage hierarchical clustering 在数学上就是对 dissimilarity 阈值做 transitive closure**（"utilized single linkage hierarchical clustering corresponding to the dissimilarity scores... to enforce transitive closures among record pairs"，引用 Ventura et al. 2015 USPTO 专利发明人消歧案例）。也就是说：**我们的"单链聚合"不是某种简化实现，它就是教科书里最原始、最基础的那一档方法**，文献上从来没把它当作"讲究"的方案。
2. **Correlation clustering**（Bansal, Blum, Chawla, *"Correlation Clustering"*, Machine Learning 56(1-3):89-113, 2004）——把问题建模成图上 +/− 边标注，最大化簇内 + 边与簇间 − 边（等价：最小化簇内 − 边 + 簇间 + 边）。**NP-hard**（同一篇论文证明），minimization 版本有 constant-factor 近似，maximization 版本在簇数 ≤2 时有 PTAS。这是唯一一个把"单一目标函数"讲清楚、不需要预先指定簇数的方法，但需要近似求解。
3. **Hierarchical agglomerative clustering (HAC)**，complete/average linkage——比单链更保守，一个点只有跟簇内**所有**（complete）或**平均**（average）成员都够相似才能加入。Ventura et al. (2014, 2015) 用 HAC + ensemble classifier 做大规模 ER。
4. **图划分类**：Cut Clustering（最小割，Flake-Tarjan-Tsioutsiouliklis）、Articulation Point Clustering、Markov Clustering (MCL, van Dongen)。
5. **Graphical / Bayesian entity resolution**（Bhattacharya & Getoor 2006 LDA 式模型；Steorts et al. 2016 的 SMERED；Marchant et al. 2019 的 d-blink）——不是"先两两判决再聚类"，而是直接对"记录→潜在实体"的联合结构建模，能给出聚类结构的不确定性量化，但计算成本高、可扩展性是长期研究课题。

### 2.2 唯一的定量对比实验：Hassanzadeh, Chiang, Lee, Miller (2009)

*"Framework for Evaluating Clustering Algorithms in Duplicate Detection"*, PVLDB 2(1):1282-1293, VLDB'09（**[已读全文]**，[PDF](http://www.vldb.org/pvldb/vol2/vldb09-1025.pdf)）。这是我查到的唯一一篇专门用真实/合成脏数据（企业名称、DBLP 论文标题，29 个数据集，含均匀分布和 Zipfian 分布两种）对上述所有聚类算法做受控精度/召回率/规模对比的论文。**这是回答本节问题最直接、最硬的一手证据**，关键发现：

- **Partitioning（= transitive closure / connected components，我们现在的方法）**：论文原话（摘要+结论）：

  > "Our results using partitioning of the similarity graph (finding the transitive closure of the similarity relation) which is the common approach in many early duplicate detection techniques, confirms the common wisdom that this scalable approach results in poor quality of duplicate groups. **But more importantly, we show that this quality is poor even when compared to other clustering algorithms that are efficient.**"

  定量上：阈值 θ=0.2（较松的图，边多）时，ground truth 有 500 个簇，Partitioning 只产出 **51 个簇**——大量不相似的记录被一条弱链串成一个大簇（链式效应，chaining），跟我们观测到的"A↔B、B↔C 过线但 A↮C 完全不像，仍被串成一组"是同一个失效模式，且**在阈值越低/候选边越"宽松"时越严重**——这点跟我们用 0.94 这种"候选"级别（而非"确信匹配"级别）的阈值直接相关。
  
  Figure 5（结果总表）里 Partitioning 在"Robustness Against — Choice of threshold"一栏被评为 **Low**，"Amount of Errors"也是 **Low**。

- **Correlation Clustering（用 Cautius 近似算法）**和 **Cut Clustering (MinCut)**——论文原话：

  > "Our results also show that sophisticated but popular algorithms, like Cut clustering and Correlation clustering, gave **lower accuracy** than some of the more efficient single-pass algorithms."

  更值得注意的一点：论文也测试了 CC-PIVOT（即下面第 6 节要讲的 Ailon-Charikar-Newman 随机化 3-近似算法），但作者的原话是"this randomization did not improve the quality of the clusters on average comparing to the CENTER algorithm"——**所以他们最终没有把 CC-PIVOT 的结果放进论文**。也就是说，理论上更"讲究"的 correlation clustering 近似算法，在这一具体基准上并没有跑赢简单的单遍扫描启发式。

- **表现最好的是简单的单遍算法 CENTER / MERGE-CENTER，以及 Markov Clustering (MCL)**——论文明确说自己是第一篇把 MCL 用到 duplicate detection 上的工作，"in fact it is among the most accurate algorithms for this task and is also very efficient"。CENTER：以图中度数最高的未标记节点为簇心，把与之相似的节点收进簇，反复直到所有节点被标记，单遍 O(n) 扫描（需要预先按相似度排序）。MERGE-CENTER 是 CENTER 的扩展，额外合并"簇心互相相似"的簇。

**诚实说明**：这篇论文是 2009 年的，比较对象都不含近十年的图神经网络/embedding 方法，且它评估的"correlation clustering"是一个特定近似算法（Cautius），不是穷举所有近似方案；不能机械地读成"correlation clustering 全面不如启发式"，只能说**在这一个受控实验里，理论上更漂亮的方法没有兑现优势，简单方法（尤其 MCL）反而最稳**。这个反直觉发现值得我们警惕：不要假设"换成更复杂的聚合算法"自动就是提升。

### 2.3 复杂度与失效模式小结

| 方法 | 复杂度 | 已知失效模式 |
|---|---|---|
| Transitive closure / 单链 | O(边数)，单遍扫描 | **Chaining**：一条弱链把不相关记录串起来；阈值越低越严重（Hassanzadeh et al. 2009 实证） |
| Correlation clustering（精确解） | NP-hard（Bansal et al. 2004 证明） | 精确解不可行；近似解在实践中不一定跑赢启发式（同上） |
| Correlation clustering（Pivot 近似） | O(n + 边数) 期望，3-近似 | 随机化，结果依赖随机种子而非节点顺序（见第 6 节） |
| HAC / complete-linkage | O(n² log n) 朴素实现 | 对噪声敏感，簇数需要靠阈值切树（cut dendrogram） |
| Markov Clustering | 依赖矩阵乘法，通常较快 | 需要调 inflation 参数（虽然 Hassanzadeh et al. 发现默认值就相当稳健） |
| Cut Clustering / MinCut | 多次最大流 | 对阈值敏感度中等；在 2009 年基准里精度不如单遍算法 |

---

## 3. Cross-document event coreference resolution (CDEC) 怎么做？

**结论：CDEC 学术界的标准流程和我们现在的架构骨架一模一样——pairwise scorer 打分 + agglomerative clustering 收尾；"同一事件不同阶段算不算同一事件"是一个专门被建模、而不是自动含糊处理的子问题（subevent structure）。**

### 3.1 Benchmark

**ECB+**（Cybulska & Vossen, 2014）是 CDEC 最主流的 benchmark，扩展自 Bejan & Harabagiu (2010) 的 ECB 语料。据 Ahmed et al. (2023)（见下，**[已读]** 第 3 页表格），ECB+ 包含 43 个 topic/subtopic、982 篇文档，annotate 事件 mention 及其 coreference cluster；训练/验证/测试按 topic 1-35 / 36-45 切分。

### 3.2 主流方法路线

Ahmed, S.R., Nath, A., Martin, J.H., Krishnaswamy, N. (2023) *"2\*n is better than n²: Decomposing Event Coreference Resolution into Two Tractable Problems"*, arXiv:2305.05672（**[已读]**）原文对标准流程的描述：

> "Traditionally, ECR is performed on pairs of event mentions by calculating the similarity between them and subsequently using a clustering algorithm to identify ECR relations through transitivity."

以及对近期 SOTA（transformer 交叉编码路线）的总结：

> "Most recent works ... in CDCR have shown success in using pairwise mention representation learning models, a method popularly known as cross-encoding. ... At inference, such works use variations of incremental or agglomerative clustering techniques to form predicted coreference links."

具体 SOTA 工作（均**[未读全文，仅摘要/被 Ahmed et al. 引用确认]**）：
- Held, W., Iter, D., Jurafsky, D. (2021) *"Focus on what matters: Applying Discourse Coherence Theory to Cross Document Coreference"*, EMNLP 2021, arXiv:2110.05362——用局部语篇上下文（discourse coherence）采样"hard negative"训练细粒度 pairwise 分类器，是当时公认的 ECB+ SOTA 之一。
- Caciularu, A. et al. (2021) *"CDLM: Cross-Document Language Modeling"*, Findings of ACL: EMNLP 2021, arXiv:2101.00406——用全局注意力机制扩展预训练语言模型跨文档上下文长度（到 4096 token），做 pairwise 打分。

**⚠️ 更正一个我自己先前误读**：我最初通过工具摘要误以为 Ahmed et al. (2023) 这篇论文的"两个可分解子问题"里有一个是"用聚类解决传递性"，但直接读原文后发现这是错的——**这篇论文的两个子问题实际是 (a) 用启发式规则过滤掉大量非共指对、(b) 在过滤后更平衡的数据集上训练 pairwise 分类器，目的是省计算量，跟聚类/传递性完全无关**。这提醒我们：工具摘要可能编造细节，凡是关键结论都应回读原文确认——这条也贴在这里供以后核对。

### 3.3 "同一事件不同阶段算不算同一事件"

Araki, J., Liu, Z., Hovy, E., Mitamura, T. (2014) *"Detecting Subevent Structure for Event Coreference Resolution"*, LREC 2014, pp.4553-4558, [ACL Anthology L14-1725](https://aclanthology.org/L14-1725/)（**[未读全文，仅摘要]**）——直接处理这个判准问题：把"partial event coreference"拆成 **subevent relations**（构成一个更大事件的、有先后顺序的阶段性事件序列——例如"审判"这个大事件下的"开庭""质证""宣判"）和 **membership relations**（一个事件集合的成员实例）两类，都跟"完全共指"（full coreference）区分开单独建模。方法上用一个 logistic regression 基线之上再叠加针对 subevent 的模型，在情报领域语料上比基线提升 3.2 BLANC F1。

这条对我们的意义是：**"同一事件的后续报道算不算同一 occurrence"在学术界不是靠含糊带过的，是一个专门的判准维度**。我们现在让 LLM 一次性回答"是不是同一个 occurrence"，隐含地把 subevent/follow-up 关系和 full coreference 混在一个问题里问，这可能是判决噪声的一个来源（但没有查到直接量化这个具体混淆有多大影响的论文，只能说文献承认这是需要单独处理的维度）。

---

## 4. LLM 做两两匹配判决：N-way 分组 vs 两两问

**结论：查到的论文里，"给 LLM 一批候选、让它一次性从中选出最佳匹配"（selecting）和"给 LLM 一组记录、让它直接输出分组"（in-context clustering）这两种"群体"范式都有实证支持、且比逐对问更省钱；但没有一篇论文验证了我们观察到的具体现象——"把已经成组的 3+ 条丢给 LLM 问'是不是同一事件'，它几乎恒答是，拆成两两问就能否决"。这个"预先分组后确认"的场景（confirmatory framing）跟查到的两种"群体"范式（选最佳候选 / 从零聚类）在任务形式上都不完全一样，需要标注为未找到直接证据。**

### 4.1 三种"群体"范式，以及它们各自是什么、不是什么

1. **"Selecting"**（从 N 个候选中选最佳匹配，本质是 1-对-N，不是"这组是否共指"）——Wang, T. et al. (2025) *"Match, Compare, or Select? An Investigation of Large Language Models for Entity Matching"*, COLING 2025, arXiv:2405.16884, [代码](https://github.com/tshu-w/ComEM)（**[已读摘要+方法描述]**）。论文对比三策略：matching（二分类 pairwise）、comparing（pairwise 相对比较）、selecting（把一条查询记录和多个候选一起放进一个 prompt，让模型利用"record interactions"选出最佳匹配）。核心结论：selecting 因为利用了记录间的全局一致性信息，效果优于纯 pairwise matching；作者提出 ComEM 框架组合多种策略以兼顾效果与成本，在 8 个数据集、10 个 LLM 上验证。**注意**：这个任务形状是"给定一条记录，从候选池里挑出它的匹配对象"，跟我们"给定一组已经预筛出来的记录，判断它们是否都指向同一事件"不是同一个问题——不能直接套用其"selecting 更准"的结论。

2. **"In-context clustering"**（直接把一批记录扔给 LLM，让它输出分组，从零聚类，不是确认预分组）——*"In-context Clustering-based Entity Resolution with Large Language Models: A Design Space Exploration"*, arXiv:2506.02509（**[通过 WebFetch 抓取原文并核对]**）。核心发现：
   - 精度上，一次给 9 条记录聚类跟逐对匹配基本打平甚至更好（Cora: pairwise 0.88 vs 聚类 0.90；Alaska: 0.81 vs 0.82；AS: 0.70 vs 0.70）。
   - 成本上差距巨大：API 调用次数减少 12-108×，token 消耗减少 3-28×，费用减少 3-22×，端到端时间减少 6-55×（Alaska 数据集具体数字：24,540 次调用/$0.43/241 分钟 → 2,040 次调用/$0.15/40 分钟）。
   - 失效模式：**不是"倾向于说都属于同一组"**，论文原话是"if the record set is too large, the LLM's performance may degrade due to long context lengths"，即长上下文导致的幻觉/误分组，作者用一个"Misclustering Detection Guardrail"机制处理，而不是报告"过度合并偏差"。

   **这一点直接跟我们的观察有张力**：这篇论文测的是结构化记录匹配（Cora 引文、Alaska 商品目录），没有发现"给一组就倾向于全判是"的系统性偏差；我们观察到的"整组一次问、模型几乎恒答是"，可能是**任务性质不同**导致的——判断"是不是同一新闻事件"比判断"是不是同一篇论文/同一件商品"主观、模糊得多，且我们是"确认一个已经摆在那里的候选分组"（anchoring 效应更强），而不是"从零构造分组"。这个区别在文献里没有被验证过，需要标注为**未找到直接证据**，仅供参考对照。

3. 相邻但不精确匹配的偏差研究：查了"confirmation bias"（*Failing to Falsify*, arXiv:2604.02485）和"acquiescence bias"（arXiv:2509.08480）两条 LLM 偏差文献，前者讲的是假设验证场景下模型倾向于找支持证据而非证伪，后者的实际发现反而是**LLM 对是非题整体偏向答"否"**（跟我们观察的"偏向说是"方向相反）。这两篇都不是针对"确认一个预先给定的分组"这个具体场景的，**不能作为我们现象的证据，只能算主题相邻**。

### 4.2 O(n²) 调用的优化手段

- **Blocking 先行**：OpenSanctions Pairs（2026），arXiv:2603.11051（**[已读，通过 WebFetch 核对]**）用 inverted index（字符 n-gram + 音译处理）先把候选对砍下来，再逐对喂给 LLM，论文原话"blocking strategy...reduces the O(n²) comparison space"，并明确建议未来工作"应该优先做好 blocking、clustering"而不是继续调 pairwise 模型本身。该论文的量化结果：rule-based 基线 F1 91.33%（recall 99.42%/precision 84.46%，即宁可错杀不放过），GPT-4o F1 98.95%（precision 98.78%/recall 99.11%），最强开源模型 DeepSeek-R1-Distill-Qwen-14B F1 98.23%；论文特别提到把匹配任务框成"contradiction detection"（默认判正、除非发现明确冲突）这个 prompt 设计角度。**该论文没有做 pairwise vs 分组 prompting 的对比，也没有做级联/缓存这类显式成本优化，只做了不同模型尺寸的性价比对比**（提到 Llama-3.1-8B 性价比最优）。

- **级联（cascade）**：通用 LLM 成本优化的标准做法，来自 Chen, L., Zaharia, M., Zou, J. (2023) *"FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance"*, arXiv:2305.05176, [代码](https://github.com/stanford-futuredata/FrugalGPT)（**[未读全文，仅摘要]**）——用便宜模型先答，答案置信度不够再升级到贵模型，论文报告最多 98% 成本下降、同时不掉点甚至提升 1.5% 准确率。这不是 ER 专用论文，是通用 LLM 调用成本优化框架，但思路直接适用。ER 领域的具体实例：*"Retrieve, Match, Escalate: Accurate and Scalable Product Linking with VLM-Distilled Cross-Encoders and Agentic VLMs"*, arXiv:2608.25037（**[未读全文，仅摘要]**）——便宜的 cross-encoder 自动解决高置信度多数，只把"中间不确定区间"升级给贵的多模态 VLM。

- **只问不确定区间**：这条思路在 ER 领域有正式名字——**active learning for record pairs**。Binette & Steorts (2022)（**[已读]**，第 20 页）提到 Enamorado (2019) "proposed an active learning algorithm which iteratively requests labels for specific record pairs"，即只对模型最不确定的候选对去请求（人工或模型）标注，而不是对所有候选对一视同仁。这是 pairwise 判决层面"只问不确定的"这一优化思路在 ER 文献里最直接的先例，虽然 Enamorado 原文讲的是请求人工标注而非 LLM 调用，但机制是一致的（可以用模型自身的置信度/margin 做筛选）。

---

## 5. 新闻去重的工业实践

**结论：查到的一手来源（Google 专利、TDT 项目、Event Registry 论文、RevDet 论文）里，"story = 用 centroid 向量代表一个簇 + 相似度阈值判断新文章是否并入"是跨越 20 年、从 TDT 项目到 Google News 专利到近期学术系统都在用的共同骨架，跟我们现在"centroid + cosine"的设计是同一个范式；但这些一手来源都没有公开过"如何处理传递性冲突/链式效应"这个具体子问题的解法，说明这个问题即便在工业界大概率也是未被公开解决、或者被更强的相似度模型/更严格阈值绕开而不是被聚合算法解决的。**

### 5.1 Google News

美国专利 US7568148B1（Bharat, Curtiss, Schmitt，Google，"Methods and apparatus for clustering news content"）（**[已读，通过 WebFetch 核对原文]**）描述的技术方案：
- 用 **hierarchical agglomerative clustering** 对文档向量聚类。
- 相似度基于 **TFIDF 向量**，其中标题、首句、命名实体（人名/地名/事件名/机构名）被赋予**更高权重**，理由是"这些元素在同一事件的不同报道里表达方式相对一致，不受文风/立场/地域影响"。
- **簇用 centroid 表示**（簇内所有文档词向量的平均），centroid 被认为能"唯一刻画这个簇讨论的主题"。
- 有一个"先粗聚类、再用更严格阈值二次细分"的 refinement 步骤，但**专利文本没有给出具体阈值数字，也没有讨论传递性/链式效应问题**。

这条直接印证：**我们"centroid 代表 story + cosine 阈值"这个设计本身，是至少 20 年前 Google News 就在用的工业标准做法**，不是我们自己发明的权宜之计。

Yahoo 的另一件专利 US8832105B2 "System for incrementally clustering news stories"（**[未读全文，仅标题/发明人确认]**）方向是增量聚类（新文章逐一和现有簇比较，不必重新聚类全量），但没有进一步核实其聚合算法细节。

### 5.2 TDT (Topic Detection and Tracking)

NIST/DARPA 资助的学术项目（1998-2004），是"story = 同一真实世界事件的新闻聚类"这一问题最早的系统化学术框架，其中 **First Story Detection** 是识别"某事件的第一篇报道"的子任务。CMU 的方案（**[未读全文，仅搜索摘要]**）：TF-IDF 向量 + hierarchical agglomerative clustering with **average linking**（注意：是 average-linkage，不是我们用的单链）+ 增量 IDF 的时间窗口做在线检测。来源：[NIST TDT 项目概览](https://www.nist.gov/publications/topic-detection-and-tracking-evaluation-overview)。

### 5.3 Event Registry / newsapi.ai

Leban, G., Fortuna, B., Brank, J., Grobelnik, M. (2014) *"Event Registry – Learning About World Events From News"*, WWW 2014 Companion, arXiv:1405.4053（**[未读全文，仅摘要]**）——号称能识别"描述同一事件的文章组"，甚至跨语言把同一事件的多语言报道聚为一组，提取事件的地点/时间/参与者/主题。系统架构细节未核实。

### 5.4 GDELT

- GDELT Cloud 官方方法论文档提到聚类是"UTC 按天窗口"（`gdeltcloud.com/methodology`，**[未读全文，仅搜索摘要]**），**同一持续事件如果跨天，不同天的文章不会被自动并入同一簇**——这跟我们的"事件后续算不算同一 occurrence"问题是同一类，GDELT 选择了"不处理"（用时间窗口硬切）而不是"用算法判断"。
- RevDet（Azeemi, A.H. et al. (2021) *"Robust and Memory Efficient Event Detection and Tracking in Large News Feeds"*, AALTD workshop @ ECML PKDD 2021, arXiv:2103.04390，**[未读全文，仅摘要]**）——号称能用恒定内存追踪跨越数天/数月持续演化的事件，并有一个"redundancy removal"去重步骤，但抓取到的摘要信息没有给出具体聚类算法名称/阈值参数，**无法判断它是否处理了传递性冲突问题**。
- 第三方批评：*"Deduplication of the media-based event databases"*, Journal of Computational Social Science, 2025（**[未读全文，仅摘要]**）——指出 GDELT 关键词字段准确率约 55%、数据冗余度高达 20%，并提出"两层去重方法"改进。这条说明**即便是被广泛使用多年的工业级新闻事件库，去重质量问题也是持续被学术界发现和修补的，不是一个已经被解决、可以照抄答案的问题**。

**未找到的东西**：没有查到任何一手来源公开描述"新闻聚合系统如何处理 pairwise 相似度的传递性冲突"这个具体算法细节（不管是 Google、Yahoo、Event Registry 还是 GDELT）。合理推测是：工业系统更可能靠"更强的相似度信号（专有名词/时间/地点联合特征）压低误连概率，让链式效应在实践中较少发生"，而不是"引入更复杂的聚合算法去兜底"，但这只是推测，没有一手证据支撑，如实标注为未找到。

---

## 6. 贪心 clique 划分依赖种子顺序：正经做法是什么？

**结论：文献上标准答案是用**随机化**算法替代贪心——Ailon-Charikar-Newman 的 Pivot 算法：每轮均匀随机选一个未分组节点做 pivot，把它和它的所有邻居分进同一簇，重复直到所有节点分组完毕。这个算法对 correlation clustering 的最小化目标有严格的期望 3-近似保证，且因为是"随机选 pivot"而非"贪心选 seed"，"依赖种子顺序"这个 bug 本身被转化成了"依赖随机数种子"——可以多次运行取多数投票或最优解来消除这个依赖，理论上有保证托底，不是纯拍脑袋的启发式。但同样要注意：Hassanzadeh et al. (2009) 实测这个算法并没有比简单的 CENTER 算法更准。**

### 证据

- Ailon, N., Charikar, M., Newman, A. *"Aggregating Inconsistent Information: Ranking and Clustering"*, STOC 2005 / J.ACM 55(5):23, 2008（**[未读全文，仅摘要+多处二手确认]**）——提出 **Pivot 算法**：从图中随机（均匀）选一个未聚类节点作为 pivot，把它和它所有相邻（+边）的未聚类节点分进同一个簇，从剩余节点里重复这个过程。这个算法对 correlation clustering 的 minimization 目标（最小化"不一致"边数）是 **3-近似**（期望意义下），不需要求解 LP、复杂度低于当时最好的 LP 方法、且可并行化（引自 Francesco Bonchi, *"Correlation Clustering: from Theory to Practice"*, KDD 2014 tutorial slides，[PDF](https://www.francescobonchi.com/CCtuto_kdd14.pdf)，**[未读全文，仅搜索摘要]**）。

- 这个算法直接回答了"贪心依赖种子顺序"的问题：**贪心版本的失效在于"先处理哪个节点"由某个确定性但任意的排序（比如我们现在可能是按发现顺序/字典序）决定，不同排序会给出系统性不同、且没有质量保证的结果；Pivot 算法把"选择顺序"本身变成一个显式的随机变量，配上理论近似比保证**——也就是说，"结果依赖种子"这件事没有被消除，而是被**从"未声明的隐藏 bug"变成"声明式的、有界的随机性"**：可以多次独立运行（不同随机种子）后取共识（比如对每对记录统计"在多少次运行里被分进同一簇"的比例）或直接取近似比最优的一次，这是理论保证赋予的合法操作，贪心版本做不到（没有近似比保证，多次运行的差异也没有统计意义）。

- **诚实的反例**：Hassanzadeh et al. (2009)（**[已读全文]**）明确测试了 CC-PIVOT（就是这个 Pivot 算法）用于 duplicate detection，结论是"this randomization did not improve the quality of the clusters on average comparing to the CENTER algorithm"，所以最终没有把它的结果放进论文的正式对比表。这说明：Pivot 算法解决的是"种子依赖"这个**工程/理论问题**（结果的可重复性、有无质量下界），不代表它在具体任务上的**绝对精度**一定比一个调好的启发式（比如按度数排序的 CENTER）更高。这两件事要分开看：我们的问题描述里"贪心依赖种子顺序"本身是一个应该被修的 bug（无法重现、没有下界保证），但换成 Pivot 不等于自动获得更高精度，精度还是要靠实测。

### 可用实现

没有查到一个被广泛使用、维护良好的 correlation clustering 通用库（不像 scikit-learn 之于 k-means 那样）。找到的具体实现：
- [`Garrafao/correlation_clustering`](https://github.com/Garrafao/correlation_clustering)（Python，基于局部搜索的启发式实现，`cluster_correlation_search`）——小型学术参考实现，非生产级。
- [`filkry/py-correlation-clustering`](https://github.com/filkry/py-correlation-clustering)——明确标注是 Bansal-Blum-Chawla (2004) disagreement-minimizing 算法的实现。
- **Markov Clustering (MCL)** 有维护相对更好的 Python 封装：[`markov-clustering`](https://pypi.org/project/markov-clustering/)（`pip install markov_clustering`，MIT license，依赖 numpy/scipy，可选 networkx 画图），封装的是 van Dongen 的原始 MCL 算法。考虑到 Hassanzadeh et al. (2009) 实测 MCL 是精度+效率的最佳折衷之一，这可能是"比贪心单链更讲究、又不需要自己实现近似算法"的最现成选项。
- JedAI（Java）内置 7 种 clustering 算法可选，包含 Connected Components、Center、Ricochet 家族等，是目前查到的唯一把这些算法都做成开箱即用模块的成熟工具包。

---

## 7. 对我们的直接建议

### 7.1 我们现在的方向在文献里对应什么、是不是标准做法

| 我们的设计 | 文献对应 | 评价 |
|---|---|---|
| Centroid 代表 story，cosine ≥0.94 生成候选对 | 标准 ER blocking + Google News 专利同款（TFIDF centroid + 阈值） | **是标准做法**，没有问题 |
| 候选对丢给 LLM 问"是不是同一 occurrence" | 标准 CDEC pairwise scorer（虽然文献里通常是训练出来的 cross-encoder，不是 prompt LLM，但角色对应） | **架构上是标准做法**，判准维度上没有显式区分 full coreference vs subevent/follow-up（见 §3.3），是潜在噪声源 |
| 两两判决后单链聚合（union-find） | **transitive closure / connected components**，ER 文献里最原始的基线方法 | **不是"简化实现"，是文献公认最弱的一档**，Hassanzadeh et al. (2009) 实测其精度显著低于其他所有测试过的方法，且失效模式（chaining）与我们观测到的完全吻合 |
| 整组一次性问 LLM "是不是同一事件" | 部分类似"in-context clustering"（从零聚类）或"selecting"（多候选选一），但都不是"确认一个已给定的组" | **没有直接对应的文献场景**，我们观察到的"整组问几乎恒答是"这个具体现象没有被任何查到的论文验证或证伪 |
| 贪心 clique 划分依赖种子顺序 | 已知 bug，标准修法是随机化（Pivot 算法） | **该修**，但换算法本身不保证精度提升，需要实测 |

### 7.2 可以照搬的

1. **换单链为 complete-linkage 或 MCL，而不是自己发明启发式**。complete-linkage（一个点要跟组内所有成员都过线才能入组）在概念上最接近 Hassanzadeh et al. (2009) 里表现最好的 CENTER/MERGE-CENTER（都要求"跟簇代表点相似"这类更严格的约束），比单链保守，能直接堵上"A↮C 也被串进同一组"这个观测到的 bug——因为 complete-linkage 的定义就排除了"组内存在低于阈值的配对"这种情况，正好对应我们说的"28 个 ≥3 组有 20 个内部存在低于阈值的配对"这个具体故障。这是最小改动、最省事、有文献支持的选项。如果想要更"讲究"的方案，MCL（`pip install markov_clustering`）是文献里唯一被证明精度+效率双高的算法，值得作为对照组实测。
2. **LLM 判决保持两两问，不要图省事整组问**——这跟我们自己的实测结论一致，也没有查到任何文献证据支持"整组问更准"能推广到"判断新闻事件是否为同一 occurrence"这个主观性更强的任务上（唯一查到的"整组更好"的论文测的是结构化记录匹配，任务性质不同，见 §4.1）。
3. **只对不确定区间调 LLM，省成本**——这是 ER 文献里 active learning 的标准思路（Enamorado 2019），也是通用 LLM 成本优化的标准思路（FrugalGPT 级联）。如果两两判决的调用量因为改聚合算法而增加，这是现成的省钱手段：先用 cosine 分数本身筛一道（比如 ≥0.98 的对大概率不需要问 LLM，可以直接判定/走确定性规则），只把"中间不确定区间"送给 LLM。
4. **Pivot 随机化算法是解决"贪心依赖种子顺序"这个具体 bug 的正经方案**，如果决定继续走 correlation-clustering-in-spirit 的路线（把 LLM 的两两判决当作 +/− 边标注，找一个全局一致的划分），应该用 Pivot（可以自己实现，逻辑不复杂：随机选点→收邻居→重复）而不是贪心，且理论上支持"多次运行取共识"来进一步提升稳定性。

### 7.3 不适用 / 需要打问号的

1. **不要指望 correlation clustering 的精确/近似解自动比现在的方法准**——Hassanzadeh et al. (2009) 是我查到的唯一硬性对比数据，结论是 correlation clustering（包括 Pivot 随机化版本）在他们的基准上没有跑赢简单的启发式方法。如果要引入它，必须先在我们自己的数据上和 complete-linkage/MCL 做 A/B，不能凭理论优雅程度拍板。
2. **"selecting"策略（ComEM 论文）不能直接套**——它是"1 个查询记录 + N 个候选，选最佳匹配"的任务形状，我们的场景是"N 个记录，判断是否互为同一事件"，形状不同，套用其"利用全局一致性更准"的结论需要额外验证。
3. **"整组问 LLM 更省钱"（in-context clustering 论文）的成本优势很诱人，但不能不经验证就用于我们的场景**——它的精度持平结论建立在结构化记录（引文、商品）上，而且论文本身也没有报告"过度合并偏差"，跟我们的实测结果（几乎恒答是）矛盾，说明这个技巧在"事件是否为同一 occurrence"这种更主观的判断上可能不成立，需要自己测，不能直接照搬省钱。
4. **Subevent/follow-up 判准（Araki et al. 2014）目前没有可以直接抄的公式**——只查到"这是一个需要单独建模的维度"这个结论，没查到可以直接搬进 prompt 的具体判准规则或数据集可以借用（ECB+ 标注了 subevent，但是新闻文本领域，不是我们这种通用新闻聚合场景，直接迁移的价值存疑，需要另外评估）。
5. **工业界（Google/Event Registry/GDELT）的一手来源都没有公开传递性冲突的解法**——不能假设"大厂肯定有更好的方案"，唯一确认的工业实践信息是"centroid + 阈值"这个我们已经在用的部分，链式效应的具体处理没有公开先例可抄。
