# 语义通道原型（semantic-compare）— 2026-08-29

治「方向反转 / 身份张冠李戴 / 极性」——判官对这三类的已知盲区。沿用 extract-compare
的分工：**LLM 只抽取（逐字引用、禁推理），代码全判定**。

- 通道逻辑：`semantic-compare.ts`
- 跑批壳：`semantic-eval.ts`（`SELFTEST=1` 零 LLM 秒回；不带则全量）

---

## 一、最重要的结论：先修金标，别先修通道

**在现有金标上，这条通道唯一确定有边际价值的是零 LLM 的引语核对。**
带 LLM 抽取的三个判据（角色 / 极性 / 时序）没有跑赢已有的判官基线。

同一份 `gold/synthetic-contradicted.jsonl` 的语义子集（15 条）上：

| | 召回 | 相对通道 |
|---|---|---|
| qwen-max 判官（2026-07-10 存档） | 6/15 | 通道净补 **3** 条（14/23/24）→ 并集 9/15 |
| deepseek-v3 判官（2026-07-11 存档） | 10/15 | 通道净补 **1** 条（24）→ 并集 11/15 |
| 本通道（终版） | **7–8/15**，误伤 **4–6/88**（同配置两次跑的区间，见第三节噪声地板） | — |

净补的那 1 条（`ctr-intel-24`）是 misquote，由**零 LLM 的引语核对**抓到的，跟 LLM 抽取无关。

三条必须一起读的限定：

1. **n=15，分辨不了方案优劣。** 8/15 的 95% CI 约 [0.27, 0.79]——跟 6/15 和 10/15 全都重叠。
   再叠上下面那条噪声地板（同配置重跑就差 ±1），这份读数能说的只有
   「通道确实会在真语义错上开枪，且误伤是个位数百分比」，说不了「比判官好/差」。
   净补的条数按**两次跑都命中**的 7 条算，结论不变（vs qwen-max 补 3，vs deepseek 补 1）。
2. **两个判官基线的模型都已不可用**（DashScope key 自 2026-07-29 401），通道用的是
   `@cf/meta/llama-3.3-70b`。这是跨模型对照，不是干净 A/B。
3. **合成扰动对判官偏易。** 扰动是在原句上换一个词造出来的，词面线索清晰；memory
   `intel-grounding-judge-validated` 记的 deepseek「真金标 κ0.285 死刑、合成召回 0.692」
   正是这个落差。所以「deepseek 在合成集上 10/15」不代表它在生产里也这样。

**推论**：下一个该动的是金标，不是通道。要判定这条路走不走得通，需要**真实简报里的语义错**
（非合成扰动）标注若干条。现有真金标 `judge-gold.jsonl` 只有 8 条 contradicted，
且未按语义类型分层。

---

## 二、设计依据：「抽三元组」只覆盖 direction 的 1/4

交接文档建议「从 timeline 抽 (施事,动作,受事) 三元组做代码通道」。读完金标 26 条合成
contradicted 后发现，**`direction` 这一类不是同一个机制**：

| 金标 | 表面归类 | 真实机制 | 代码可判？ |
|---|---|---|---|
| ctr-intel-22 | direction | 角色互换 Cornyn↔Paxton | ✅ 位置判据 |
| ctr-intel-23/26 | direction | before/after 时序反转 | ✅ 闭集关系词 |
| ctr-intel-20 | direction | 动词反义 resumed/suspend | 🟡 带否定标记才行 |
| ctr-intel-12/13/14 | entity | 槽位替换（人名/条约名） | ✅ 槽位比对 |
| ctr-intel-15..25（7 条） | negation | 其中 6 条带**词面否定标记** | ✅ 闭集标记 |
| ctr-intel-15 | negation | 无标记反义（struck targets / fell short） | ❌ 需语义 |
| ctr-intel-24 | misquote | 引语与源不符 | ✅ 零 LLM 子串 |

所以真正吃下这批错的不是三元组本身，是**四个各自独立的判据**，共用一次 LLM 抽取：

