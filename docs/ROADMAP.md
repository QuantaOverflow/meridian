# Meridian Roadmap

按 ROI 排序（业务价值 ÷ 改动成本）。ROI 评估基于 2026-06 全链路状态：选择层 NDCG@10=0.958 已饱和+防回归闸；忠实度门检测层已建且影子模式跑通，判据标定见 memory `faithfulness-runtime-gate`。

> **2026-06-16 重排**：eval 最佳实践调研（见 `docs/eval-playbook.md`）暴露根本问题——忠实度 judge 是一把**没验证过的尺**。原 P1（enforce + revision）全部建在它之上。验 judge 升为 **P0**，必须先于一切依赖它的动作。revision 已实现但其有效性同样受 judge 召回上限约束。

> **2026-06-23 更新**：把当前裁判（含 06-16/17 全部修复）部署上线（ai-worker `04d26436` + backend `f074c6e1`，仍影子），触发首条真实 brief（report 21）。**enforce 阻塞根因从"judge 笼统未验"具体化为三因叠加**：①跨故事串源（每条 claim 对全部源硬判，缺"按 claim 检索相关证据"步）②Lever A 跨语境数字误触 ③裁判非确定性（同输入偶发假矛盾）；被事实通道"第一个矛盾即短路 + `contradicted≥1` 即拦"放大成误杀整条正确简报。修法对标业界标准管线（分解→检索→投票验证→占比）。详见 memory `faithfulness-enforce-blocked-rootcause` / `llm-judge-faithfulness-industry-patterns`。

> **2026-06-25 更新**：P0/P1 大幅推进，06-23 那批读数（κ 0.19、contradicted precision 0、误杀正确简报）**已被推翻为"坏尺假象"**。三件事改变结论：① 旧 precision-b2 金标双盲复标发现 **34% 标错**（`626abd4` 清洗）；② 金标扩到 75 条随机采样 + 多跑取均（RUNS）→ **κ 0.19→0.60（≈验收线），翻转率仅 1%**（裁判在真实 claim 上其实稳，`2960c3d`）；③ P1 三根因修补全部落地并部署（影子 `1c216315`）：检索路由 slice1 `0f176a3` / self-consistency 弱化一票否决 slice2 `4770f0d` / run 级定位的 3 个确定型误拦 bug 修复 `b4235b6`+`db6a083`，**run 级误拦率 33%→11%（已复测）**。**enforce 头号阻塞已从"修判定机制"变为"扩样本"**——run 级 n=9、contradicted n=5，所有"率"非决策级，需扩到几十条标注 brief 才能谈翻开关。enforce 仍影子。详见下方 P0/P1 现状。

---

## P0 · 验证忠实度 judge（meta-eval，地基）

**现状（2026-06-25）：基本达成事实通道验收，已解锁 P1。** meta-eval 脚本（`scripts/eval/faithfulness/meta-eval.ts`）+ 人工金标已建并迭代到位：
- 金标 75 条（contra5/unsup23/sup47），双盲 co-label（Claude 子 agent + codex，98% 一致），**随机采样真实分布**（非挑刺）；旧 precision-b2 金标曾 34% 标错，已清洗（`626abd4`）。
- 读数（75 条 RUNS=3）：**κ=0.60（≈验收闸 0.6）**；supported P0.86/R0.92、unsupported P0.73/R0.70、**翻转率 1%**（裁判在真实 claim 上稳，非确定性真但小）。
- **唯一软肋：contradicted 仅 n=5、recall 0.40**（漏极性/否定矛盾如 "wasn't symbolic"）。矛盾在真实简报里稀有，随机采样凑不够 → 需定向/合成补样后，contradicted 通道才算也验过（挪到 P1 剩余项）。
- **未做：self-preference 仍在**——qwen-max 判 Qwen brief 同家族，κ≥0.6 已达但虚高风险未除（换异家族 judge / MiniCheck 第二尺，作 P1 期间次级关注）。

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

