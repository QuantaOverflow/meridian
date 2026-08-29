# article-prompt-slim —— 一次性原型

## 问题

`src/prompts/articleAnalysis.ts` 的模板固定 **10,264 字符**，其中 47% 是三条 few-shot 示例、
36% 是 Detailed Criteria。而真实文章的**中位正文只有 2,912 字符**——模板是正文的 3.5 倍，
每天 686 篇各付一遍。

按奥卡姆剃刀：**保留 few-shot 这个技巧、砍到最小**。
要回答的是一个位置问题：**最小到哪一步会出现明显质量突变？**

## 怎么答

5 个变体 × 10 篇真实文章。变体按剃刀逐级收紧：

| id | 剃掉什么 |
|---|---|
| `full` | 不剃（基线 = 线上那一份，直接调生产函数，不抄） |
| `one` | 砍掉 Tech / Science 两条示例，留地缘政治那条 |
| `one-lean` | 上一档 + 示例去掉散文外壳，只留输入一行 + JSON |
| `minimal` | 上一档 + criteria 去掉举例与解释散文，**判据全留** |
| `zero` | 示例全砍。**这是对照，不是候选** —— 不测它就无法证明留下的那条示例在干活 |

fixtures 刻意不是「典型新闻」，而是 enum 字段最容易翻车的边界：中文 ×2、
`PARTIAL_USEFUL`、宣言体、体育转会、名人。质量突变会先在这些地方出现。

## 噪声地板

生产用 `temperature 0.1`，**非确定性**。所以基线跑两次，`full vs full₂` 的偏离就是地板。
任何变体落在地板内 = 与基线不可区分。**不建地板就会把抖动读成退化。**

## 看哪几个数

- **硬字段** `language / completeness / content_quality / primary_location` —— 枚举，
  下游驱动质量门。翻一个就是真回归，不看 Jaccard。
- **余弦** —— 五个数组拼成 `generateSearchText` 再 embed。这是聚类真正吃的东西，
  逐字不同没关系，**语义漂了才有关系**。裁决看这个。
- 软 Jaccard 只是辅助读数，别当判据。

## 跑

```bash
pnpm -F meridian-ai-worker prototype:slim
# 打本地 wrangler dev： AI_WORKER_URL=http://localhost:8787 pnpm -F ... prototype:slim
```

`[r]` 跑当前文章 · `[a]` 跑全部 10 篇 · `[s]` 汇总 · `[d]` 逐字段明细 · `[q]` 退出

一轮全跑 = 10 篇 × 6 臂 = 60 次调用，约 1,800 neurons ≈ $0.02。

## 完事之后

赢的变体从 `variants.ts` 抬进 `src/prompts/articleAnalysis.ts`；
`compare.ts` 里的 `generateSearchText` 是从 backend 拷来的副本，**不要一起带走**。
TUI 外壳丢掉。

---

# 结论（2026-08-29，跑了两轮，10 篇 × 6 臂）

## 剃刀落在 `minimal-loc`

模板 **10,264 → 3,733 字符（-64%）**，neurons **24.5 → 15.3（-38%）**，
年费 **$36 → $10**。

| 变体 | 模板 | 硬字段翻车（轮1/轮2） | 余弦均 | 余弦最差 | neurons |
|---|---|---|---|---|---|
| full（基线） | 10,264 | 0 / 0 | 1.000 | 1.000 | 24.5 |
| **full₂（噪声地板）** | — | **1 / 1** | **0.991** | **0.977** | 24.7 |
| one | 6,281 | 6 / 5 | 0.979 | 0.942 | 19.3 |
| one-lean | 6,018 | 6 / 5 | 0.979 | 0.940 | 17.4 |
| minimal | 3,579 | 6 / 5 | 0.980 | 0.946 | 15.1 |
| **minimal-loc** | **3,733** | **2 / 3** | **0.981** | **0.950** | **15.3** |
| zero（对照） | 2,500 | 6 / 5 | 0.971 | 0.935 | 14.7 |

## 三件被实测钉死的事

**1. 突变点不在示例数量上，在一条没人写过的判据上。**

砍示例后唯一的系统性偏移是 `primary_location` **粒度崩了**：

```
India → Ujjain-Garoth four-lane road, Ramakhedi village   ← 街道级
China → 重慶                                              ← 城市级 + 中文
USA   → Akron, Ohio                                       ← 城市级
```

查因：`Detailed Criteria` 里**根本没有 `primary_location` 的定义**。三条示例
（`USA` / `Switzerland` / …）是靠"都写国家级"隐式在教。砍到一条，示范信号就不够了。

补 **96 字符**的判据后 6→2（轮2 5→3），成本一分不涨。
**剃掉 6,531 字符的散文，补 96 字符的判据——这是剃刀该有的形状。**

**2. `minimal-loc` 剩下的翻车全是假阳性或噪声，真实语义翻车 = 0。**

```
USA → United States              ×2   同一个国家，度量的 norm 认成不一致
Nepal-Tibet border → Nepal            噪声地板自己也翻这一条
```

**3. 那一条示例确实在干活，不是心理安慰。**

`zero` 对照在所有臂里余弦最差（0.971 均 / 0.935 最差）、软 Jaccard 最低。
留一条有据，不是"保险起见"。

## 没动的东西

`language` / `completeness` / `content_quality` 三个枚举 **全臂零翻车**。
质量门（LOW_QUALITY / JUNK 拦截）不受影响——这是最该担心的地方，实测没事。

## 遗留 / 别误读

- **n=10、两轮**。硬字段的 6-vs-1 差距远超噪声所以敢下结论；余弦差距只有 0.01
  量级，别拿它做更细的排序。
- 软 Jaccard **没有区分力**：噪声地板自比只有 0.59-0.65，比某些变体还低。
  它只是辅助读数，写在这里是为了防止下一个人拿它当判据。
- 度量把 `USA` 与 `United States` 判成不一致。**刻意没加别名表**——加了就是在
  给自己的结论放水；宁可在结论里说清楚。
- fixtures 是刻意挑的边界样本（中文 ×2、PARTIAL_USEFUL、宣言体、名人），
  **不是随机抽样**，所以翻车率不能当生产发生率读。

## 抬进生产的话

`variants.ts` 里 `minimal-loc` 的组装方式搬进 `src/prompts/articleAnalysis.ts`。
`compare.ts` 里的 `generateSearchText` 是从 backend 拷来的副本，**不要一起带走**。
上线后用 `scripts/eval/` 的 article-quality 判官（κ 已验）再对拍一轮。
