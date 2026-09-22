# intel-grounding 标注规范（自包含）

人照此规范标注 `(情报报告 claim, 输入 RSS 文章) → verdict`，产出 `labels.jsonl`。

> **核心原则**：标的是「claim 相对 SOURCE 是否成立」，**不是**相对真实世界。
> 这里 SOURCE = 喂给情报分析的**那一簇输入 RSS 文章全文**（prompt 的 `<articles>` 块，
> 快照在 `sources.jsonl`）。情报报告写的事就算是真的，只要这簇文章里没有，也算 `unsupported`。

**本文件是自包含的。** 原版（`eval/intel-grounding/rubric.md`）只写了与 faithfulness 的差异，
判据主体在 `eval/faithfulness/rubric.md` 里。2026-09-22 清理时 faithfulness 整条链退役，
那份 rubric 差一步被删——一旦删掉，这 100 条标签就变成无法解释的字符串。
所以这里把两份合成一份，不再跨目录引用任何东西。

---

## 1. 谁来标、怎么标

- **一个领域专家定标准**（"仁慈独裁者"），不要委员会平均。
- 每条都写一句 `note` 说明判据——既是复核依据，也是未来 few-shot 素材。
- 先两人独立标一小片（约 20 条）算 inter-rater κ 当上限；分歧对齐 rubric 再继续。
- **binary / categorical 判，不要打分。**

## 2. 判前必做：decontextualization（指代消解）

孤立的 claim 常无法判。标注（和喂 judge）前，把 claim 变自包含：

- 代词还原：「他否认了指控」→「<具名人物> 否认了 <具体指控>」
- 省略补全：「该公司将裁员」→「<具名公司> 将裁员」
- 消解后仍无法独立判定 → 标 `note: "underspecified"`，**不要**塞进金标（坏样本污染 κ）

跳过这步是 spurious `unsupported` 的头号来源。情报报告里「该组织」「此次行动」很多，
本线 prose 已给每条加了 `[field]` 前缀（summary / timeline / …）作审计线索，
但消解仍按原 claim 文本做。

## 3. 三个 verdict（factual 通道）

| verdict | 定义 | 关键边界 |
|---|---|---|
| **supported** | source 直接陈述或清楚蕴含该 claim | 允许改写 / 归纳 / 跨句聚合，**不要求逐字**。忠实的摘要句被 source 蕴含即可 |
| **unsupported** | source 既没说也没否定——一个无源添加（可能是幻觉） | claim 多出 source 没有的具名细节（地点 / 数字 / 人名 / 时间）即属此类，**哪怕主句其余部分 supported** |
| **contradicted** | source 断言了与 claim 不相容的内容 | source 说 A，claim 说非 A |

**`unsupported` 与 `contradicted` 必须分清**（混了 κ 会崩）：source 没提 → `unsupported`；
source 说了相反 → `contradicted`。

**复合 claim 拆开判**：一条 claim 里混了 supported 部分 + 无源细节，按最严判
（有无源细节 → `unsupported`），并在 note 标明哪部分无源。

## 4. 两个 verdict（analytical 通道）

分析句（解读 / 推断 / 预测）允许超出字面事实，只判前提：

| verdict | 定义 |
|---|---|
| **consistent** | 对 source 中确实存在的事实的一个可辩护解读（即便推断本身超出了它们） |
| **contradicts_facts** | 推断依赖或断言了 source 否定的东西，或针对 source 中根本不存在的实体 / 事件 |

情报报告的 `informationGaps`、`significance.reasoning` 多是 analytical。

## 5. 这一层特有的四类失败（标注时重点盯）

情报分析做深度综合（跨多篇文章合成、推断动机、补时间线），比 brief 改写更易"脑补"：

1. **跨文章合成幻觉**：报告把 A 文的实体 + B 文的事件错误嫁接成一个不存在的事实 →
   该组合源里没有 → `unsupported`；源否定 → `contradicted`
2. **补全的时间线**：`timeline[].date` 是高发区——模型常把"近期"补成一个具体日期。
   源里没有该日期 → `unsupported`；源给的是别的日期 → `contradicted`