**现状（2026-06-25）：三根因修补全部落地并部署（影子，version `1c216315`），run 级误拦率 33%→11%（已复测）；头号限制已变为"样本量太小、读数非决策级"。** 06-23 report 21 暴露的"误杀正确简报"三根因，按业界 retrieve-then-verify 管线逐一修：
- **slice1 检索路由**（`0f176a3`，`rankSourcesByRelevance` 实体门，单一真源 `faithfulness-prompts.ts`）：按 claim 与源词/实体重叠排序取 top-k，哥伦比亚 claim 结构性踢出伊朗源。补上 FactScore/SAFE/RAGAS 标准管线缺的"检索"第②步。
- **slice2 弱化一票否决**（`4770f0d`）：rank-0 矛盾要 self-consistency 多数投票（`CONTRA_VOTES=3`）坐实才拦；低排名源的矛盾降级 unsupported（`db6a083`，bug3 修同主题跨故事误拦——伊朗导弹 claim 撞共享战争词汇的乌克兰源）。
- **run 级金标定位的 3 个确定型误拦全治**：bug1 比较基准误读 + bug2 约数过判（`b4235b6`）、bug3 同主题跨故事路由（`db6a083`）。run 级金标 9 brief（3 should-block / 6 not），真错抓捕 3/3、无漏判。复测 **误拦率 33%→11%（1/9）**。
- **数字诚实（关键）**：3 个 bug 是**确定性修好**的（具体案例 + 无回归，不需大 n）；但 run 级 n=9（误拦 1/9，95%CI≈0.3–48%）、claim 级 contradicted 仅 n=5——**所有"率"都不是决策级**，撑不起"能不能开闸"。残留 1/9 是**第 4 模式**（同源内"累计 vs 单次"两个数字，裁判挑错去比 → 假矛盾，近 bug2 数字消歧）。

**剩余要做（按顺序，瓶颈=扩样本而非再修判定）：**
1. **扩样本到决策级**（头号阻塞，用户已点出）：run 级金标到 ~50–100 条标注 brief（误拦率 ±5–10% 才可信）；contradicted 补到 ~30–50 个矛盾样本（组织上稀有、随机凑不够 → 定向/合成，但合成会高估）；抓捕率需含真错的 brief（也稀有，或合成注入）。标注靠已成型的 co-label 双盲法（Claude 子 agent + codex 异家族）。
2. **治 contradicted 极性/否定盲 + 第 4 模式**：裁判清洗后唯一真软肋是漏极性/否定矛盾（"wasn't symbolic" vs 源 symbolic）；外加第 4 模式源内数字消歧。修前先有 #1 的可信尺。
3. **Lever A 单位感知**：bug2 残留（"25 years" 对齐源 "12th term" ≈24y，Lever A 同 number 类不分单位、prompt 压不全）——单独评估。
4. **enforce 工程前置**：`brief_run_status` 加 `BLOCKED_FAITHFULNESS` 枚举 + migration；时序 revise→重新 check→仍脏才拦（`auto-brief-generation.ts` 已留 TODO）；补 revision 对 contradicted 的处理（report 21 里 `changed=false`，v1 疑只删 unsupported 不动 contradicted）。
5. **enforce 切换（最后）**：#1 扩样本后误拦/抓捕率稳了 + 复校阈值，才翻 `FAITHFULNESS_GATE_ENFORCE=true`。
6. claim decontextualize / Claimify（ADR 0001 在做，输入侧提质）；MiniCheck/HHEM 第二尺（可选，非银弹）。

**成本：** 中——检测层/revision/路由/投票/3 bug 修均已就绪并部署（影子），剩余主要是**人工扩样本**（标注 brief + 补矛盾/含真错样本）把"率"做到决策级，再校阈值翻开关，不再是"重构判定机制"。

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

## P3 · brief 别漏大事 / 别把一件事拆三条

**业务价值：** 漏掉重要事件或同一事件拆散 → 读者觉得"不全 / 啰嗦"，brief 显得不专业。覆盖度 + 不重复 = 专业感。

**根因修正（2026-07，error-analysis 路2）：** "漏大事"的头号来源**不是聚类**——8 简报 40 缺陷归因：**68% 在合成层**（④→⑤ 写简报时静默丢故事/失真），聚类只占 12.5%。原 P3 押"聚类表示升级"押错了主战场。

**现状（2026-07-07）：合成层漏报已修一轮并双尺复测。** 19 条确证漏报 open-code 归因（`scripts/eval/error-analysis/synthesis-omission-opencode.md`）：noteworthy 兜底通道失效（被元评论占用）37%+37%、被宏观叙事吸收 26%、"in random order" 谎言致重要性倒挂（37 死地震被丢、裁判签证进头条）；"7-8 条上限"假设证伪。修法=覆盖契约（每 story 必有去向：深析/折叠保特异性/noteworthy 一句）+ 如实告知重要性降序（导详略不导取舍）+ `[story k/N]` 标记 + noteworthy 重定义为落选安置区。**A/B 复测（8 期重放，`scripts/eval/coverage-judge/regen-ab.ts`）：dropped 13.4%→6.2%，gold 19 条救回 15（2 条升 headline）**。
- **代价（已确证非判官噪声）**：contradicted 6→14（重跑稳定），主为日期挪移/归属反转型失真（June 3→4、2026→2023、"Xi 主办阅兵"写成"出席 Putin 阅兵"），多在正文分析块——机制=单篇织入更多故事、事实密度升高。RARR 没接住 → 下一杠杆是 P1 的裁判/RARR **日期与归属专项**，不是继续堆合成 prompt。
- **残留漏报**（7/112）：吸收类（A3C 拉美）+ 体育/突发在 temp0.7 下偶发契约失守（1782322639966 一 run noteworthy 回退元评论、密苏里坠机仍丢）——prompt 契约压均值不保单次，**硬保证需两遍法**（生成后 reconcileCoverage 对账→dropped 补录），已有判官（κ0.965）可直接做，待评估延迟/成本。

