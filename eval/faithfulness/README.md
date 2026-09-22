# faithfulness（已退役，仅保留 rubric）

2026-09-22 清理：这套 harness 连同它的金标一并删除，只留下 `rubric.md`。

## 为什么整套删

两个独立原因，各自都足够：

1. 它按 `phase === 'brief_generation'` 过滤 LLM 调用记录，而生产写作层 brief-block-v6
   只写 `phase = 'brief_block_v6'`，二者不相交，结构性查不到任何新数据。
2. 生产路径直接跳过忠实度门——`apps/backend/src/workflows/auto-brief-generation.ts`
   里那段硬编码 `why = 'v6_path_no_report'`，门的输入是整份旧格式情报报告，而报告层已退役。

`build-judge-worklist.ts` 里还硬编码着 2026-06 的 workflow ID，永远打不到新数据。

## 为什么连金标一起删

`gold/judge-gold.jsonl` 有 109 条人工判定，但：

- 只覆盖 **3 篇**简报（109 条判定挤在 3 个 brief_id 里）
- `gold/sources.jsonl` 存的"证据"是旧的情报分析 prompt 与报告，不是原始文章。
  参照系随报告层一起消失，这批判定没法在新链路上重跑

对照组：`../intel-grounding/gold/` 的证据是**原始 RSS 文章正文**、覆盖 39/39，
与管线形态无关，因此那批**保留了**。判断标准就是这个——金标的价值取决于它的参照系
还在不在，不取决于标注花了多少人力。

## 为什么留 rubric.md

`../intel-grounding/rubric.md` 显式复用本文件里的 grounding 判据（verdict 定义、
decontextualization、分层、接受闸），删掉它，那边保留的 100 条金标就无法解释。

## 已蒸馏的读数

- 覆盖对账判官 κ=0.965（n=112）与三尺三角测量方法论 →
  `docs/knowledge/nodes/experiment-coverage-judge-kappa-n112.md`、
  `docs/knowledge/nodes/mechanism-coverage-judge-triangulation.md`
- 检测上限与相关决定 → `docs/adr/0001-*`、`docs/adr/0004-brief-writer-v3.md`
