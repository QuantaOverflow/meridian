# Intel-grounding Judge 标注规范（金标 rubric）

人照此规范标注 `(情报报告 claim, 输入文章 source) → verdict`，产出 `gold/judge-gold.jsonl`，用来验证 grounding judge 这把尺（`meta-eval.ts`）。

本 rubric **直接复用 faithfulness 的 grounding 判据**（verdict 定义、decontextualization、分层、接受闸完全一致）。下面只标注**针对「情报报告 vs 输入文章」需要特别注意**的差异——其余请同时参阅 `../faithfulness/rubric.md`。

> **核心原则**（与 faithfulness 一致）：标的是「claim 相对 SOURCE 是否成立」，**不是**相对真实世界。这里 SOURCE = 喂给情报分析的**那一簇输入 RSS 文章全文**（即 prompt 的 `<articles>` 块）。情报报告写的事就算是真的，只要这簇文章里没有，也算 `unsupported`。

---

## 与 faithfulness 的关键差异（务必先读）

| 维度 | faithfulness | intel-grounding（本线） |
|---|---|---|
| SOURCE | 喂给 brief 生成的 per-story 情报报告 | 喂给情报分析的**原始 RSS 文章**（`<articles>` 块） |
| 被评对象 | brief 的 claim | **情报报告**的 claim（executiveSummary / timeline / 推断 / 矛盾 / 缺口） |
| 这层防什么 | brief 是否忠于情报报告 | **情报报告是否忠于原文**（链上最关键、此前零设防的真相源） |

**为何这层更易钻入幻觉**：情报分析做深度综合（跨多篇文章合成、推断动机、补时间线），比 brief 改写更易"脑补"。标注时重点盯下面四类情报特有失败：

1. **跨文章合成幻觉**：报告把 A 文的实体 + B 文的事件错误嫁接成一个不存在的事实 → 若该组合源里没有 → `unsupported`（或源否定 → `contradicted`）。
2. **补全的时间线**：`timeline[].date` 是高发区——模型常把"近期"补成一个具体日期。源里没有该日期 → `unsupported`；源给的是别的日期 → `contradicted`。
3. **虚构的 contradictions**：报告 `contradictions` 字段声称"源里存在某冲突"。把它当**对源的事实断言**判：源里真有这两个互斥说法吗？没有 → `unsupported`（报告编了一个不存在的矛盾）。
4. **signalStrength / significance 的 reasoning**：常含对源可靠性的断言（"主要来自低可信源"）——源里真有可佐证的可靠性信号吗？

---

## 沿用 faithfulness 的判据（不复述，去读 ../faithfulness/rubric.md §2–7）

- **§2 decontextualization**：情报报告的 claim 同样要先消解指代再判（报告里"该组织""此次行动"很多）。本线 prose 已给每条加了 `[field]` 前缀（summary/timeline/...）作审计线索，但消解仍按原 claim 文本做。
- **§3 三个 factual verdict**：`supported` / `unsupported` / `contradicted` 定义与边界**完全一致**。`unsupported`(源没提) vs `contradicted`(源说反) 的分清同样是 κ 不崩的关键。
- **§4 两个 analytical verdict**：`consistent` / `contradicts_facts`。情报报告的 informationGaps、significance reasoning 多是 analytical。
- **§5 分层 + 过采稀有类**：除 faithfulness 的维度外，**额外按报告字段分层**（timeline / contradictions / summary / entity-role）——不同字段失败画像不同（时间线易补日期，contradictions 易虚构）。
- **§6 金标格式**：见本目录 `gold/judge-gold.example.jsonl`。新增可选 `strata.field` 标注 claim 出自哪个报告字段。
- **§7 接受闸**：held-out 上 **κ ≥ 0.6（目标 0.8）** 且 **幻觉类召回 ≥ 0.7**。不过则先调 judge prompt，仍不过**换非 Qwen 家族 judge**。

> judge prompt 是与 faithfulness **共用的同一份**（`faithfulness-prompts.ts`）。本线不另存 prompt，避免漂移；若发现情报层有 faithfulness prompt 覆盖不到的失败模式，应在那份单一真源上加判据并**两条线都重跑 meta**。

---

## 人裁终裁政策（2026-07-10 定稿，标注/复审必须遵守——此前两个 session 对同批样本裁出过相反结果，根因就是本节缺失）

1. **缺口/元断言类 claim（informationGaps / signalStrength reasoning 里的 "no X is available"、"reporting is consistent across A/B/C" 等）**：
   把它当**对源覆盖状态的可核验断言**判——源包完整在手，缺口是否真实存在可机械核验；
   核验为真 → `supported`（被源整体蕴含），核验为假（源里其实有 X）→ `contradicted`。
   **不采用**"必须源里明说'不存在'才算 supported"的字面派裁法：现实中没有报道会写
   "本文未提供分层数据"，那条规则会把整个 informationGaps 字段判死刑，让 enforce
   专门拦掉报告最诚实的自我限定（误拦方向）。
   终裁样例：`#story9#22`（无死亡分层）、`#story9#23`（18M 无第三方核证）、`#story0#8`
   （四家媒体交叉印证）→ 均 supported。

2. **日期/时间可源内推算解析时按解析值判**：源给相对时间（"Friday"、"last week"）而
   文章发布时间戳也在源内 → 解析出的具体日期视为"源给了日期"；claim 与之冲突 →
   `contradicted`（适用 faithfulness rubric "源给的是别的日期→contradicted"），
   **不是** unsupported。判官该抓的恰是"具体日期写错"，裁成轻罪会让尺子对日期错误降敏
   （日期正是 qwen 已知盲区）。
   终裁样例：`#story6#9`（源 Friday+发布日 6/1–6/2 → 首令 5/29，claim 写 31 May，
   且 2026-05-31 为周日）→ contradicted。

3. **复合 claim 按"逐成分核源"后再定**，不许凭"太长/绑了多件事"直接判 unsupported——
   `#story13#7`（AUKUS 三成分）曾因 22k 长源漏检被误维持 unsupported，逐字核后三成分
   全在源里 → supported。时态改写（源过去事件、claim 历史现在时）与 "internal" 级
   修饰词属可容改写，不构成无源细节。

---

## self-preference 泄漏（本线同样存在，且更隐蔽）

情报报告由 `qwen-long` 生成，judge 是 `qwen-max`——同家族，grounding 分数可能系统性虚高。faithfulness 已记录此风险；本线因被评对象是 qwen 的深度综合输出，泄漏风险只多不少。κ 验收若临界，优先考虑换非 Qwen judge。
