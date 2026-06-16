# Meridian Eval Playbook

如何为 LLM 管线做好 eval。源自 2024–2026 业界/学术最佳实践调研（Hamel Husain & Shreya Shankar、UK AISI Inspect、Pragmatic Engineer、LLM-AggreFact 系列论文），并对照 Meridian 现状。

> 一句话总纲：**先看数据，别先建指标。** 验证你的尺子（尤其 LLM-as-judge）再用它的读数。

---

## 0. 我们现在的位置

| 环节 | 状态 | 判定 |
|------|------|------|
| 选择层 NDCG@10 = 0.958 | 对人工金标的确定性指标 + 防回归闸 | ✅ 教科书级做对 |
| 聚类 DBCV 调参 | 内禀指标 + pooled gold | ✅ 做对 |
| 忠实度 LLM-judge（qwen-max） | 无人工金标 meta-eval，6 份报告上方向性拟合阈值 | ❌ **未验证（2025 头号反模式）** |
| 系统 error analysis | 未做过正式 open/axial coding | ❌ 缺 |

**核心结论：忠实度 judge 是一把没验过的尺。** revision（已实现）、阈值 0.15/4 复校、enforce 切换——全部建在它之上。验 judge 是这条线的地基，不是可选项。

---

## 1. Error-analysis 优先（最高 ROI 的活）

业界共识：领域专家 **60–80% 的开发时间花在看数据 + eval**，不是写自动检查器。流程：

1. **Open coding（自下而上标注）**：一个领域专家（"仁慈独裁者"，不是委员会）逐条读 trace，写自由笔记描述哪里错了。**关键规则：只标每条 trace 的「第一处上游失败」**——在 5 阶段管线里，坏 brief 常常根因是坏 cluster、再上是坏文章分析；标到链条最先断的地方。
2. **Axial coding（建分类法）**：把笔记归成 5–10 个命名失败桶，按频率计数 → 数据驱动的修复 roadmap。
3. **理论饱和**：读到 ~20 条连续 trace 不再出新失败模式为止；起步基线 **≥100 trace**。
4. **只为「持续」失败建 evaluator**：prompt 一改就好的别建检查器；只对改 prompt 后仍残留的失败，才上昂贵的 LLM-judge。

**采样不能随机**（随机采样在偏斜数据上浪费预算在简单样本）：
- 分层：按阶段 / 源类型 / 故事类别 / 语言（我们是多语新闻）。
- 离群：按响应长度、源数、延迟排序取极端。
- Embedding 聚类：复用 e5-small 向量，小簇过采抓边缘案例。
- 信号驱动：负反馈、被丢弃的故事、validation 拒绝的样本。

**节奏**：每 2–4 周对新数据做一次完整复盘；间隔周抽查 10–20 条离群。

Meridian 落点：对 **story-validation** 和 **brief-synthesis** 各跑一轮独立 error analysis。忠实度 judge 应当**从合成阶段的失败分类法里长出来**，而非通用地硬接。

---

## 2. 验证 LLM-as-judge（用它之前必做）

未验证的 judge = 加了延迟和成本的 vibe。验证协议：

- **标注粒度 = claim**（不是 brief）。我们的 judge 是 claim 级，金标就必须是 `(claim, source) → {supported / unsupported / contradicted}`。brief 级标签验不到 claim 级 judge。
- **裁决用 binary / categorical，不用 Likert**（相邻档 3 vs 4 主观、噪声大）。我们的三分类可以，但要把 `unsupported`（源没提）vs `contradicted`（源说了相反）在标注指南里界定清晰——这俩常被混淆，混了 κ 会崩。
- **样本量**：起步迭代 ~30 条（标→比 judge→改 prompt→重复；Honeycomb 3 轮达 >90% 一致）；可靠生产 judge 的下限 **≥100 条**；标到失败模式饱和为止。
- **锁 held-out 测试集**（judge prompt 从未在其上调过），最终一致性只在它上面报。
- **指标用 per-class，不用 accuracy**：我们数据严重偏 `supported`，"全判 supported"也能拿高 accuracy 却完全没用（majority-class artifact）。
  - **per-class TPR/TNR**：`contradicted`/`unsupported` 的召回 = "抓得住幻觉吗"；`supported` 的 TNR = "会不会误伤好句"。分开报。
  - **Cohen's κ**：chance-corrected 的单一一致性数。**目标 κ ≥ 0.6（"substantial"，最低线），≥0.8 为目标**；已发表的好 judge 对人类共识达 0.80–0.93。
  - **balanced accuracy**：= per-class 召回均值，prevalence-independent，作概览但**不能替代** TPR/TNR 明细。
  - 先用 2 个人标一小片，算**人类 inter-rater κ = 上限**——judge 别指望超过人类彼此的一致度。