| 通道 | 判据 | LLM |
|---|---|---|
| **Q 引语** | claim 里 ≥2 词的引号跨度必须在源里逐字出现 | 零 |
| **R 角色** | 互换（crosswise 双向命中）/ 替换（一槽对上、另一槽是不同专有名词） | 共用抽取 |
| **P 极性** | 谓语头部否定标记位不同，且两侧施事是同一个 | 共用抽取 |
| **T 时序** | before 类 vs after 类，闭集关系词 | 共用抽取 |

全部只产出**单向信号**（把判定推向 contradicted），绝不反向洗白——与 extract-compare 同惯例。

---

## 三、L1/L2 分层：这次省下的返工

harness 强制分两层跑：

- **L1 判定层**（`SELFTEST=1`，零 LLM）：手写 AssertionPair 喂比对器，13 条，全过。
- **L2 抽取层**（全量）：真源真 LLM。

首轮 L2 读数是召回 3/15。因为 L1 已经证明判据是对的，那 12 条漏**只能是抽取层**——
这个归因是免费的，不用再做消融。逐条读抽取原始 pair 后拿到修法：

| 迭代 | 召回 | FPR | 改了什么 |
|---|---|---|---|
| 首轮 | 3/15 | 2/8 | — |
| +定向补抽（照 extract-compare 的 VALUE_RETRY） | 6/15 | 2/8 | 6 条报 `absent` 是长源检索没配上，不是源里真没有 |
| +门修复 +时序槽补抽 | 7/15 | 2/20 | 见下 |
| +实体前缀窗口 6→5 +泛指中心词抑制 | 7–8/15 | 4–6/88 | 两条误伤的结构修法 |

### 噪声地板（必读，否则上表全是误读）

**同一份代码、同一份数据、`temperature: 0`，连跑两次：**

| | 召回 | 误伤 | 命中的金标 |
|---|---|---|---|
| run A | 8/15 | 4/88 | 14,16,17,**21**,22,23,24,25 |
| run B | 7/15 | 6/88 | 14,16,17,22,23,24,25 |

Workers AI 在 `temperature: 0` 下**不是确定性的**。差异全在抽取层：`ctr-intel-21`
（William Ruto）run A 给 `confidence=high` 进了比对，run B 给 `low` 被门挡掉。

推论一：**上表的召回列不可逐行相减。** 倒数第二行到最后一行的 7→8 不可能来自实体修法，
那是抖动。

推论二：**看误伤的身份，不看误伤的条数。** 误伤分两拨——

- **稳定核心 4 条**（两次跑都在）：China 筹码、`temporarily blocked`/`ordered … to suspend`、
  `Pentagon`/`Department of Defense`、`prior to`/`following`。
- **抖动尾巴 0–3 条**（只在一次跑里出现）：Xi and Putin/The Kremlin、
  interim administration in Tigray/Pretoria accord、LA Sheriff 那条 polarity。

所以「实体前缀 + 泛指中心词两个修法有效」这个说法**成立**，但支撑它的证据不是
「6/88 降到 4/88」（那是噪声），而是**被针对的那两条误伤
（`Lebanese Government`/`Lebanon`、`Immigrant rights groups`/`El Movimiento DFW`）
在修法后的两次跑里都不再出现**。

⚠️ **L1 全过不等于判据管用**——case 和判据都是我自己写的，只证明逻辑自洽。
真读数只在 L2。

### 负结果：命题极性补抽臂（`PROP_RETRY=1`）—— 双向变差，已毙

想治的失败形状是「首轮把 claim 对齐到了源里**相关但不对应**的句子」（ctr-intel-18/19/20）。
做法是对「事件对上、施事对上、但两侧极性相同」的对再问一次，prompt 改问
「找**最直接说这件事成没成**的那句，包括说它没发生 / 被拒绝 / 被搁置的句子」。

| | 召回 | 误伤 |
|---|---|---|
| arm off（两次跑） | **7–8/15** | **4–6/88** |
| arm on（一次跑） | 6/15 | 10/88 |

**结论按噪声地板打折后**：

- 召回 6/15 落在 arm off 的 7–8 之下但只差 1–2，**在噪声带边缘，不能算变差**。
- 误伤 10/88 **落在 arm off 观测带 [4,6] 之外**，且误伤构成变了
  （polarity 2–3→5、role_substitution 1–3→6），这是唯一有点分量的信号。
  但 arm off 只有 2 次跑做底，n 太小，这也只是**倾向性**不是定论。

