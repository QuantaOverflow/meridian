---
{
  "id": "lesson-restate-before-judge",
  "type": "lesson",
  "title": "核验失败在判定步不在检索步；改任务定义能削弱它，但没消灭「两侧都复述对仍判 supported」",
  "date": "2026-09-18",
  "status": "recorded",
  "tasks": ["治事实关系错"],
  "scope": "glm-4.7-flash 上的句级核验；材料为已消耗 heldout 与已调优开发题，未在未接触材料上复验",
  "source": "eval/cluster-to-brief/out/atomic-evidence/reframe-probe-v0.20/REFRAME-PROBE-RESULT.md",
  "conditions": ["结论限定在单候选句对单证据句（+半径 2 窗口）的题型；跨文章取舍与漏报未测"],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "supersedes", "to": "lesson-relation-factor-observability", "attributes": {"scope": "只更新失败定位与可改善性，不推翻其观测记录"}},
    {"type": "cautions", "to": "attempt-plan-verify-backfill", "attributes": {"scope": "该组合含 specialist-question-gate，其判定步尚未立住"}}
  ],
  "kind": "diagnostic_observation",
  "invalidates_when": "在未接触、跨事件材料上复验 B 臂，或把判定真正交给代码比较后重新定位失败"
}
---

跨四个批次稳定复现的形状：模型在 reason 与所选证据片段里已经复述了正确的原文信息，却把关系相反
的候选判成 supported。窄语法规则的检出增量跨全部批次为 0（heldout 有 factorGuard 消融坐实），所以
失败不在检索、上下文或接口，在**判定**这一步。

`measure-attribution-not-faithfulness` 记的 57% 引用是事后合理化，与这个形状同源：引用和判定本就
解耦，引用是判完之后补的。

把任务定义从「审计候选是否被完整支持」改成「先分别陈述两侧对同一事实的说法，再判是否一致」，
同模型同上下文下检出 3/8 → 7/8、误拦仅 +1。但**它是削弱不是消灭**：27,000 km² 那题两侧复述都正确
且并排摆着，仍判 supported。判定还是模型在做，只是脚手架变好了。

两条边界：
- 翻任务定义不能翻成「假定有错去找」。反向举证臂把 17 条全判 unsupported，误拦 9/9。
- 结构化字段里确实含有代码够得着的信息（五行数量-单位比对正好命中那条漏放），但同一次比对也在
  一条正常题上误报，n=1 不足以说「判定归代码」这条路赢了。
