# Meridian Roadmap

按 ROI 排序（业务价值 ÷ 改动成本）。ROI 评估基于 2026-06 全链路状态：选择层 NDCG@10=0.958 已饱和+防回归闸；忠实度门检测层已建且影子模式跑通，判据标定见 memory `faithfulness-runtime-gate`。

> **2026-06-16 重排**：eval 最佳实践调研（见 `docs/eval-playbook.md`）暴露根本问题——忠实度 judge 是一把**没验证过的尺**。原 P1（enforce + revision）全部建在它之上。验 judge 升为 **P0**，必须先于一切依赖它的动作。revision 已实现但其有效性同样受 judge 召回上限约束。

> **2026-06-23 更新**：把当前裁判（含 06-16/17 全部修复）部署上线（ai-worker `04d26436` + backend `f074c6e1`，仍影子），触发首条真实 brief（report 21）。**enforce 阻塞根因从"judge 笼统未验"具体化为三因叠加**：①跨故事串源（每条 claim 对全部源硬判，缺"按 claim 检索相关证据"步）②Lever A 跨语境数字误触 ③裁判非确定性（同输入偶发假矛盾）；被事实通道"第一个矛盾即短路 + `contradicted≥1` 即拦"放大成误杀整条正确简报。修法对标业界标准管线（分解→检索→投票验证→占比）。详见 memory `faithfulness-enforce-blocked-rootcause` / `llm-judge-faithfulness-industry-patterns`。

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

**现状（2026-06-23 实测后）：** 检测层 + per-story 喂源 + revision v1 均已实现并部署（影子）。但首条真实 brief（report 21）即暴露门会**误杀正确简报**——根因三叠加（跨故事串源 + Lever A 跨语境数字误触 + 裁判非确定性），被"第一个矛盾即短路 + `contradicted≥1` 即拦"放大。离线 precision-b2 per-story 实测（κ 0.19、contradicted precision 0、unsupported precision 0.50）在生产复现。**所以 enforce 前置不只是"验 judge"，是先修门的判定机制。** 详见 memory `faithfulness-enforce-blocked-rootcause`。

**要做（修法按性价比，对标业界标准管线——见 memory `llm-judge-faithfulness-industry-patterns`）：**
1. **加"按 claim 检索相关源"再判**（最该做）：消除跨故事串源，是 FactScore/SAFE/RAGAS 以来的标准管线第②步，我们目前缺。
2. **弱化"矛盾"一票否决**：借 RAGAS 二元支持占比，或要求矛盾来自相关源 + self-consistency 复判一致；至少先让事实通道别"第一个矛盾就短路"（照搬分析通道已有的防护）。
3. **判矛盾的 claim 做 self-consistency 多数投票**：吸收裁判非确定性。
4. **claim decontextualize / Claimify**：ADR 0001 在做，输入侧提质。
5. **enforce 切换（最后）**：上述修完 + 在当前裁判上复测 precision 达标后，才翻 `FAITHFULNESS_GATE_ENFORCE=true`。需先给 `brief_run_status` 加 `BLOCKED_FAITHFULNESS` 枚举 + migration；时序为 revise→重新 check→仍脏才拦（`auto-brief-generation.ts` 已留 TODO）。
6. MiniCheck/HHEM 作便宜第二尺（可选，非银弹）。

**成本：** 中——检测层/revision 已就绪，但门判定机制要按业界管线重构（检索 + 投票 + 占比），不再是"接个开关"。

---

## P2 · 上游脏文章拦在门外（文章质量门 eval）

**业务价值：** garbage in garbage out。低质文章混入 → 污染事件聚类 → brief 选错/写歪，下游再准也救不回。系统性提质而非补漏。

**现状：** `articleAnalysis` 已对文章打质量分，但打分精度无 eval，无法判断质量门是否真的拦对。

**要做：** 给文章质量门搭 eval（金标 + 指标），校准 cutoff，卡掉低质源进入聚类。

**成本：** 中。

---

## P2.5 · 情报分析 eval（忠实度门信任的"真相源"，至今零设防）

**业务价值：** 情报分析（`intelligenceAnalysis.ts`）产出每个 story 的情报报告，这正是**忠实度门拿来当"真相"对比 brief 的那个源**。但这一步**从没做过 eval**——忠实度门信任它信得死死的。情报分析编错 → 情报报告错 → brief 照抄 → 门一比"一致"→ 放行（门反而帮上游背书）。整条链最关键的真相源反而没设防。

**为什么紧要：** 它是多阶段 LLM 链里幻觉最易钻入的一步（深度分析、推断、跨文章综合），且其错误对下游不可见。今天修好的是"brief 忠于情报报告"；"情报报告忠于 RSS 原文"这层是空的。逻辑价值不输忠实度门，更治本。

**要做：** 复用刚建好的 faithfulness meta-eval 方法论——情报报告对其输入文章做 claim 级 grounding 验证（judge：情报报告每句在源文章里有据吗）。可直接搬 `scripts/eval/faithfulness/` 的 harness + rubric + 合成扰动 + dev/heldout 切分。

**成本：** 中——方法现成（faithfulness 那套），主要是建情报层金标。

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
- 忠实度 revision step v1（路径 B，source-free 删除/剥离，commit 3f73878）
- 忠实度 judge 验证：单一真源 + meta-eval(κ/per-class) + dev/heldout 切分 + 合成 contradicted；数字盲修复(Lever A)→矛盾召回 0→0.769（commit 33b9694…3219503）。**注：0.769 是合成/cert 题上的 recall；真实抽取 claim 上 precision 差（contradicted precision≈0、κ≈0.19）——别拿 0.769 当 enforce 可翻的依据，见 P1 现状**
- 情报报告 R2 卸载（突破 Workflow 1MB step 上限，maxStoriesToGenerate 3→15）

## 方法论

- **`docs/eval-playbook.md`** — 如何为 LLM 管线做好 eval（error-analysis 优先、验 LLM-judge、框架选型、CI 闸、反模式）。P0 直接源于此。
