# 文章质量门 eval（P2）

给 `articleAnalysis` 这步打的**质量分**搭 eval：金标 + 指标，校准质量门 cutoff。

## 这条线在评什么

`articleAnalysis`（`services/meridian-ai-worker/src/prompts/articleAnalysis.ts`）对每篇 RSS 文章打两个质量维度：
- `content_quality`: `OK` | `LOW_QUALITY` | `JUNK`
- `completeness`: `COMPLETE` | `PARTIAL_USEFUL` | `PARTIAL_USELESS`

**质量门**（`apps/backend/src/workflows/auto-brief-generation.ts::validateContentQuality`）据此把低质文章拦在聚类之前：

```
REJECT  当  content_quality ∈ {LOW_QUALITY, JUNK}  或  completeness == PARTIAL_USELESS
KEEP    其余
```

> 注意：门是**分类阈值**，不是连续分数 cutoff。所谓"校准 cutoff" = 校准这条分类边界——验 scorer 在每个类、尤其在 KEEP/REJECT 边界上判得准不准，再决定门逻辑该往松/紧调。

这把尺从没做过 eval，无法判断它拦对没拦对。本 harness 验 **scorer↔人 一致性**，复用 faithfulness 那条线（`scripts/eval/faithfulness/`）的方法论：盲标表 + κ + per-class + dev/heldout 切分。

## 文件

| 文件 | 作用 |
|---|---|
| `types.ts` | 维度类型 + `deriveGate`（复刻 runtime 门逻辑，把两维度折叠成 KEEP/REJECT） |
| `scorer.ts` | 调 ai-worker `/meridian/article/analyze` 现打分 |
| `metrics.ts` | 混淆矩阵 / Cohen's κ / per-class TPR·TNR·precision（与 faithfulness 同源） |
| `build-worklist.ts` | 候选文章 → 现打分 → 分层（过采脏/边界）→ 盲标表 |
| `meta-eval.ts` | 金标上现打分 → 三通道（content_quality / completeness / gate）κ + per-class + cutoff 读数 |
| `rubric.md` | 标注规范（两维度定义、采样分层、接受闸） |
| `gold/quality-gold.example.jsonl` | 5 条种子金标（让 meta-eval 端到端能跑，**非真验证集**） |

## 跑法

```bash
cd scripts/eval/article-quality
pnpm install            # 装本地 tsx + typescript（见 package.json，本地 node_modules 模式）

# A) meta-eval（默认跑种子金标，端到端 smoke）
#    需要能访问 ai-worker（线上或本地 wrangler dev），真实 DashScope 计费
AI_WORKER_URL=http://localhost:8787 pnpm meta gold/quality-gold.example.jsonl

# 用真金标 + 只看 heldout：
AI_WORKER_URL=... SPLIT=heldout pnpm meta gold/quality-gold.jsonl

# B) 生成盲标表（先备好候选 JSONL，见下「数据来源」）
AI_WORKER_URL=... pnpm worklist candidates.jsonl
# → worklist/<date>.blind.jsonl（给标注者填 gold）+ worklist/<date>.pred.jsonl（旁车）
```

env：`AI_WORKER_URL`、`KAPPA_MIN`(0.6)、`RECALL_MIN`(0.7)、`CONCURRENCY`(4)、`SPLIT`(dev|heldout|all)、`WORKLIST_MAX`(80)、`BATCH`(日期)。

> 本地起 ai-worker：`cd services/meridian-ai-worker && pnpm wrangler dev --port 8787`。

## 数据来源（关键，有个坑）

**现在没有现成 backend 端点能一次拉「已打分文章 + 正文」**：
- `admin /articles`、`debug /r2-content-check` 都不返回 `content_quality`/`completeness`。
- 历史 `article_analysis` 的 LLM 调用**没落 R2**——`processArticles.workflow.ts` 调 `analyzeArticle` 时没传 `traceId`，`loggedChat` 缺 trace_id 即跳过写入。所以 observability `llm-calls/` 里翻不到文章分析样本。
- 文章级数据**确实存在 DB**：`$articles.content_quality` / `.completeness`（旧分，可用于分层）+ 正文在 R2（按 `$articles.contentFileKey`）。

所以候选文章要由用户从 **DB + R2** 自行导出成候选 JSONL（每行 `{id, title, content, url?}`）。两条路：
1. **SQL + R2**（推荐）：`SELECT id, title, url, content_quality, completeness, content_file_key FROM articles WHERE status='PROCESSED' AND publish_date > now()-interval '14 days'`，再按 `content_file_key` 从 `ARTICLES_BUCKET` 取正文拼成 JSONL。可借 `pnpm -F @meridian/database studio` 或 wrangler r2。
2. **新建一个只读导出端点**（属 runtime 改动，本任务范围外，需用户决定）。

