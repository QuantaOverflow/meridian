# 合成层漏报 open-code 归因（19 条确证 dropped）

日期：2026-07-07。样本 = `scripts/eval/coverage-judge/gold.jsonl` 里 `gold==dropped` 的 19 条
（8 期真实 brief / 112 story-disposition，人裁 gold；判官 dropped precision=1.0 → 信号可信）。
方法：逐条读「story 报告 + 该期简报全文 + noteworthy 区 + 同期幸存者」，open-code 归因。
目的：定位 `getBriefGenerationPrompt` 该改哪个根因（洞3 后续，error-analysis 路2 头号缺陷 68%）。

## 先证伪两个假设

**"7-8 条上限撞满被挤掉" —— 不成立（主因）。** 8 期 gold headline 数为 11/11/8/9/9/8/8/10，
模型根本没守 "up to 7-8" 上限；且 noteworthy 区（上限 5）8 期只用了 0-5 条、多期 ≤2。
漏报不是"名额用完被挤"，是**从未被考虑安置**。

**"顺序随机所以随机丢" —— 不成立。** backend `auto-brief-generation.ts:1035-1040` 按
`importance + log2(1+源数)` 降序排序后取 top-N，S1..S15 就是重要性排序；19 条 dropped
**全部落在 S6 之后**（S1-S5 零丢失）。但 prompt 第 57 行却告诉模型 "(in random order)" ——
撒谎导致模型只能自行猜重要性，于是尾部内部出现倒挂（见 C 类）。

## 归因分类（每条取主码）

| 码 | 机制 | 条数 | 占比 |
|----|------|-----|------|
| A 被宏观叙事吸收 | 相邻大故事覆盖了同主题，本条特异性内容（地点/伤亡数/事件本身）整体丢失，简报只剩泛词 | 5 | 26% |
| B 突发单一事件被"战略分析师"人设过滤 | 灾害/犯罪/体育/纪念类，无地缘"战略含义"→ 被 DEPTH OVER BREADTH 心态整条弃掉 | 7 | 37% |
| C 中层政治/机构故事无兜底通道 | 有战略价值但排不进头条，noteworthy 又没接住 → 彻底消失（简报全文 0 提及） | 7 | 37% |

逐条：

| id | story | 码 | 备注 |
|----|-------|---|------|
| 1780036335731#S7 | 黎巴嫩空袭升级 | A | 简报只剩"停火法律地位" |
| 1780494276570#S6 | Henry Nowak 谋杀案(英) | B | 国内犯罪+全国危机，0 提及 |
| 1780494276570#S9 | 世界杯 LA/墨城安保 | C | 简报全文无 world cup/fifa |
| 1780494276570#S10 | 澳 AUKUS 核潜艇转向 | C | 战略级故事，全文无 aukus/submarine |
| 1780494276570#S15 | DOJ 废止 $1.776b 基金 | C | 同主题两期都被丢（见 #S9'） |
| 1780554095183#S8 | Bakersfield 人质对峙 | B | |
| 1780554095183#S11 | 拳王阿里逝世十周年 | B | 软性/纪念，丢弃可辩护 |
| 1780554095183#S12 | CBS 解雇 Pelley | C | 新闻自由角度有价值 |
| 1780662961660#S11 | Bolton 认罪 | C | 简报 0 命中 |
| 1780662961660#S13 | A3C 拉美干预 | A | 只剩 Trump 泛词 |
| 1780662961660#S14 | Burnham 挑战工党领袖 | C | |
| 1781007434068#S9 | 菲律宾 7.8 级地震 37 死 | B | **倒挂实锤**：S14 索马里裁判拒签、S15 肯尼亚抗议都进了，37 死地震没进 |
| 1781007434068#S13 | 巴勒斯坦囚犯性暴力报告 | A | 只剩 Israeli 泛词 |
| 1782204768600#S7 | Lucknow 火灾 15 死 | B | 仅元评论脚注；noteworthy 5 席全给了元评论 |
| 1782204768600#S9 | 菲律宾校园枪击 3 死 | B | |
| 1782322639966#S8 | Jabalia 空袭 4+2 死 | A | 被 Israel 宏观叙事吸收 |
| 1782322639966#S12 | 密苏里坠机 13 死 | B | 同期 noteworthy 给了"Neuer 第五届世界杯" |
| 1782322639966#S13 | 荷日 2-2 世界杯 | A | WC 主题被 Curacao 故事占位，本场吸收 |
| 1780036335731 (S7 已计) | — | — | 19 条止 |

B 类 7 条中 **5 条带死亡人数**（37/15/13/3/1+）——"重要性倒挂"的主体就是 B 类：
上游选择层已按 importance 判它们值得进 top-15，合成层用自己的"战略品味"推翻了。

