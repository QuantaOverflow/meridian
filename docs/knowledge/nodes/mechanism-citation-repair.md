---
{
  "id": "mechanism-citation-repair",
  "type": "mechanism",
  "title": "写完由代码补出处:数字与引语不在所引原句里就去材料里找字面包含它的原句",
  "date": "2026-09-20",
  "status": "candidate",
  "tasks": ["治事实关系错", "设计验收门"],
  "scope": "direct-raw exec 臂(DIRECT_RAW_WRITE_REPAIR=mech);materials = 本次写作用到的全部重点原句",
  "source": "scripts/eval/cluster-to-brief/arms/direct-raw/direct-raw.mjs(repairCitations / contextOf)",
  "conditions": ["成稿逐句带出处", "比对只认字面包含(数字去千分位、引语归一大小写与标点)"],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "justified_by", "to": "lesson-judge-needs-alignment"}
  ],
  "input": "成稿句子 + 它声称的出处 + 材料池(重点指向的原句,含代词句的前一句)",
  "output": "补过出处的句子(只增不删)+ 补了几处的计数",
  "limits": "只覆盖数字与引号内 ≥2 词的原话;专名、从句、结论这些补不了——真实一天里出处挂错仍有 22%;找不到就原样留着,由快档报读数",
  "invalidates_when": "扩到专名与从句后误补出现(补上的原句其实不支撑该句)"
}
---

**两个确定性修复,合起来算一个机制**:

1. **补出处**:句中数字/引语若不在被引原句里,去材料池找字面包含它的原句补进 sources。
   只增不删、只认字面包含,所以不会把出处改错。真实一天 51 篇里补了 19 处,
   数字缺出处从每批 2–8 句降到 3/248,引语降到 1/248。
2. **代词句带上前一句**:材料里若某条原句以代词开头或含「he added」这类无主名引述,
   自动把同篇前一句一起给写作层。治的是 c1 那次把分析师的话安到 Andersson 名下(v6 唯一硬错),
   加了之后同类错误在后续 18 篇里没再出现。

**为什么值得单独记**:这两条是零 LLM、可判定的,和「靠 prompt 压」形成对照——
同期用 prompt 禁止编造关系,三次运行仍然出现;而机械补出处的读数是稳定的。
