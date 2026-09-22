# intel-grounding（harness 已退役，金标保留）

2026-09-22 清理：这套 harness 的脚本全部删除，只保留 `gold/` 与 `rubric.md`。

## 为什么删 harness

它按 `phase === 'intelligence_analysis'` 过滤 LLM 调用记录来取数，而报告层随 brief-block-v6
上线一并退役，这个 phase 不再产生任何记录。脚本还能跑，但只能打冻结的历史数据，
验不了当前生产的任何行为。

## 为什么留金标

`gold/` 是自包含的，与已退役的管线无关：

- `judge-gold.jsonl` — 100 条人工判定，形如 `{claim, gold: supported|unsupported}`
- `sources.jsonl` — 对应的证据快照，**是原始 RSS 文章正文**，不是情报报告。
  覆盖率 39/39（金标涉及的 39 个 brief 全部有证据）
- `human-adjudicated.jsonl`（24 条人裁）、`synthetic-contradicted.jsonl`（26 条合成反例）、
  `claude-secondlabel.jsonl`（异家族第二标注）、`agreement-audit.jsonl`

判定的参照系是「这句话在这簇原文里有没有支撑」。换任何写作架构，这个判定都成立，
所以以后验任何 grounding 判官都能直接复用这批语料。

对照组：`../faithfulness/` 的金标是按旧格式情报报告标的，109 条判定只覆盖 3 篇简报，
参照系随报告层一起消失，因此那批**没有保留**。

## rubric.md 与它的依赖

`rubric.md` 是标注规范——没有它，`supported` / `unsupported` 这些标签无法解释。
它显式复用 `../faithfulness/rubric.md` 里的 grounding 判据（verdict 定义、
decontextualization、分层、接受闸），所以那一份文件也一并留着，`faithfulness/` 目录下
其余内容已删除。

## 已蒸馏的读数

判官选型结论见 `docs/knowledge/nodes/experiment-intel-grounding-judge-selection.md`：
qwen-max 真实 API 重跑 κ=0.407 FAIL、deepseek-v3 同样 FAIL；Claude 的 κ=0.779 是离线核算，
真 API 复验从未留痕。README 曾长期写着「judge 未验证」而彼时 κ 已算出，那处矛盾记在
`docs/knowledge/nodes/lesson-intel-grounding-readme-stale.md`。
