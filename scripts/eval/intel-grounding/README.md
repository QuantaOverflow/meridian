# Intel-grounding eval（P2.5）

验证**情报报告对其输入 RSS 文章是否忠实**（grounding）。这是忠实度门拿来当"真相源"对比 brief 的那个对象，此前整条链零设防。judge 判情报报告的每条 claim 在源文章里 `supported / unsupported / contradicted`。

方法论与 harness **整套搬自 `../faithfulness/`**（同一套 judge prompt、同一套 meta-eval κ/per-class 算法、同一套 dev/heldout 切分与合成扰动思路）。差别只在被评对象/真相源换了一层：

| | faithfulness | intel-grounding |
|---|---|---|
| SOURCE（真相） | per-story 情报报告 | **情报分析的输入 RSS 文章**（`<articles>` 块） |
| 被评对象 | brief 的 claim | **情报报告**的 claim |

> ⚠️ **本线状态：harness ready，judge 未验证。** 还没有真人金标，没有跑过 κ 验收。在用户完成"金标 + κ 验收"前，**不得**把本线的任何读数当可信。见末节"还差什么"。

---

## 数据来源

每个 brief workflow 的每个 story 都有一条 `intelligence_analysis` LLM 调用，存在 backend observability：

- 列调用：`GET /observability/runs/:workflowId/llm-calls`（筛 `phase=intelligence_analysis`）
- 取全文：`GET /observability/llm-calls/<key>` → `request.messages[0].content`（= 情报 prompt，内嵌 `<articles>` 输入文章）+ `response.content`（= 情报报告，含 `<final_json>`）

`intel-source.ts` 负责把这两端拆开：
- **SOURCE** = prompt 里 `<articles>…</articles>` 之间的文章全文（剔除指令脚手架，避免 judge 把指令当事实源）
- **被评对象 prose** = 情报报告 JSON 摊平的 prose（executiveSummary / timeline.description / significance & signalStrength reasoning / entity role / factualBasis / contradictions / informationGaps），解析复用 runtime 的 `AIResponseParser.parseIntelligenceResponse`

---

## 跑法

依赖与 faithfulness 一致（本地 `node_modules`：tsx + typescript + @types/node）。若 `node_modules` 不存在，在本目录 `pnpm install`。

```bash
# 1) 生成盲标 worklist（拉 observability → 抽 claim → judge 分层过采非-supported）
#    需要能访问 backend（*.workers.dev 国内需代理）。LLM 走真实 DashScope，会计费。
BATCH=2026-06-17 pnpm worklist                       # 默认 6 个 admin-brief
pnpm worklist admin-brief-XXXX                        # 指定 workflow
#   env: BACKEND_URL, AI_WORKER_URL, JUDGE_MODEL(qwen-max), WORKLIST_MAX(80),
#        CONCURRENCY(5), MAX_STORIES_PER_WF
#   产出：worklist/<batch>.blind.jsonl（给标注者，藏 judge 答案）
#         worklist/<batch>.judge.jsonl（judge 分层预测，critic 对比用）

# 2) 合成 contradicted 批（确定性最小扰动，可信、免标）
pnpm perturb                                          # 读 worklist/perturb-base.json
#   生成器只做"材料化 + 双重逐字校验"(from 在 claim、source_quote 在源)，不猜语义
#   产出：gold/synthetic-contradicted.jsonl（gold=contradicted, synthetic:true）

# 3) 跑单份报告的全量 grounding（探查/排错用，非验收）
pnpm score admin-brief-XXXX 0                          # workflow + storyIndex

# 4) meta-eval：在金标上验 judge（κ / per-class TPR/TNR / gate）
pnpm meta gold/judge-gold.jsonl                        # SPLIT=dev|heldout|all
#   gate：κ≥0.6 且 幻觉类召回≥0.7。调 prompt 只看 dev，最终只在 heldout 报。
```

**source 旁车**：worklist 把全量 source 内联进 blind 表（体积大、gitignored）。落 gold 时按 faithfulness 模式抽出紧凑版 `gold/judge-gold.jsonl` + `gold/sources.jsonl`（`{brief_id, source}`，brief_id = story_ref 如 `admin-brief-XXXX#story0`）。`meta-eval.ts` 与 `build-perturb-batch.ts` 都按 brief_id 从旁车取 source。

---

## 合成批规模与设计

`build-perturb-batch.ts` 读 `worklist/perturb-base.json`（人挑的"source 确实支撑"的 claim + 显式扰动意图），FactCC 式五类最小扰动：`number` / `negation` / `direction` / `entity` / `misquote`。每条经**双重逐字校验**（`from` 在 claim、`source_quote` 在该 story 的源）才输出，gold 由构造方式确定为 `contradicted`，无需人判。

当前仓内 `perturb-base.json` 是 **4 条占位模板**（`admin-brief-XXXX`，覆盖 number/negation/direction/entity 各一），用于演示格式与跑通管线——**不是真实样本**。用户需替换为从真实情报报告抽出的 claim + 真实 `source_quote` 后才能产可信合成行。

---

## 还差什么才算 eval 真正完成（必须用户在裁定环里做）

本目录交付的是 **harness + 合成扰动生成器 + 候选材料模板**。按项目铁律（`docs/eval-playbook.md`：凡 LLM-judge eval，裁判本身必须人工金标验过 κ/TPR/TNR 才算数），以下**只能由用户做**：

1. **建真人金标**：`pnpm worklist` 产盲标表 → 领域专家照 `rubric.md` 标 `(claim, source) → verdict`，**分层过采** `unsupported`/`contradicted` 及情报特有失败（跨文章合成、补日期、虚构 contradictions）。起步 ≥100 条，锁 held-out。先两人标一小片算 inter-rater κ 当上限。
2. **填充并校验合成批**：把 `perturb-base.json` 占位换成真实 claim + 真实 `source_quote`，`pnpm perturb`，**人工抽查**确认每条扰动确实造成 contradicted、锚点逐字对，再 merge 进 `gold/judge-gold.jsonl`。
3. **跑 κ 验收闸**：`pnpm meta gold/judge-gold.jsonl`，SPLIT=heldout 看 **κ≥0.6（目标 0.8）且幻觉类召回≥0.7**。不过 → 先调共用 prompt（`faithfulness-prompts.ts`，改后两条线都重跑 meta），仍不过 → **换非 Qwen 家族 judge**（情报报告由 qwen-long 生成、judge 是 qwen-max，self-preference 泄漏风险高）。
4. **只有 κ 验收过，本线读数才可信**，才能据此判断"情报报告对原文忠不忠"，进而决定是否给情报层加门/改 prompt。

在第 3 步通过前，禁止声称 "intel-grounding judge 可信" 或 "情报层 eval 做完了"。
