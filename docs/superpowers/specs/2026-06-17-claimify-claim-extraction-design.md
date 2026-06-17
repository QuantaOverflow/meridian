# Claimify 式 claim 抽取重构 — 设计文档

> 创建日期：2026-06-17
> 目标 reader：本人 + 未来回来 review 的我
> 状态：已设计，待实现
> 决策依据：`docs/adr/0001-claimify-claim-extraction.md`

---

## 1. 背景与动机

忠实度门把 brief 的 claim 逐条对"情报报告(源)"判忠实度，flag 的会被 revision 删掉。
2026-06-17 的 precision eval 测出：正常新闻 brief 上 **~57% 的 factual claim 被误拦**
（双盲 + critic 查源，batch2 n=35）；标签密集型 brief 只有 6%（batch1 n=32）。

根因排查（两路独立 + 引 prompt 行）定位三 bug。其中 ②（FACTUAL_PROMPT 逐字硬规则）、
③（Lever A 强令信任）已最小改动修复并验稳（见第 6 节）。**剩余误拦几乎全是 ①**：

> `EXTRACT_PROMPT` 用关键词白名单区分 factual / analytical，且抽取整句。无白名单词的解读句
> （"Iran weaponized its silence"、"it was a symbolic endpoint"、"these players were global
> unifiers"、"the US wants to de-escalate"、"Pulte meets none of that"）被标 `factual` →
> 进事实尺 → 源无原话 → unsupported → revision 误删 brief 的解读。

现有 prompt（`faithfulness-prompts.ts:13-38`）已有"拆 fact+interpretation"规则，但 analytical
判据依赖 cue 词（"signals/suggests…"），没 cue 的解读句整句漏进 factual。需要的是
**先判可验证性、再拆原子** 的结构化抽取（Claimify）。

## 2. 范围

**In-scope**
- 重写 `EXTRACT_PROMPT`：从"关键词分类 + 整句抽" → Claimify 式 **Selection + Disambiguation + Decomposition**。
- 新增**抽取质量 meta-eval**：量 Selection（该抽的有没有抽、不该抽的有没有滤）与 Decomposition
  （原子是否自包含、是否剥离了解读外壳）。
- 用现有 precision 标注集（batch1+batch2 的 gold）作抽取 eval 的金标种子。

**Out-of-scope**
- judge 端 prompt（②③已独立修复，不在本 spec）。
- 门判据 (A)(B) 阈值、enforce 开关（P1，依赖本 spec 把误拦压下来后再谈）。
- 多次 LLM 调用的 per-sentence pipeline（v1 先单次调用；不够再升，见第 5 节）。
- analytical 通道任何改动（红线：永不 gate）。

## 3. 架构

```
meridian/
├── services/meridian-ai-worker/src/services/
│   └── faithfulness-prompts.ts          # 重写 EXTRACT_PROMPT(单一真源, runtime+eval 共用)
├── scripts/eval/faithfulness/
│   ├── claims.ts                        # extractClaims 适配新输出(若结构变)
│   ├── gold/
│   │   ├── extraction-gold.jsonl        # 新:抽取金标(句子→应抽/应滤/应拆)
│   │   └── judge-gold-precision*.jsonl  # 已有:复用为误拦回归集
│   └── extraction-meta-eval.ts          # 新:抽取质量评估脚本
└── docs/adr/0001-claimify-claim-extraction.md
```

## 4. 新 EXTRACT_PROMPT 设计（v1 单次调用）

一次调用、对整份 brief，内部按 Claimify 三阶段推理，只输出可验证事实原子。

### 4.1 Selection（先筛可验证性）

判每句："这句**是否含可对源核查的事实**(事件/数字/日期/人名/引语/具体行动/具体关系)？"
- 否（纯解读/评价/动机/象征/修辞/前瞻/通用知识）→ **不抽**。
- 是 → 进 Decomposition。

明确指令（取代旧的 cue-词判据）：

