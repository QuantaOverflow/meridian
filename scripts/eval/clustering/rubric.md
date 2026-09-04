# 事件金标标注规范（clustering / events-F1）

这份规范是 `gold/events-F1.jsonl` 的判据来源。**改判据就等于改尺**——任何修改都必须同时重标全部
事件，否则严格口径在不同事件上尺度不同，读数不可比。

---

## 一、判的是什么

判**「同一个 happening」——同一件发生过的事**，不是同一个主题、不是同一个实体、不是同一条故事线。

> 「尼泊尔洪灾」是一个 happening；「喜马拉雅冰川风险」是一个主题；「Trump」是一个实体。

### 为什么不追求一个更精确的单一定义

学界正面承认这条边界没有唯一答案。Vossen & Cybulska (2017, arXiv:1704.04259) §8 原文：

> "How far can we go to lump together event data? ... **peoples' intuitions on decomposing events to
> smaller units are also not clear-cut.** ... This is where event coreference could set a hard border
> but this also means that annotation and evaluation of data sets may need to be different, e.g.
> assigning not only event-coreference relations but also **subevent and topical relations**."

HiEve 语料（Glavaš et al. 2014）的粒度判定，**人类标注者之间一致性只有 69% F-score**，作者自陈任务
「认知负荷很高」。

所以本规范不用一个二元问题覆盖全部情况，改成**五档并存**，让主指标只吃最确定的那一档。

---

## 二、五档定义

| 档 | 定义 | 进指标吗 |
|---|---|---|
| `members` | 讲这件事本身 | ✅ 严格 + 宽松 |
| `related` | 因这件事才有这篇，但主语是别的议题 | 仅宽松 |
| `unverifiable` | 标题里没有任何锚点，只能靠邻近推断 | ❌ |
| `multi_label` | 一篇同时属于两个及以上事件 | ❌ 进指标，但**从纯度分母剔除** |
| `non_article` | 节目单、频道首页标题、无实质内容 | ❌ |

不属于上述任何一档的 → `out`，不写进文件（`borderline` 里可留判决痕迹）。

### members vs related：看这篇报道的主语

```
主语是「这次事件本身、它的组成部分、或它的直接产物」   → members
主语是「一个更大的议题、机制或计划」，事件只是案例      → related
```

实例（全部来自本金标的实判）：

| 标题 | 主语 | 判 |
|---|---|---|
| `Nepal army races to rescue 100 trapped in flooded hydropower tunnel` | 这次的救援 | members |
| `Missing tally rises to 2,482 ... as disaster toll hits 584` | 这次的伤亡 | members |
| `Nepal declines foreign rescue teams` | 这次的处置决策 | members |
| `China's information controls hamper assessment of Tibet flood damage` | 这次灾损如何被知悉 | members |
| `A melting glacier contributed to the deadly Nepal floods. Expect more like this` | 冰川消融这一机制 | **related** |
| `Could the China-Nepal disaster spur a safety rethink for a flagship rail project?` | 铁路项目 | **related** |
| `Power reversal: Nepal may import from India` | 电力贸易 | **related** |
| `What makes Nepal's geography so uniquely prone to disasters` | 尼泊尔地理 | **related** |
| `Ashwin's blunt warning to Rishabh Pant`（科伦坡赛后） | Pant 的打法 | **related** |

### 反应类的细分（`reaction_rule`）

「看主语」在反应类稿件上不够用，需要这一层：

```
争议当事方以正式身份采取的立场/行动   → members
旁观者的情绪、评论、行为聚合量        → related
```

| 标题 | 类型 | 判 |
|---|---|---|
| `Oslo mayor cancels own wedding after death of Norway's king` | 行动（有职务身份） | members |
| `Tennessee governor backs airport name change to honor Dolly Parton` | 行动 | members |
| `Ontario premier answers Trump's 'Lake America' with giant sign` | 行动 | members |
| `RSS chief's US visit faces protests` | 语法主语是这次访问 | members |
| `'Typical Trump, silly joke': 'Lake America' has Canadians laughing` | 情绪 | **related** |
| `US residents can't stop googling its old name` | 行为聚合量 | **related** |
| `Dolly Parton streams skyrocket after her death, up 2,109%` | 行为聚合量 | **related** |
| `How the Nepal flash flood unleashed a wave of anti-China misinformation` | 行为聚合量 | **related** |
| `Faf du Plessis shares heartfelt Nepal flood message` | 情绪表达 | **related** |