**更新（2026-07-08）：两遍法覆盖补录已落地（commit `232b15e`，未部署）。** 对标 uMedSum 顺序
（RARR 去编造在前、补漏在后）：`repairCoverage` 程序化从 dropped story 的 executiveSummary
逐字取首句补插 noteworthy（不经 LLM，by-construction 零新编造）；`coverageRepair` 默认开。
三臂复测：**dropped 13.4%→6.2%→0.0%（0/112），gold 19 条全救回**；忠实度 twopass
contradicted 7≈基线 6、unsupported 1.1% 全场最低。诚实注记：twopass 批草稿全自覆盖、补录
0 次触发（尾部保险，插入路径已用失守简报离线实测）；treatment/twopass 批间 contradicted
16 vs 7 → prompt 失真代价软化为"均值升高但批间噪声大"。

**技术债（v1 决策记录，2026-07-08 用户拍板）：补录采用"降级版"逐字抽取，非 uMedSum 完全体。**
- **是什么**：补录内容 = executiveSummary 首句逐字拷贝，不经 LLM 改写。选它的证据：A/B 实测
  "让模型自己补覆盖 → 日期挪移/归属反转失真上升"，且 RARR 1.0 只治编造、接不住转录失真
  （核对器与 qwen 裁判同家族，日期/归属正是该家族已量出的系统盲点，见 P1 环1 裁判 κ0.586 未过线）。
- **代价**：①通讯社腔句子夹在对话腔简报里有文风断层；②只保"在场"不保"消化"（补录故事无分析、
  无跨故事联系，重要性倒挂只被 prompt 部分缓解）；③补录条目的覆盖指标自我实现（bullet 即判官
  label 前缀，必判 covered）——coverage 读数中补录部分是"构造保证"非"独立测量"。
- **升级触发条件（满足其一再动）**：
  1. 生产补录触发率高（>20% 期次或单期 ≥3 条）→ noteworthy 区堆出断层，说明 prompt 契约
     在真实分布压不住；触发率从 R2 coverage 清单 grep reason="覆盖补录" 可统计，无需新设施。
  2. RARR 2.0（日期/归属专项）做完且核对器在扩样金标上过线 → 有可信守门员后才允许 LLM
     改写补录句融入文风（uMedSum 完全体：改写 + 贴源核对）。
- 在此之前**不要**顺手给补录加 LLM 润色——那等于在守门员缺位时重新打开失真的门。

**要做（剩余）：**
1. 聚类表示升级（entity + 时间特征）：只占缺陷 12.5%，次项。
2. （依赖 P1）RARR 日期/归属专项 → 解锁上述补录升级。

**成本：** 合成层已收口；聚类表示升级仍大。

---

## 已完成（基线已固化，勿回归）

- 选择层 NDCG@10 = 0.958，防回归闸 `--baseline 0.958 --tolerance 0.02`
- 聚类 DBCV 网格搜索调参
- 忠实度门检测层 + 影子模式 + 判据标定
- 忠实度 revision step v1（路径 B，source-free 删除/剥离，commit 3f73878）
- 忠实度 judge 验证：单一真源 + meta-eval(κ/per-class) + dev/heldout 切分 + 合成 contradicted；数字盲修复(Lever A)→合成题矛盾召回 0→0.769。**真实 claim 上：清洗金标(75 条)+多跑取均后 κ=0.60、翻转率 1%（2026-06-25，commit `626abd4`…`db6a083`）——此前 κ≈0.19/precision 0 系坏尺(34% 标错)+单跑假象，已推翻。** 仍缺：contradicted 稀有类(n=5)定向补样、self-preference 换异家族 judge。
- 情报报告 R2 卸载（突破 Workflow 1MB step 上限，maxStoriesToGenerate 3→15）

## 方法论

- **`docs/eval-playbook.md`** — 如何为 LLM 管线做好 eval（error-analysis 优先、验 LLM-judge、框架选型、CI 闸、反模式）。P0 直接源于此。
