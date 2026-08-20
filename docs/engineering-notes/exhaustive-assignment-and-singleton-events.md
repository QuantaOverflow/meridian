# 穷尽分配、单例事件与"报道量≠重要性" —— 一手来源调研

> **调研起因**：story-validation 环节把一个聚类（最多 ~100 篇）整个交给
> `@cf/zai-org/glm-4.7-flash`，让它判 `single_story` / `collection_of_stories` /
> `pure_noise`；走 collection 时模型列出若干子故事及其成员 id。
> 2026-08-18 生产实测：1011 篇窗口 → 64 个真簇（967 篇）+ 44 篇噪声，最终只有 **528 篇**
> 进入故事，**352 篇（进簇文章的 36%）被模型的回答完全没提到**。大簇尤其严重
> （100 篇的簇覆盖 13–30%，53 篇的簇覆盖 4–48%，36 篇的簇覆盖 6–11%）。
> 已排除：**不是 token 预算**（max_tokens 4000 时实际只吐 700–1100 tokens，提到 16000 无变化、
> 无截断）；**不是 prompt 缺规则**（`prompts/storyValidation.ts` 已有整节 anti-padding）。
> 另有一个结构性偏置：`services/story-validation.ts:118,142` 的 **≥2 篇**门槛按**报道量**筛选
> 而非重要性——宝莱坞票房有 5 篇报道所以进简报，印度最高法院跨邦调水裁决只有 1 篇报道所以出局。
>
> **本文只用一手来源**：arXiv / ACL Anthology / CEUR 论文正文（读 PDF 或 HTML 正文，不是摘要转述）、
> 官方文档、开源项目源码。每条论断给 URL + 标题，能定位到章节的给章节。
> 每条都标注 **【实验】**（论文里有实验数据支撑）还是 **【设计主张】**（只是作者的设计选择/断言）。
> 查不到可靠一手来源的，在第 ⑤ 节明确写"没找到"，不用泛泛而谈填充。


> ## ⚠️ 引文核实状态（2026-08-20 补记，由另一位读者抽验）
>
> 本文由子 agent 调研撰写。提交前抽验了引文真实性，结论：**书目全部真实，具体数字只验到摘要级**。
>
> | 出处 | 核实 |
> |---|---|
> | arXiv:2408.04873 EpiMine | ✅ 抓 HTML 全文 74,590 字读过；§4.2 几何切分 / §4.3 LLM 摘要 / §4.4 低置信片段过滤 属实 |
> | arXiv:2508.08272 Real-time News Story Identification | ✅ 摘要原文核过："assign each news article to a specific story"；用 BERTopic/DBStream/TextClust，**全程无 LLM** |
> | arXiv:2506.00277 Matryoshka 层次聚类 | ✅ 真实，Hanley & Durumeric, ACL 2025 |
> | arXiv:2511.15424 LLM-MemCluster | ✅ 真实，Dual-Prompt 定簇数属实；**`[K_min,K_max]` 不在摘要，未验正文** |
> | arXiv:2408.02442 Let Me Speak Freely | ✅ 真实，方向属实（"significant decline in LLMs reasoning abilities under format restrictions"）；**−26~−63pp 等具体数字在正文，未验** |
> | arXiv:2405.02732 L3X | ✅ 真实；**recall 51.6→79.8 / precision 34-45→9-10 等数字在正文，未验** |
> | arXiv:2604.25130 LongSumEval | ✅ 真实，feedback-driven refinement 属实；**consistency −5.9% 在正文，未验** |
>
> **背景**：同批调研的另一份交接文档里，两句署名 arXiv:2408.04873 的"逐字引用"
> （`overly broad episode labels` / `abstraction level` + `inner loop`）经全文检索
> **在原文中 0 次出现**，系编造。本文未发现同类问题，但正文数字请按上表的核实级别使用。

---

## ⓪ 四句话结论

1. **"36% 成员被静默漏掉"在文献里有名字、有受控实验、有归因：它是 multi-instance processing
   的「条目数」容量问题，不是 token 预算问题，也不是 prompt 规则问题。**
   同一批实例，把 n 从 2 拉到 2000，性能在 n≈20–100 开始下滑、n≥200 明显掉、n≥1000 崩塌；
   而人为把每个实例加长一倍（token 翻倍、条目数不变）**几乎不掉**。
2. **让 LLM 穷尽分配一个 ~100 元素的集合，没有任何一手来源支持它可行**；最接近的同构任务
   （listwise 重排 100 个 passage）的作者直接说做不到，改用 w=20 滑窗。所有主流系统
   （BERTopic 源码、TopicGPT、ClusterLLM、Event Registry、TDT/Story Forest）
   **没有一个让 LLM 去切分集合**——几何负责分配，LLM 只做逐条判定或命名。
3. **"覆盖契约 + 两遍法补录"这副药在「分配」任务上有一手证据，但代价方向和合成层不同**：
   分块+并集能把 recall 从 ~51.6% 拉到 ~79.8%，**代价是 precision 从 34–45% 崩到 9–10%**，
   必须再接一道甄别（scrutinization）才有用。合成层"补录几乎零代价"的经验**不能直接外推**。
4. **`≥2 篇`门槛在业界两派都有一手先例**：Event Registry 明写"最少 5 篇"（**设计主张，无实验**），
   而一个 2025 年的流式故事识别系统里 **79% 的故事只有 1 篇文章**且不设最小源数。
   更关键的是 Reuters Tracer 的实验证明：**在簇只有 3 条内容、任何通讯社都还没报道之前**，
   就能用内容特征把 newsworthiness 判到 P/R≈0.61——**重要性不必等报道量堆出来**。

---

## ① Q1：让 LLM 对集合做穷尽分配（exhaustive assignment）

### 1.1 根因定性：掉的是"条目数"，不是"上下文长度"【实验】