**推翻这条线时必须三组同时改。** 这条线是标注者画的，不是数据自带的。

### unverifiable vs out：有没有锚点

```
unverifiable  标题里没有任何锚点，只能靠同源/时间接近/地理关系推断  ← 没有信息
out           标题有锚点，但那个锚点指向别的事                     ← 信息指向别处
```

把「另一起同题材的发生」（比哈尔邦另一场洪水）放进 `related` 会污染 related 的语义——它是 `out`。

`out` 的一个额外档位：**发布时间早于本事件首报**。这是确定性排除，不是推断。

### multi_label

一篇同时报道两件事（周报、多主题简报、一篇同时写加沙与杰宁的稿子）。**它确实属于该事件**，所以
算纯度时不能当 false positive——算法把它放进正确簇反而被扣分是错的。故从纯度分母剔除。

---

## 三、标题不够时读正文

本金标的初版是**只读标题**建的（fixture 里没有正文）。2026-09-04 用 R2 正文裁定了 17 条不确定项，
成绩是：

```
标题推理判对   14 条
判错            3 条
```

判错的三条有共同点：**都是「规则推出来的自信答案」**。

- Qusra 两条：用「行为主体不同（以军 vs 定居者）、相隔 36 小时」推出该拆 → 正文显示是同一场自
  8 月 9 日起的持续围困的两次升级，**该合**
- `disaster toll hits 584` / `7 bodies swept into Gandak river`：用「标题不自足就不进」推出证据不足
  → 正文明确指向本事件，**该收**
- `Ashwin's warning to Pant`：判成证据不足 → 正文有明确的系列赛锚点，**不是证据不足，是 related**

**教训**：规则本身没错，错在用规则替代证据。凡是能取到正文的条目，读正文；取不到的，如实标
`unverifiable` 而不是硬判——它把「我不知道」显式记下来，所以后来能被正文裁掉。

正文取法：
```bash
psql "$PGURL" -At -c "select id, content_file_key from articles where id in (...)"
npx wrangler@4.120 r2 object get "meridian-articles-prod/<key>" --remote --pipe
```

---

## 四、已知偏差（用读数前必须知道）

1. **标题风格偏差**：`unverifiable` 曾集中在 Times of India——该源的标题惯例不重复事件名。把
   unverifiable 排除出严格口径会**系统性少算该源的贡献**，方向固定不是随机。换 fixture 后这个偏差
   会移到别的源，**必须重算不得沿用**。
2. **单篇事件**（7 个）完整率恒 1.0，无信息量 → 不进宏平均，只报「有没有被吞进大簇」。
3. **Dolly Parton 天然缺头**：讣告首报不在窗口内，窗口里只有主题各异的回指稿（旅游遗产 / 慈善 /
   地方回忆 / 女权 / 机场命名），没有共同事件锚点。已标 `exclude_from_primary`。
4. **加沙 8 条里多条单源**（半岛），拆分后单成员事件多，做跨源去重评估时统计意义有限。
5. **两类逐字重复必须分开**：同源同时刻 = 抓取脏数据（`duplicate_pairs`，打分时只计一次）；
   跨源同稿转发 = 去重算法该抓的正例（不进 `duplicate_pairs`）。混为一类会让该字段没法用。
6. **只覆盖全库 26%**。其余文章不属于这 24 个事件——三个标注者独立通读全库 + 独立复核确认无漏标，
   但这只保证「这 24 个事件没漏成员」，不保证「窗口里没有别的事件」。

---

## 五、建造过程（可复现）

1. 三个标注者（A/B/C）各自**通读全部 1031 条标题**、各负责若干事件、互不通气
2. 协调者统一判据后，三组按同一把尺各自复核并翻案（B/C 均自行翻掉过自己的判断）
3. 独立复核（codex，read-only）审粒度一致性、跨组不一致、系统性偏差、漏标
4. 按复核结论收紧（全部是降档，不删条目）
5. 用 R2 正文裁定全部 `unverifiable` 与争议 `related`

机械校验（每次改动后必跑）：id 全部存在于 `titles-F1.tsv`、五档互斥、无跨事件重复、
`members ∩ non_article = ∅`、`borderline.decision` 与实际归档一致。