> Classify by **verifiability against the source**, NOT by cue words. A sentence is
> verifiable only if a reader could check it against the source for a concrete
> event/number/date/name/quote/action. Sentences whose main point is meaning,
> significance, motive, symbolism, evaluation, or prediction ("X was a symbolic
> endpoint", "weaponized its silence", "global unifiers", "wants to de-escalate")
> are NOT verifiable factual claims — do not emit them.

### 4.2 Disambiguation（消歧，保守）

> Resolve pronouns/ellipsis to make each claim self-contained. If the correct
> referent or reading is **not clear with high confidence**, drop the claim rather
> than guess (low confidence → omit).

（呼应 Claimify "只在高把握时抽"——拿不准不抽，护精度。）

### 4.3 Decomposition（拆原子，剥解读外壳）

> Split compound sentences. For a sentence that blends a verifiable fact with an
> interpretation, **emit ONLY the verifiable factual atom; discard the interpretive
> wrapper.** Example: "X died near Marjayoun, a symbolic endpoint to the mission"
> → emit "X died near Marjayoun"; do NOT emit "a symbolic endpoint".

### 4.4 输出

v1 保持现有结构兼容，但 `type` 实际只产 `factual`（analytical 不再从这里喂门；若仍想保留
分析句做 warning，可单列但**标 `analytical` 且下游已知永不 gate**）。决策：v1 **只输出 factual 原子**，
analytical 不抽（最简、直接消误拦）；analytical warning 若将来要，另起。

```
Each element: {"text": "<self-contained verifiable factual atom>", "type": "factual"}
```

> 注意"verifiable"在忠实度语境 = 可对**源**核查（非对世界）。Selection 文案需写明用源做判据。

## 5. 风险与 v1→v2 升级条件

| 风险 | 表现 | 缓解 |
|------|------|------|
| Selection 过严 | 漏抽真事实，覆盖率↓，真幻觉漏检（召回洞） | 抽取 meta-eval 量覆盖率；judge meta-eval 守 unsupported 召回≥0.85 |
| Selection 过松 | ① 复发，解读句又被抽 | precision 回归集（batch2）量误拦率，目标 ≪57% |
| 单次调用能力不足 | 长 brief 下 Selection/Decomposition 推理质量掉 | 升级 v2：per-sentence 多阶段调用（成本↑，仅当 v1 eval 不达标才上） |
| 拆原子粒度漂移 | 原子太碎/太粗，entailment 率波动 | Decomposition entailment 率进 meta-eval |

**v1 验收线**（达标即停，不过度工程）：
- 误拦率（batch2 回归集）从 57% → **≤15%**。
- 召回不退：`pnpm meta` 事实通道 κ≥0.6、unsupported 召回≥0.85、contradicted≥0.769。
- 抽取覆盖率（该抽的事实原子被抽出比例）≥ ~0.85（防 Selection 过严挖召回洞）。

未达标再考虑 v2 多阶段。

## 6. 已完成的前置（②③，本 session 2026-06-17）

`faithfulness-prompts.ts` 已改两处（待 commit）：
- **②**：删 FACTUAL_PROMPT 的"必须逐字"硬规则 → 改"蕴含/改写/聚合即 supported，evidence_quote
  仍给源 span 但不再以无逐字降级"。
- **③**：Lever A 从"values differ → contradicted + 禁翻案" → "待核提示：先确认同一事实、
  等价值(3526≈over 3500、日期格式)不算矛盾、对齐错就正常判"。

实测（heldout + batch2 回归）：危险假矛盾误拦 5→1、忠实摘要误拦减少；召回未退
（contradicted 0.867、unsupported 0.714，gate PASS）。残留误拦≈①，本 spec 处理。

## 7. 实施步骤

1. 固化 ②③：typecheck + commit（已验稳）。
2. 建抽取 meta-eval（`extraction-meta-eval.ts`）+ 抽取金标（从 precision 标注派生：
   gold=supported 的解读句=应滤/应拆；gold=unsupported/contradicted 的=应抽）。
3. 重写 `EXTRACT_PROMPT`（第 4 节）。
4. 跑抽取 meta-eval + `pnpm meta` 回归；对照第 5 节验收线。
5. 达标 → commit；不达标 → 评估 v2 多阶段。
6. 误拦压下来后，回到 ROADMAP P1（enforce）重新评估 precision/recall 是否够翻开关。