- **对齐失败就换模型**：judge 怎么调都对不齐人类，换 judge 模型。
- **Goodhart 哨兵**：judge 通过率 ~100% = 题太简单；~70% 更有信息量。

---

## 3. judge 的已知偏置（有一条正中我们）

- **self-preference / preference leakage**：生成和裁判同模型家族 → 分数虚高。**Meridian 的 brief 用 Qwen 生成，judge 又是 qwen-max——正中此坑。** 缓解：换**不同家族**的 judge 模型，或引入 MiniCheck（非 Qwen）当交叉尺，并检查换生成器后一致性是否掉。
- **leniency 偏松**：judge 倾向"看着行 → supported"，漏细节级编造。缓解：强制 CoT——"先抄出支撑该 claim 的源原文 span，抄不出则判 unsupported"。
- **verbosity 偏长**：原子化已把 claim 长度归一，保持单事实短句。
- **position 偏置**：单 claim 判定风险低；只在一个 prompt 批量塞多 claim 时才需随机化顺序。

---

## 4. 忠实度专属方法

- **我们的原子 claim 拆法 = FactScore 范式，是公认正解**——方向对。
- **第二把尺：MiniCheck-Flan-T5-Large（770M）**，groundedness ≈ GPT-4 级、成本极低。放 `meridian-ml-service`（已有 transformer），**不在 Workers runtime 跑**（要 GPU、超 step 预算）。用法：qwen-max 与 MiniCheck **分歧的样本 → 进人工标注队列**（高效主动学习采样器 + 全量人工复核之间的连续回归信号）。结果写 R2 `observability/*.json`，沿用现有卸载模式。
- **⚠️ "Verify with Caution"（arXiv 2501.14883, 2025）**：5 个 SOTA 事实性指标互相不一致，且对 **(a) 重度改写输出** 和 **(b) 跨远距源的 claim** 系统性有偏。**两条都打中我们**（brief 改写、多源合成跨段）。结论：MiniCheck 是廉价交叉验证，**不是真值**；人工金标仍是唯一锚。明确建议："在你的领域手动验证这些指标的可靠性再依赖它们。"
- **decontextualization（判前指代消解）**——被低估的关键步。原子 claim 如"他否认了指控"孤立无法判（judge 解析不了"他"）。判前把每条 claim 做指代消解、变**自包含**，再喂 judge 和 MiniCheck。跳过这步是 spurious `unsupported` 的主要来源。
- 同时要 eval **拆解器本身的质量**：原子 claim 是否忠实覆盖 brief 而不添信息——坏拆解会悄悄污染每条下游裁决。

参考基准：**LLM-AggreFact**（11 个 grounded-faithfulness 数据集，按 balanced accuracy 排名；人类天花板 ~77% BAcc，所以没有自动尺是人类级）。RAGTruth 提供词级人工标注语料，可低成本播种我们的金标。

---

## 5. 框架选型（TS Workers + Python ML 混合栈）

> **沿语言缝两套，git 里 JSON baseline 粘合。judge 只实现一次。**

- **Python / ml-service 侧 → Inspect AI**（UK AISI，AISI/METR/Apollo 在用）：严谨、多 provider、typed task/solver/scorer。承载 judge meta-eval、NDCG、聚类质量。
- **TS Workers 侧 → Promptfoo 或 Evalite（Vitest-native）**：贴着 prompt 所在地（`services/meridian-ai-worker/src/prompts/`）做 per-endpoint eval + PR gate，契合现有"改 prompt→`wrangler dev`+curl 验"流程。
- **judge 单一真源**：rubric 在 Python/Inspect 定义并验证，暴露成一个 gateway 端点，TS/Python 两侧都调它——别维护两份 judge 实现。
- 避免：现在不上 LangSmith（我们非 LangChain）；只有当 git-JSON baseline 不够、需要托管 dataset/scorer UI 时才考虑 Braintrust（其沙箱 Python 自定义 scorer 对混合栈独特）。

