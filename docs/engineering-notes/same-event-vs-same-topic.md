# 「同一件事」vs「同一个题材」：判别特征的文献解法与落地路线（2026-09-05）

> **调研起因**：去掉 UMAP 后聚类 ARI 0.19→0.78（两窗口复现），剩下的两个病已确认同根因——
> e5-small 余弦分不开「同一件事」和「同一个题材」：96 簇里 20 个题材凑堆簇（网球/板球/日本防务/
> 美英房产），交付簇里约 6% 文章是同题材孤篇混入（索马里海盗混进北塞浦路斯渡轮簇）。
> 已试过的实体 Jaccard 融合、时间衰减、质心剥离、三个簇级门全部失败或收益 ≤+0.038，
> 明细见任务发起方给的实验清单与 `cluster-segmentation-negative-results.md`。
>
> **标注惯例**（沿用 `event-dedup-industry-patterns.md`）：**【已读】** = 通过 curl+pdftotext 或
> WebFetch 拿到正文并核对具体段落；**【部分读取】** = 正文只核实到部分；**【未读全文，仅摘要】** =
> 只有搜索摘要/二手转述。文献结论与我自己的推断分开标，推断一律写明**【推断】**。
>
> **与同目录旧笔记的分工**：`cluster-to-story-segmentation.md`（切分谁来做）、
> `event-dedup-industry-patterns.md`（pairwise 判决怎么聚合）、
> `story-granularity-industry-patterns.md`（粒度定义没有唯一答案）、
> `exhaustive-assignment-and-singleton-events.md`（LLM 容量退化曲线）已覆盖的引文只做指针引用。
> 本文的增量是一个此前没人正面查过的问题：**「event 与 topic 的判别特征」本身**。

---

## ⓪ 结论先行

1. **这个问题在文献里有正式名字和成体系的解法**：TDT 的 New Event Detection（NED）。经典答案
   （Kumaran & Allan 2004/2005）一句话可复述：**同一件事 ⇒ 实体通道和题材词通道都高；
   同题材不同事 ⇒ 只有一个通道高**。解法是把文档拆成「命名实体向量」和「题材词向量」
   **分开算相似度，在决策层用分类器融合**，在 TDT2/TDT5 上统计显著优于单一全文余弦。
2. **我们那些失败的融合实验，失败的不是「用实体」这个方向，是「融进距离矩阵」这个层次**。
   文献里从 2004（perceptron 学权重）到 2018（SVM-rank 学权重）到 2021（triplet-loss 学线性
   权重）的每一代系统，**没有一个把异质通道加权求和成一个距离再喂聚类**——全部是通道各自算分、
   学习一个决策函数。量纲不可通约的问题（我们实测实体距离恒在 1 附近、余弦距离 0–0.32）在
   决策层融合下不存在。
3. **实体通道对最难的一类（Kharg 岛 AI 视频：实体比真成员还高）原理上无效**，文献里有同型
   案例（Kumaran & Allan 的 Turkey/Sezgin 例子：高 IDF 实体重合导致假「同事件」）。能分开
   这一类的只有「发生了什么」那个通道——谓词/动作层比对，这正是 pairwise LLM 判定的领地，
   而 pairwise LLM 判「是否同一事件」已被 GPT-4 实验（CoNLL 2023）和我们自己的 7/7 实测双重
   支持。
4. **同题材不同事恰好是监督系统也最难的盲区**：SemEval-2022 Task 8（10k 对新闻、7 维相似度
   人工标注）的官方错误分析显示，模型误差与 GEO/ENT 维度的相关高达 0.97/0.88——
   「地理和实体都像、但不是同一个 story」正是最强参赛系统集中翻车的地方。对我们的期望管理：
   这不是调一个特征就能全收的病。
5. **推荐路线是两级级联**：零 LLM 的「通道分歧筛选门」（embedding 高 × 实体证据低 → 嫌疑）
   先把 1100 篇里的嫌疑压到百级，再用 LLM **成对**判定只复核嫌疑。金标（两窗口 ~240 事件）
   足够校准 2D 门限并给 LLM 判官做 κ 验证——这是校准不是训练，不受「没有训练数据规模」限制。