**[Understanding LLM Performance Degradation in Multi-Instance Processing: The Roles of Instance
Count and Context Length](https://arxiv.org/pdf/2603.22608)**（arXiv:2603.22608v2）

这是本次调研中与我们的问题最同构的一篇受控实验论文。设计（§3.2, §4.4）：先做单实例过滤，
只保留"所有对比模型单独处理都答对"的实例，再把**同一批实例**按
n ∈ {2,5,10,20,50,100,200,500,1000,2000} 塞进一个 prompt；16 个 LLM，temperature 0。

- **退化曲线**（摘要 / §5.1, Figure 2）："all LLMs follow a pattern of slight performance
  degradation for small numbers of instances (≈20–100), followed by a performance collapse on
  larger instance counts"；"all models show noticeable drops above 200 instances and near-collapse
  beyond 1,000 instances, with success rates falling below 20% at 2,000 instances."
- **"只做前几条、剩下的不管"这个 failure mode 被显式记录**（§5.2）："the model producing
  predictions for only the first few instances and omitting the remaining ones, which corresponds
  to a key mistake (missing key)... only 171 out of 4,620 experiments exhibit this omission,
  almost exclusively at instance counts of 500 or more... **most models do not warn users about
  such limitations**." ——模型几乎从不告诉你它漏了，正是我们的"silently unmentioned"。
- **"不是 token 预算"的直接实验证据**（§6，本篇对我们最有价值的部分）：
  - §6.1 人为给每个实例注入无关上下文（平均 136 → 326 tokens，翻倍多），**条目数固定时成功率
    "broadly similar"**（Figure 6）。
  - §6.2 相关分析：成功率 vs 实例数 Spearman **ρ = −0.61**；vs 总上下文长度 **ρ = −0.37**
    （均 p<0.001）。**固定实例数后**，上下文长度与成功率的相关落到 −0.15~+0.15、**p 全部 >0.1**
    （Table 4）。
  - §6.3："the number of instances plays a stronger role than context length... In MIP settings,
    LLMs must process each instance individually and aggregate the resulting outputs."
- §5.1 附带：**打乱实例顺序对总成功率影响很小**（Figure 4）→ 这**不是**简单的位置偏置。

**作者自陈局限**："our experiments are English-centric"；任务是精确聚合类。→ 方向可信，
**具体阈值不能照搬到中英混合的语义切分**。

**[Attention Overflow: Language Model Input Blur during Long-Context Missing Items
Recommendation](https://arxiv.org/html/2407.13481v1)**（arXiv:2407.13481）【实验】

任务：给一个含 N 个条目的列表，让模型说出缺失的条目；同时统计 **repetition rate**
（返回一个已经在输入里的元素的比率）。结果："Most language models solve the missing number
prediction task with relatively high accuracy with less than 128 items"；
**"the repetition rates shoot up and the accuracy decreases in all models after 256 items"**
（Figure 1）。摘要里作者给的转折点是"around 100 items"。

作者对机制的解释是**设计主张/假说**，不是被证明的机制："We refer to this issue as attention
overflow, as **preventing repetition requires attending to all items simultaneously**."
——我们的任务恰好要求"同时注意到全部成员并保证每个被处置一次"，和这个失败条件定义重合，
而 100 这个数字正好撞上我们的簇上限。

**顺带解释 temperature=0 仍有 run-to-run 差异**：
**[Understanding and Mitigating Numerical Sources of Nondeterminism in LLM
Inference](https://arxiv.org/html/2506.09501v2)**【实验】。根因是浮点非结合性 +
kernel/batch/GPU 配置差异。Table 3：贪心解码下跨 12 种运行时配置，
DeepSeek-R1-Distill-Qwen-7B 在 AIME'24 上 **BF16 准确率标准差 9.15%，FP32 为 0%**；
Table 4：输出长度标准差 BF16 **9,189 tokens** vs FP32 为 0；Figure 5：BF16 下
"over 90% of examples showing divergence"，FP32 只有 2.2%。
→ **托管推理（Workers AI）大概率跑 BF16，"temperature=0 = 确定性"这个假设不成立**，
不要把 run-to-run 差异当成 prompt 没写清楚。

### 1.2 覆盖契约 / 结构化输出能不能治？——有反向证据，要小心【实验】

**[Let Me Speak Freely? A Study on the Impact of Format Restrictions on Performance of Large
Language Models](https://arxiv.org/html/2408.02442v3)**（EMNLP 2024 industry track）

四档格式约束：Natural Language（基线）→ NL-to-Format（两步）→ Format-Restricting
Instructions → JSON-mode（constrained decoding，最严）。

- **推理类任务掉分**（Table 1 / Figure 2）：GPT-3.5-Turbo 在 GSM8K 上
  **75.99%（text）→ 49.25%（JSON+schema），−26.74pp**；Claude-3-Haiku
  **86.51% → 23.44%，−63.07pp**；LLaMA-3-8B 在 Last Letter 上 75.13% → 28.0%。
- **分类类任务反而涨**（Figure 3）：Gemini-1.5-Flash 在 DDXPlus 上 41.6% → 60.3%，**+18.7pp**。
- 作者推荐 **NL-to-Format 两步法**："decouples content generation from format adherence"。

**对我们的含义**（这是"覆盖契约"路线的关键约束，不是否定它）：
story-validation 是**推理 + 生成结构**混合任务，正落在"格式越硬越掉"的那一侧；
而"逐篇独立分类"是**分类任务**，落在"格式约束反而有帮助"的那一侧。
**这条实验数据本身就在推荐把任务从「集合切分」改成「逐条分类」。**

**工程可行性**：Workers AI 的
[JSON Mode 文档](https://developers.cloudflare.com/workers-ai/features/json-mode/) 说
"Developers pass a `response_format` object containing a `json_schema` field"，但**支持模型是
白名单**（文档列的是 Llama 3.1/3.3、Hermes 2 Pro、DeepSeek 等）；
[glm-4.7-flash 模型页](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)
只列了 `response_format` 参数存在，**没说支持 json_schema 模式**。
→ **上 schema 约束前必须先本地 curl 实测该模型是否真支持**，别假设。
（同页有价目：$0.06 / M input tokens，$0.40 / M output tokens，Context Window 131,072——
后面成本估算用这个。）

**没有找到**"给 JSON schema 加一个显式 `unassigned` 桶 / 要求计数求和 = N 就能提高覆盖率"的
量化一手证据（详见 ⑤）。

### 1.3 分块 + 并集 + 甄别：唯一有量化证据的"同一副药"【实验】

**[Recall Them All: Retrieval-Augmented Language Models for Long Object List Extraction from Long
Documents](https://arxiv.org/html/2405.02732v1)**（L3X，arXiv:2405.02732）

这是我找到的、**最接近"覆盖契约 + 两遍法"用在非摘要任务上**的一手实验。任务是从长文档里抽
"某 subject-predicate 的全部 object"，作者形式化为 **Recall@Precision_X**。
方法两阶段：**Stage 1 recall-oriented generation**——把长文切块、检索候选、
**对每个 batch 分别 prompt 再取并集（union）**；**Stage 2 precision-oriented scrutinization**
——用打分/置信度/分类器剪掉假阳性。

- **并集把召回抬起来**（Table 4）：LLM-only 最好 ~**51.6%** → L3X plain **77.8%** →
  L3X +amp **79.8%**，约 **+28pp**。
- **代价是精确率崩塌**：Stage 1 precision **9.3–10%**（LLM-only 是 34–45%）。
- **接甄别后才可用**（Table 5）：R@P50 = **46.5%**，R@P80 = **29.8%**。

**这条要说清楚的含义**：我们下游合成层"覆盖契约 + 两遍法程序化补录把漏报 13.4% → 0%"
（见 memory `synthesis-omission-fix`）之所以几乎没有代价，是因为**合成层的补录对象是「已确认属于本
简报的故事」，补进来必定是对的**；而 story-validation 的"补录"要决定**某篇文章属不属于某个故事**
——这是个判断，不是搬运。L3X 量化了这个差别：**同一副药，在需要判断的场景下 precision 会塌，
必须配一道甄别环节**。别指望白捡。

### 1.4 残余集合迭代 / 覆盖反馈回路【实验，但域外】

**[LongSumEval: Question-Answering Based Evaluation and Feedback-Driven Refinement for Long
Document Summarization](https://arxiv.org/pdf/2604.25130)**（arXiv:2604.25130）

Algorithm 2 就是标准的"检测缺口 → 构造自然语言反馈 → 重生成 → 循环到阈值"：
`score_cov < T_cov` 时用未被回答的问题构造 Coverage-Oriented Refinement prompt
（"Address all the questions listed below in your revised summary"）。

- **覆盖率提升**（§IV-E-2, Table III）：对全部摘要用，Patent **+39.71%**、PubMed **+35.51%**、
  CNN/DM-CNN **+16.61%**、Arxiv **+10.15%**、CNN/DM-DM **+8.85%**；
  只对**低覆盖子集**用，提升 **+63.83% ~ +83.72%**。
- **测到了代价**：对全部摘要做覆盖精炼时，Arxiv 的 consistency **−5.91%**、低覆盖子集 **−5.35%**
  ——"suggesting a potential trade-off between coverage and consistency during refinement"。
- **对我们最该注意的一句**：作者观察到**新闻数据集（CNN/DM）的提升最小**，
  "news summaries may already capture salient information effectively in their initial generation"。

**适用性打折**：这是摘要覆盖，不是集合分配。它能支持的是"**程序化检测缺口 + 只对缺口重问**这个
控制结构有效且提升集中在低覆盖样本上"，**不能**直接当作"分配任务上也能补到 0 漏"的证据。

### 1.5 强制穷尽的失败模式：会不会逼出乱分？

- L3X 给了**直接的定量证据**：recall-first 的并集策略把 precision 打到 9–10%（上文 1.3）。【实验】
- Attention Overflow 给了**重复项**的定量证据：条目数超过 ~256，模型开始把输入里已有的元素当作
  "缺失项"吐出来（repetition rate 飙升）。【实验】
- 我们自己的生产观测里已经有同族现象：`story-validation.ts:137-141` 的注释记录了
  "**曾观测到幻觉 id —— 簇外/捏造 —— 与跨子故事重复**"，所以代码用簇成员白名单挡。
  这与 D2 的 repetition 现象同型。
- **没找到**专门测"在 prompt 里强制 every-item-must-be-assigned 会带来多少强行错配"的论文（见 ⑤）。

### 1.6 Q1 方案汇总（含我们自己的成本估算）

成本口径（**本文自算，不是文献数据**）：按 glm-4.7-flash $0.06/M in、$0.40/M out；
每篇文章在 prompt 里约 150–200 tokens（`story-validation.ts:305-320`：ID + 标题 + URL + 摘要要点）；
当前每天约 64–95 个簇、967 篇进簇文章。当前 story-validation 全天成本约 **$0.03–0.05**。

| 方案 | 一手依据 | 额外 LLM 调用 | 我们的成本/延迟估算 | 判断 |
|---|---|---|---|---|
| 只在 prompt 里加"必须穷尽分配" | **无一手证据**；反向证据见 1.1（条目数容量问题）与 1.2（硬格式伤推理） | 0 | ~$0 | **不推荐单独用**。根因是容量不是指令 |
| 加显式 `unassigned` 桶 + 计数校验 | 没找到量化证据（⑤）；只有"让漏掉变可见"的工程价值 | 0 | ~$0 | **值得做，但定位是观测而非修复**（工作区已有类似改动，见 1.7） |
| JSON schema 硬约束 | 2408.02442【实验】：推理任务 −26~−63pp，分类任务 +18.7pp | 0 | ~$0 | **别在集合切分上用**；改成逐条分类后再用 |
| 分块（w≈20）+ 并集 + 甄别 | 2405.02732【实验】recall +28pp / precision → 9–10% / R@P50 46.5；2304.09542 RankGPT w=20,s=10 | 大簇 ~5–10 次/簇，全天 +300~500 次 | 输入总量约翻倍 → 全天 ~$0.1；串行 10 次/簇会顶延迟，需并发 | **中**：能治覆盖，但必须配甄别，否则把噪声灌进简报 |
| 残余集合迭代（检测未分配 → 只对残余再问一轮） | 2604.25130【实验，域外】低覆盖子集 +63~84%，但 consistency −5.9% | 只对有残余的簇 +1 次 | 全天 +~30% ≈ +$0.015 | **高性价比**，但要预期到"补进来的成分质量更差"，必须留痕可回溯 |
| 逐篇独立分类（见 ④） | 2512.04350 ClusterFusion【实验】；2311.01449 TopicGPT【实验】 | O(n)：967 次/天（或只对残余 352 次） | 每次 ~500 tok in → 全天 ~$0.03–0.06 | **最高**：穷尽性由构造保证，不靠模型自觉 |

### 1.7 关于我们代码的一个事实更正

`services/meridian-ai-worker/src/services/story-validation.ts` 的**工作区未提交改动**里，
已经加了 `UNASSIGNED_IN_COLLECTION` / `OUTLIER_IN_SINGLE_STORY` 两类拒绝记录和
`partiallyDroppedArticles` 计数（只记账、不改行为）。所以"完全无任何记录"这个描述
**对已提交版本成立，对当前工作区不再成立**。本文后续建议都建在"留痕已有"之上。

---

## ② Q2：单例（singleton）事件该不该成 story

**结论先说：业界两派都有一手先例，且分歧点不是"要不要多源交叉验证"，而是"这个系统的产品目标是
情报覆盖还是编辑精选"。**

### 2.1 要求多篇的一派：Event Registry【设计主张，无实验】

**[Cross-lingual detection of world events from news articles](https://ceur-ws.org/Vol-1272/paper_19.pdf)**
（Leban, Fortuna, Brank, Grobelnik，Jožef Stefan Institute；CEUR Vol-1272 paper 19）

§3 原文（我读了 PDF 正文 p.2）：

> "An assumption that we make in identifying events is that any relevant event should be reported
> at least by a few different news publishers."
>
> "Each identified cluster of articles is considered to describe an event if it contains **at least
> a minimum number of articles (the minimum value used in our system is 5 articles)**."

**必须说清楚**：这是**明写的假设 + 一个拍下来的阈值，论文里没有任何实验去验证这个阈值**
（全文唯一的量化实验是跨语言簇合并的 SVM，85 个样本、10 折交叉验证 87% 准确率，与阈值无关）。
所以"业界都要求多源"这句话，在这篇里只能算 **precedent，不算 evidence**。

同一节还有一条对 Q4 极有价值的做法（见 ④）：
> "we want to reevaluate each cluster after a few updates in order to determine if it should be
> split into two clusters or merged with another cluster. In order to decide if the cluster should
> be split we apply a **bisecting k-means algorithm (with k = 2)** on the cluster. We then use a
> variant of the **Bayesian Information Criterion** to decide whether to accept the new split or not."

### 2.2 允许单篇的一派：流式故事识别【实验/数据】

**[Real-time News Story Identification](https://arxiv.org/html/2508.08272v1)**
（Škvorc, Ivačič, Hribar, Robnik-Šikonja，arXiv:2508.08272v1）

系统**显式允许单篇故事**，且数据分布上单篇是绝对多数：6,400 篇文章 → 4,028 个故事，其中
**3,199 个（约 79%）只有 1 篇文章**，2–10 篇的 789 个，10 篇以上 40 个（最大 134 篇）。
论文原话："A significant number of stories, therefore, contain only a small number of articles,
often as few as one article per story."

**没有最小源数要求**；噪声控制靠 **distance-based threshold 的 outlier 检测** +
要求文章指向具体的 events/places/people，而不是靠"够不够多家报道"。
时间约束是"a story contains articles from at most 10 days"（fading factor 实现）。

### 2.3 TDT 传统里，单例本来就是合法输出【实验】

- **[Streaming First Story Detection with application to Twitter](https://aclanthology.org/N10-1021.pdf)**
  （Petrović, Osborne, Lavrenko，NAACL 2010）§4：
  "for each tweet a we either assign it to an existing thread if its nearest neighbour is within
  distance t, or say that a is the first tweet in a new thread... **By changing t we can control
  the granularity of threads.**" 实验用 **t = 0.5**（t ∈ [0.5, 0.6] 结果基本一致）。
  → 新文档没有近邻时**就是开一个只有它自己的 thread**，单例是算法的正常输出，不是要被过滤的东西。
  TDT5 上最小归一化代价 C_min = 0.70（无界空间）/ 0.71（有界），UMass 基线 0.69；
  运行时间 **28 小时 → 2 小时**。
- **[Multilingual Clustering of Streaming News](https://ar5iv.labs.arxiv.org/html/1809.00540)**
  （Miranda et al., EMNLP 2018）：新文档与所有既有质心比相似度，
  "If the largest similarity exceeds a threshold τ for cluster index j, then we set C(d)=j"，
  否则**开新簇（即单例）**。单语 F1 英语 94.1 / 德语 97.1 / 西语 94.2。

### 2.4 决定性的一条：重要性可以在"报道量还没堆起来"之前判出来【实验】

**[Reuters Tracer: Toward Automated News Production Using Large Scale Social Media
Data](https://arxiv.org/pdf/1711.04068)** §VII-B（我读了 PDF 正文 p.7）：

> "Since newsworthiness scores are updated as clusters grow, we also checked their dynamic
> performance... **Before the event is reported by any news agency**, our algorithm can recognize
> news as partial news with **0.61 precision and recall**. But it does not perform as well in
> capturing news-only events at such an early stage (precision and recall are **0.58 and 0.52**)."

**这直接回答了我们的问题**：一个部署在路透生产环境的系统，在**簇只有 3 条推文、没有任何通讯社
报道**的时候，就已经能用内容特征把"值不值得报"判到 0.6 上下。
**"只有一家报道所以不重要"不是一个必须接受的推论。**

### 2.5 落到 `≥2 篇` 这条规则上

- **不要把 `≥2` 当作噪声防线** —— 上面三类系统防噪声用的是**距离阈值 + 实体/地点/时间的具体性**，
  不是数人头。我们已经有 `cluster_selection_epsilon`（现 0.35）这根旋钮，那才是对应物。
- **如果放开单例，代价是绝对量**：现在 44 篇噪声 + 352 篇未分配里会有一部分变成单例故事，
  下游 `maxStoriesToGenerate` 会被稀释。**这是排序问题，不是过滤问题**——
  Reuters Tracer 的做法正是"newsworthiness 当 **ranking task**"（§VII-B："the newsworthiness
  evaluation is considered as a ranking task"），而不是拿它当闸。
- **一手来源里没有任何一篇给出"min cluster size 阈值的 precision/recall 权衡曲线"**（见 ⑤）。
  Event Registry 的 5 和我们的 2 都是拍的。要动它，只能自己测。

---

## ③ Q3：重要性与报道量解耦（coverage volume ≠ importance）

### 3.1 有明确处理这个偏置的一手来源：Reuters Tracer【实验】

同上 §VII-B。要点：

- **三级 newsworthiness 标准**（路透记者定的）："(1) newsworthy - events with significant impact
  and global interests that can be reported by major news agencies like Reuters; (2) partially
  newsworthy - events with local impact that can be reported on local news media;
  (3) not newsworthy."
- **打分用的是内容特征，不是量**（§IV）：
  - **Scope/Impact**："the potential extent of an event's impact, including its magnitude (such as
    the scale of an earthquake), human impact (such as casualties or injuries) or
    financial/physical impact"，用 "a cardinal-extractor and a linear classifier"；
  - **Novelty**：靠时间表达式 + 与既有事件的相似度做"stale"过滤；
  - **Localization**：地理粒度按事件类型定（恐袭到城市，洪水可跨省）；
  - **Topic**：不同题材的 scope 语义不同（Entertainment/Sports 弹性大，Crisis/Law/Crime/Weather 有硬含义）。
- **实测数据**：400 个簇、2 名标注者，**weighted Kappa 0.68**；分布是 **11% news / 31% partial news**；
  排序质量 **NDCG 0.84**；分类操作点 news+partial **P 0.68 / R 0.66**，news-only **P 0.67 / R 0.59**。
- **作者点出的困难**（设计主张）："journalists can have different perceptions of the newsworthiness
  of the same event under different scenarios. For example, an explosion at New York is more
  newsworthy than a city in a war-torn area."

**对我们的直接映射**：我们 `storyValidation.ts` 的 d1–d4 rubric（strategic/spillover/human/novelty）
**已经是这一路**，而且 prompt 里明写了 "NOT by drama, **coverage volume**, or casualties alone"。
**所以我们的重要性建模没错，错的是它下游被一个按报道量的硬门（`≥2`）预先截断了。**
Tracer 的架构等价于：**先给所有簇打分，再按分数排序取头部**——闸在排序，不在人头。

### 3.2 把"被报道了没有"当标签会把偏置烙进模型【实验 + 作者自陈】

**[Tracking the Newsworthiness of Public Documents](https://ar5iv.labs.arxiv.org/html/2311.09734)**
（Spangher et al., arXiv:2311.09734）

任务：给定旧金山市议会的政策文件，预测记者会不会写它。数据：13,089 份政策（2013–2023）、
202,644 篇 SFChronicle 文章、3,400 小时会议录像转写。

- **覆盖极度稀疏**【实验】：13,089 份政策里只有 **1,105 份（7.8%）**得到过报道；
  10 年窗口里覆盖率稳定在 2–6%。
- **任务很难**【实验】：微调 GPT3-Babbage 在平衡测试集上 **25.1 F1**；
  **人类记者之间的一致性只有 63.2 F1**（即人类上限也不高）；
  但排序推荐可用——记者 **84%** 的情况下更偏好模型生成的清单而非随机样本。
- **作者自陈的偏置**：用"是否被报道"当 ground truth，捕获的是**这一家报纸的编辑决策**，
  不是普适的 newsworthiness；方法假设"past coverage patterns predict future patterns"。

**含义**：**任何"用报道量/是否被报道当监督信号"的重要性模型，都在复制已有的注意力分布。**
我们要的恰恰是纠正它，所以**不能**拿"这个故事有几篇报道"当重要性特征或标签——
这条正是 `≥2` 门槛在做的事。

### 3.3 salience vs prominence：一手证据说"数数是最弱的信号"【实验】

**[A New Entity Salience Task with Millions of Training
Examples](https://aclanthology.org/E14-4040.pdf)**（Dunietz & Gillick, EACL 2014）

定义：salience = "assigning a relevance score to each entity in a document"，
"salient entities are those that human readers deem most relevant to the document"（§1）。
金标构造：**假设摘要里提到的实体就是 salient**，把 NYT 语料的 abstract 与正文实体对齐
（110,639 篇文档 / 2,229,728 个标注实体，约 14% 为 salient）。

Table 3（测试集 salient 类的 P/R/F1）：

| 特征 | P | R | F1 |
|---|---|---|---|
| Positional baseline（首句提到即算 salient） | 59.5 | 37.8 | **46.2** |
| `head-count`（词频计数，传统 keyword 做法） | 37.3 | 54.7 | **44.4** |
| `mentions`（共指消解得到的提及计数） | 57.2 | 51.3 | **54.1** |
| `1st-loc` + head-count + mentions + headline + head-lex | 59.7 | 63.6 | 61.6 |
| + centrality（实体图 PageRank） | 60.5 | 63.5 | **62.0** |

- **"数数"是全场最弱的单特征**：`head-count` 的 F1 **44.4**，**低于什么都不学的首句基线 46.2**；
  换成结构化的共指提及数才 54.1。作者结论（§5）："features derived from a coreference system are
  more robust than simple word count features typical of a keyword extraction system."
- **这个任务本身就很主观**（Table 1）：两位专家标注者之间 **Cohen's κ = 0.56**（作者称 "moderate"，
  "a difficult, subjective task"）。
- centrality（PageRank）只带来 +0.4 F1，"small but statistically significant (p ≤ 0.001)"，
  作者自评 "entity centrality seems to add little information beyond what these features already provide"。

**适用性打折（重要）**：这是**文档内实体显著性**，不是**跨文档事件重要性**。
它能支持的是"**计数类特征在显著性判断上是弱信号，结构/位置/语义信号更强**"这个方向性结论，
**不能**直接当作"报道量与重要性无关"的证据。
另外 κ=0.56 提醒我们：**如果要给 story-validation 建重要性金标，人际一致性天花板不会高**，
别拿高 κ 当验收门（和 memory `article-quality-judge-eval` 里"真天花板 0.675"的教训一致）。

### 3.4 没找到的部分

**"报道量与编辑判断的重要性之间的相关系数"这个直接量化，没找到一手来源**（见 ⑤）。

---

## ④ Q4：如果"让 LLM 穷尽分配"本身是反模式，正确架构是什么

### 4.1 业界的边界划在哪里：几何做分配，LLM 做判定/命名

**BERTopic —— 最广泛使用的实现，LLM 从不碰成员归属**

- 论文（**设计主张**）：[BERTopic: Neural topic modeling with a class-based TF-IDF
  procedure](https://ar5iv.labs.arxiv.org/html/2203.05794)，三步 embedding → UMAP+HDBSCAN →
  c-TF-IDF；"separating the process of embedding documents from representing topics allows for
  significant flexibility"。
- 层级归并（[官方文档](https://maartengr.github.io/BERTopic/getting_started/hierarchicaltopics/hierarchicaltopics.html)）：
  对 c-TF-IDF 表示算余弦距离矩阵 + linkage（默认 ward）→ **整个切分/合并零 LLM 参与**。
- LLM 的位置（[官方文档](https://maartengr.github.io/BERTopic/getting_started/representation/llm.html)
  + [源码 `_openai.py`](https://raw.githubusercontent.com/MaartenGr/BERTopic/master/bertopic/representation/_openai.py)）：
  `nr_docs: int = 4`，主循环 `for topic, docs in repr_docs_mappings.items()` 内一次
  `client.chat.completions.create(...)` → **每个主题一次调用，输入是 4 篇代表文档，
  输出只是一个标签**。

**我们现在的做法越过了这条线**：把 100 篇整簇丢给 LLM 让它切分。
这和 memory `clustering-prune-overreach` 里"质心剪枝越权替 LLM 做甄别"是同一类边界错误、方向相反。

### 4.2 几何侧本来就有"再切细"的旋钮，而且我们没在用【官方文档，设计主张】

[hdbscan 官方参数选择文档](https://hdbscan.readthedocs.io/en/latest/parameter_selection.html)：

> "If you are more interested in having small homogeneous clusters then you may find **Excess of
> Mass has a tendency to pick one or two large clusters** and then a number of small extra
> clusters... a better option is to select **'leaf'** as a cluster selection method. This will
> select leaf nodes from the tree, **producing many small homogeneous clusters**."

我们 `services/meridian-ml-service/src/clustering.py:101` 现在是
`hdbscan_cluster_selection_method: str = 'eom'`。
[how_hdbscan_works](https://hdbscan.readthedocs.io/en/latest/how_hdbscan_works.html) 说明 EOM 的
取舍规则："If the sum of the stabilities of the child clusters is greater than the stability of the
cluster... otherwise we declare the cluster to be a selected cluster and **unselect all its
descendants**."

→ **那个 87 篇的"伞状糊"簇，在 condensed tree 里很可能本来就有子结构，只是被 EOM 丢弃了。**
我们现在是在用 LLM 重做 HDBSCAN 已经算过但被扔掉的那部分树。
**零新增 LLM 成本**。（注意：这是官方文档的设计说明，**不是**"leaf 一定更好"的实验证据；
我们上次把 eps 从 0.5 调到 0.35 时已经证明这条链路可测可验，同样的方法可以用来测 leaf。）

**同一招在生产新闻系统里的先例**：Event Registry 用 **bisecting k-means (k=2) + BIC** 定期决定
一个簇要不要劈开（§3，见 2.1 引文）——**用几何 + 模型选择准则做 split 判定，不问 LLM**。

### 4.3 逐篇分类（per-item classification）：穷尽性由构造保证【实验】

**[TopicGPT: A Prompt-based Topic Modeling Framework](https://ar5iv.labs.arxiv.org/html/2311.01449)**
（arXiv:2311.01449）
- 阶段 2 分配："We provide the LLM with our generated topic list, 2-3 examples, and a document"
  → **每篇文档一次调用**，输出含 topic label + **一句支持该分配的原文引用**。
- 精炼/合并：用 Sentence-Transformer 余弦 **≥0.5** 生成候选对，LLM 每次只判 5 对是否近重复
  → **候选由几何生成，LLM 只做二元判定**。
- 效果（Table 1）：Wiki refined P₁ 0.74 / ARI 0.60 / NMI 0.70（LDA 0.64/0.52/0.67）；
  人评主题错配 **30.3% vs LDA 62.4%**。
- 成本（论文实测，GPT-4 时代价格）：Bills 1,000 篇 = 生成 $30 + 精炼 $10 + 分配 $48 = **$88**。

**[ClusterFusion: Hybrid Clustering with Embedding Guidance and LLM
Adaptation](https://arxiv.org/html/2512.04350v1)**（arXiv:2512.04350）
- 三段式：**embedding-guided subset partition（KMeans 分 M=2K 组，均衡采样）→ 1 次 LLM 调用抽取 K 个
  topic → 每条记录 1 次 LLM 调用分配**（Algorithm 1；无效标签则重跑该次调用）。总调用 **N + 1**。
- 效果（Table 2–3）：Bank77 ACC 68.3 / NMI 81.4；CLINC ACC 87.3 / NMI 93.5；Tweet ACC 87.1。
- **消融最关键的一条**：给定 oracle topics 的 "assignment only" 达 **88.8–92.3 ACC**
  → **逐条分配这一步本身很准，瓶颈在 topic 抽取**。
- 成本：Figure 4，OpenAI Codex 数据集（406 条）"63.8% improvement with **less than $0.02** total
  cost increase"。

**[LITA: An Efficient LLM-assisted Iterative Topic Augmentation
Framework](https://arxiv.org/html/2412.12459v1)**（arXiv:2412.12459）——只问"边界样本"
- 判定 ambiguous 的规则：`|δ(d,μ_i1) − δ(d,μ_i2)| ≤ ε`（到最近两个质心的余弦距离之差，ε=0.1）。
- 【实验】20 Newsgroups 7,532 篇里只有 **1,325 篇**要问 LLM（约 18%）；
  CLINC(D) 4,500 篇里只有 **487 篇**（约 11%）。相比 PromptTopic 的"每篇都问"，API 调用降 **>80%**。
- ⚠️ 作者**没有**做"全量问 LLM vs 只问边界"的效果对照实验，"全量不可行"是**设计主张**。

**[Large Language Models Enable Few-Shot Clustering](https://ar5iv.labs.arxiv.org/html/2307.00524)**
（TACL）——三种用法的性价比【实验，Table 5】
- 关键短语扩展（聚类前）最便宜收益最大：OPIEC59k Macro F1 **80.0**（基线 53.5），成本 $2.24；
- 成对约束（PCKMeans）最贵：约 **20,000 次**查询 / $10–42，且 §5.5 明说
  "unless at least 2500 pairs labeled by a true oracle are provided, pairwise constraint KMeans
  fails to deliver any value"；
- **低置信点后校正**（聚类后，只问低置信点"要不要改挂到 top-5 最近簇之一"）成本 $3.38–12.73
  → **这是三者里最适合我们移植的一种**。

**[ClusterLLM](https://ar5iv.labs.arxiv.org/html/2305.14871)**（EMNLP 2023）：LLM 只当三元组/成对
预言机，分配始终由 embedder + KMeans/层次聚类完成；1,024 次查询 ≈ $0.60。
⚠️ 作者说"不能直接让 LLM 聚类"的理由是 **"the inaccessible embeddings"（拿不到 embedding 的工程
约束）**，**不是**"LLM 切分不准"的实验结论——引用时别偷换。
且它的收益依赖**微调 embedder**，我们在 Workers / ml-service 上做不了。

### 4.4 滑窗 / setwise：把"生成完整列表"换成"每次做一个小判断"【实验】

**[A Setwise Approach for Effective and Highly Efficient Zero-shot Ranking with
LLMs](https://ar5iv.labs.arxiv.org/html/2310.09497)**（SIGIR 2024）Table 2（TREC DL 2019, Flan-t5-large）：

| 方法 | NDCG@10 | 推理次数 | prompt tokens | 延迟 |
|---|---|---|---|---|
| Listwise Generation | .561 | 245 | 119,120.8 | **54.2s** |
| Pointwise QLM | .557 | 100 | 15,211.6 | 0.6s |
| Setwise Heapsort | **.670** | 125.4 | 40,460.6 | 8.0s |

作者对 listwise 的批评：**"The LLM may generate results in an unexpected format or even decline to
generate the desired document label list."** Setwise 的修法是**从 logits 读排名，不要求模型把完整
列表生成出来**。→ listwise（= 我们现在的形态）**效果不赢、token ×8、延迟 ×90，还背上输出完整性风险**。

**[RankGPT / Is ChatGPT Good at Search?](https://ar5iv.labs.arxiv.org/html/2304.09542)**：
"**Since ChatGPT cannot manage 100 passages at a time, we use the sliding window strategy**"，
窗口 **w=20、步长 s=10**。⚠️ 作者归因于 token 限制（**设计主张**）；Table 12 的超参对比里
w ∈ {20,40,60,80} **w=20 最好（nDCG@10 67.05）**，算弱实验证据。
→ 换算到我们：100 个成员按 RankGPT 规格是 **9–10 次窗口调用**，不是 1 次。

### 4.5 更彻底的一条路：流式质心匹配，直接消灭"批量切分"这个动作

见 2.3 的 Petrović（NAACL 2010，常数时间/空间，TDT5 C_min 0.70）与 Miranda（EMNLP 2018，
τ 阈值 + 72 小时高斯时效特征，单语 F1 94.1）。
中文生产先例：**[Growing Story Forest Online from Massive Breaking
News](https://ar5iv.labs.arxiv.org/html/1803.00189)**（CIKM'17，腾讯 QQ 浏览器）——
两层聚类（先对**关键词共现图**做社区发现，再在社区内建文档图做社区发现），
在线增量 merge/extend/insert；**日均 164,922 篇中文新闻，MacBook Pro 上每天数据 26 秒处理完**；
事件聚类 homogeneity 0.96 / V-measure 0.962，故事树正确边 82.8%。

**对我们**：需要持久化故事质心（Postgres 或 DO 都放得下，向量很小），Workers 无状态不是障碍。
收益是彻底不用"一次切分 100 篇"，顺带解决跨日故事连续性。**但这是架构改造，不是一个 patch。**

---

## ⑤ 明确"没找到"的部分

1. **没有任何一手来源专门测过"LLM 一次性切分 ~100 篇新闻文章"的质量。** 最接近的是
   arXiv:2603.22608（n≈100 起明显下滑，但任务是精确计数聚合）和 RankGPT（作者直接说 100 篇做不到，
   改滑窗，但没给退化曲线）。我们观测到的 4–30% 提及率，文献里没有对应基准数字。
2. **"在 JSON schema 里加显式 `unassigned` 桶 / 要求计数求和 = N，能提升覆盖率"——没找到量化一手证据。**
   2408.02442 测的是格式约束对**准确率**的影响，不是对**完整性**的影响。这条只能自己做 A/B。
3. **"强制 every-item-must-be-assigned 会带来多少强行错配"——没找到直接实验。**
   只有间接证据：L3X 的 precision 9–10%（recall-first 的代价）和 Attention Overflow 的 repetition rate。
4. **min-cluster-size / min-source-count 阈值的 precision-recall 权衡曲线——没找到。**
   Event Registry 的"5"是拍的（无实验），我们的"2"也是。
5. **"报道量与编辑判断的重要性之间的相关性"的直接量化——没找到。**
   最接近的是 arXiv:2311.09734，它给的是"用被报道当标签会烙进单一媒体的编辑偏好"这个**定性论证 +
   作者自陈**，以及"只有 7.8% 的政策被报道过"这个覆盖稀疏度，不是相关系数。
6. **中英混合对上述退化的影响——没找到。** arXiv:2603.22608 自陈 "our experiments are
   English-centric"；Story Forest 是中文系统但不涉及 LLM。
7. **listwise 输出"漏项"的定量统计——大部分没找到。** 唯一有量化的是 arXiv:2603.22608 §5.2
   （171/4,620 个实验出现"只做前几条"，几乎全在 n≥500）和 Attention Overflow 的 repetition 曲线。
8. **"多文档摘要覆盖率随输入文档数增长而下降"的定量曲线——没找到**
   （arXiv:2310.10570 只给了位置偏置，没给随 k 增长的覆盖率曲线）。

---

## ⑥ 落到 Meridian 的建议（按性价比排序，均需自测验证）

> 以下是**基于上述一手来源的推论**，不是文献结论本身。项目暂无 story-validation 的 eval harness
> （memory `eval-program-landscape` / ADR 0002 已记："story-validation 连 meta 都还没建"），
> 所以任何一条落地前都要先有能测"覆盖率 + 甄别质量"的尺，否则又是拍脑袋。

1. **【零 LLM 成本，最该先做】把大簇的切分交还给几何。**
   对超过阈值（比如 >30 篇）的簇单独重跑一次 HDBSCAN，用 `cluster_selection_method='leaf'`
   或更小的 `cluster_selection_epsilon`，或按 Event Registry 的 bisecting k-means (k=2) + BIC 做
   split 判定。依据：hdbscan 官方文档（4.2）+ BERTopic 源码的职责边界（4.1）+ Event Registry §3（2.1）。
   预期：簇数从 ~95 涨到 ~130–150，单簇规模落回 LLM 的舒适区，`collection_of_stories` 分支使用率下降。
2. **【O(n) 但很便宜】把"整簇切分"换成"逐篇独立分类"。**
   先由几何/一次 LLM 调用定出候选故事表，再对每篇文章单独问"属于哪个 / NONE"，
   并按 TopicGPT 的做法**要求给出支持该归属的原文片段**（可直接接现有 extract-compare 通道做程序化核验）。
   依据：ClusterFusion 的 assignment-only 消融 88.8–92.3 ACC（4.3）+ 2408.02442 "分类任务上格式约束
   反而 +18.7pp"（1.2）。穷尽性**由构造保证**，不再依赖模型自觉。
   成本估算（本文自算）：只对残余 352 篇做 ≈ +$0.02/天；全量 967 篇 ≈ +$0.03–0.06/天。
   **真正的约束是 Workflow step 的墙钟**（该 step 刚从 10 分钟提到 25 分钟，commit `01ddd16`），
   并发 6 时全量约 +8 分钟、只做残余约 +3 分钟 —— 这才是要卡的预算。
3. **【最小改动】残余集合再问一轮 + 留痕。**
   程序化算出未被任何子故事覆盖的成员，只把这批再喂一轮，循环到不动点或 2 轮封顶。
   依据：LongSumEval 的覆盖反馈回路（1.4），注意它测到的 consistency −5.9% 代价，
   **补进来的成分要单独打标，别和第一轮的混在一起**。
4. **【别单独做】只在 prompt 里加"必须穷尽分配"。** 根因是条目数容量（1.1），指令治不了；
   而且硬格式约束在推理型任务上有 −26~−63pp 的实测代价（1.2）。
5. **【单例问题】把 `≥2` 从「闸」改成「排序特征」。**
   依据：Reuters Tracer 把 newsworthiness 当 ranking task 且能在报道量堆起来之前判出来（2.4）；
   Spangher et al. 证明"用被报道当信号"会复制既有注意力分布（3.2）；
   Dunietz & Gillick 证明计数是显著性判断里最弱的特征（3.3）。
   噪声控制交给距离阈值 + 具体性要求（2.2/2.3），而不是数人头。
   **注意这会和 `maxStoriesToGenerate=15` 的瓶颈叠加**（memory `source-pool-dead-feeds`），
   两者要一起看。