3. **虚构的 contradictions**：报告 `contradictions` 字段声称"源里存在某冲突"。
   当作**对源的事实断言**判：源里真有这两个互斥说法吗？没有 → `unsupported`
4. **signalStrength / significance 的 reasoning**：常含对源可靠性的断言
   （"主要来自低可信源"）——源里真有可佐证的可靠性信号吗？

## 6. 采样：别随机，要分层

按下列维度分层，并**过采稀有类**（否则全是 supported，幻觉类召回算不出来）：

- **verdict 类**：刻意补足 `unsupported` / `contradicted` 各 ≥ 一定量
- **claim 类型**：数值 / 归属引语 / 因果 / 时间——失败画像不同
- **报告字段**：timeline / contradictions / summary / entity-role——不同字段失败画像不同
  （时间线易补日期，contradictions 易虚构）
- **难例**：重度改写句、跨远距源 claim

**规模**：起步 ≥ 100 条落 held-out；judge prompt 的调参只在 dev 切片上做，最终 κ 只在 held-out 上报。

⚠️ 本批实际没做到过采稀有类，见 `manifest.json` 的 `limitations`。

## 7. 人裁终裁政策（2026-07-10 定稿）

此前两个 session 对同批样本裁出过相反结果，根因就是本节缺失。标注与复审必须遵守。

1. **缺口 / 元断言类 claim**（`informationGaps`、`signalStrength.reasoning` 里的
   "no X is available"、"reporting is consistent across A/B/C" 等）：
   当作**对源覆盖状态的可核验断言**判——源包完整在手，缺口是否真实存在可机械核验；
   核验为真 → `supported`（被源整体蕴含），核验为假（源里其实有 X）→ `contradicted`。
   **不采用**"必须源里明说'不存在'才算 supported"的字面派裁法：现实中没有报道会写
   "本文未提供分层数据"，那条规则会把整个 `informationGaps` 字段判死刑，让 enforce
   专门拦掉报告最诚实的自我限定（误拦方向）。
   终裁样例：`#story9#22`（无死亡分层）、`#story9#23`（18M 无第三方核证）、
   `#story0#8`（四家媒体交叉印证）→ 均 `supported`。

2. **日期 / 时间可源内推算，解析时按解析值判**：源给相对时间（"Friday"、"last week"）
   而文章发布时间戳也在源内 → 解析出的具体日期视为"源给了日期"；claim 与之冲突 →
   `contradicted`，**不是** `unsupported`。判官该抓的恰是"具体日期写错"，裁成轻罪
   会让尺子对日期错误降敏（日期正是 qwen 的已知盲区）。
   终裁样例：`#story6#9`（源 Friday + 发布日 6/1–6/2 → 首令 5/29，claim 写 31 May，
   且 2026-05-31 为周日）→ `contradicted`。

3. **复合 claim 按"逐成分核源"后再定**，不许凭"太长 / 绑了多件事"直接判 `unsupported`——
   `#story13#7`（AUKUS 三成分）曾因 22k 长源漏检被误维持 `unsupported`，逐字核后
   三成分全在源里 → `supported`。时态改写（源过去事件、claim 历史现在时）与 "internal"
   级修饰词属可容改写，不构成无源细节。

## 8. 接受闸

held-out 上：

- **Cohen's κ ≥ 0.6**（目标 0.8）
- **幻觉类（unsupported + contradicted）召回 ≥ 0.7**

不过则 judge 不可信：先调 judge prompt（强制 CoT 取证），仍不过则**换非 Qwen 家族 judge**。

> 金标的真值地位不可动摇：judge 与金标冲突时，先怀疑 judge，不是改金标去迁就 judge。

⚠️ 只看 κ 不够：本批 88% 是 `supported`，判官把少数类全判错也能拿高一致率。
必须同时看少数类那一侧的召回，见 `manifest.json` 的 `labelBalance`。

## 9. self-preference 泄漏

情报报告由 `qwen-long` 生成，judge 是 `qwen-max`——**同家族，grounding 分数可能系统性虚高**。
本线因被评对象是 qwen 的深度综合输出，泄漏风险只多不少。κ 验收若临界，优先换非 Qwen judge。

`claude-secondlabel.jsonl` 就是为此做的异家族第二标注。
