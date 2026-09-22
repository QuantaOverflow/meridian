---
{
  "id": "mechanism-coverage-judge-triangulation",
  "type": "mechanism",
  "title": "三尺三角测量：judge + 异家族第二标注 + 决定论对齐器共同标注，分歧交人裁，避免 LLM-judge 自证",
  "date": "2026-07-07",
  "status": "recorded",
  "tasks": ["设计验收门"],
  "scope": "验 LLM-judge 本身是否可信的方法论，不限于 coverage-judge 这一个 harness；实例来自 eval/coverage-judge/",
  "source": "eval/coverage-judge/README.md「三尺三角测量」节 + commit d2b6f09（2026-07-07，feat(eval): 覆盖对账判官 κ 验证 harness）",
  "conditions": [
    "前提：被验判官（qwen-long）与被评对象（简报生成也用 qwen 家族）同家族，self-preference 风险正是要验的东西",
    "第二标注器必须是异家族模型（这里用 GPT/codex），理由是与被验判官不共享同一套系统性偏差",
    "决定论对齐器（无 LLM，专有名词加权词汇重叠）作为第三票，强项是二分类 covered/dropped，弱项是 headline/noteworthy 这种更细的语气/位置判断"
  ],
  "evidence_origin": "local_record",
  "relations": [
    { "type": "based_on", "to": "experiment-coverage-judge-kappa-n112" }
  ],
  "input": "N 条待判样本（此例为 story-disposition 组合），每条同时喂给三个独立标注器：(a) 被验的 LLM judge，(b) 异家族第二 LLM 标注器，(c) 一个不依赖 LLM 的决定论对齐器",
  "output": "三票一致的样本直接进暂定 gold；三票不一致的样本进 disagreements 清单，由人以「仁慈独裁者」身份裁定后写回 gold.jsonl；最终 gold 按来源分层记录（三尺一致 / 决定论强项区间内的 grounded 复核 / 人裁 / 多数决），供 κ、precision/recall 等指标计算",
  "limits": "决定论对齐器只在强类别（此例是 covered/dropped 二分类）可信，弱类别（headline/noteworthy）分歧大，不能当作独立第三票用于细粒度判断；异家族第二标注器仍是 LLM，本身可能有系统性偏差，只是与被验判官的偏差方向大概率不同，不是真正独立于「LLM 判断」这件事本身；三角构造成本是 3 次标注 + 1 次人裁，比单判官直接用要贵，只在「这把尺会被长期依赖、错了代价大」时值得做；人裁分歧样本量占比高时（此例 35/112 ≈ 31%）说明这把尺本身的判定边界模糊，仲裁本身也需要写清楚的裁定标准，不能只凭直觉",
  "invalidates_when": "判官模型换代或被评对象生成模型换代之后（self-preference 的具体形状可能变化），或分歧率显著高于本例的 31%（说明该任务的判定边界比 covered/dropped 更模糊，需要重新设计判定粒度而不是简单加多标注器）"
}
---

**做法**：coverage-judge 要验证的是"简报覆盖对账"判官（`reconcileCoverage`，qwen-long）
能否可信地把候选 story 判成 headline / noteworthy / dropped 三类，其中 `dropped` 是
"合成层漏报"这个结论的直接依据。因为判官与被评对象（简报生成）同属 qwen 家族，直接拿这个
判官自己的判定当 gold 有明显的 self-preference 风险——它可能系统性地偏向判自己的生成结果
"没问题"。

解法是三角测量而不是单纯找人工全标：三个独立标注源里，两个是模型（被验判官本身 + 异家族
的 GPT/codex 做第二标注），第三个完全不用 LLM（决定论的专有名词加权词汇重叠对齐器）。
三者一致的样本（本例 77/112）可以放心暂定为 gold；不一致的样本（35/112）才需要人工介入，
而且人工只需要裁「三个信号打架的那一部分」，不需要从零标注全部 112 条——这是这个方法论
省人力的地方。

**为什么可复用**：这个结构不依赖"覆盖对账"这个具体任务，任何要验证 LLM-judge 可信度、
又担心 judge 与被评对象同源导致自证的场景都能套：找一个异家族模型做第二标注、找一个（哪怕
弱一点的）非 LLM 信号做第三票、只对三票不一致的子集做人裁。它的成本模型也值得记下——
不是"标一遍就完事"，是"跑三遍 + 裁一部分"，比单判官 pipeline 贵，需要判断这把尺是否
重要到值得这个成本（详见 [[experiment-coverage-judge-kappa-n112]] 里这把尺后续被用来
验证一次真实的生产修复，值回了成本）。