> harness 本身不连 DB/R2（避免引入 Neon/R2 凭据依赖），只吃候选 JSONL。这是有意的解耦：scorer 是「现打分」而非读旧分，eval 验的是当前 prompt 这版尺。

## cutoff 校准思路

`meta-eval.ts` 的 **gate 通道**给出校准读数：
- **REJECT 召回**（抓脏率）：真该拦的脏文章里拦住几成。低 → 脏文章漏进聚类（garbage in）。
- **REJECT 精度**（= 1 − 误杀率）：拦下来的里头真该拦的占比。低 → 好文章被误拦、真新闻丢失。

文章质量门「拦脏优先」：召回不足通常比精度不足更伤下游。但误杀过高会让简报漏掉真事件。校准就是看这俩的权衡，决定门逻辑往哪调，例如：
- 召回够、精度低（误杀多）→ 门太严：考虑把某类（如 `LOW_QUALITY`）从 REJECT 放回 KEEP，或只在 `JUNK` 上拦。
- 召回低（漏脏多）→ 门太松：考虑把 `PARTIAL_USEFUL` 也纳入更严判，或修 prompt 让 scorer 更敢打低分。
- 也看 per-class 错配：是哪个维度、哪两类之间错配多（content_quality 的 OK↔LOW，还是 completeness 的 USEFUL↔USELESS）。

> 这些调整动的是 **prompt 或门逻辑（runtime）**，本任务不做——只产出读数供裁定。

## 结果（2026-07-01，首轮金标 + 判官读数）

**金标**：`gold/quality-gold.jsonl`（73 条，非 5 条种子）。溯源：从 `scripts/eval/scrape-quality` 的 73 篇真实 R2 正文语料，按本 rubric 标 content_quality/completeness。标注方法（跨家族 + 真人裁定，避免单模型共盲）：
- 主标注 = Claude；第二标注 = **codex 独立盲标**（`gold/codex-labels.jsonl`，跨模型家族）；
- 二者 15 条分歧由**真人逐条裁定**（原则：高质量去娱乐化新闻=OK，娱乐/观点/太短=LOW，有具体事实短新闻=OK，纯色彩/预告=LOW），落定为金标（`adjudicated:true`）。

**判官读数（金标 vs 生产已存 content_quality，n=73）**：
- content_quality **κ=0.648**；跨家族参照 codex vs 真人金标 κ=0.808（codex 是更好的标注者）。
- 判官**中度过判 LOW**（LOW precision 0.39：判 LOW 常判错），但——
- **⚠️ 别把这精度当生产误杀率**：73 条是**过采脏样本**（塞满 LOW/JUNK 以便测）。**无偏随机 80 篇实测：判官打 LOW 0 次、误杀（REJECT 真新闻）0/80，Wilson 95%CI [0,4.6%]**。因 LOW 生产占比仅 1.3%，过采把精度放大了。
- **净结论：判官现状可上生产（本就在生产），误杀≈0；收紧 LOW prompt = 可选打磨非急病。** JUNK 三方稳无争议。

**局限**：15 分歧真人裁定、58 条 Claude=codex 一致未真人核（双模型一致高置信）；completeness 维度未裁；n=73（<理想≥100）；κ 是"金标 vs 生产已存标签"（非重跑当前 prompt——那需 `pnpm meta` 走 ai-worker 计费）。

## 还差什么才算 eval 真正完成（必须用户在裁定环里做）

本 harness **只是搭好了脚手架 + 候选材料**，下面这些没做，eval 不算完成：

1. **真人金标**（铁律，见 `docs/eval-playbook.md` §2）：现在只有 5 条种子样本（让 meta-eval 能跑），**不是验证集**。要由领域专家照 `rubric.md` 标 **≥100 条**、分层过采脏/边界、锁 held-out。candidates JSONL → `pnpm worklist` → 标注者填盲标表 → 汇总裁定 → `gold/quality-gold.jsonl`。
2. **inter-rater κ 上限**：先两人独立标 ~20 条算人类彼此一致度，作为 scorer κ 的天花板。
3. **接受闸由用户裁定**：`meta-eval.ts` 里 `KAPPA_MIN=0.6 / RECALL_MIN=0.7` 是**占位**，不是定论。真接受阈值要用户依业务容忍度（漏脏 vs 误杀谁更不能忍）定。
4. **cutoff 校准 + 落地**：依 gate 读数决定门逻辑/prompt 怎么调——属 runtime 改动，本任务范围外，由用户做并自行 eval 复核。
5. **（可选）回归闸**：金标稳定后，把 `pnpm meta` 钉死 scorer model + 阈值，与 NDCG / faithfulness 闸并列进 CI（见 playbook §6）。

> ⚠️ 在 1–3 完成前，**不能**声称"质量门校准好了 / scorer 验过了"。scorer 是一把还没验的尺，和 faithfulness judge 升 P0 前同理。
