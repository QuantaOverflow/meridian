# 文章质量门标注规范（金标 rubric）

人照此规范标注 `(title, content) → {content_quality, completeness}`，产出 `gold/quality-gold.jsonl`，用来验证 `articleAnalysis` 这把「质量尺」（`meta-eval.ts`）。方法论依据见 `docs/eval-playbook.md` §1–2。

> **核心原则**：标的是「这篇 scraped 文章正文作为下游聚类/简报输入的质量与完整度」——**不是**这条新闻本身重不重要。一篇关于无聊小事的完整报道 `content_quality=OK`；一段抓崩的重要新闻 `content_quality=JUNK`。

被评对象的判据来自 `services/meridian-ai-worker/src/prompts/articleAnalysis.ts`。标注时与被评对象用**同一套定义**，这样 κ 量的才是「尺准不准」而非「定义不同」。

---

## 1. 谁来标 + 怎么标

- **一个领域专家定标准**（"仁慈独裁者"），不要委员会平均。
- 每条写一句 `note` 说明判据——既是复核依据，也是未来 few-shot 素材。
- 先两人独立标一小片（~20 条）算 **inter-rater κ** 当上限；分歧对齐 rubric 再继续。
- **categorical 判，不打分。**
- 标注者**看不到 scorer 的预测**（盲标，sidecar 在 `worklist/*.pred.jsonl` 仅 critic 用）。

---

## 2. 维度一：content_quality（OK | LOW_QUALITY | JUNK）

| 值 | 定义 | 关键边界 |
|---|---|---|
| **OK** | 标准新闻报道/分析/访谈/新闻稿等有实质事实内容，结构清晰、有信息量。 | 哪怕题材小、不重要，只要是正经报道就 OK。 |
| **LOW_QUALITY** | 有内容但有问题：极薄/极短无新信息、重观点轻事实、名人八卦、煽动/标题党（即便属实）、误抓的评论区 UGC、每条细节极少的清单/合集。 | "可能有用但要打旗标"。**与 JUNK 的界**：LOW_QUALITY 仍是**散文/能读的内容**，只是质量差。 |
| **JUNK** | 明显不是可用文章正文：错误页（404/500）、登录/订阅提示、只有导航/站点样板、纯代码、无上下文的原始数据表、机器生成乱码、模板重复文本。 | "应被整篇过滤"。**与 LOW_QUALITY 的界**：JUNK 是**非文章**（抓取失败/样板），不是"差文章"。 |

---

## 3. 维度二：completeness（COMPLETE | PARTIAL_USEFUL | PARTIAL_USELESS）

| 值 | 定义 | 关键边界 |
|---|---|---|
| **COMPLETE** | 看起来是输入里能拿到的全文。 | |
| **PARTIAL_USEFUL** | 文本被截断（付费墙淡出、"阅读更多"截断、突然断在段中），但核心信息**够**理解基本故事并抽取有意义数据。 | 与 USELESS 的界：**核心事实在不在**。 |
| **PARTIAL_USELESS** | 只有标题/导语/一小段，几乎没有可用内容，做摘要/抽关键词不可能或无意义。 | |

---

## 4. 两维度独立标，门裁决由其推导

`content_quality` 与 `completeness` **分别**标，不要互相迁就。门的二元裁决（KEEP/REJECT）由 `meta-eval.ts::deriveGate` 按 runtime 门逻辑自动折叠：

```
REJECT  当  content_quality ∈ {LOW_QUALITY, JUNK}  或  completeness == PARTIAL_USELESS
KEEP    其余
```

> ⚠️ 这条折叠规则是从 `apps/backend/src/workflows/auto-brief-generation.ts::validateContentQuality` 复刻的。**若 runtime 门逻辑改了，必须同步 `types.ts::deriveGate`，否则 eval 量错了边界。**

只有当你认为「两维度都不脏但这篇就是该拦/该放」这种门逻辑本身的反例时，才显式填 `gold_gate` 覆盖推导值，并在 `note` 说明——这类样本正是用来质疑门逻辑（而非质疑 scorer）的。

---

## 5. 采样：别随机，要分层 + 过采脏 / 边界（见 playbook §1）

文章质量分布严重偏 `OK`/`COMPLETE`。随机采样 → 盲标表几乎全是干净文章 → REJECT 召回算不出来。务必**分层 + 过采**：

- **门裁决类**：刻意补足 REJECT 样本（JUNK / LOW_QUALITY / PARTIAL_USELESS）到一定量——gate 通道算它们的召回。
- **边界档**：过采 `LOW_QUALITY`（OK↔LOW 的界）与 `PARTIAL_USEFUL`（USEFUL↔USELESS 的界）——cutoff 卡对没卡对就看这层。`build-worklist.ts` 已默认过采这两类。
- **失败画像**：错误页、付费墙截断、UGC/评论、清单合集、机器生成、极短更新——各覆盖若干。
- **来源/语言**：多语新闻系统，过采非英文与不同源类型（news vs tech feed）。

**规模**：起步 ≥100 条落 held-out；scorer prompt 的调参只在 dev 切片做，最终 κ/召回只在 held-out 报。

---

## 6. 金标格式（JSONL，一行一条）

```json
{"id":"<article_id 或哈希>","title":"...","content":"<scraped 正文>","url":"<可选>","gold_content_quality":"LOW_QUALITY","gold_completeness":"COMPLETE","strata":{"kind":"gossip_thin","lang":"en"},"note":"名人八卦、极少事实","split":"heldout"}
```

字段：
- `gold_content_quality`: `OK` | `LOW_QUALITY` | `JUNK`
- `gold_completeness`: `COMPLETE` | `PARTIAL_USEFUL` | `PARTIAL_USELESS`
- `gold_gate`（可选）: `KEEP` | `REJECT`——仅当要覆盖 deriveGate 推导值时填
- `split`（强烈建议）: `dev` | `heldout`——最终读数只在 heldout 报
- `strata` / `note`（可选）：分层审计 + 判据
- `#` 开头行与空行被忽略

---

## 7. 接受闸（meta-eval.ts，占位阈值）

held-out 上，以 **gate 通道**为准：
- **Cohen's κ ≥ 0.6**（目标 0.8）
- **REJECT 召回 ≥ 0.7**（抓脏率——脏文章被拦住的比例）

> ⚠️ 这是 harness 的**占位**阈值，不是定论。文章质量门是「拦脏优先」：REJECT 召回不足（脏文章漏进聚类）比 REJECT 精度不足（好文章误拦）更伤下游。但误拦率（= 1 − REJECT 精度）过高会丢真新闻。**真正的接受阈值与 cutoff 该往松/紧调，由用户在裁定环里依据业务容忍度定**（同时看 REJECT 召回与精度的权衡）。

> 金标的真值地位不可动摇：scorer 与金标冲突时，先怀疑 scorer（调 articleAnalysis prompt），不是改金标迁就 scorer。对不齐就**换 scorer 模型**（当前 qwen-plus/turbo）。
