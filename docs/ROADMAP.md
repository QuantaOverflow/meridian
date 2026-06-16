# Meridian Roadmap

按 ROI 排序（业务价值 ÷ 改动成本）。ROI 评估基于 2026-06 全链路状态：选择层 NDCG@10=0.958 已饱和+防回归闸；忠实度门检测层已建且影子模式跑通，判据标定见 memory `faithfulness-runtime-gate`。

> **2026-06-16 重排**：eval 最佳实践调研（见 `docs/eval-playbook.md`）暴露根本问题——忠实度 judge 是一把**没验证过的尺**。原 P1（enforce + revision）全部建在它之上。验 judge 升为 **P0**，必须先于一切依赖它的动作。revision 已实现但其有效性同样受 judge 召回上限约束。

---

## P0 · 验证忠实度 judge（meta-eval，地基）

**为什么最优先：** 忠实度 judge（qwen-max 判 claim supported/unsupported/contradicted）从未做人工金标 meta-eval。门阈值 0.15/4 是在 6 份**未验裁判**的输出上方向性拟合的。judge 没验 → 离线 eval、运行时门、revision、enforce **全部建在沙上**。这是 2025 头号 eval 反模式（"未验证的 judge = 加了延迟的 vibe"）。

**额外风险——self-preference 泄漏：** brief 用 Qwen 生成，judge 又是 qwen-max，同家族 → 分数系统性虚高。

**要做（详见 `docs/eval-playbook.md` §2–4）：**
1. **建 claim 级人工金标**：`(claim, source) → {supported/unsupported/contradicted}`，≥100 条，**分层采样**（按 verdict 类过采稀有类、claim 类型、单源 vs 多源合成），锁 held-out 测试集。
2. **判前 decontextualization**：指代消解、claim 自包含，再喂 judge（漏这步是 spurious unsupported 主因）。
3. **算 judge↔人 一致性**：**per-class TPR/TNR + Cohen's κ**（不用 accuracy——数据偏 supported）。先用 2 人标一小片定上限。
4. **接受闸**：κ ≥ 0.6（目标 0.8）且 contradicted/unsupported 召回 ≥ ~0.7。对不齐就**换非 Qwen 家族 judge**（兼缓解 self-preference）。
5. **写 `scripts/eval/judge-meta-eval.*`** 作回归闸（钉死 judge model+temp），与 NDCG 闸并列。
6. （可选第二尺）`meridian-ml-service` 接 **MiniCheck-Flan-T5-Large**（离线 batch，非 runtime），qwen-max↔MiniCheck 分歧样本进人工队列做主动学习采样。

**成本：** 中——主要是人工标注 + 一套 meta-eval 脚本。**但这是解锁 enforce 的唯一前置。**

---

## P1 · 让 brief 不撒谎（忠实度 enforce + 自动改写）

**依赖 P0**：judge 验过、阈值在真实流量复校后，才翻 enforce。

**业务价值：** 可信度是新闻产品命根。brief 会编细节（如 source "以色列空袭贝鲁特" → brief "贝鲁特**南郊**"）。读者抓到一次假话就不再信整个产品。

**现状：** 检测重活已完成——judge（qwen-max）+ 门 F 判据（`contradicted>=1` 或 `unsupported_rate>0.15 且 genuine_unsupported>=4`）+ per-story 喂源。当前影子模式（`FAITHFULNESS_GATE_ENFORCE=false`），算 verdict 但永不拦。**revision step（路径 B）已实现**（2026-06-16，commit 待提）：门后 source-free 删除/剥离 flagged factual claim，影子模式下也跑；其有效性受 judge 召回上限约束（judge 漏判 → revision 收不到 → 删不掉），故 P0 验 judge 同样提升 revision 上限。

**要做：**
1. **enforce 切换**：P0 验完 judge + 影子数据复校 0.15/4 阈值后，翻 `FAITHFULNESS_GATE_ENFORCE=true`。需先给 `brief_run_status` 加 `BLOCKED_FAITHFULNESS` 枚举 + migration。
2. **enforce 时序修正**：现 `v.block` 是修订前算的；enforce 上线时正确序为 revise→重新 check→仍脏才拦（已在 `auto-brief-generation.ts` 留 TODO 注释）。
3. **revision 增强（后续）**：v1 只删/剥；"按 source 改写成正确版本"需路由 per-story 源，留后续。

**成本：** 小——检测层 + revision v1 已完成，剩接 enforce。

---

## P2 · 上游脏文章拦在门外（文章质量门 eval）

**业务价值：** garbage in garbage out。低质文章混入 → 污染事件聚类 → brief 选错/写歪，下游再准也救不回。系统性提质而非补漏。

**现状：** `articleAnalysis` 已对文章打质量分，但打分精度无 eval，无法判断质量门是否真的拦对。

**要做：** 给文章质量门搭 eval（金标 + 指标），校准 cutoff，卡掉低质源进入聚类。

**成本：** 中。

---

## P3 · brief 别漏大事 / 别把一件事拆三条（聚类表示升级）

**业务价值：** 同一事件分散成多簇或漏掉重要事件 → 读者觉得"不全 / 啰嗦"，brief 显得不专业。覆盖度 + 不重复 = 专业感。

**现状：** 聚类已用 DBCV 网格搜索调参，但表示仍是通用 multilingual-E5-Small。行业共识（TDT 新闻事件检测，见 session e2484c23）：问题主要在"表示"而非"聚类算法"，通用 embedding 在故事粒度分辨力不足。

**要做：** 给聚类补 entity + 时间特征，提升故事粒度分辨力。

**成本：** 大——放在 P1/P2 之后。

---

## 已完成（基线已固化，勿回归）

- 选择层 NDCG@10 = 0.958，防回归闸 `--baseline 0.958 --tolerance 0.02`
- 聚类 DBCV 网格搜索调参
- 忠实度门检测层 + 影子模式 + 判据标定
- 忠实度 revision step v1（路径 B，source-free 删除/剥离，commit 待提）
- 情报报告 R2 卸载（突破 Workflow 1MB step 上限，maxStoriesToGenerate 3→15）

## 方法论

- **`docs/eval-playbook.md`** — 如何为 LLM 管线做好 eval（error-analysis 优先、验 LLM-judge、框架选型、CI 闸、反模式）。P0 直接源于此。