---

## ① 文献怎么解：event vs topic 判别的谱系

### 1.1 TDT/NED：问题的正式形态与双通道经典解【已读】

TDT 对 event 的定义（"some unique thing that happens at some point in time... differs from a
broader category of events both in spatial/temporal localization and in specificity"）已在
`story-granularity-industry-patterns.md` §1.1 核实过原文，不重复。要补的是：**TDT 的
New Event Detection 子任务，其核心困难恰好就是我们的问题**——新事件的报道和旧事件的报道
往往题材高度相似（另一次空难 vs 上一次空难），单一全文余弦分不开。

**[Using Names and Topics for New Event Detection](https://aclanthology.org/H05-1016.pdf)**
（Kumaran & Allan, HLT/EMNLP 2005）【已读，curl+pdftotext 读过正文】

- 判别直觉原文（§3）：**"If two stories were on the same topic, they would share both named
  entities as well as topic terms. If they were on different, but similar, topics, then either
  named entities or topic terms will match but not both."** ——把这句话的「topic」按 TDT
  语义读成「event」，就是我们要的判据：**双通道同时高才是同一件事，单通道高是两种不同的
  假相似**（实体高题材低 = 同人物不同事；题材高实体低 = 同题材不同事，即我们的网球/板球/
  房产袋）。
- 具体做法：每篇文档拆三个表示——全文向量、**named entity 向量**（BBN IdentiFinder 抽的
  Event/GPE/Location/Organization/Person/Date/Time 等全部合并进一个向量）、**topic-term
  向量**（全文去掉命名实体后剩下的词）。对每对文档算三个余弦，**当特征喂 SVM** 判 new/old。
- 结果（Table 1）：TDT2 最小代价 0.585→0.530、TDT5 0.701→0.661，sign test 统计显著。
  基线（单一全文余弦 + 增量 TF-IDF）正是当年 NIST 评测里最强的系统。
- 反例案例（§3，与我们的 Kharg 型同构）：Turkey–Syria 冲突的新事件，被基线误判为旧事件，
  因为最近邻是 Turkey–Bulgaria 军事合作稿——**高 IDF 实体（Turkey、国防部长 Ismet Sezgin）
  重合抬高了全文余弦，而题材词一个都不重合**。"Determining that the topic terms didn't match
  would have helped the system avoid this mistake."
- 前作 **[Text Classification and Named Entities for New Event Detection](https://ciir-publications.cs.umass.edu/pdf/IR-340.pdf)**
  （SIGIR 2004）【部分读取——PDF 字体编码损坏读不全，机制经 H05 自引转述核对】：
  按新闻类别用不同规则——**"certain categories of news were better tackled using only named
  entities, while using only topic terms for the others helped"**（H05 §2 转述）。对我们有一条
  直接暗示：体育类（我们题材袋的重灾区：网球、板球）是文献里明确点名「要靠实体分事件」的
  类别。
- 同一谱系的更早工作（Yang et al. 2002，topic-conditioned novelty detection）【未读原文，
  经 H05 §2 转述】：先把文档粗分大类，**类内做 NED，且按类重新加权命名实体、按类建停用词表**
  ——「先题材后事件」的两层结构 + 实体在类内权重被抬高。

### 1.2 Makkonen：四语义类子向量（who/where/when/what 分开比）【未读全文，仅摘要】

**[Simple Semantics in Topic Detection and Tracking](https://link.springer.com/article/10.1023/B:INRT.0000011210.12953.86)**
（Makkonen, Ahonen-Myka, Salmenkivi, Information Retrieval 7, 2004）

搜索摘要与多篇转述一致确认：文档表示拆成四个语义类子向量——**proper names（WHO）、
locations（WHERE）、temporal expressions（WHEN）、normal terms（WHAT）**，相似度
**逐类分开算**，再用一个 **perceptron 学各类的相对权重**。这是「事件 = 时空 + 参与者 +
动作各自比对」在 TDT 时代最直白的实现，和 Vossen & Cybulska 的 bag-of-events 四元组
（`story-granularity-industry-patterns.md` §5.3，CoNLL F1 73 vs 词形基线 63）是同一思想的
两代实现。

### 1.3 流式生产系统：多通道 + 学习权重是贯穿三代的骨架【已读】

- **Miranda et al. 2018**（EMNLP，Priberam，英语 F1 94.1；旧笔记已引，本次读 ar5iv 正文补
  细节）【已读】：每篇文档 **9 个 TF-IDF 子向量**（{词, 词元, **命名实体**} × {标题, 正文,
  标题+正文}）+ 发稿时间戳；文档-簇相似度**逐子向量算再聚合**，权重用 **SVM 学**（在金标
  流上模拟运行生成训练对）。时间用高斯相似度函数，是**特征**不是距离项。
- **[Event-Driven News Stream Clustering using Entity-Aware Contextual Embeddings](https://arxiv.org/abs/2101.11059)**
  （Saravanakumar, Ballesteros, Chandrasekaran, McKeown, EACL 2021, Amazon）【已读，
  curl+pdftotext】：在 Miranda 同一数据集上的后继 SOTA。要点：
  - 表示 = **11 个通道**（9 个 TF-IDF 子向量 + 1 个 dense embedding + 时间戳），相似度逐通道
    算、**加权模型用 triplet loss 改写成线性分类目标学出来**；
  - dense 通道不是裸 BERT——**entity-aware BERT**：用外部 NER 给每个 token 加「是/不是实体」
    嵌入，再用事件相似度任务 fine-tune。消融：**加实体感知比不加高约 3 个点 B³-F1**；
    作者观察 "the model learns to project entities and non-entities in mutually orthogonal
    directions"；
  - 量化锚点：**纯稀疏 TF-IDF 通道就有 86.8 B³-F1，全模型 94.76**——多通道骨架本身承担了
    大头，神经表示是增量。
- **EventX / Story Forest**（指针，`cluster-to-story-segmentation.md` §1.2）：第二层
  「同 event 判定」是**训练好的 SVM 对文档对打分**，特征= 内容 TF-IDF 余弦 + 标题余弦 +
  首句相似度等**多通道文档对特征**——又一个「决策层融合的 pairwise 分类器」实例。
- **Google News 专利**（指针，`event-dedup-industry-patterns.md` §5.1）：TFIDF 向量里
  **标题/首句/命名实体加权更高**——单通道内做实体加权，是同一思想的最粗版本。

**谱系小结（文献结论）**：2004 perceptron → 2005 SVM → 2017 SVM（EventX）→ 2018 SVM-rank →
2021 triplet-linear，五代系统一致的结构是：**通道分开算相似度（实体通道必在其中），融合发生
在决策层（学出来的权重/分类器），从来不在距离层**。没查到任何一个系统把实体相似度加权求和进
聚类距离矩阵。

### 1.4 SemEval-2022 Task 8：这个判别被做成了公开基准【已读】

**[SemEval-2022 Task 8: Multilingual news article similarity](https://aclanthology.org/2022.semeval-1.155/)**
（Chen et al.）【已读，curl+pdftotext】

- 数据：**近 10,000 对新闻**、18 个语言组合（含中文），每对人工标 **7 个维度**（4 档 Likert）：
  **GEO / ENT / TIME / NAR（叙事）/ STYLE / TONE / OVERALL**。OVERALL 的原始问法：
  **"Overall, are the two articles covering the same substantive news story? (excluding style,
  framing, and tone)"**——就是我们的目标变量；STYLE/TONE 被显式分离出去，说明「文风相似」
  作为干扰项是这个领域的共识（我们「同源文风抱团」的病有名字了）。
- 训练集 4,918 对带标签、公开可下载；最强参赛系统与金标 Pearson 相关 0.818，人类标注者
  更高（"suggesting space for further progress"）。
- **官方错误分析（§4.6）直接量化了我们的困境**：各强队模型误差的方差与 GEO 维度相关 0.97、
  与 ENT 相关 0.88；把「GEO/ENT/TIME/NAR 都至少 somewhat similar」的对单独拿出来，误差随
  OVERALL 差异单调上升（相关 0.88）——**「表面维度都像但不是同一个 story」正是监督系统的
  集中失败区**。论文 Table 1 自带的例子和我们的题材袋一模一样：两篇印度疫情稿 GEO/ENT/TIME
  都重合，"The two articles, however, still refer to different events."
- 参赛系统形态（如 [GateNLP-UShef 的 entity-enriched Siamese transformer](https://arxiv.org/pdf/2205.15812)
  【未读全文，仅摘要】）：cross-encoder / Siamese + 实体增强，都是 pairwise 监督模型。

**对我们的价值**：(a) 这份数据可以白拿来当 LLM pairwise 判官的**额外验证集**（OVERALL 二值化
后就是「同一 story?」判定），不用自己再标；(b) 它给了期望上限——监督 cross-encoder 都只到
0.818 相关，别指望某个单一特征把 20 个题材袋全收干净。

### 1.5 结构化事件比对与「事件时间」通道

- **bag-of-events 四元组加权匹配**（Vossen & Cybulska 2017，指针，
  `story-granularity-industry-patterns.md` §5.3）：粒度做成显式旋钮（日期按年/月/日三档、
  参与者全共享/部分共享），CoNLL F1 73。代价是完整 NLP 栈，旧笔记已判「工程量最大」。
- **[Giveme5W1H](https://arxiv.org/abs/1909.02766)**（Hamborg et al. 2019）【未读全文，仅
  摘要+官方 README】：开源规则系统抽 who/what/when/where/why/how，**前四个 W 的抽取精度
  p=0.79**，作者明说用途之一是 article clustering。对我们的意义不是引入它（我们已有 LLM 抽的
  字段），是佐证「事件身份 = 前四个 W 的匹配」这个骨架被反复独立实现。
- **事件时间 ≠ 发稿时间**（文献结论 + 我们的负结果解释）：Makkonen 的 WHEN 类是**文本内
  时间表达式**，SemEval 的 TIME 维度问的是「文章描述的时段」，都不是发稿时间戳。我们
  「时间衰减加进距离」失败的机制（48h 窗口内同一事件摊满全窗）恰好说明发稿时间在窗口内
  无判别力；而**事件发生时间**有（维纳斯首轮出局 vs Rybakina 登顶排名，是两个不同日期的
  happening）。【推断的部分：用我们已有的 `event_summary_points` 或补抽事件日期能否达到
  可用精度，文献没测过，要自己验。】

### 1.6 LLM 做事件同一性判定的近作

- **[Cross-Document Event Coreference Resolution: Instruct Humans or Instruct GPT?](https://aclanthology.org/2023.conll-1.38/)**
  （Zhao, Xue, Min, CoNLL 2023）【已读部分正文，curl+pdftotext】：把 CDEC 做成
  **去上下文化句子对的多分类**问 GPT-4。结论：**GPT-4 zero-shot 大幅超过众包工人、与受训
  标注者相当**（受训标注者 coref 类 F1 84.88 量级）。同样重要的警告：**GPT-4 "exhibits
  tendencies of being overly confident, and forcing annotation decisions even when such
  decisions are not warranted due to insufficient information"**——信息不足时硬判，这对
  我们「标题信息量不足」的对是直接风险（金标构建时人读标题的错误率 3/17 也是同一教训，
  见 `cluster-segmentation-negative-results.md` §4.1）。
- **[Synergetic Event Understanding](https://arxiv.org/abs/2406.02148)**（ACL 2024）【未读
  全文，仅摘要】：LLM 负责理解/改写事件描述，小模型负责共指判定的协同框架——又一个
  「LLM 不做全局划分、只做局部语义加工」的例子。
- **TECL**（[CIKM 2025](https://dl.acm.org/doi/10.1145/3746252.3760792)）【未读全文，仅摘要】：
  topic-enhanced 多方面对比学习做新闻事件聚类表示——表示学习派的最新作，需要训练数据，
  对我们暂不可用，仅记录存在。
- LLM 一次性划分整簇的容量失效、in-context clustering、pairwise 聚合的传递性问题：全部
  指针引用旧笔记（`exhaustive-assignment-and-singleton-events.md` §1、
  `event-dedup-industry-patterns.md` §2/§4），结论不变：**pairwise 准、划分不稳**。

### 1.7 谱系总表

| 路线 | 代表 | 实体通道怎么用 | 融合位置 | 监督需求 |
|---|---|---|---|---|
| 双通道 NED | Kumaran & Allan 04/05 | NE 向量单独算余弦 | SVM（决策层） | 185 正例即可训 |
| 四语义类 | Makkonen 04 | who/where/when/what 各自子向量 | perceptron（决策层） | 小 |
| 多通道流式 | Miranda 18 / Saravanakumar 21 | 实体 TF-IDF 子向量 ×3 + entity-aware BERT | SVM / triplet-linear（决策层） | 金标流模拟 |
| pairwise 图 | EventX | 文档对特征进 SVM | 分类器（决策层） | 3.5k 标注 |
| 结构化四元组 | Vossen 17 / Giveme5W1H | 参与者=显式槽位 | 加权匹配函数 | 标注集调权重 |
| 监督 cross-encoder | SemEval-22 参赛系统 | 实体增强输入 | 端到端 | 4.9k 对 |
| LLM pairwise | CoNLL 23 / ACL 24 | 隐式（模型内） | 逐对判定 | zero-shot 可用 |

---

## ② 映射到我们的三类失败

### 2.1 题材凑堆簇 = 「题材通道高、实体通道空」的教科书情形

美英房产袋（8 篇之间**没有任何实体被 ≥2 篇共享**）就是 Kumaran & Allan 那句判别直觉的右半边：
topic terms 高度重合（housing/acres/premium/conservation）、named entities 零重合。网球、
板球、日本防务同理（板球袋里唯一贯穿的「实体」是 cricket/Australia 这类高频弱实体）。
**文献视角下这不是疑难杂症，是双通道判据的标准阳性**。我们的杂物袋检测器（实体共享 <0.30，
精度 96%）本质上已经是这个判据的簇级版——它有效不是运气，是重新发明了 NED 的实体通道。

### 2.2 我们的实体融合为什么失败而文献的成功：距离层 vs 决策层【推断，但机制清楚】

三个失败实验的共同点：把实体信号**揉进喂给 HDBSCAN 的那一个距离**里——
Jaccard 融合（量纲差一个数量级，实体项主导）、秩归一化融合（把距离摊成均匀分布，密度
聚类无从下手）、时间衰减（λ 无解）。文献五代系统全部避开了这个层次：**聚类/判定吃的是
「多个通道分数 → 学习到的决策函数」的输出，不是通道的线性混合距离**。决策层融合的好处
正好逐条对上我们的失败原因：
- 量纲不可通约 → 决策函数各通道各有自己的阈值/权重，不需要同一把尺；
- 秩归一化破坏密度结构 → 决策层不动 embedding 距离，密度结构保留；
- 全有全无的簇级误杀（NASA 望远镜案例）→ 决策函数可以输出「嫌疑分」而不是二元开除。

**落地形态推论**：不要再造「更好的融合距离」，把实体通道做成**聚类之后的篇级/簇级校验特征**，
用金标校准一个 2D 决策边界（embedding 余弦 × 实体证据分）。240 个金标事件对校准一条
logistic/折线边界绰绰有余（Kumaran & Allan 用 185 个正例训 SVM）。

### 2.3 Kharg 型混入：实体通道原理性失效，只有「what」通道能分

「特朗普 Kharg 岛 AI 生成视频」5 篇混进美伊交火簇、实体命中比真成员还高——与 Kumaran &
Allan 的 Turkey/Sezgin 反例同型：**高 IDF 实体重合制造假同一性**。文献的答案（topic-term
通道不匹配则否决）在这里也只对了一半：AI 视频稿和交火稿的题材词也高度重合（Iran/strike/
military）。真正的差别在**谓词层**：一边的核心动作是「发布/流传一段视频」，一边是「袭击/
交火」。这一层没有任何稀疏通道能稳定捕捉，是 **pairwise LLM（或 NAR 维度的监督模型）的
专属领地**——SemEval 把 NAR 单独设维、CoNLL 2023 用去上下文化句子对问 GPT-4，都是在这一层
工作。**结论：级联的最后一级必须是语义判定，前面的通道门只负责把嫌疑集缩小。**

### 2.4 「实体报道用词各异」的真事件簇（NASA 型）是实体通道的假阳性来源

NASA 8 篇分写 "Roman Telescope"/"$4.3bn"/"cosmic secrets"，实体 Jaccard 中位 0——实体通道
在这类簇上**空匹配不代表不同事件**。文献对策有两个：(a) Yang et al. 2002 的按类调权（有的
类别实体本来就稀）；(b) 把实体通道从「否决器」降级为「嫌疑信号」，终审交给语义层。
我们簇级门整簇归零的教训就是把 (b) 做反了。

### 2.5 embedding 输入自带题材偏置【推断，零文献直接支持】

`generateSearchText`（`apps/backend/src/lib/core/utils.ts`）把 `thematic_keywords` +
`topic_tags` + `content_focus` 拼进 embedding 输入——这三个字段**按构造就是题材信号**，等于
主动把同题材文章往一起拉。文献的间接支持：所有多通道系统都把「题材表示」和「实体表示」
分开存放，没有一家拼成一串再算单一余弦。但**没有任何文献直接测过「拼题材字段伤事件聚类」**，
且有反向风险：NASA 型簇（实体各写各的）可能正是靠题材词粘住的，删掉题材字段可能打碎真
事件簇（B³-R 掉）。这条是纯推断，好在验证是零成本的离线消融。

---

## ③ 排序建议

> 每条给：机制（为什么它能分开、余弦不能）、预估成本、可证伪的验证设计、最可能的失败模式。
> 验证统一用 F1+F2 两窗口全覆盖金标（`scripts/eval/clustering/full-score.ts`），主指标 ARI，
> B³-P（conflation 应涨）/B³-R（不应显著掉）做诊断——与
> `clustering-recall-first-metrics` 记忆的「指标必须成对」一致。

### A.【第一优先】两级级联：通道分歧筛选门 → LLM 成对复核

**机制**：第一级复刻 Kumaran & Allan 双通道判据的篇级版——对每篇交付簇成员算两个数：
(i) 它与簇内其他成员的 embedding 余弦（已有）；(ii) 实体证据分 = 与多少个成员共享至少一个
**加权后的**专有名词（IDF 加权或「出现在 ≥3 簇即停权」，治 India/Trump 这类弱实体；数据源 =
标题专名 + `key_entities`）。「embedding 高 × 实体证据低」= 题材袋嫌疑；整簇成员两两实体
图不连通 = 簇级嫌疑。**门只标嫌疑，不删任何东西**（吸取 NASA 整簇误杀教训）。第二级把
嫌疑篇与所在簇的 2 个代表篇（medoid + 实体证据最高篇）做 LLM 成对判定「这两篇是不是同一个
happening」，输入用标题 + `event_summary_points`（CoNLL 2023 的 decontextualized sentence
思路），显式允许 `cannot_decide`（治 GPT-4 式过度自信），`cannot_decide` 默认保留不动。
嫌疑篇两问皆「否」才剥离成单篇；题材袋簇内做成对判定后按 complete-linkage 聚合（治链式
效应，`event-dedup-industry-patterns.md` §7.2 的结论）。

**为什么余弦不能而它能**：余弦把「文风+题材+实体」压成一个标量；级联把实体通道单独拎出来
（分开 2.1 的题材袋），把谓词层交给 LLM（分开 2.3 的 Kharg 型），两类病各有各的通道。

**成本**：第一级零 LLM（纯计算，杂物袋检测器代码可扩展）。第二级调用量估算：6% 混入嫌疑
（~30-40 篇 ×2 问）+ 20 个题材袋（平均 5 篇 × 簇内成对 ~10 对）≈ **250–400 次/窗口**；
glm-4.7-flash 按 ~500 tok in / 50 tok out 算 ≈ **$0.02–0.04/天**，Workers AI 300rpm 限速下
并发 6 约 3–5 分钟，workflow step 预算内。实现 3–5 天。

**验证设计（可证伪）**：金标窗口离线跑三臂——(a) 只跑第一级门（标出的嫌疑直接剥离）；
(b) 完整级联；(c) 全量成对 LLM 上限对照（只对 20 个题材袋跑，看级联比全量丢多少）。
判据：**级联臂 ARI 相对基线 +0.03 以上且 B³-R 掉幅 <0.01 才算成立**；(a) 臂显著差于 (b) 臂
才证明 LLM 级有增量，否则第二级砍掉。LLM 判官先单独验：从金标免费构造 ~100 个正负对
（正对 = 同事件成员对；负对 = `topics-F1.jsonl` 主题层里同主题不同事件的对——这恰好是最难
的负对），κ ≥0.6 且负对召回 ≥0.7 才接入（`judge-partial-match-blindspot` 记忆要求先验判官）。

**最可能的失败模式**：(1) LLM 判官对「转述性/元报道」（AI 视频稿 vs 交火稿）可能也判「同一
件事」——它字面上确实 about 同一冲突；负对验证集里必须放进 Kharg 那 5 篇实测，过不了就承认
这 6% 里有一部分治不了。(2) 实体证据分对多语言/译名不归一（e5 是多语言的，实体字符串不是）；
F2 窗口如果多语言占比高，第一级召回会掉。(3) 成对判定在簇内聚合仍有传递性问题，complete-
linkage 偏保守可能把大事件切碎——盯 B³-R。

### B.【并行做，零成本】embedding 输入消融

**机制**：见 §2.5，把题材字段（`thematic_keywords`/`topic_tags`/`content_focus`）从
embedding 输入里去掉或降序重排，直接减少「题材相似」混进唯一距离的份额。**这是唯一动根因
（向量本身）的便宜实验**。

**成本**：离线重算两窗口 embedding（本地 e5-small 批算，几分钟）+ 重跑 full-score，半天。

**验证设计**：四臂消融——全字段（基线）/ 去 keywords+tags / 去 focus / 只留
title+location+summary+entities。判据：ARI 涨且 NASA 型簇（金标里报道用词各异的事件）
完整率不掉。**两个窗口都要过**（去 UMAP 的教训：单窗口结论必须复现）。

**最可能的失败模式**：题材字段正在替稀实体簇当粘合剂，去掉后 B³-R 掉、题材袋照旧（题材
相似可能主要来自 summary 正文本身而不是那几个字段）。是推断，测完就知道。

**【推断】标注**：文献零直接支持，纯本仓库推理。

### C.【A 的简化版先行探针】题材袋簇的小集合 LLM 判定

**机制**：对第一级标出的嫌疑簇（≤15 篇），把标题列表一次问 LLM「这是一件事还是一个题材下
的多件事？如果是多件事请分组」。注意这**不与「LLM 一次划分整簇已证伪」冲突**：证伪的是
60–147 条的划分（容量区间 n≥20–100），这里 n≤15 且问题是二分类+小划分；我们自己「7 条主线
归一组一次答对」的实测也在这个规模。

**成本**：~20 次/窗口，<$0.01/天，一天实现。可以作为 A 的第二级里「簇级」那一半先行上线，
比篇级成对便宜一个量级。

**验证设计**：20 个题材袋 + 20 个真事件簇（含 NASA 型）盲测，混淆矩阵；真事件簇被误拆
≥2 个就降级为只出信号不动数据。

**最可能的失败模式**：n=10–15 恰在容量退化区边缘，划分部分可能不稳（沿用金标窗口跑 3 次
看划分稳定性；不稳就只用它的二分类判断、划分交给篇级成对）。

### D.【排后】事件时间通道

**机制**：抽每篇的**事件发生时间**（非发稿时间），日期不同直接是分裂证据（§1.5）。治网球
（首轮出局 vs 排名发布）、板球（八年前旧事回顾）这类时间可分的题材袋。

**成本**：`event_summary_points` 里未必有规范化日期，大概率要在文章分析 prompt 里加一个
字段（改 prompt 要过 eval，见 CLAUDE.md 工作规则）+ 回填历史，一周级。

**失败模式**：滚动事件（洪灾、战争）事件时间本身就是区间，日期通道对它们无定义；抽取
错误率未知。文献支持（Makkonen WHEN 类、SemEval TIME 维）方向性成立，但**「用 LLM 抽的
事件日期做聚类分裂信号」没有先例，属于推断**。

### E. 不推荐清单（附原因）

- **监督 cross-encoder / 表示学习 fine-tune**（SemEval 参赛系统、Saravanakumar、TECL 路线）：
  需要训练基础设施 + 域内标注规模，且 SemEval 0.818 的上限说明收益封顶；我们的金标只够
  校准和验证，不够训练。SemEval 数据留作判官验证集就好。
- **把实体/时间再融进距离矩阵的任何变体**：三次失败 + 文献五代系统零先例（§2.2），这条
  路线关闭。
- **继续调 HDBSCAN 参数 / min_samples / eps**：全网格已扫，单调关系已探明，无剩余空间。
- **簇级硬门（全有全无）**：NASA/阿富汗误杀实测 + 本文 §2.4，门只能出嫌疑信号。

---

## ④ 明确没找到的

1. **「LLM 逐对判新闻是否同一事件，接在无监督聚类后面做净化」的完整系统先例**——CoNLL 2023
   验证了判定环节本身，但「聚类 → 通道门筛嫌疑 → LLM 成对复核」这个具体级联查不到一手先例
   （与 `cluster-to-story-segmentation.md` ⓪-5 的负面发现同类：要做就是自己设计+自己验，
   没有业界标准做法可抄）。
2. **「拼接题材字段伤事件聚类」的直接实验**——零文献，B 条纯推断。
3. **LLM 抽取的事件发生日期用于聚类分裂的先例**——零文献，D 条纯推断。
4. **Kumaran & Allan 2004 的按类规则明细**——PDF 字体编码损坏，只拿到 H05 的转述级信息。
5. **多语言实体归一化在轻量新闻管线里的现成方案**——Event Registry 有跨语言 concept 链接
   但依赖其私有基础设施，没查到可直接搬的轻量实现。

---

## ⑤ 行动清单（排序）

| # | 动作 | 验证成本 | 先决条件 |
|---|---|---|---|
| 1 | **B：embedding 输入消融**（四臂 × 两窗口，离线） | 半天，$0 | 无 |
| 2 | **A 第一级：通道分歧门**（篇级实体证据分 + 簇级实体图连通性，只出嫌疑标记），金标上校准 2D 边界 | 1–2 天，$0 | 无 |
| 3 | **LLM 成对判官 κ 验证**（金标免费构造 ~100 正负对，负对必含 Kharg 5 篇与主题层难负对） | 1 天，<$0.5 | #2 的嫌疑定义 |
| 4 | **C：嫌疑簇小集合判定探针**（20 题材袋 + 20 真簇盲测 ×3 轮稳定性） | 1 天，<$0.1 | #3 过线 |
| 5 | **A 完整级联三臂对照**（门 only / 级联 / 全量上限），判据 ARI +0.03 且 B³-R 掉幅 <0.01 | 2–3 天，<$1 | #3、#4 |
| 6 | D：事件时间字段（改分析 prompt + 过 eval + 回填） | 一周级 | #1–#5 收益不够时再启动 |

**一票否决线**：#3 判官验证不过（κ<0.6 或难负对召回 <0.7）则 #4/#5 全停，只上 #1+#2
（零 LLM 部分独立有价值：题材袋检测本来就是杂物袋检测器的推广）。
