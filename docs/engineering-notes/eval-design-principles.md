# Meridian Eval 设计理念

> 本项目所有质量评估(faithfulness、聚类质量等)遵循的共同设计原则。
> 写给"要新增一个 eval"或"看不懂现有 eval 为什么这么设计"的人。
> 现有实现:`scripts/eval/faithfulness/`、`scripts/eval/clustering/`。

---

## 第一原则:绝不直接相信 LLM 吐的分数

LLM 给的 0–1 分(置信度、质量分、相关性分)**没有校准、是噪声**——同一输入不同次、
不同措辞会得到不同分,且无法对齐人类标准。所以:

> **不要让 LLM 给分。要么用确定性指标,要么逼 LLM 给"可机器验证的证据"。**

这条衍生出下面两种 eval 模式。

---

## 模式 A:确定性指标 vs 参考划分(用于聚类质量)

**适用**:能定义"标准答案"的结构化任务(分组、分类、排序)。

**做法**:
1. 用**强模型一次性**产一份"参考"(gold),例如 qwen-max 把当天文章分成故事。
2. 之后用**纯确定性指标**给任意候选输出打分,**全程不再用 LLM**。

**例:B-cubed**(`scripts/eval/clustering/metrics.ts`)——逐篇算,再平均:
- `precision_i` = (与 i 同预测簇 **且** 同参考组的数) / (i 所在预测簇的数) → **低=conflation**
- `recall_i` = 同分子 / (i 所在参考组的数) → **低=fragmentation**
- 纯集合运算,确定性、可复现。

**为什么这样分工**:把"昂贵且不稳的判断"(产参考)做**一次**,把"打分"做**无数次**
(确定性)。这样 grid-search / A-B 对比都便宜,且每次打分结果一致。

> 但"产一次参考"本身就不稳(LLM 跨重产抖动 13~49 组)。如何**可靠地**造这份 gold
> (多采样 + consensus + 人工兜底 + 冻结)的完整工作流,见
> [clustering-gold-construction.md](./clustering-gold-construction.md)。

---

## 模式 B:LLM-as-judge + 强制证据 + 确定性校验(用于忠实度)

**适用**:没有唯一标准答案、但能"对着源材料核验"的任务(简报有没有编造)。

**做法**(`scripts/eval/faithfulness/`):
1. 抽出原子 claim,并分类(factual / analytical)。
2. judge 判一条 claim 支不支持时,**必须从源材料里摘一段逐字引用**当依据。
3. **代码做子串校验**:引用必须真的出现在源里才算数(`verified`)——judge 不能空口说"支持"。
4. **出分类不出分数**:SUPPORTED / UNSUPPORTED / CONTRADICTED。
5. 聚合成可解释的指标(如 `factual_faithfulness = supported / 总 factual`)+ gate。

**核心**:LLM 只负责"找出处",**真假由确定性校验定**。把对 LLM 的信任压到最低。

**已知改进点**:精确子串校验过脆(引用被截断/改写 → 假阴性,误判 UNSUPPORTED)。
应归一化空白 + 容忍截断/模糊匹配,既减假阴性又保留"必须有可验证出处"的防作弊属性。

---

## 第二原则:校验要一路追到"地面真值",忠实性不可传递

链式管道里每一层都把**上一层的输出**当真值。但"层N 忠于 层N-1" + "层N-1 忠于 层N-2"
**推不出"层N 忠于源"**——每跳都能掉一点,漂移会累积。

> **必须至少有一条校验一路追到最底层的真值(原始文章),而不是只回退一跳。**

当前缺口:faithsfulness 只查 **"简报 ⊂ 情报输入"**,默认情报报告是对的。
该补 **`intel_vs_articles`**(情报 ⊂ 原文),同套"强制逐字引用 + 子串校验"。

---

## 第三原则:先校准 judge / 参考本身,再信它的数字

LLM 产的参考/判定也会错。用数字下结论前:
- **人工抽样校准**(10% 人工):比对 LLM 参考 vs 人工标注,确认一致性可接受。
- judge 用**更强、且与被评对象不同**的模型(避免"自己评自己")。
- 参考用**不同的方法**产(如评 UMAP+HDBSCAN 时,参考用"扁平分组",方法不同才算外部标准)。

> 实测教训:某次聚类 eval 参考是 91 故事/97 篇(几乎全单例),
> 一查是源稀疏导致的真实形态——**先确认样本/参考可信,再读指标**。

---

## 第四原则:评估指标必须对齐业务语义,不是数学便利

无监督内置指标(DBCV、silhouette)优化的是**几何**(簇致密/分得开),不是**业务语义**
(一簇=一个故事)。两者相关但不等价。

> 实测:按 DBCV 自动调聚类,反而把无关主题揉成 2 个巨簇(几何分翻倍、语义更烂)。
> **别拿几何指标当调参目标**;要的是语义指标(B-cubed vs 语义参考)。详见
> `llm-pipeline-pitfalls.md` §16。

