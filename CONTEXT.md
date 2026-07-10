# Meridian

新闻聚合系统的领域词汇表(术语与其精确含义)。实现细节不进本文件——见代码与 `docs/`。

## Eval / 判官

**判官 (Judge)**:
一个 LLM,对每个待测条目吐一个分类标签(如 supported/unsupported/contradicted),用来自动评判管线某一环的质量。
_Avoid_: 评委、打分器、scorer(scorer 指机械指标计算,不是 LLM)

**检测型判官 (Detection-judge / 桶①)**:
"对每个条目做一个分类/取舍判断"这一族 eval harness——`intel-grounding`、`faithfulness`、`article-quality`、`coverage-judge`。与之并列的另三种问题形式各用各的指标族:**聚类**(B-cubed)、**排序**(NDCG)、**生成**(含错率/漏报率)。只有检测型判官共用召回/精确率那套指标。

**把握分 (Confidence score)**:
判官对单条判决"有几成确定"的量。**Meridian 的约定:把握分 = 投票占比(N 票里判某类的票数 k/N),不采信 LLM 自报的置信度**(后者业界公认不可靠)。
_Avoid_: 自报置信度、self-reported confidence(明确排除)

**操作点 (Operating point)**:
判官在"抓得多(召回)"与"误拦少(精确率/FPR)"之间选定的一个平衡位置。硬标签判官只有一个操作点;要一条曲线需可拧的把握分。

**误拦 (False flag / over-block)**:
把本来合格的条目判成有问题(幻觉/低质/该拦)。精确率低 = 误拦多。作为运行时门时,误拦 = 冤枉压住合格产出。
_Avoid_: 误报(口语可,正式用"误拦"统一)
