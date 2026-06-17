# ADR 0001 — 忠实度门的 claim 抽取改用 Claimify 式 Selection + Decomposition

- **状态**：Accepted（2026-06-17）
- **决策者**：shiwj
- **关联**：`docs/eval-playbook.md`、`docs/engineering-notes/faithfulness-eval-best-practices.md`、knowledge 笔记 `claim-extraction-for-faithfulness.md`、memory `eval-program-direction`、ROADMAP P0/P1

---

## 背景与问题

忠实度门（faithfulness gate）流程：从 brief 抽 claim → judge 逐 claim 对"情报报告(源)"判
`supported / unsupported / contradicted` → 门判据 (A)(B) 决定 block → revision 删除被 flag 的 claim。

2026-06-17 做 **precision（误拦率）eval** 时测出：在正常新闻 brief 上，judge 把约 **57%** 的
"factual claim" 误判为 unsupported/contradicted（双盲 Claude+codex 标注 + critic 查源裁定，
n=35，batch2）。对比"上下文标签密集型"brief 误拦仅 6%（batch1，n=32）——**误拦率强依赖 brief 类型**，
之前只测了一种类型所以漏看。

根因排查（两路独立 subagent + codex，引 prompt 行级证据）确认三个缠在一起的 bug：

1. **① 抽取器 channel 误标（误拦数量主因）**：`EXTRACT_PROMPT` 用关键词白名单
   （"signals""suggests"…）区分 factual / analytical，且**抽取整句**。无白名单词的解读句
   （"Iran weaponized its silence""it was a symbolic endpoint""these players were global
   unifiers""the US wants to de-escalate"）被标成 `factual` → 进事实尺判 → 源里没这原话 →
   unsupported → revision 误删了 brief 的解读/修辞。
2. **② FACTUAL_PROMPT 逐字硬规则**：要求 `supported` 必须能从源逐字抄出，与"蕴含即可"的
   rubric 冲突，误拦忠实摘要/跨句聚合。
3. **③ Lever A 强令信任**：把启发式数字/日期对齐结果直接断言"矛盾"且禁止翻案，制造假矛盾
   （"3,526" 被判矛盾于 "over 3,500"；"28 February" 矛盾于 "February 28"）——尤其危险，
   因为门判据 (A) 是 `contradicted≥1 即拦整篇`。

② 和 ③ 已用最小改动修复（commit 待提），实测：危险的假矛盾误拦 5→1、忠实摘要误拦减少，
且召回未退（heldout contradicted 0.867、unsupported 0.714，gate PASS）。**剩余误拦几乎全是 ①**。

## 决策

**采用 Claimify（微软，*Towards Effective Extraction and Evaluation of Factual Claims*, 2025）
的三段式 claim 抽取，替换现有"关键词白名单 + 整句抽取"的 `EXTRACT_PROMPT`：**

```
Selection       先判句子"是否含可对源核查的事实"；纯解读/评价/修辞句直接滤掉，不抽
Disambiguation  指代/歧义消解，只在"高把握确定正确解读"时才往下；拿不准则不抽
Decomposition   把澄清后的句子拆成自包含(context-independent)的可验证原子 claim；
                混合句剥离解读外壳，只保留可验证事实原子
```

抽取阶段只产出"可对源核查的事实原子"送 judge；纯解读句不进入忠实度判定链路。

## 为什么这样（核心理由）

- **误拦的根在抽取，不在 judge**：judge 没判错，是抽取把"不该用事实尺量的句子"派给了它。
  修 judge（放宽事实尺）治标且会松召回；修抽取（不把解读句当事实抽）治本。
- **解读留在 brief，不被删**：抽取阶段"不抽"≠"从 brief 删"。不抽 → 不判 → 不 flag → revision
  不动它 → 解读原样保留在最终简报（情报简报的解读/前瞻正是其价值）。当前 bug 恰恰在删这些解读。
- **不开召回洞**（关键）：被滤掉的只有"无真假可言的纯主观句"。真幻觉=捏造的事实，按定义必含
  可验证原子 → 必被 Selection 选中 → 必被抽 → 必送判 → 必过门。**丢主观句 ≠ 丢幻觉**。
- **有 SOTA 背书**：Claimify 实测 99% entailment、覆盖 87.6%、精度 96.7%。

## 被否决的备选

1. **放宽 analytical 类定义，把解读句路由到 analytical 通道** —— ❌ 否决。
   analytical 通道 κ=0.27、warning-only、**永不进 gate**（红线，见 `faithfulness-check.ts`）。
   把句子路由过去 = 赶进不设防的房间；"伪装成解读的真幻觉"会溜过门 → **召回洞**。
   路由是把问题挪到不检查的地方，过滤/拆解是只丢真正不含事实的部分——后者才对。

2. **只修 judge 端（②③），不动抽取** —— ❌ 不充分。
   ②③ 修完后仍残留 ~11/20 误拦，全是 ① 的整句解读被当 factual 抽。不动抽取治不了根。

3. **VeriScore 式"直接丢所有不可验证句"** —— ⚠️ 部分采纳。
   Selection 阶段采纳其"不可验证就不验"思想；但保留 Decomposition 处理**混合句**
   （事实+解读），避免把含真事实的句子整句丢掉。

## 后果

**正面**
- 解读类误拦预期大部分消失（修辞句不再被抽），且不开召回洞。
- brief 的解读/前瞻得以保留，revision 只删真·无源事实。
- 抽取质量提升同时利好 P2.5（情报分析 eval）——同一套抽取可复用。

**负面 / 成本**
- `EXTRACT_PROMPT` 重写 + 调试，prompt 变长 → 抽取 LLM 调用 token 上升。
- Selection 过严会漏抽真事实（覆盖率↓）、过松则 ① 复发——需 eval 校准（见 spec）。
- 需新增"抽取质量"meta-eval（Selection 准确率、Decomposition entailment 率），否则换了个
  没验证的环节。

**约束（不可退的红线）**
- 改 `faithfulness-prompts.ts` 单一真源后必跑 `pnpm -F @meridian/eval-faithfulness meta`：
  事实通道 κ≥0.6、unsupported 召回≥0.85、contradicted 召回≥0.769 不回退。
- analytical 通道维持 warning-only，永不 gate（与本 ADR 无关，仍是红线）。
- 抽取的"不抽"只允许作用于纯解读句；任何含可验证事实的句子必须产出至少一个事实原子。

## 实施

详见 spec：`docs/superpowers/specs/2026-06-17-claimify-claim-extraction-design.md`。
分阶段：先固化已验的 ②③，再独立实施 ① 的 Claimify 重构（带抽取 meta-eval 护栏）。
