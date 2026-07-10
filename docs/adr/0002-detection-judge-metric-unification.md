# 检测型判官的指标统一(先统一测量,不改门)

## Context

我们有一族 eval harness("检测型判官"/桶①)让 LLM 判官吐分类标签、对人工金标算一致性:`intel-grounding`、`faithfulness`、`article-quality`、`coverage-judge`。四者的指标代码**各自实现、已经漂移**(3 份内联在各自 `meta-eval.ts`、article-quality 抽了本地 `metrics.ts`),导致"同样是判官,验收方式不一致"。同时排查发现现有的门只卡召回、不卡误拦(单腿门),存在"见啥拦啥即可刷高召回"的漏洞。

## Decision

**只统一"测量",不动"门"。** 抽一个**类无关**的共享模块 `scripts/eval/_shared/metrics.ts`,四个判官都 import;它对任意 `classes: string[]` 计算并报告统一的一套**单点指标**:per-class 召回、精确率、FPR、Fβ + 总体 κ、balanced accuracy。**每个 harness 现有的门(κ≥0.6 + 召回 floor)一字不改**——新增的精确率/FPR/Fβ 只是"多报几列",不作为闸。"用新指标设新门 / 调操作点"属于后续"优化"阶段,per-harness 按成本单独定。

## Considered Options

- **只统一测量(选中)** vs **连门语义一起改**:后者会立刻让某些 harness 从 PASS 变 FAIL,且需要每个环节的"漏检 vs 误拦谁更贵"成本模型才能定阈值——那是优化阶段的活,不塞进"统一"这步。先让新指标"只报告不设闸"跑几轮看真实分布,避免拍脑袋数当硬门(正是我们在 intel-grounding 单腿门上踩过的坑)。
- **单点指标** vs **投票占比(k/N)做把握分 + Recall@FPR 曲线**:曲线类需要"把握分"(可拧的阈值),而判官只吐硬标签。我们的把握分**不采信 LLM 自报置信度**(业界公认不可靠),只认**投票占比**(`CONTRA_VOTES` 已在算、但被 `majorityVerdict` 丢弃)。留住计数即可白得粗曲线,但这一步**先不做**——记为将来项。
- **范围 = 4 个判官** vs **含 scrape-quality / story-validation**:scrape-quality 是机械签名检测、数据形态不同,保持现状;story-validation 连 meta 都还没建,等它建尺时直接接入共享模块。

## Consequences

- 共享模块**类无关**(筐名当参数传:`evalChannel(preds, classes, label)`),同一份吃下三分类忠实度、OK/LOW/JUNK 质量、KEEP/REJECT 接受闸、覆盖判官。取现有最全实现当基准;article-quality 本地 `metrics.ts` 并入后删除。
- **验证不碰 LLM**:指标是纯算术、在随机判官下游,用写死的 `(gold, pred)` + 已存报告的混淆矩阵做确定性自测,断言"新旧公式出同一个数"。
- 漂移的 harness(如 article-quality 缺 κ/balanced acc)会被**标准化补齐**——严格说不是"行为完全不变",而是"补齐到标准集";自测会顺带暴露旧实现的暗坑。
- 门语义不变 → **本次不改变任何 harness 的 PASS/FAIL**,可安全一次性 retrofit 四个判官。