机制上说得通：prompt 里点名了「包括说它没发生的」，抽取器就去**猎否定**，
捞回跟 claim 不对应的否定句。与 memory `rarr-prompt-constraint-negative` 同形状——
**每加一条约束，模型换一条逃逸路径**。

**处置**：既然没有一个轴上跑赢，就不开。代码留着（`PROP_RETRY` 默认关）当负结果存档。
要翻案得先把 arm off 的噪声带用 ≥5 次跑测实。

---

## 四、途中踩到的坑（都有实测，别重踩）

1. **门不能只看 claim 侧特征。** 极性冲突可以只在**源**侧带否定标记：`ctr-intel-18` 的
   claim 是 "An interim official confirmed that procedural changes occurred"（无引号、
   无否定、无时序、无专有名词），源是 "no change was implemented"。claim 侧四个判据全不
   命中 → 门直接吃掉，读数上表现为「抽取层 0 个 assertion」，很容易误读成模型不行。

2. **同一个函数不能既当判据又当门。** `polarityOf()` 为压假阳性只看谓语头 3 个 token；
   拿它当门就会漏。门要全句扫描。

3. **撇号与开引号同字符。** `The declaration's language normalizes Russia's war as a
   'crisis'` 被抓成跨度 `s language normalizes Russia`——两个所有格撇号配成了一对。
   单引号必须做边界判定（前须行首/空白，后须行尾/标点）。

4. **否定标记落在宾语里 ≠ 谓语否定。** "explained the technical rationale for
   **abandoning** mid-engine EV concepts" 撞源 "explains" → 假极性冲突。
   英语否定附着在谓语头，只看前 3 个 token 即挡住，且金标里的真例全部落在窗口内。

5. **极性必须要求两侧施事对得上。** 极性说的是「同一个行为者做没做同一件事」，
   施事不同就无从谈起。

6. **实体前缀窗口 6 太紧、token 全等必须收。**
   `Lebanese Government` vs `Lebanon`（lebane/lebano，窗口 6 判不同）→ 降到 5；
   `Sir Jonathan Ive` vs `Jony Ive`（爱称前缀对不上，但姓氏逐字相同）→ 加 token 全等。
   金标里三对真身份替换（Wong/Husic、Garland/Blanche、Rome/Geneva）无任何共享 token，
   两处放宽都不伤召回。

7. **泛指类别不构成身份冲突。** `Immigrant rights groups in Dallas` vs
   `El Movimiento DFW` 是类与实例。注意 "Dallas" 让该短语通过了大写实体判据，
   所以必须单独挡中心词，光看大写不够。

---

## 五、剩下没修的（附归因）

| 金标 | 漏因 | 层 |
|---|---|---|
| ctr-intel-15 | 无标记反义（struck targets / fell short） | 设计外，需语义 |
| ctr-intel-19/20 | 补抽桥到了源里**相关但不对应**的句子 | 抽取层 |
| ctr-intel-18 | 同上 | 抽取层 |
| ctr-intel-12 | 被替换的人名本身就在源里做着别的事，无从判 | 不可判 |
| ctr-intel-13 | 两侧 patient 槽位含义不一致（withdrew *what* vs withdrew *whom*） | 抽取层 |
| ctr-intel-21 | 首轮找对了句子但 confidence=low，被门挡 | 门的代价 |
| ctr-intel-26 | 源侧时序词是 "Earlier on Thursday"，不在闭集里 | 判据覆盖 |

三条内在误伤（无干净修法）：命题不同但共享否定词（China 有筹码 / 没在用筹码）、
同义但否定词在窗外（`temporarily blocked` / `ordered ... to suspend`）、时序对错句。

---

## 六、状态

**未接 runtime，未 commit 决定待定。** 位置现在跟 eval runner 并排；若验过要进生产，
`semantic-compare.ts` 整体移到 `services/meridian-ai-worker/src/services/`
（与 `extract-compare.ts` 并列，单一真源由 runtime 与 eval 共同 import）。

按第一节的结论，**接 runtime 之前应该先补真实语义错的金标**。
