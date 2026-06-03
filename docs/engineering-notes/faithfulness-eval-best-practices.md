# 忠实度评测最佳实践 —— 业界调研 + 对现有 harness 的批判与改造建议

> 本文围绕一个具体问题:Meridian 把聚类后的"情报报告"合成新闻 brief,我们要评测
> **brief 的忠实度(faithfulness / groundedness)**——brief 里的事实性陈述是否都有
> source(情报报告)支撑,尤其要抓"添油加醋"(source 里没有、却被当作有据呈现的具名
> 事实,例如凭空写出"已与德/奥/荷 5 国谈判")。
>
> **核心痛点**:现有 harness 在 `judge.ts` 里有一个 **verbatim-quote-verification** 步骤
> ——要求 judge 引用 source 逐字原文,字符串匹配不上就把 `supported` 降级为
> `unsupported`。这制造了大量假阴性,把 `factual_faithfulness` 系统性压低(实测 0.652,
> 真实更高),导致尺子不可信,无法干净区分"真脑补"和"工具噪音"。
>
> 我们的任务类型是 **summarization-faithfulness**(对 source 的忠实),**不是**
> QA-RAG 的 factuality(对世界的正确性)。下文凡引用外部方法都会说明这一差异下的适用性。

---

## ① 摘要结论:我们该用什么方法

一句话:**把 judge 从"逐字取证(verbatim quote)"改成"自然语言蕴含(NLI/entailment)判定",
保留 LLM-as-judge 但删掉字符串匹配的硬降级,并补一个 meta-eval(对一小批人工标注金标)
来证明尺子本身可信。**

具体落地优先级:

1. **【必做,根因修复】删除 `verifyEvidence` 的硬降级逻辑**(`judge.ts:49-56, 84`)。
   verbatim 子串匹配对"摘要/改写/抽象"必然失败,是假阴性的直接来源。改为:judge 输出
   仍可带证据,但证据**不要求逐字**,可以是 source 的句子级 span/句子编号;`verified`
   只作为附加信号供人工复核,**绝不再用它覆盖 `verdict`**。

2. **【必做】把判定范式改成 entailment 三分类**(entailed / neutral / contradicted),
   对齐 RAGAS / SummaC / FactCC 的主流做法。"supported"= source **蕴含**该 claim(允许
   改写、归纳、跨句聚合),而非"source 里有这句话"。

3. **【强烈建议】claim 抽取走 FActScore 式原子化**,粒度细到"一个 claim 一个可验证信息单元",
   尤其把"已与德/奥/荷 5 国谈判"这种**复合具名事实拆成可单独验证的原子**,这样脑补的
   那一颗才会被单独标红,而不是被同句的真事实稀释。

4. **【强烈建议】引入一个独立的 NLI/grounding 模型做交叉验证(可选第二尺子)**:
   MiniCheck-FT5(770M)/ Bespoke-MiniCheck 或 AlignScore,作为 LLM-judge 之外的
   second opinion;两把尺子分歧的样本进人工复核队列。注意我们跑在 Cloudflare,本地
   小模型部署有成本,**可作为离线 batch 评测而非运行时**。

