# 簇→故事切分：粒度定义、成对判断与稳定性的一手文献调研

> **调研起因**：`storyline.ts` / `auto-brief-generation.ts` 现在让 LLM（glm-4.7-flash，
> temperature=0）一次读完一个簇的全部文章标题（曾测到 57 条），一次性输出完整的
> 故事/主线划分。同一 prompt、同一输入跑 6 次，得到 48 / 48 / 53 / 10 / 45 / 13 条——
> 不光数量不稳，方向也相反：有的轮次几乎不合并（57 篇出 53 条，接近"每条标题各自成一条"），
> 有的轮次合过头成题材筐（`Sudan conflict` / `Opinion and analysis` 这类）。六种不同
> prompt 写法都没测出可复现的改善。与此对照，把切碎的 7 条同一场灾难的主线原样问模型
> 「这几条是不是同一个 happening」，一次问对，7 条全部归一组。本文调研三件事背后的
> 学界/业界一手依据：①"一个事件"的边界该怎么定，②成对判断是否真的比一次性划分更可靠、
> 非传递性怎么聚合，③生产系统怎么做，④这种"一次输出完整划分"任务的不稳定性有没有文献
> 量化和对策，⑤除了"一次划分"和"成对判断+聚合"还有没有第三种问题形式。
>
> **方法论**：一手来源优先——论文原文（arXiv/ACL Anthology/LREC proceedings 镜像/专利
> 原文）、官方文档、开源库源码。凡是通过 `curl` 抓取 PDF/HTML 并用 `pdftotext` 读过正文、
> 核对过具体段落的，标 **【已读】**；只有搜索引擎摘要、没有拿到正文逐字引用的，标
> **【未读全文，仅摘要】**。查不到一手来源的问题，在最后一节明说"没找到"。
>
> **与同目录三份旧笔记的分工**：`cluster-to-story-segmentation.md`、
> `event-dedup-industry-patterns.md`、`exhaustive-assignment-and-singleton-events.md`
> 已经把"topic→event 这一刀谁来切""LLM 处理大集合的容量退化曲线（n≈20–100 开始掉、
> RankGPT/Setwise 的滑窗）""correlation clustering 是不是标准答案（Hassanzadeh et al.
> 2009 的负结果）""Google News/Event Registry/Reuters Tracer 的一手细节"这几件事讲透了。
> 本文**不重复贴引文全文，只做指针引用 + 补充细节**，新增的是：TDT/ECB+/HiEve 的粒度定义
> 原文、Pairwise Ranking Prompting 论文对"listwise 为什么不可靠"的显式失败模式清单、
> cluster ensemble 领域"投票怎么聚合划分"的正经答案、NewsCatcher 和 Thomson Reuters 的
> 一手生产系统细节、"抽事件三元组再匹配"这条第三路线的一手依据。

---

## ⓪ 六句话结论

1. **TDT 从一开始就把 topic 收紧成"event"，用"具体性 + 时空定位"而不是关键词重合来定义
   边界**（Allan et al. 1998），但 TDT 的最小单位本来就是 event 级，**它没有回答"一个
   event 该不该再切成子事件"这个我们真正要问的问题**——这一层要靠 ECB+/HiEve/subevent
   文献补。
2. **学界不是没看见粒度歧义，是正面承认了它，并给出的答案是"换成多种关系类型"而不是
   "把定义写得更精确"**：Vossen & Cybulska (2017) 明说"要不要把一个故事/主题下的所有
   事件揉成一个大事件，人类自己的直觉本来就不清晰"，解法是同时标注 coreference /
   subevent / topical 三种关系，而不是硬指定一条唯一边界。HiEve 的粒度判定人际一致性
   只有 69% F-score，作者自称"认知负荷很高"。**我们六版定义文字改来改去模型只是跟着漂，
   这不是我们没把定义写对，是这条边界本身在学界就没有单一答案**。
3. **"成对判断比一次性列表更可靠"在文献里有直接支持，且给出了具体失败模式清单**：
   Pairwise Ranking Prompting 论文（Qin et al. 2023/2024）系统记录了 listwise 输出的
   四种失败模式——Missing / Rejection / Repetition / **Inconsistency（同一批候选换个
   顺序喂进去，输出的排列都不一样）**——这条失败模式与我们观测到的"同一 prompt 同一输入
   跑 6 次结果打架"是同一个现象的另一种任务上的复现。
4. **"投票怎么聚合成划分"不是"分类标签多数投票"的简单推广，这一点学界有专门论证**：
   Strehl & Ghosh (2002) 明说 cluster ensemble 比 classifier ensemble 更难，因为
   "cluster labels are symbolic"，必须先解决 label correspondence problem，标准解法是
   mutual-information 意义下的组合优化（CSPA/HGPA/MCLA）或 Fred & Jain (2005) 的
   co-association 矩阵——**不能把"6 轮结果取多数"简单套在"划分"这种结构化输出上**。
5. **生产系统里能查到一手细节的（NewsCatcher 官方文档、Thomson Reuters 专利）都确认
   "几何/图算法做切分、LLM 只在切完之后验证"这条边界**，且 NewsCatcher **明确说过把
   聚类算法从"density-based"换成 Leiden 就是为了稳定性**——"The Leiden algorithm
   produces more stable and accurate clusters than the previous density-based method
   because it optimizes community structure globally rather than locally"，这是一条
   独立的工业证据：**密度聚类（我们用的 HDBSCAN 打底）在这类任务上被别的公司实测过不够
   稳，换成图算法是他们的应对**。
6. **除了"一次划分"和"成对判断+聚合"，一手文献里还能确认两种第三形式**：Thomson Reuters
   的专利把人类编辑的既有标签当"种子"、算法只做成员扩展（种子扩展）；Vossen & Cybulska
   的 bag-of-events 模型把事件拆成 action/time/location/participant 四元组、身份判定是
   四元组的加权相似度函数，不依赖整句语义（先抽结构再匹配）。两条都有具体代价，见 §⑤。