---

## 实操约定

- **指标组合(目标 60/30/10)**:60% 确定性(集合运算/子串校验/schema 校验) +
  30% LLM-judge(强制证据) + 10% 人工(校准/抽查)。**绝不只靠 LLM-judge。**
- **看回归,不看绝对阈值**:先给当前 prod 打基线分,新改动"比基线好"才算赢,
  而不是定一个拍脑袋的绝对门槛。
- **版本化**:报告里记 judge 模型 + prompt hash + dataset id,结果可追溯、可复现。
- **缓存昂贵步骤**:LLM 产的参考按 workflow_id 缓存,重复评估/对比算法时复用。
- **框架选择**:不引入 promptfoo/DeepEval 等(它们是"一行=一样本"的 prompt eval,
  不适合 corpus 级指标如 B-cubed);沿用仓库 bespoke TS 模式,fetch / judge / score 分层。

---

## 业界对照与借鉴(2026 调研)

**我们的 faithfulness ≈ 业界标准**:RAGAS / FActScore 都是"把输出拆成 claim → 逐条
验证是否被源支持 → 支持比例"。我们独立做到了同一模式,且**多加了强制逐字引用 +
子串校验**——比 vanilla RAGAS 更严(RAGAS 的"支持"判定本身也可能是 LLM 幻觉)。

**值得借鉴的具体技巧**:
1. **NLI / 小模型做忠实度**(`AlignScore` / `SummaC`):小 NLI 交叉编码器判"源是否蕴含
   这条 claim",便宜、快、确定性。→ NLI 当大头,LLM-judge 只判边界 case(落实 60/30 配比、省钱)。
2. **few-shot 人工样例进 judge**(`FaithJudge`):judge prompt 里塞一小撮人工标注的
   支持/编造对照例,准确率明显提升。
3. **RAGAS contextual precision/recall**:评"喂给 brief 的料(情报输入)相不相关/全不全",
   补我们一直缺的 intel 层视角。
4. **公开 benchmark 校准**:`RAGTruth` / `FaithBench` / `TofuEval` / `AggreFact` 带人工标注,
   拿来测我们 judge 的真实准确率。

**清醒认知**:benchmark 显示即便 SOTA 幻觉检测器在难数据集上也仅 ~50–70% 准确率。
→ faithfulness 分**当相对信号(看回归/AB),不当绝对裁决**;多检查集成 + 人工抽样,别单点依赖。

**框架取舍**:借方法,不照搬。RAGAS/DeepEval 成熟但是 Python、不做我们的 B-cubed 聚类 /
`intel_vs_articles` 溯源 / 子串校验那层严谨。如需 battle-tested 实现,可把 faithfulness
这一层用 DeepEval/RAGAS 当 Python sidecar,其余留 TS。

---

## Eval 演进 Roadmap(按优先级)

> 这是支撑[源覆盖主线](见 llm-pipeline-pitfalls.md §15)的**度量基建**:
> 让"源/算法改动后质量有没有变好"可量化、可归因。

| 优先级 | 事项 | 为什么 / 解锁什么 | 成本 |
|---|---|---|---|
| **P0** | **在 500 篇富样本上跑 B-cubed**(修 reference 的 502:prompt 瘦身或换 qwen-long) | 终于有 29 个真·多源故事的好样本,拿到**故事形成质量**第一个真实数字(之前全单例测不出) | 低 |
| **P1** | **修 faithfulness 子串校验脆性 + 加 few-shot 校准** | 现有 faithsfulness 数字有假阴性(引用截断→误判 UNSUPPORTED),修完数字才可信 | 低 |
| **P2** | **加 NLI/SLM 忠实度层**(AlignScore/SummaC 式) | 成本最优:确定性大头 + LLM 只兜边界;呼应"能 SLM 不 LLM" | 中 |
| **P3** | **补 `intel_vs_articles` 溯源层** | 闭合"忠实性不可传递"缺口——查情报分析忠不忠于原文(现仅查 brief⊂intel) | 中 |
| **P4** | **拿 RAGTruth/FaithBench + 小人工集校准所有 judge** | 知道每个 judge 的真实准确率,才敢用它的数字下结论 | 中(持续) |
| **P5** | **contextual precision/recall 评情报输入 + 多检查集成** | 覆盖更全的质量维度;集成降低单 judge 噪声 | 中 |

**依赖关系**:P0 现在就能独立做;P1 解锁"信任 faithfulness 数字";P2/P3 在 faithfulness
基础上扩展;P4 校验所有 judge 的可信度;P5 是后续丰富。

---

## 一句话

**把不可靠的环节(LLM 判断)压到最小且强制其产出可机器验证的证据,其余用确定性逻辑;
并确保至少一条校验追到原始文章。** 这样数字才可信、可复现、可归因。
