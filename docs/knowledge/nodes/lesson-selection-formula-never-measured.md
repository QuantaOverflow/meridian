---
{
  "id": "lesson-selection-formula-never-measured",
  "type": "lesson",
  "title": "生产选择层现在跑的是零 LLM 纯公式 blockImportance，但 NDCG=0.958 这把尺量的是已退役的 storyValidation LLM importance——纯公式这一档从未被任何 harness 测过",
  "date": "2026-09-22",
  "status": "live",
  "tasks": ["设计验收门", "改报告层结构"],
  "scope": "apps/backend/src/lib/core/storyline.ts 的 blockScore/blockImportance；对照对象是 scripts/eval/selection/BASELINE.md 的 NDCG 基线（见 [[experiment-selection-ndcg-baseline]]）",
  "source": "apps/backend/src/lib/core/storyline.ts:104-136（blockScore 与 blockImportance 函数上方的代码注释，作者本人在 2026-09-02 左右写下并自陈「纯公式这一档从未被测过」「机制：广泛报道 ≠ 重要」「接受这个降级是明确决定，不是没看见」）",
  "conditions": [
    "blockScore(distinctSources, articleCount) = log2(1+源数) + 0.5·log2(1+篇数)，纯公式、零 LLM，取代 story-validation 的 LLM importance(1-10)",
    "blockImportance 是 blockScore 的取整钳位版本，仅供下游 storyThreads 的 latest_importance>mean_importance 升温判断与 ORDER BY importance 使用，代码注释明确写「排序不要用它——排序用 blockScore 原值」",
    "storyValidation.ts（services/meridian-ai-worker/src/prompts/ 与 services/meridian-ai-worker/src/services/story-validation.ts）仍存在于代码库并被 apps/backend/src/workflows/auto-brief-generation.ts 等处引用，但用于选择层排序的 LLM importance 路径已被 blockScore 取代——storyValidation.ts 是否还被用于其他用途（例如别的字段校验）未在本节点核实，不确认其「已完全退役」，只确认「排序键已经换成纯公式」",
    "2026-09-02 那次实测（零 LLM 重排真实数据）具体换人：挤进前 15 的包括航母停靠泰国(9源16篇)、图派克案宣判(7源15篇)等；被挤出去的包括刚果埃博拉死亡超3000(3源4篇)、习近平访埃及(3源5篇)等——这次「换人」实测本身也没有对应的 NDCG/recall 读数，只是定性列出了排序结果差异"
  ],
  "evidence_origin": "local_record",
  "relations": [],
  "kind": "gap",
  "invalidates_when": "有人针对 blockScore/blockImportance 这一档排序键补做了 NDCG 或等价的排序质量评估（哪怕是复用 selection/BASELINE.md 同一批金标重新跑一次），之后这条「未测」的记录应当被新的实验结果取代，而不是继续引用本节点"
}
---

**这是一个尚未解决的缺口，不是一次失败的实验**——没有任何 harness 跑过、也没有任何 gold
标注过 `blockScore`/`blockImportance` 这一档排序键的效果好坏。记录它的理由是：如果不写
下来，删掉 `scripts/eval/selection/` 之后，"NDCG=0.958 这把尺"和"生产实际在跑的排序公式"
之间的错位关系就彻底没人知道了——将来有人翻出 BASELINE.md 的历史版本（或翻到这条知识节点），
可能会想当然地把 0.958 当成当前排序质量，这是错的。

## 时间线

1. 2026-06-06（commit 0b43902）：NDCG@10=0.958 基线建立，排序键是
   `LLM importance + COVERAGE_WEIGHT·log2(1+源数)`（见 [[experiment-selection-ndcg-baseline]]）。
2. 某个时间点（本节点未追踪具体 commit）：生产排序键换成了零 LLM 的 `blockScore`，
   代码注释里明确写这是"有代价的降级，不是等价替换"，并且列出了旧基线里两个组成部分各自
   的贡献（rubric +0.068、覆盖度 +0.018），暗示换成纯公式大概率会丢掉 rubric 那部分收益——
   但这只是作者基于旧数据做的**推断**，不是新的实测。
3. 到 2026-09-22（本次蒸馏时点）：纯公式这一档排序键依然没有对应的 NDCG 或任何排序质量
   读数。`scripts/eval/selection/` 这套 harness（BASELINE.md、rescore.ts、gold-worklist-
   2026-06-05.csv 等）本身面临被删除——一旦删除，连"曾经有把尺能测这个"的痕迹都会消失，
   除非有意识地把这个缺口写进知识库。

## 为什么这个缺口值得显式标注为未决事项

- **换排序键是明确决定，但决定没有配对验证。** 代码注释说"接受这个降级是明确决定，不是
  没看见"——这句话本身说明作者知道有风险，但目前项目里没有任何地方记录"这个风险后来
  兑现了没有"。
- **旧基线不能直接拿来推断新公式的表现。** 0.958 的大头贡献来自 LLM rubric（+0.068），
  而新公式恰恰砍掉了这部分，仅保留覆盖度那一档小贡献（+0.018）的思路（对数加权源数/
  篇数）。类推的方向是"新公式可能接近甚至低于 0.872（纯旧 importance 都没有）那一档"，
  但这只是基于历史分解数字做的合理怀疑，不是实测，不能当结论使用。
- **重新测的成本相对可控。** `gold-worklist-2026-06-05.csv`（140 行）和 BASELINE.md 描述的
  方法论如果在删除前完整入库或至少被本节点引用路径记录下来，之后想补测时不需要从零设计
  金标格式。