5. **【必做】meta-eval 验证尺子**:人工标注 ~30-50 条 claim 金标(supported/unsupported/
   contradicted),算 judge 与人工的一致性(Cohen's κ / balanced accuracy)。**尺子没被
   验证过,分数就不可信**——这正是当前 0.652 不可信的本质。

6. **【建议】区分两道闸**:
   - **离线 eval(尺子/回归)**:可容忍噪声,关注趋势与相对比较,不 fail-closed。
   - **运行时 fail-closed guardrail**:只拦"会塌房"的硬错——**矛盾(contradiction)**
     和**具名实体脑补**(出现 source 完全没有的国家/公司/数字),命中则 brief 不发布或
     降级。这一道要保守、可解释、低假阳性。

---

## ② 业界/学术方法全景(带出处)

### 2.1 忠实度 / groundedness 指标与框架

| 方法 | 核心思路 | 适用性(对我们) | 出处 |
|---|---|---|---|
| **RAGAS faithfulness** | LLM 把回答分解成 statements/claims,逐条判定"能否由 context 推断(inferred)",分数 = 被支撑 claim 数 / 总 claim 数。注意它用的是 **infer/entail** 而非逐字匹配 | **高度契合**。我们的"factual_faithfulness = supported/factual"就是这个公式;差别在我们多加了 verbatim 硬降级——RAGAS 没有 | [RAGAS docs](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/) |
| **RAGAS FaithfulnessWithHHEM** | 用 Vectara HHEM-2.1 这种专用幻觉检测分类器替换 LLM 的验证步骤 | 可作为第二尺子的现成思路 | 同上 |
| **FActScore** | 长文本拆成 **atomic facts**(每条只含一个信息单元),逐条二分类是否被知识源支撑,取支撑比例;自动版误差 <2% | **claim 抽取层直接借鉴**:原子化粒度是抓"添油加醋"的关键 | [arXiv 2305.14251](https://arxiv.org/abs/2305.14251) / [ACL](https://aclanthology.org/2023.emnlp-main.741/) |
| **SummaC** | 重新启用 NLI 做摘要一致性检测;关键洞见:NLI 数据是**句子级**,而一致性判定是**文档级**——要把 doc 切成句子两两算 entailment 再聚合(SummaCConv) | **直接相关**——我们正是 summarization-faithfulness;说明"为什么句子级证据比逐字更对" | [arXiv 2111.09525](https://arxiv.org/abs/2111.09525) / [TACL](https://aclanthology.org/2022.tacl-1.10.pdf) |
| **QAGS / QuestEval** | 基于问答:从摘要生成问题,在源文档上答,答案不一致即不忠实;QuestEval 双向(摘要↔文档)兼顾 precision/recall | 思路可借鉴但工程重(要 QG+QA 两个模型),对我们偏重 | [SummaC 论文内对比](https://arxiv.org/abs/2111.09525) |
| **AlignScore** | 训练一个统一的"信息对齐"函数(整合 NLI/QA/paraphrase/fact-verify/summarization 等 7 类任务 4.7M 样本),用一个模型覆盖多种不一致场景;匹配甚至超过 GPT-4 级指标 | **强候选的离线第二尺子**:一个模型、不挑任务、开源 | [arXiv 2305.16739](https://arxiv.org/abs/2305.16739) / [GitHub](https://github.com/yuh-zha/AlignScore) |
| **MiniCheck / Bespoke-MiniCheck** | 把"grounded factuality"建模为 NLI;用 GPT-4 造合成训练数据微调小模型;MiniCheck-FT5(770M)达 GPT-4 精度但成本低 400×;配套 LLM-AggreFact benchmark | **最佳性价比第二尺子**:小、快、专为"输出能否被 grounding 文档支撑"设计,正中我们靶心 | [arXiv 2404.10774](https://arxiv.org/abs/2404.10774) / [GitHub](https://github.com/Liyan06/MiniCheck) |
| **FactCC** | BERT 蕴含分类器,合成"实体/数字替换、否定、代词替换"等扰动训练;专为摘要事实一致性 | 经典基线,说明 NLI > 字符串匹配的来历 | [GitHub](https://github.com/salesforce/factCC) |
| **TRUE / AIS** | AIS = Attributable to Identified Sources,把"可归因于指定来源"形式化为标注协议(每条陈述能否归因到给定 source);TRUE 把多个一致性数据集统一成 benchmark | **概念框架**:我们要的正是 AIS——"对 source 可归因",而非"对世界正确" | AIS 概念见 [RAGTruth](https://aclanthology.org/2024.acl-long.585/) 等综述引用(TRUE 原文 **待核实**) |
| **RAGTruth** | ~18k 条 RAG 生成响应的**词级(span-level)**幻觉人工标注语料;response 级一致性 91.8%,span 级 78.8% | 做 meta-eval / 训练检测器的数据范式参考;说明 span 级标注难度 | [arXiv 2401.00396](https://arxiv.org/abs/2401.00396) / [ACL](https://aclanthology.org/2024.acl-long.585/) / [GitHub](https://github.com/ParticleMedia/RAGTruth) |
| **FELM** | 对 LLM 输出做细粒度 factuality 标注的 benchmark(含错误 span 与类型) | meta-eval 参考(细节 **待核实**) | 见 [awesome-hallucination-detection](https://github.com/EdinburghNLP/awesome-hallucination-detection) |

### 2.2 Claim decomposition(原子化抽取)最佳实践

- **粒度**:FActScore 主张 atomic fact = 一句话只含一个可验证信息单元。复合句必拆。
  对我们"已与德/奥/荷 5 国谈判"这类,理想拆法是把"谈判这件事"和"涉及哪几国/几国"
  作为可单独验证的单元——只要这样,脑补的"5 国"才能被单独判 unsupported,不被同句真事实掩盖。
- **可验证性 / decontextualization**:抽出的 claim 要能脱离原文独立判定,需做指代消解
  (把"它/该公司"还原成具名实体),否则 judge 无法判。这是 FActScore/AIS 标注的标准前置步骤。
- **已知风险**:RAGAS 文档与多篇博客都指出 **decomposition 是关键依赖**——漏抽/过度拆分
  会让下游 NLI 与最终分数漂移。所以抽取 prompt 要稳、要可复现(temperature=0),并最好
  抽样人工核对抽取质量。

来源:[FActScore](https://arxiv.org/abs/2305.14251)、[RAGAS faithfulness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/)。

### 2.3 LLM-as-judge 的陷阱与校准

已被反复记录的偏差(对我们的取舍见括注):

- **position bias**:成对比较里偏向某个位置——我们是**单条 claim 二/三分类,非成对**,
  此偏差影响小。
- **verbosity bias**:偏好更长输出——我们让 judge 输出结构化 verdict,影响小。
- **self-enhancement bias**:judge 偏袒"自己"产出的文本。**我们要警惕**:brief 由
  qwen-long 写,judge 也用 qwen-max(同家族),存在自偏护短风险 → meta-eval 必须查这条。
- **calibration drift / 过度自信**:judge 常对不可靠判断也给高置信,标量打分鼓励虚假精度。
- **meta-eval 是底线**:必须用人工金标基准 judge 的准确率、测与人工专家的一致性
  (κ / balanced accuracy)。**没做 meta-eval 的尺子不可信**。

来源:[Justice or Prejudice? Quantifying Biases in LLM-as-a-Judge](https://llm-judge-bias.github.io/)、
[Evidently:LLM-as-a-judge 指南](https://www.evidentlyai.com/llm-guide/llm-as-a-judge)、
[Deepchecks:judge calibration](https://deepchecks.com/llm-judge-calibration-automated-issues/)。

### 2.4 如何做归因/支撑判定而非逐字引用(本案核心)

主流共识:**用语义蕴含(entailment/NLI),不用字符串匹配**。

- 摘要本质是改写/抽象,正确摘要是**被源语义蕴含**而非源的子串;字符串匹配在改写场景
  必然产生假阴性([entailment as eval metric](https://www.sciencedirect.com/science/article/pii/S2949719123000250))。
- FactCC 等用 BERT 蕴含分类器替代逐字匹配,正是为解决这个问题([FactCC](https://github.com/salesforce/factCC))。
- 有报告称:**先把回答拆成 atomic claim 再跑 NLI,比句子级基线 F1 高 12-18 分**——
  原子化 + 蕴含是当前最稳的组合(见 §2.1 检索摘要)。
- SummaC 的洞见:NLI 训练数据是句子级,判定要在**句子粒度**上做再聚合,而不是要求
  整段逐字对齐([SummaC](https://arxiv.org/abs/2111.09525))。
- Anthropic 的 guardrail 指南确实建议"让模型为每条 claim 找一句支撑 quote,找不到就撤回"
  ——**但那是让模型自我检查的生成期策略,quote 是给人看的审计线索,不是用程序做精确
  子串匹配的硬门**。我们误把"审计线索"当成了"硬判据"。

### 2.5 分数聚合、阈值、gating;离线 eval vs 运行时 fail-closed

- **聚合**:RAGAS 式 supported/total 比例是标准做法(我们已是)。但应**分层报告**:
  整体比例 + 按 claim 类型(具名事实 vs 泛述)+ 把 contradiction 单列(它比 unsupported 严重)。
- **阈值**:阈值应由 **meta-eval 标定**,而不是拍脑袋。先用金标确定 judge 在哪个分数段
  与人工一致,再据此设 gate;否则阈值建在不可信的尺子上无意义。
- **离线 eval ≠ 运行时 guardrail**(业界明确区分):
  - 离线:回归 / 趋势 / 模型对比,容忍噪声,**不应 fail-closed**(否则工具噪声会误伤)。
  - 运行时:evidence-first 生成 + 强制引用 + 允许 abstain + claim-to-evidence 映射,
    命中硬错则**拦截 / 降级 / 转人工**。可达 40-96% 幻觉削减(视栈而定)。
- **fail-closed 只拦硬错**:contradiction、source 完全没有的具名实体/数字。
  软信号(unsupported 的泛述)进观测与人工队列,不阻断发布。

来源:[KDnuggets:7 ways to reduce hallucinations](https://www.kdnuggets.com/7-ways-to-reduce-hallucinations-in-production-llms)、
[RAG grounding tests](https://medium.com/@Nexumo_/rag-grounding-11-tests-that-expose-fake-citations-30d84140831a)、
[Galileo:hallucination detection tools](https://galileo.ai/blog/best-hallucination-detection-tools-llm)。

### 2.6 忠实度(对 source) vs 事实正确性(对世界)

- **faithfulness/groundedness**:输出是否忠于**给定输入**(source/情报报告)。**我们要的是这个。**
- **factuality**:输出是否符合**真实世界知识**。需要外部知识库,**不在本评测范围**。
- 经典区分:摘要可以"不忠实但事实正确"(用了背景知识但源里没有),也可以"忠实但事实错误"
  (源本身就错)。我们抓的是前一种里的"添油加醋"——**源里没有就算脑补,哪怕它碰巧是真的**。
- intrinsic(改动源内信息→矛盾) vs extrinsic(加入源无法验证的信息→无据)幻觉的区分,
  正好映射我们的 `contradicted` vs `unsupported`。

来源:[On Faithfulness and Factuality in Abstractive Summarization (ACL 2020)](https://aclanthology.org/2020.acl-main.173.pdf)、
[Survey of Hallucination in NLG](https://arxiv.org/html/2202.03629v6)。

---

## ③ 对现有 harness 的逐点批判

> 文件:`scripts/eval/faithfulness/{claims,judge,llm,score,types}.ts`

### 3.1 【根因】verbatim-quote-verification 制造系统性假阴性 ⭐

**现象**:judge 的 `reason` 明明写 "The source directly states X",verdict 却是 `unsupported`,
`factual_faithfulness` 被压到 0.652。

**根因**:`judge.ts`

```
44  function normalize(s) { return s.toLowerCase().replace(/\s+/g,' ').trim(); }
49  function verifyEvidence(quote, source) {            // 逐字子串匹配
51    const nq = normalize(quote); const ns = normalize(source);
53    if (ns.includes(nq)) return true;                 // 全量子串
54    const head = nq.slice(0, max(20, len*0.6));
55    return ns.includes(head);                         // 退而求前 60% 子串
57  }
...
14  FACTUAL_PROMPT: "...For 'supported', evidence_quote MUST be copied verbatim
                     from the SOURCE (an exact substring)..."   // prompt 也在逼逐字
84  if (verdict === 'supported' && !verified) verdict = 'unsupported';  // 硬降级
```

三处共同作用:(a) prompt 命令 judge 必须逐字抄;(b) `verifyEvidence` 做规范化后的子串匹配;
(c) 第 84 行**程序强制覆盖** judge 的语义判断。

**为什么 verbatim 必然失败**:情报报告→brief 是**抽象式摘要**,brief 会改写、合并多句、
归纳数字、调整措辞。这种场景下"逐字子串"几乎不可能命中(SummaC/FactCC 论文的整个出发点
就是为此放弃字符串匹配改用 NLI)。即便退到"前 60% 子串"也救不了改写。结果:**judge 语义
上判对了(supported),却被字符串匹配一票否决**——这是定义上的假阴性,且系统性偏向压低分数。

**后果**:尺子失真。0.652 既包含真脑补(我们想抓的),也包含大量"改写导致匹配不上"的工具噪声,
两者混在一起,**无法干净区分"真添油加醋"和"匹配失败"**——尺子失去判别力。

**修复(见 §4)**:删掉 verbatim 硬门,改 entailment;quote/span 降级为审计线索。

### 3.2 judge 的"verdict 定义"其实是对的,被自己的硬规则毁了

`FACTUAL_PROMPT` 里 `supported` 的定义是 "directly states **or clearly entails**"——
**entails 本来是对的**!问题全在"Hard rule:必须逐字抄,抄不到就改判 unsupported"这段
把语义判断废掉了。所以改造不需要重写 verdict 语义,**只需拿掉 verbatim 强制**。

### 3.3 claim 抽取粒度可能不够原子,稀释脑补信号

`claims.ts` 的 `EXTRACT_PROMPT` 让模型拆复合句、分 factual/analytical(分流设计本身合理)。
但没有 FActScore 式的"一个原子=一个可验证单元 + decontextualize"约束。风险:
"X 已与德/奥/荷 5 国就 Y 谈判"可能被当**一条** factual claim;若源支持"X 在谈判 Y"但
没有"5 国",judge 很可能整体判 supported(主干对),**脑补的"5 国"被真主干掩盖**。
原子化 + 指代消解能让"5 国"成为独立可判单元。

### 3.4 gate 与聚合的工程问题

- `score.ts:78` `gate_pass = contradicted===0 && contradicting===0` ——
  **方向对**(只拦 intrinsic 矛盾,不拦 unsupported),但目前 `factual_faithfulness`
  这个 headline 数字本身被 §3.1 污染,**对外汇报会误导**。
- **阈值无标定**:没有任何 meta-eval 支撑"多少分算可接受"。
- **judge 与 brief 同源模型**(都 qwen 家族),有 self-enhancement 风险,未被检验。

### 3.5 边界/解析的小问题(非核心,记录)

- `llm.ts` / `claims.ts` 的 `parseJSON` + `salvageObjects` 容错很重,说明 judge 输出
  JSON 不稳;temperature=0 已设,但仍依赖正则抢救。改造后 judge 输出更结构化时可收紧。
- 与全局 MEMORY 中"边界运行时校验"一致:这些跨 service / LLM 边界目前缺 zod 校验,
  坏数据会静默流过。本次不改,**标记为后续**。

---

## ④ 具体改造建议(落到 `judge.ts` 的哪一环)

### 4.1 第一刀(最小、最高优先级):拆掉 verbatim 硬降级

`judge.ts`:

1. **删除第 84 行的硬覆盖** `if (verdict==='supported' && !verified) verdict='unsupported';`。
   这是假阴性的总闸,先关掉它,`factual_faithfulness` 会立刻回升到接近真实值。
2. **`verifyEvidence`(49-56)降级为附加信号**:保留计算,但只写进 `evidence_verified`
   字段供人工复核排序,**不再回写 verdict**。
3. **改 `FACTUAL_PROMPT`(14-43)**:把 "Hard rule: evidence_quote MUST be copied
   verbatim ... else unsupported" 整段删掉。改成:judge 基于**语义蕴含**判定;若 supported,
   给出**最相关的 source 句子(可改写引用或给句子编号)**作为依据,无需逐字。

### 4.2 第二刀:判定范式 = 原子化 + entailment 三分类

- **claim 抽取(`claims.ts`)**:在 `EXTRACT_PROMPT` 加 FActScore 式约束:
  "每条 claim 只含一个可独立验证的信息单元;复合的具名事实(多个国家/数字/主体)拆成
  多条;把代词/指代还原成具名实体(decontextualize)"。这样"5 国"能被单独判。
- **`judgeFactual`**:verdict 沿用 `supported/unsupported/contradicted`(= entailed/
  neutral/contradicted,语义已对齐 RAGAS/SummaC),但判据是"source 是否**蕴含** claim",
  允许跨句聚合、改写、归纳。输出结构:`{verdict, evidence_sentences:[...], reason}`,
  `evidence_sentences` 是 source 里支撑该 claim 的句子(可多句),**用于审计不用于硬判**。

### 4.3 第三刀(可选,提升可信度):引入 NLI/grounding 第二尺子

- 离线 batch 用 **MiniCheck-FT5(770M)** 或 **AlignScore** 对每条 claim 跑一次 grounding,
  与 LLM-judge 的判定做**交叉**:两者一致→高置信;分歧→进人工复核队列。
- 部署注意:我们在 Cloudflare 无常驻 GPU,这类小模型**作为离线评测脚本**跑(本地/CI),
  **不放运行时**。MiniCheck 专为"输出能否被 grounding 文档支撑"设计,与我们靶心一致,优先它。

### 4.4 验证尺子本身(meta-eval,必做)

- 人工标注 **30-50 条 claim 金标**(supported/unsupported/contradicted),覆盖
  正常改写、真脑补(德/奥/荷案例)、矛盾三类。
- 算 judge 与人工的 **Cohen's κ / balanced accuracy**;**重点查假阴性率**(改写被误判
  unsupported 的比例)是否随 §4.1 改造而显著下降。
- 顺便查 **self-enhancement**:让一个**非 qwen 家族**的 judge(如换一个 provider 的模型)
  对同一批金标判一遍,看是否系统性更严——若是,说明同源 judge 在护短。
- **阈值在金标上标定后再写进 gate**,不要拍脑袋。

### 4.5 离线 eval 与运行时 fail-closed 分开搭

- **离线(本 harness 的定位)**:产出 `factual_faithfulness`、flagged 列表、趋势;
  **不 fail-closed**,容忍噪声,用于回归与 prompt 迭代。`gate_pass` 可保留为"软告警"。
- **运行时 guardrail(新增,独立于本 harness)**:在 brief 合成后、落库/发布前加一道轻量检查,
  **只拦硬错**:
  - `contradicted` > 0 → 拦截/降级;
  - **具名实体脑补检测**:抽 brief 里的具名实体(国家/公司/人名/数字),凡 source 完全
    不出现的 → 标红拦截。这一条专治"凭空 5 国",简单、可解释、低假阳性,最值得先上。
  - 命中则:brief 不发 / 退回重写 / 转人工。fail-closed 要保守(宁可多转人工,不可
    把工具噪声变成阻断)。
  - 这与全局 MEMORY"边界 fail-closed + zod 校验"一致:运行时这道闸的输入输出应 zod 校验。

### 4.6 改造顺序建议

1. §4.1 删硬降级(10 分钟,立竿见影) →
2. §4.4 做 30-50 条金标 meta-eval(确认假阴性真的降了、尺子可信) →
3. §4.2 原子化 + entailment prompt(让"5 国"可单独判) →
4. §4.5 运行时具名实体脑补 guardrail(把"抓脑补"从离线尺子搬进发布门) →
5. §4.3 MiniCheck/AlignScore 第二尺子(锦上添花,提升离线置信)。

---

## ⑤ 参考文献(链接)

**框架 / 文档**
- RAGAS Faithfulness — https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/
- MiniCheck GitHub — https://github.com/Liyan06/MiniCheck
- AlignScore GitHub — https://github.com/yuh-zha/AlignScore
- FactCC GitHub — https://github.com/salesforce/factCC
- RAGTruth GitHub — https://github.com/ParticleMedia/RAGTruth
- awesome-hallucination-detection(含 FELM 等索引) — https://github.com/EdinburghNLP/awesome-hallucination-detection

**论文**
- FActScore (EMNLP 2023) — https://arxiv.org/abs/2305.14251 / https://aclanthology.org/2023.emnlp-main.741/
- SummaC (TACL 2022) — https://arxiv.org/abs/2111.09525 / https://aclanthology.org/2022.tacl-1.10.pdf
- AlignScore (ACL 2023) — https://arxiv.org/abs/2305.16739 / https://aclanthology.org/2023.acl-long.634/
- MiniCheck (EMNLP 2024) — https://arxiv.org/abs/2404.10774 / https://aclanthology.org/2024.emnlp-main.499/
- RAGTruth (ACL 2024) — https://arxiv.org/abs/2401.00396 / https://aclanthology.org/2024.acl-long.585/
- On Faithfulness and Factuality in Abstractive Summarization (ACL 2020) — https://aclanthology.org/2020.acl-main.173.pdf
- Survey of Hallucination in NLG — https://arxiv.org/html/2202.03629v6
- Textual entailment as eval metric for abstractive summarization — https://www.sciencedirect.com/science/article/pii/S2949719123000250

**LLM-as-judge 偏差 / 校准**
- Justice or Prejudice? Quantifying Biases in LLM-as-a-Judge — https://llm-judge-bias.github.io/
- Evidently:LLM-as-a-judge 指南 — https://www.evidentlyai.com/llm-guide/llm-as-a-judge
- Deepchecks:LLM judge calibration — https://deepchecks.com/llm-judge-calibration-automated-issues/

**运行时 guardrail / 生产实践**
- KDnuggets:7 ways to reduce hallucinations in production LLMs — https://www.kdnuggets.com/7-ways-to-reduce-hallucinations-in-production-llms
- RAG grounding tests — https://medium.com/@Nexumo_/rag-grounding-11-tests-that-expose-fake-citations-30d84140831a
- Galileo:hallucination detection tools — https://galileo.ai/blog/best-hallucination-detection-tools-llm

**待核实**
- **TRUE benchmark** 原始论文链接未在本次检索中直接确认(AIS 概念见上述 RAGTruth/综述引用);如需引用 TRUE 原文请另行核实。
- **FELM** 具体协议细节(错误 span/类型定义)**待核实**,以原论文为准。
- "原子化 + NLI 比句子级 F1 高 12-18 分"的具体数字来自检索摘要转述,**引用前请回原文核实**。

---

## ⑥ 一句话教训

**忠实度评测的本体是"语义蕴含",不是"字符串相等"。** 我们用 verbatim 子串匹配去验证一个
本质上是改写/抽象的摘要,等于用错的尺子量对的东西——尺子读数(0.652)既不可信也无判别力。
修复的核心不是调阈值,而是**换判定范式(→ entailment)+ 验证尺子(→ meta-eval)**。
