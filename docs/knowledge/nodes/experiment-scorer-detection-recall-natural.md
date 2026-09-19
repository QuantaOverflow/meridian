---
{
  "id": "experiment-scorer-detection-recall-natural",
  "type": "experiment",
  "title": "新 scorer 在 82 句自然金标上召回 12/15 = 80%、精确率 86%（上一代 20%/33%）",
  "date": "2026-09-19",
  "status": "recorded",
  "tasks": ["设计验收门"],
  "scope": "金标来自 brief-v3-prod 的 M2 run（老 v3 写作层，自然错误率 18.3%），**不是** cluster-to-brief 的任何一个臂；召回不能直接外推到那批臂",
  "source": "scripts/eval/scorer-recall/（gold/natural-errors.jsonl 入库；语料在 apps/backend/prototypes/brief-v3-prod/out，本地不入 git）",
  "conditions": [
    "grading instructions 与 cluster-to-brief 的判定包逐字同源（含「判不准的归属类错误标 ok」那条）",
    "该流水线不标逐句出处，所以只判事实正确性一件事，没有覆盖维、没有引用维",
    "金标按**文本匹配**定位，不按句号：生产 splitter 与 lib.mjs 不同构（c0-lead 生产切 14 句、我们切 13 句），按句号对会静默指到相邻句",
    "判官为 Claude subagent（opus），一个簇一个判官，只读判定包",
    "金标本身是 2026-09-18 由 Claude Opus 5 逐句对照原文标注的，不是神谕，其自身错误率未测"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "yields", "to": "lesson-source-stripping-undetected"}
  ],
  "kind": "probe",
  "outcome": "observed",
  "inputs": "12 个 block / 82 句可判定候选句 / 15 条手工标注的事实错（actor 9、time 3、quantity 1、state 1、epistemic 1）",
  "evaluation": "score-recall.mjs 按句聚合到最严档，非 ok 即算检出，与金标求交。零 LLM",
  "result": "召回 **12/15 = 80.0%**（Wilson 95% CI 54.8–93.0%），对检测上限 12/14 = 85.7%；精确率 **12/14 = 85.7%**（CI 60.1–96.0%）。按形状：actor 7/9、time 2/3、epistemic 1/1、quantity 1/1、state 1/1。上一代 structured-verifier 在同一批金标上是召回 3/15 = 20%、精确率 33%。漏掉三条：#2（Greer 被写成 she，簇内原文没有代词，属检测上限）、#4（比喻方向反转）、#10（拆除令写成在倒塌前下达，时序反转，原标注里后果最重的一类）",
  "cost": "零远程 LLM；4 个判官合计约 33 万 subagent token",
  "record_completeness": "complete"
}
---

**为什么不造注入题。** 同一份原始标注实测过：人工注入 60 条按 quantity/actor/polarity/state/scope
各 12 条配平，而自然分布里 **polarity 与 scope 一条都没出现**（0/83），占自然 20% 的时序错在注入体系里
**连类别都没有**，占 60% 的 actor 错里 6/9 是「两条各自正确的事实被融成一句、把 A 的谓语挂到 B 头上」
——单点替换造不出这个形状。结论写死在那份文档里：**注入题上测出的召回不可外推**。

### 这个读数推翻了当天早些时候的一个推断

`cluster-to-brief` 的臂在新 scorer 上 fatal/hard 全为 0，当时据此推断「判官看不见归属类错误」。
80% 的召回否掉了这个推断。更可能的解释是**那批臂在事实层面确实比 M2 那批干净**——
但两者错误形状可能不同，这个召回数字不能直接搬过去。

### 同分布的定向抽查（补做，非穷尽标注）

在 `direct-raw` 的 c7/c37/c43 上，按自然错误形状筛出判官标 ok 的高危句 42 句（融合/归属/时序），
逐句对原文核了 32 句：**零确认漏判**。四条最可疑的全部不成立——
「merely a temporary arrangement」在 993150:9（所引句的下一句）、「since taking office in April」在 993150:11 逐字、
因果方向与 986232:7 一致、「50 villages」在 986232:9。

抽查回答的是存在性（有没有漏），不是比率（漏了多少）；后者要穷尽标注才有分母。