---

## ① 粒度定义：TDT 的 topic/event/story，ECB+ 的事件共指判准，subevent 层级

### 1.1 TDT：topic 被收紧成 event，用"具体性"而不是关键词重合定义边界【已读，PDF 正文】

**[Topic Detection and Tracking Pilot Study: Final Report](https://maroo.cs.umass.edu/getpdf.php?id=14)**
（Allan, Carbonell, Doddington, Yamron, Yang, 1998, DARPA Broadcast News Transcription
and Understanding Workshop）

原文定义（§1.1）：

> "During the first portion of this study, the notion of a 'topic' was modified and
> sharpened to be an 'event', meaning some unique thing that happens at some point in
> time. The notion of an event differs from a broader category of events both in
> spatial/temporal localization and in specificity. For example, the eruption of Mount
> Pinatubo on June 15th, 1991 is considered to be an event, whereas volcanic eruption in
> general is considered to be a class of events."

即：**"一个 event"的边界不是靠关键词/主题重合判定，是靠"时空定位 + 具体性"**——皮纳图博
火山 1991 年 6 月 15 日那次喷发是一个 event，"火山喷发"这个类别不是。`story` 在 TDT 里
指的是流内的一个**文档单元**（一条广播新闻/一篇 newswire 稿），不是"事件"本身；
§1.3 明写"It will be assumed that each story discusses at most one event. Therefore
each story may be included in at most one cluster."——即 TDT 的基本假设是**文档级单指派**，
event 是"用一组 story 定义出来的"（"an event is defined by its association with stories
that discuss it"）。

**这条对我们的直接含义**：TDT 的最小分析单位本来就是 event 级（"topic=event"），
**它没有"一个粗粒度 topic 该切成几个 event"这一层的算法**——因为它的输入假设已经是
"每篇 story 只讨论一个 event"。我们的问题（一个 HDBSCAN 簇里混了同一场灾难的多个侧面）
在 TDT 框架里根本不存在，因为 TDT 假设这种混合在文档级就已经被切开了。**TDT 能回答
"用什么判据定义一个事件"，回答不了"一个粗粒度簇该切成几份"**。

### 1.2 ECB+：事件共指的判准是"能不能从上下文判定指向同一真实世界事件"，且作者自己举了
真正有歧义的例子【已读，PDF 正文】

**[Using a sledgehammer to crack a nut? Lexical diversity and event coreference
resolution](https://aclanthology.org/L14-1646/)**（Cybulska & Vossen, LREC 2014,
pp. 4545–4552）

论文把事件建模为四个成分——action / time / location / participant（human +
non-human）——共指判准原文（§1）：

> "If one can determine based on the context that two event instances refer to the same
> real world event, they can be considered as coreferent. If not, the actions should not
> be seen as coreferent."

作者自己举的例子直接展示了这条判准的局限：

> "Lindsay Lohan checked into rehab. / Ms. Lohan entered a rehab facility. These two
> sentences might refer to the same event, although as Ms. Lohan has been to rehab
> multiple times, it may also refer to two different instances."

即**判准本身承认"光看两句话有时判不出来"，需要额外上下文**——这不是判准写得不够精确，
是这类任务本来就存在"信息不足以判定"的情形。ECB+ 语料的组织方式也隐含了粒度分层：
43 个 topic（如"银行爆炸"），每个 topic 下**可能对应不止一个 seminal event**（如 2008
年俄勒冈的银行爆炸和 2012 年雅典的银行爆炸是同一个 topic 下的两个不同 seminal event）——
ECB+ 扩展语料时特意新增了 502 篇描述"同 topic 下不同 seminal event"的文档
（[cltl/ecbPlus README](https://raw.githubusercontent.com/cltl/ecbPlus/master/README.md)
**【已读】**），说明语料设计者自己就把"topic"和"seminal event"当成两层，不是同一个东西。

### 1.3 粒度歧义被正面承认：学界的解法是"多种关系类型"而不是"更精确的单一定义"
【已读，PDF 正文】

**[Identity and Granularity of Events in Text](https://arxiv.org/abs/1704.04259)**
（Vossen & Cybulska, arXiv:1704.04259, 2017）

这是本次调研里对"粒度歧义怎么处理"回答最直接的一手来源。§8 Discussion 原文：

> "Defining the granularity of event descriptions provides an interesting view on
> event-coreference. How far can we go to lump together event data? In a way, we could
> lump all events that make up a story or a topic together and define a period of time
> in which the topic or story takes place with all the involved participants. **This
> does not necessarily violate the idea of event-coreference since peoples' intuitions
> on decomposing events to smaller units are also not clear-cut.** Obviously, at some
> point lumping of event data generates unclarity of scope relations between events and
> participants, such as more than one person murdering the same or different persons,
> or even semantic anomalies such as the same person being at different places at the
> same time. **This is where event coreference could set a hard border but this also
> means that annotation and evaluation of data sets may need to be different, e.g.
> assigning not only event-coreference relations but also subevent and topical
> relations.**"

以及一条对我们同样有用的旁证：

> "Annotation of event coreference is not an easy task and annotators tend to be
> conservative."

**这条直接回答我们的问题「他们承认粒度有歧义吗，怎么处理的」**：承认，而且承认的方式很
明确——"人类自己对'该把事件切多细'的直觉本来就不清楚"，学界的应对不是"把定义写得更严"，
是**放弃用一个二元问题（是不是同一事件）覆盖所有情况，换成三种并存的关系类型**
（coreference 全同指 / subevent 子事件 / topical relation 同主题但不同指）。
我们现在 story-validation/storyline 的一次性判定，本质上就是在用一个二元问题
（这些文章算不算同一个故事）去覆盖学界认为需要三个维度才能说清楚的关系空间。

### 1.4 HiEve：四分类关系 + 人际一致性只有 69% F-score，且作者称任务"认知负荷很高"
【已读，PDF 正文】

**[HiEve: A Corpus for Extracting Event Hierarchies from News
Stories](https://aclanthology.org/L14-1020/)**（Glavaš, Šnajder, Kordjamshidi, Moens,
LREC 2014, pp. 3678–3683）

标注方案是给每对事件提及判定四选一关系（§3.1）：

1. **SuperSub**：第一个事件在时空上包含第二个事件（第二个是子事件）；
2. **SubSuper**：反过来；
3. **Coref**：两个提及指向同一真实世界事件；
4. **NoRelation**：既不包含也不共指。

判据强调"必须同时满足时空两个维度"，论文给了两个反例说明单一维度不够：阿根廷"革命"发生
在二战期间但不是二战的一部分（时间上 DURING 但不是 part-of）；伦敦大瘟疫和大火都发生在
伦敦但大火不是瘟疫的一部分（空间 CONTAINS 但不是 part-of）。

**人际一致性（IAA）只有 69% F-score**（§3.2），作者原话："Annotators themselves judged
the task as very cognitively demanding... this also indicates that there is room for
further improvement in the annotation quality... the annotators worked together to
resolve the disagreements." ——**连专门为这个任务训练过的标注者，两人独立判都判不到一致，
最后要靠人工协商**。这直接量化了"粒度判定有多难"：不是我们的 prompt 写得不够好，
是这类判断在人类标注者之间的上限本来就不高。

### 1.5 Subevent / membership / full coreference 三分类的判据来源（指针引用）

Araki, Liu, Hovy, Mitamura (2014) *"Detecting Subevent Structure for Event Coreference
Resolution"*, LREC 2014, [ACL Anthology L14-1725](https://aclanthology.org/L14-1725/)
——把"部分共指"拆成 subevent relation / membership relation / full coreference 三类，
已在 `cluster-to-story-segmentation.md` §5 和 `event-dedup-industry-patterns.md` §3.3
核实过（该论文本身两次全文抓取因网络问题失败，只核实到摘要级），本文不重复贴引文，
直接复用其结论：**"同一事件的后续/不同侧面算不算同一 occurrence"在学界是专门分开建模的
维度，不是靠一个模糊问题囊括的**。

### 1.6 生产系统里的 event / sub-event 层级：Thomson Reuters 专利的具体例子
【已读，专利正文】

**[US11663254B2 — System and engine for seeded clustering of news
events](https://patents.google.com/patent/US11663254B2/en)**（Thomson Reuters
Enterprise Centre GmbH，发明人 Jack G. Conrad, Michael J. Bender，优先权日
2016-01-29）

专利正文里给的具体例子直接展示了生产系统怎么落地"事件/子事件"这一层：

> "the germinal event labels provide a means to organize top-level 'event' clusters
> (e.g., Ukraine crisis) and the invention uses algorithmic means to organize
> lower-level 'sub-event' clusters (e.g., Ukraine crisis/airline crash) and fold in
> third-party content."

以及另一个例子："events e.g., Exxon-Valdez oil spill or BP Horizon explosion" 对应
"sub-events related to events e.g., cleanup effort associated with Exxon Valdez oil
spill or BP Horizon explosion"。**这条把"洪灾/救援/伤亡/成因算不算一个事件"这类问题的
生产答案摆出来了：不算一个层级，是 event（乌克兰危机/埃克森瓦尔迪兹漏油）之下挂
sub-event（客机坠毁/清理行动）的两层结构，而不是一个平铺的"故事"**。具体机制见 §③.4。

---

## ② 成对 vs 一次性；非传递性怎么聚合

### 2.1 Pairwise Ranking Prompting：listwise 的四种显式失败模式，其中一条就是我们观测到
的现象【已读，全文】

**[Large Language Models are Effective Text Rankers with Pairwise Ranking
Prompting](https://arxiv.org/abs/2306.17563)**（Qin, Jagerman, Hui, Zhuang, Wu, Yan,
Shen, Liu, Liu, Metzler, Wang, Bendersky, Google Research，Findings of NAACL 2024，
arXiv:2306.17563）

论文转述 Sun et al. (2023b) RankGPT 论文观测到的 listwise 失败模式（§2.2），四种都有名字：

> "Missing: When LLMs only output a partial list of the input documents. Rejection:
> LLMs refuse to perform the ranking task and produce irrelevant outputs. Repetition:
> LLMs output the same document more than once. **Inconsistency: The same list of
> documents have different output rankings when they are fed in with different order
> or context.**"

**Inconsistency 这一条，就是我们"同一 prompt 同一输入跑 6 次得到 48/48/53/10/45/13"的
另一种任务上的复现**——只是我们的输出空间是"划分"不是"排列"，但触发条件相同：一次性
生成结构化的全局输出，输出会随不确定的内部状态（顺序/采样噪声）漂移。

论文给出的诊断和 PRP 方案的核心论点（§2.2）：

> "**LLMs do have a sense of pairwise relative comparisons, which is much simpler than
> requiring a calibrated pointwise relevance estimation or outputting a permutation for
> a list of documents.**"

量化证据（§6, Table 5）：**PRP 的格式失败率只有 0.02%，"in stark contrast to the
listwise approaches"**（listwise 的具体失败率论文没有单独给出精确数字，但反复强调
"very common"/"frequent"）。效果上（§5.3）：PRP 比黑盒商业 RankGPT（listwise）高
**4.2%**，比 pointwise LLM 方案高 **10% 以上**，部分变体能追平监督式的 RankT5。
论文还专门测了"打乱输入顺序"下的鲁棒性（§6, Table 4）：PRP-Allpair 几乎不受影响，
listwise 方法"fall back to the initial ranking" 当预测失败时（这本身就是 listwise
脆弱性的一个直接后果——预测失败不是报错，是静默退化成拿到什么算什么）。

**注意任务边界**：PRP 解决的是"排序"（找出相对顺序），不是"分组"（找出等价类）——
排列和划分是不同的输出结构。但**触发不稳定的机制是共通的**：一次性要求模型对一个集合
输出一个内部一致的全局结构（无论是全序还是划分），这个结构本身没有把"逐项判断"分解开，
出错会累积成全局结构错乱；而两两问是把判断拆到最小单元，每次判断互相独立，错误不会
传播成结构性坍缩。

### 2.2 更早、更宽的同类证据（指针引用，已在旧笔记核实，不重复贴引文）

- **RankGPT**（Sun et al., arXiv:2304.09542）：作者原话"Since ChatGPT cannot manage 100
  passages at a time, we use the sliding window strategy"，滑窗 w=20 s=10；已在
  `exhaustive-assignment-and-singleton-events.md` §1.6/§4.4 核实。
- **Setwise**（arXiv:2310.09497，SIGIR 2024）：listwise 在 TREC DL 2019 上 NDCG@10 .561、
  推理 245 次、54.2s 延迟；Setwise Heapsort .670、125 次、8.0s——listwise **既不是最准
  也不是最快，只是最直觉**。已在 `event-dedup-industry-patterns.md`（间接）和
  `exhaustive-assignment-and-singleton-events.md` §4.4 核实。
- 这两篇加上本文 §2.1 的 PRP，**三篇独立论文、三个不同任务形式（排序）、共同结论都是
  "一次性生成完整结构化输出不如拆成两两判断再聚合"**——虽然任务都是排序不是分组，
  但这条结论的**任务无关部分**（"一次性生成 vs 拆成两两"）和我们的场景直接同构。

### 2.3 非传递性聚合：correlation clustering 不是免费的答案（指针引用）

我们自己观测到"A↔B 同段、B↔C 同段，不代表 A↔C 同段"——这在 `event-dedup-industry-patterns.md`
§2 已经系统调研过，核心结论**直接复用**：

- Monge & Elkan (1997) 式的 transitive closure / connected components（我们如果直接
  拿两两判决做 union-find 就是这一类）在文献里**是最原始最弱的一档**，
  Hassanzadeh et al. (2009, VLDB) 的受控实验证明它的聚类质量显著低于其他方法，
  失效模式叫 **chaining**——"一条弱链把不相关记录串起来"，与我们观测到的现象完全同构。
- **Correlation clustering 不是天然更好的替代**：Hassanzadeh et al. (2009) 同一篇论文
  也测了 correlation clustering（含 Ailon-Charikar-Newman 的 Pivot 随机化 3-近似算法），
  结论是"this randomization did not improve the quality of the clusters on average
  comparing to the CENTER algorithm"——**在这个基准上，理论上更精致的方法没有跑赢简单
  启发式**。表现最好的是简单的单遍算法 CENTER/MERGE-CENTER 和 Markov Clustering。
- 完整引文、复杂度表、可用实现（`markov_clustering` PyPI 包等）见
  `event-dedup-industry-patterns.md` §2/§6，本文不重复。

**对我们的直接含义**：如果要把"成对判断+聚合"这条路线做实，**不要默认 correlation
clustering 就是正确答案**——唯一的受控对比实验说它不一定比 complete-linkage 或 MCL 更准，
需要自己在真实数据上 A/B。

### 2.4 投票怎么聚合成"划分"——这不是分类标签的简单多数投票

如果最终选择"多轮跑、投票取共识"来治不稳定，这里有一个容易踩的坑：**"划分"是结构化
输出，不能像分类标签那样直接数众数**。

**[Cluster Ensembles — A Knowledge Reuse Framework for Combining Multiple
Partitions](https://www.jmlr.org/papers/v3/strehl02a.html)**（Strehl & Ghosh, JMLR 3,
2002, pp. 583–617）【已读，全文】

论文明确指出这件事比分类集成更难，原因是"标签没有固定对应关系"（§1）：

> "The cluster ensemble design problem is more difficult than designing classifier
> ensembles since **cluster labels are symbolic and so one must also solve a
> correspondence problem**. In addition, the number and shape of clusters provided by
> the individual solutions may vary based on the clustering method... In fact, the
> 'right' number of clusters in a data-set often depends on the scale at which the data
> is inspected, and sometimes equally valid (but substantially different) answers can
> be obtained for the same data."

即：**六轮跑出来的"第 3 组"在不同轮次之间根本不是同一个东西，不能直接对齐取多数**——
必须先解决"哪一轮的哪一组对应哪一轮的哪一组"这个对应问题。论文把这个问题正式形式化为
"在共享互信息（mutual information）意义下找一个与所有输入划分平均互信息最大的共识划分"，
并给出三种求解算法：**CSPA**（把划分转成两两共现相似度矩阵，再重新聚类）、**HGPA**
（把问题建成超图划分问题）、**MCLA**（把各轮的簇聚成"元簇"，元簇之间竞争认领每个对象）。

一条更直接、更好实现的替代方案——**共现矩阵（co-association matrix）**，避免显式解决
对应问题：

**[Combining Multiple Clusterings Using Evidence
Accumulation](https://dl.acm.org/doi/10.1109/TPAMI.2005.113)**（Fred & Jain, IEEE TPAMI
27(6):835–850, 2005）【未读原文，通过综述文章
[Evidence accumulation clustering using combinations of
features](https://pmc.ncbi.nlm.nih.gov/articles/PMC7251952/) 转述确认，含具体机制描述】

机制：把每一轮划分转成一个 n×n 的 0/1 共现矩阵（两个对象这一轮是否被分进同一组），
多轮矩阵相加得到"共同出现频次矩阵"，再对这个矩阵做一次层次聚类得到最终划分。综述原话：
"the clustering ensemble is transformed into a pairwise co-association matrix, thus
**avoiding the label correspondence problem**, which is intrinsic to other clustering
ensemble schemes"——这条思路直接可用：**六轮划分结果，不要试图对齐"第几组"，而是统计
"这两篇文章在几轮里被分进同一组"，用这个频次当相似度重新聚一次**，这样天然绕开了
Strehl & Ghosh 指出的对应问题。

**对我们的直接含义**：如果决定用"多轮投票"来对付不稳定性，**正确做法是 co-association
矩阵或 CSPA/HGPA/MCLA 这类"划分"层面的共识算法，不是拿六份"故事列表"简单比对字符串/ID
取众数**——后者会因为"同一件事在不同轮次被起了不同的组名/顺序不同"而完全失效，
这正是 Strehl & Ghosh 说的 label correspondence problem。

---

## ③ 生产系统：Google News / Event Registry / Reuters / NewsCatcher

### 3.1 Google News、Event Registry、Reuters Tracer（指针引用）

已在 `event-dedup-industry-patterns.md` §5 和 `exhaustive-assignment-and-singleton-events.md`
§2/§3 核实：

- **Google News 专利** US7568148B1：HAC + TFIDF centroid，标题/首句/命名实体加权，
  "先粗聚类、再用更严格阈值二次细分"但**专利文本没有给出这一步的算法细节，也没有讨论
  传递性/链式效应**。
- **Event Registry**（Leban et al., CEUR Vol-1272 paper 19）：**bisecting k-means (k=2)
  + Bayesian Information Criterion** 决定一个簇要不要拆——是本次全部调研里唯一一个把
  "拆不拆"做成显式模型选择准则（而非固定阈值）的一手来源；同一篇论文也明写"至少 5 篇
  报道才算一个 event"（**设计主张，无实验**）。
- **Reuters Tracer**（arXiv:1711.04068）：newsworthiness 当排序任务打分，簇只有 3 条
  内容、任何通讯社都还没报道时就能判到 P/R≈0.61；400 簇标注实验 weighted Kappa 0.68。

### 3.2 NewsCatcher：官方文档确认"图算法切分、LLM 只验证"，且明确说明"从密度聚类换成
Leiden 是为了稳定性"【已读，官方文档 + 官方博客原文】

**[Clustering news articles — NewsCatcher
Docs](https://www.newscatcherapi.com/docs/news-api/guides-and-concepts/clustering-news-articles)**
（2026 年现行文档，抓取时间 2026-09-04）

官方文档描述的算法（"Cluster formation" 节）：

> "When you make a request with `clustering_enabled=true`, the backend service retrieves
> the pre-computed embeddings for the articles that match your query, then runs the
> **Leiden graph community detection algorithm** to group them into clusters: The
> cosine similarity between each pair of article embeddings is calculated. Article
> pairs whose similarity score exceeds the `clustering_threshold` are connected as edges
> in a similarity graph. The Leiden algorithm detects communities within that graph."

关键的一句，直接对上我们的稳定性问题：

> "**The Leiden algorithm produces more stable and accurate clusters than the previous
> density-based method because it optimizes community structure globally rather than
> locally.**"

——这是一条独立的工业证据：**NewsCatcher 之前也用过密度聚类（跟我们的 HDBSCAN 是同一
类方法），后来换成 Leiden 的理由明确写的是"更稳定"，因为 Leiden 全局优化社区结构，
密度方法是局部的**。文档里 `clustering_threshold` 默认 0.7，是唯一的可调参数，
**没有额外的 LLM 参与切分/合并决策**。

配套的 **[CatchAll 产品发布博文](https://www.newscatcherapi.com/blog-posts/introducing-catchall-a-sota-web-search-api-for-real-world-events)**
（NewsCatcher 官方博客，2025）把这条边界讲得更明确——流水线顺序原文：

> "**Intelligent Clustering** — Graph-based clustering (Leiden algorithm) groups
> near-duplicate stories, reducing the dataset to distinct events. **Validation** — A
> Gemini-class model evaluates web pages to determine whether they meet your
> criteria—keeping only relevant, credible items."

即：**先图算法聚类切出"distinct events"，LLM（Gemini 级模型）只在切完之后做"这条是否
满足查询条件"的验证，不参与切分/合并本身**。这条与 `cluster-to-story-segmentation.md`
⓪-1 从 EventX/EpiMine/Event Registry/GraphRAG 得出的结论完全一致，**NewsCatcher 是
2025–2026 年在跑的商用系统，补上了这条结论在"最新"生产系统里仍然成立的证据**。

### 3.3 Thomson Reuters：半监督"种子聚类"，人类编辑标签当种子，算法只做成员扩展
【已读，专利正文】

**[US11663254B2](https://patents.google.com/patent/US11663254B2/en)**（同 §1.6，
发明人 Jack G. Conrad, Michael J. Bender，Thomson Reuters Enterprise Centre GmbH）

机制原文（Summary 节）：

> "Editorial identifiers or labels present in germinal stories, e.g., Thomson Reuters
> stories with event labels (e.g., sluglines) serve as **'seed' documents** for topical
> news event organization. The assigned event label is metadata associated with the
> first or seminal document written concerning an event... **the invention provides a
> semi-supervised system that combines professional expertise with automated
> duplication identification/digital signature processes and clustering processes.**"

具体判据（正文相似度小节）：**两套特征**——digital-signature 相似度（对无结构正文文本）
和 tag-based 相似度（对 Calais 等实体标注器打出的结构化标签），两者都过阈值才合并/纳入。
文中明确给出阈值差异：**去重（fuzzy duplicate detection）用 0.8，聚类纳入用更松的
约 0.5**——即"判断是不是同一篇的重复"和"判断要不要归进同一事件"用的是同一套相似度分数，
但门槛不同，门槛松紧本身就是"去重 vs 聚合成事件"这两个任务的分野（对应我们
`bprime-*`/dedup-band 原型里已经区分的两个不同判决）。

**对我们的直接含义**：这是本次调研里唯一一个**把"人在回路"当作正式架构组件、而不是
纯算法兜底**的一手生产案例——不是"算法先切、人事后审"，是"人（编辑）先给种子、算法只做
增量扩展"。这条本身就是 §⑤ 的"种子扩展"这条第三路线的生产先例。

### 3.4 Bloomberg：查不到

搜索多轮，只找到 Bloomberg 工程博客有 NLP 相关论文发布记录（EMNLP 2021 四篇论文），
**没有找到任何一篇公开描述 Bloomberg 自己新闻聚合/事件聚类算法细节的一手来源**（工程
博客、专利、论文）。如实标注"没找到"，不臆测。

---

## ④ 稳定性/方差：文献里的量化和对策

### 4.1 "一次性生成完整结构化输出"的容量退化曲线（指针引用，n≈20–100 正是我们踩中的区间）

`exhaustive-assignment-and-singleton-events.md` §1.1 已经用受控实验核实：

> **[Understanding LLM Performance Degradation in Multi-Instance
> Processing](https://arxiv.org/pdf/2603.22608)**（arXiv:2603.22608）：16 个 LLM、
> temperature 0，"all LLMs follow a pattern of **slight performance degradation for
> small numbers of instances (≈20–100)**, followed by a performance collapse on larger
> instance counts"；且"打乱实例顺序对总成功率影响很小"（**不是简单的位置偏置**）。

**我们观测到的 57 篇正好落在这篇论文标出的"轻度退化区间（20–100）"内**——不是我们的
簇特别大，是 57 这个规模本身就已经进了文献记录的不稳定区，这条量化了「为什么恰好是
57 篇这个量级就开始打架」。

### 4.2 硬格式约束在推理型任务上会进一步伤准确率（指针引用）

`exhaustive-assignment-and-singleton-events.md` §1.2 已核实：**[Let Me Speak
Freely?](https://arxiv.org/html/2408.02442v3)**（EMNLP 2024 industry track）——
JSON schema 硬约束在推理类任务上 Claude-3-Haiku 掉 **63pp**，但在纯分类任务上反而
+18.7pp。**故事切分是"推理+生成结构"混合任务，落在"格式越硬越掉"的一侧**——不能指望
"把 JSON schema 收紧"来治好这个不稳定性，这条实验数据本身在暗示要把任务从"一次性生成
划分"改成"逐条分类"。

### 4.3 temperature=0 不等于确定性（指针引用，直接解释我们"同一 prompt 同一输入"仍然
跑出 6 种结果）

`exhaustive-assignment-and-singleton-events.md` §1.1 已核实：**[Understanding and
Mitigating Numerical Sources of Nondeterminism in LLM
Inference](https://arxiv.org/html/2506.09501v2)**——根因是浮点非结合性 + kernel/batch/
GPU 配置差异；贪心解码下跨 12 种运行时配置，DeepSeek-R1-Distill-Qwen-7B 在 AIME'24 上
**BF16 准确率标准差 9.15%，FP32 为 0%**。**托管推理（Workers AI 的 glm-4.7-flash）
大概率跑 BF16，"temperature=0=确定性"这个假设本身不成立**——我们的 48/48/53/10/45/13
六轮方差，一部分根因可能不在 prompt 也不在任务难度，是硬件层面的浮点非结合性。

### 4.4 Self-consistency 投票对"自由格式/结构化输出"本身适用性有限（新增）

**Self-consistency**（Wang et al., ICLR 2023，"Self-Consistency Improves Chain of
Thought Reasoning in Language Models"）【未读全文，仅搜索摘要+多篇转述确认】的经典设定
是：多次采样得到多个**标量/短答案**，取众数。搜索到的转述明确划出适用边界：
"self-consistency works well when outputs are relatively constrained (e.g., numerical
or factual answers), but is less applicable to open-ended generation, where answers
cannot be easily compared for voting"；对自由格式输出的扩展（Universal
Self-Consistency，USC）改成"让 LLM 自己从多个候选里挑最一致的那个"，而不是做结构化的
逐项众数。

**这条对我们的含义**：**"划分"既不是标量答案也不是自由格式文本，是介于两者之间的
结构化对象——标准 self-consistency 的多数投票机制本身不直接适用，USC 那种"让 LLM 自己挑"
也不适用（挑哪个划分"更一致"本身又是一次主观判断）。真正适配"划分"这种结构化输出的
投票机制是 §2.4 的 cluster ensemble 算法（co-association 矩阵 / CSPA-HGPA-MCLA），
不是通用 self-consistency 教程里默认的"数众数"**。

### 4.5 NewsCatcher 换算法治稳定性，是一条独立的工业验证（回指 §3.2）

§3.2 已经引用：NewsCatcher 官方文档明写"Leiden 比之前的密度方法更稳定，因为它是全局
优化社区结构而不是局部的"。**这条独立于我们自己的实验之外，从另一家公司的公开文档证实
了同一类问题（密度/局部方法在这类任务上不够稳）确实存在，且他们选择的解法是换聚类算法
本身，而不是在 LLM prompt 层面治**——如果我们的第 1 步（切分）方向要动，这条给了一个
"换算法而不是换 prompt"的工业先例，但要注意 NewsCatcher 治的是"聚类"这一层的稳定性，
不是"LLM 输出划分"这一层，两个稳定性问题不是同一个，不能直接照搬结论。

---

## ⑤ 第三种问题形式：种子扩展、结构化抽取再匹配，及各自的代价

### 5.1 增量式一篇一篇入组（指针引用）

已在 `cluster-to-story-segmentation.md` §1 和 `exhaustive-assignment-and-singleton-events.md`
§4.5 核实：

- **Petrović, Osborne, Lavrenko (2010)** *Streaming First Story Detection with
  application to Twitter*, NAACL — 新文档与最近邻比距离，超阈值就开新 thread（单例是
  正常输出，不是异常）；TDT5 C_min=0.70；处理时间 28 小时→2 小时。
- **Miranda et al. (2018)** *Multilingual Clustering of Streaming News*, EMNLP —
  新文档与既有质心比相似度，超阈值并入否则开新簇；英语 F1 94.1。
- **Story Forest / EventX**（Zhang et al., CIKM 2017）—— 中文生产系统，两层图社区发现
  在线增量 merge/extend/insert，日均 16 万+篇、MacBook Pro 上每天数据 26 秒处理完，
  event 级 V-measure 0.962。

**代价**：需要持久化质心/状态（跨批次），Workers 的无状态特性不是天然适配，需要接
Postgres/DO 存质心；好处是彻底不用"一次切分 N 篇"这个动作，天然解决跨日故事连续性。

### 5.2 种子扩展：人类编辑标签当种子，算法做成员扩展（新增，Thomson Reuters 一手案例）

同 §3.3——Thomson Reuters 专利的核心架构就是这个形式："germinal event labels"（编辑
给的种子文档标签）定义顶层 event，算法用 digital-signature + tag 相似度做**成员扩展**
（把后续文章并入已有种子），并且在种子事件之下再算法性地长出 sub-event 分支
（"Ukraine crisis" → "Ukraine crisis/airline crash"）。

**代价**：需要一个可靠的"种子来源"——Reuters 的种子来自人类编辑的既有 slugline，
**我们没有对应的人工种子输入**，如果要搬这条路线，种子从哪来是要先解决的前置问题
（可能的替代：用 HDBSCAN 簇内 blockScore/entityShare 最高的那篇文章当"伪种子"，
但这是我们自己的推论，不是文献里验证过的做法）。

### 5.3 先抽事件结构（四元组）再匹配：Vossen & Cybulska 的 bag-of-events 模型
【已读，同 §1.3】

**[Identity and Granularity of Events in Text](https://arxiv.org/abs/1704.04259)**
（Vossen & Cybulska, arXiv:1704.04259, 2017）

这篇论文实现的正是"先抽结构、再匹配"这条第三路线，不依赖整句/整篇语义相似度：
每个事件被抽成 **action / time / location / participant** 四个组件（沿用 §1.2
的 ECB+ 四分类），跨文档事件身份判定是**这四个组件各自相似度的加权函数**（§1）：

> "we... described a model to measure identity across events as a function of the
> similarity of the event components. Such a model can be optimized on an annotated
> data set to weigh the contribution of the components for establishing event
> identity."

粒度可调（§8）："With respect to the granularity of the matching of the components,
we have used various ways to abstract from surface forms... we can parameterize the
matching by setting loose or strict constraints: dates can be mapped by year or month
instead of day; more or less participants to be shared, with or without their roles..."
——**时间可以按年/月/日三档松紧匹配，参与者可以要求全部共享或部分共享**，这是一个显式
可调的粒度旋钮，直接对应我们"洪灾的救援/伤亡/成因该不该算一个事件"这类问题——
在这个框架里，答案取决于"你把 participant/location/time 的匹配严格度调到多松"，
不是一个非黑即白的判断。

量化效果（§7，Table 9）：bag-of-events 方法在真实事件提及上达到 CoNLL F1 **73**，
比词形基线（lemma baseline，63）高 10 分；作者也报告了严格度权衡的实测——"there is a
slight tendency for more strict parameters to increase the precision but that we
always lose more recall"。

**代价**：需要一条独立的抽取流水线（命名实体链接到 DBpedia URI、时间归一化到 ISO 日期、
参与者角色标注），论文用的是 NewsReader 项目的完整 NLP 栈（NERC + NED + WSD），
**这是比"LLM 读标题判断"重得多的工程量**；且论文自陈"时间锚点在文本里很稀疏、很难推断"
——抽取质量本身是瓶颈，"quality of modules such as NERC, NED and WSD is crucial"。
如果要搬这条路线到我们的场景，等价于把"故事切分"整个换成一条实体/时间抽取管线，
不是在现有 LLM prompt 上加约束能做到的。

### 5.4 三种形式的代价对比

| 形式 | 一手依据 | 核心机制 | 主要代价 |
|---|---|---|---|
| 一次性划分（现状） | 本文 §②/④ | LLM 一次读完整簇输出完整划分 | 容量退化 n≈20–100（§4.1）+ 硬格式伤推理（§4.2）+ 非确定性（§4.3），三者叠加 |
| 成对判断 + 聚合 | 本文 §②，`event-dedup-industry-patterns.md` §2 | LLM 两两判、图/聚类算法聚合 | O(n²) 调用量；聚合算法本身没有免费的"更好"选项（Hassanzadeh et al. 负结果）；判官本身可能有系统性盲区（详见 memory `judge-partial-match-blindspot`，本文未重新调研） |
| 增量/流式质心匹配 | 本文 §5.1 | 新文档与既有质心/最近邻比距离，超阈值并入或开新簇 | 需要持久化状态（跨批次质心），架构改造而非 patch |
| 种子扩展 | 本文 §5.2 | 人工/伪种子 + 算法成员扩展 | 需要可靠种子来源，我们没有人工编辑输入，"伪种子"未经验证 |
| 结构化抽取再匹配 | 本文 §5.3 | 事件拆成 action/time/location/participant，组件相似度加权判定身份 | 需要独立 NER/时间归一化/角色标注管线，抽取质量本身是瓶颈，工程量最大 |

---

## 对我们的直接含义

**1. "一次性划分不稳"——文献直接支持，且给出了具体量级和失败模式，不是我们 prompt 没写好。**
57 篇正落在 arXiv:2603.22608 记录的"n≈20–100 轻度退化区"（§4.1）；PRP 论文记录的
listwise Inconsistency 失败模式（§2.1）与我们"同 prompt 同输入六轮打架"是同一现象的
跨任务复现；temperature=0 在 BF16 推理下本就不保证确定性（§4.3）。**六种不同 prompt
写法测不出可复现改善，这个负结果本身也和文献一致**——因为根因是"一次性生成完整结构化
输出"这个任务形式本身，不是某一版措辞的问题，换措辞不会动到根因。

**2. "成对判断很准"——有直接支持，但要小心边界。** PRP、RankGPT、Setwise 三篇独立论文
（任务是排序不是分组）一致支持"拆成两两判断 + 聚合，比一次性生成完整结构化输出更稳更准"
这条**任务无关的机制性结论**（§2.1/2.2），我们自己的 7/7 全对实验和这条结论方向一致。
**但要注意**：这些论文测的都是"排序"，不是"分组"；我们自己在
`judge-partial-match-blindspot` 记忆里已经踩过"逐 claim 判官对方向/身份错召回≈0"的坑
——两两问也不是免费的，只是失败模式和一次性生成不同（漏判 vs 结构坍缩），聚合到划分时
还要面对非传递性（§2.3）和 correlation clustering 不一定更好这个负结果。

**3. "粒度本身没有唯一答案"——学界不仅承认，还给出了具体的应对模式，这是我们没想到的
一条。** 我们六版定义文字改来改去、模型跟着漂这个现象，在 Vossen & Cybulska (2017)
§8 里被预判到了："人类自己对分解事件到多细的直觉本来就不清楚"，学界的解法**不是**
"再想一个更精确的定义"，是**放弃单一二元判断，换成 coreference/subevent/topical
relation 三种并存的关系类型**，或者像 §5.3 那样把粒度做成一个显式可调的参数（时间年/
月/日、参与者全共享/部分共享）。**这条是我们目前完全没有的思路**：现在
story-validation/storyline 问的是一个问题（"这些文章算不算一个故事"），学界认为这个
问题本身需要拆成至少两三个维度才问得清楚。HiEve 的 69% F-score 人际一致性上限（§1.4）
也提醒我们：即便按这套三分类去改，也不该期待模型判定能到近乎完美的一致——这是任务
本身的天花板，不是实现问题。

**4. NewsCatcher"换算法治稳定性"是一条独立交叉验证，但层次要分清。** NewsCatcher
明确因为稳定性问题把聚类算法从密度方法换成 Leiden（§3.2/4.5）——这确认了"密度/局部
方法在新闻聚类任务上不够稳"不是我们独有的问题。但他们治的是"聚类"（对应我们的 HDBSCAN
那一层），我们现在不稳的是"LLM 输出划分"（HDBSCAN 切完簇之后的那一层）——**两个稳定性
问题不在同一层，NewsCatcher 的解法（换聚类算法）不能直接当作"LLM 划分不稳"的解法**，
只能当作"这一大类任务确实容易不稳"的旁证。

**5. Thomson Reuters 的种子聚类和 Vossen & Cybulska 的结构化抽取，是我们完全没考虑过的
两条路。** 现有三个候选方向（几何粗切阈值、逐篇分类、流式质心）都已经在旧笔记里论证过，
本文新增的"种子扩展"和"抽结构再匹配"两条路径**目前都缺我们能直接复用的前置条件**
（人工种子来源 / 独立抽取管线），如果要走，是新的工程投入，不是现有代码的小改动。

---

## 查不到 / 证据薄弱的

1. **Araki et al. (2014) subevent/membership/full-coreference 三分类的具体判定特征/
   规则**——两次全文抓取因网络问题失败，只有摘要级信息（同 `cluster-to-story-segmentation.md`
   §5 的记录），三分类本身是学界共识，但"怎么判"需要正文，没能补上。
2. **Bloomberg 自己的新闻事件聚类/去重算法细节**——搜索多轮，只找到 EMNLP 论文发布记录，
   没有一手技术文档、专利或工程博客描述其内部机制。
3. **"listwise/pairwise 稳定性差异"在分组（而非排序）任务上的直接受控实验**——PRP/
   RankGPT/Setwise 三篇都是排序任务，本文用"任务无关的机制性论证"去类推到分组任务，
   **没有找到一篇专门针对"LLM 一次性输出集合划分 vs 两两判断+聚合"做受控对比的论文**。
   这是本文最大的推断跳跃，标注清楚：**这是推断，不是被直接测过的结论**。
4. **"投票聚合划分"（co-association 矩阵 / CSPA-HGPA-MCLA）在 LLM 生成的多个划分候选
   上的应用案例**——Strehl & Ghosh 和 Fred & Jain 都是传统 ML 聚类集成文献（2002/2005），
   没有找到把这套方法直接用于"多次采样 LLM 输出的多个划分候选"这个具体场景的一手论文，
   本文是把经典 ML 结论类推到 LLM 输出场景，**类推本身没有被验证过**。
5. **HDBSCAN 密度聚类与 Leiden 图算法在新闻聚类任务上的直接量化对比**——NewsCatcher
   官方文档只有一句定性断言（"更稳定更准确"），没有给出具体的稳定性指标数字或对比实验，
   无法判断这个提升有多大。
6. **Fred & Jain (2005) 原始论文正文**——只通过一篇引用它的综述文章（PMC7251952）确认
   了机制描述，没有直接读到 TPAMI 原文，方法本身的可信度以综述转述为准，不算完全的
   一手核实。
7. **"抽事件三元组/四元组再匹配"这条路线在纯新闻聚合（而非 NewsReader 这类专门的语义网
   项目）场景下的应用案例**——Vossen & Cybulska 的实现依赖 NewsReader 项目的完整语义网
   基础设施（DBpedia 链接、RDF 表示），**没有找到把这套方法接入一个类似我们这样的轻量
   新闻聚合 pipeline 的先例**。
