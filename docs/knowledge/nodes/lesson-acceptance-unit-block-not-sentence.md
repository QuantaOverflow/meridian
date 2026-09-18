---
{
  "id": "lesson-acceptance-unit-block-not-sentence",
  "type": "lesson",
  "title": "验收单位该是 block 不是句；注入题的形状与自然错误分布对不上",
  "date": "2026-09-18",
  "status": "recorded",
  "tasks": ["设计验收门", "治事实关系错"],
  "scope": "依据为四个簇 83 句的非盲单人判定；自然错误率区间宽，结论是判据层级而非具体阈值",
  "source": "scripts/eval/cluster-to-brief/out/natural-error-rate/NATURAL-ERROR-RATE-RESULT.md",
  "conditions": ["有效样本 4 个簇；形状分布来自单一日期快照，季节性未知"],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "cautions", "to": "attempt-structured-verifier-interface", "attributes": {"scope": "其 60 条注入验收材料的形状与自然分布不符，测出的召回不可直接迁移"}}
  ],
  "kind": "diagnostic_observation",
  "invalidates_when": "在多期、跨日期的自然简报上重测错误形状，且分布与本次不同"
}
---

**三条互相独立的理由说明「错误放行率 < 10%」问错了层级。**

一、量的是句子，读者读的是 block。实测 8 个多句 block 全部含错。就算逐句放行率做到 10%，lead
整块干净的概率也只有 77%；要 80% 干净得把逐句率压到 1.6% 以下，即吃掉现有错误的 91%。

二、验收材料形状与自然分布不符。自然 actor 60%、time 20%、polarity 0%、scope 0%；注入材料按
quantity/actor/polarity/state/scope 各 20% 配平。40% 的验收预算花在从未出现过的形状上，占自然
20% 的时序错连类别都没有。而且自然的 actor 错多为句内融合致主语挂错，不是注入的单点替换。

三、60% 的自然错对报告是忠实的，锚报告的核验层结构上看不见。

另有两条量化陷阱：n=30 且只有满分能过——1/30 的 95% 上端已约 17%，所以那实际是零漏放门不是
10% 门；`measure-detection-ceiling` 实测便宜模型逐句判官那档 82%，目标 >90% 检出本就高于已测上限。

建议判据形态：主判据换成 block 级「lead/more 中含 ≥1 错的比例」（基线 8/8=100%），句级只留误杀率
这一个反方向的门，relations 步单独立判据（伪造关系数 = 0 + 真实 update/conflict 召回率）。
block 级比例同时满足演化所需的两个性质：有梯度、可跨代比较。