## 交叉机制（真正的根因，非互斥）

1. **noteworthy 兜底通道失效（最大可修点）**。prompt 把 noteworthy 定义成 "important stories
   flying under the radar"（≤5 条），模型将其解读为**元评论区**：实际填的是"缺失的起始日期"、
   "未具名官员"、"Neuer 的第五届世界杯"这类已覆盖故事的花絮；1780494276570 期甚至写
   *"none rise to the threshold … every item is integrated"* —— 而该期实际丢了 4 条整故事。
   落选故事从未被降级安置，直接蒸发，且模型自以为全覆盖。
2. **无 exhaustiveness 契约**。prompt 从未要求"每条输入 story 必须有去向"；
   "QUALITY OVER QUANTITY / OMIT sections / better 3-4 rich than 8 shallow" 的节制指令
   被模型从 section 级泛化到 story 级。
3. **重要性信号被主动否认**。"in random order" 是假话（实为降序），模型无法用顺序做详略
   导流，只能自行猜 → 尾部倒挂（37 死地震 out、裁判签证 in；火灾 out、球星花絮 in）。
4. 8 条硬上限**不是**主因（见证伪节），不必改它。

## 修法推导（对应 briefGeneration.ts 改动）

1. 把 "(in random order)" 改为如实声明：按重要性降序排序，**顺序决定详略，不决定收录**。
2. 新增覆盖契约：每条 story 三去向之一 —— headline 深析 / 折叠进相关故事（必须保留其
   特异性：地点、伤亡数、当事人，泛词提及不算覆盖）/ noteworthy 一句接地摘要。禁止静默丢弃。
3. noteworthy 区重定义：首要职责 = 安置所有未进正文的 story（一条一行），解除 5 条上限；
   元评论允许但只能在安置完之后追加。
4. `convertReportsToMarkdown` 给每个报告加 `[story k/N]` 序号，让"全部安置"可被模型自查
   （序号不得出现在简报正文）。

复测（双尺）：`scripts/eval/coverage-judge/regen-ab.ts` 离线重放 8 期 →
coverage 尺看 dropped 率降没降，faithfulness 尺守编造不恶化。

## A/B 复测结果（2026-07-07，本地 HEAD 重放、qwen-long temp0.7、单 run/期）

两臂均在 HEAD 重放（原生产简报生成于 bc3f8a9 RARR+输入修复之前，不能当对照），唯一变量=本轮 prompt 改动。

| 尺 | baseline(旧 prompt) | treatment(新 prompt) |
|----|------|------|
| **dropped 率**（κ0.965 判官，RUNS=3 多数） | 15/112 = **13.4%** | 7/112 = **6.2%** |
| noteworthy 占比 | 25% | 35% |
| gold 19 条确证漏报 | —（重合 10/15，模式复现） | **救回 15/19**（13 noteworthy + 2 升 headline，含 37 死地震） |
| faithfulness block | 1/8 | 2/8 |
| contradicted 总数 | 6 | **14**（重跑门 2 次稳定 → 非判官噪声） |
| unsupported 率 | 2.2% | 2.9% |
| brief 均长 | 20445 | 20047（没注水变长） |

**结论：合成漏报腰斩（13.4%→6.2%），头号缺陷方向性修复成立；但确证了 trade-off——失真上升。**

代价细节（已逐条核）：新增 contradicted 主为**日期挪移/归属反转型失真**（June 3→4 成批、
2026→2023 年份错、源"Kim/Putin 出席 Xi 的阅兵"写成"Xi 出席 Putin 的阅兵"），多在正文分析块
而非新增 noteworthy 一句话区；简报长度未变 → 机制=同长度里织入更多故事、事实密度升高、
逐 token 转录出错率上升。RARR（两臂都开）没接住 → 下一杠杆在裁判/RARR 日期+归属专项（P1），
不是继续堆合成 prompt（0c 已明令逐字抄日期仍被违反）。

残留漏报 7/112：吸收类（A3C 只剩 Trump 泛词）+ temp0.7 下偶发**契约整体失守**
（1782322639966 一个 run noteworthy 区回退元评论老habit、密苏里坠机 12 死仍丢）。
prompt 契约压均值、不保单次；硬保证走两遍法（生成后 reconcileCoverage 对账→dropped 补录），
判官已 κ 验可直接用。

注意事项：AI Gateway 会缓存相同生成请求（同 payload 重放 5s 返回同一简报）——GEN_RUNS>1
测方差需绕缓存；最老一期（1780036335731）R2 报告为旧 schema，faithfulness 源渲染须走
legacy 兜底链（regen-ab.ts 已修，否则全 claim 假 unsupported）。