---

## 6. CI 回归闸（eval 成熟后接入）

- **分层**：每 PR 跑廉价确定性检查（schema 有效、citation link 有效、source 归属存在、非空 brief）；夜间跑全量 judge sweep（500–2000 例 vs 版本化 baseline）；canary 1–5% 流量，滚动均值持续掉 2–3 分自动回滚。
- **双闸都要**：floor（绝对阈值，如 groundedness ≥ 0.85、citation 有效 ≥ 0.99）抓塌房；delta（Welch t 检验 / 两比例 z 检验，**p<0.05 且效应 > ~0.03 噪声地板**才 fail）抓缓慢漂移；长尾 gate p95 而非均值。
- **baseline = git 里 per-route 的 JSON**，**钉死 judge model + temperature 并版本化在 rubric 文件里**，让 judge 漂移变成可审 diff 而非神秘方差。
- 每路由 100–200 例（<100 误报率约半，>500 边际递减）；组成 ~60% happy-path / 20% edge / 10% refusal / 10% 历史硬失败。
- fail-the-build 用 **exit code**（0 过 / 2 硬失败 / 3 警告），不靠 grep stdout。

---

## 7. 必杀的反模式

1. **通用预制指标**（ROUGE/BERTScore/helpfulness 1-5）——很少抓到应用特定质量，制造虚假信心。（例外：cosine 用于检索优化可以。）
2. **vibes-based 开发**——无分类法、无计数、随手乱修。
3. **judge 数据泄漏**——同模型生成又裁判（§3）。
4. **Goodhart 高通过率**——100% 通过 = 题太简单。
5. **外包核心 error analysis**——断了"观察→理解→改进"闭环；只有定好 rubric 后的机械标注才可外包。

---

## 8. Meridian 推进顺序（落到 ROADMAP）

1. **验证忠实度 judge**（binary rubric、≥100 claim 金标、held-out、Cohen's κ + per-class TPR/TNR、跨家族 judge 缓解 self-preference）——**在它 gate 任何东西之前**。→ ROADMAP **P0**。
2. 对 story-validation 和 brief-synthesis 各跑一轮 **error analysis**，从持续失败长出指标。
3. 接 **MiniCheck** 当 ml-service 离线第二尺 + 分歧采样器。
4. 搭**分层 CI 闸**（Workers 侧 Promptfoo/Evalite + Python 侧 Inspect，git JSON baseline，Welch/z + floor，钉死 judge）。
5. 选择层 NDCG、聚类 DBCV 保持，并入同一 baseline-in-git + delta-gate harness。

---

## 关键外部参考

- Hamel Husain & Shreya Shankar — [LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/) · [Creating an LLM-as-a-Judge](https://hamel.dev/blog/posts/llm-judge/)
- [Pragmatic Engineer — Evals](https://newsletter.pragmaticengineer.com/p/evals)
- [UK AISI Inspect](https://inspect.aisi.org.uk/)
- [LLM-AggreFact leaderboard](https://llm-aggrefact.github.io) · [MiniCheck (EMNLP 2024)](https://github.com/Liyan06/MiniCheck)
- [FactScore (arXiv 2305.14251)](https://arxiv.org/abs/2305.14251) · [SummaC (arXiv 2111.09525)](https://arxiv.org/abs/2111.09525)
- [Verify with Caution (arXiv 2501.14883)](https://arxiv.org/abs/2501.14883)
- [Preference Leakage (arXiv 2502.01534)](https://arxiv.org/abs/2502.01534) · [Self-Preference Bias (arXiv 2410.21819)](https://arxiv.org/pdf/2410.21819)
- [A Survey on LLM-as-a-Judge (arXiv 2411.15594)](https://arxiv.org/pdf/2411.15594)
