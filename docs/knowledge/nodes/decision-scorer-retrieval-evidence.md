---
{
  "id": "decision-scorer-retrieval-evidence",
  "type": "decision",
  "title": "慢档 scorer 采用「评分方检索证据 + 引用质量单列 + 清单去杂质」，并加指纹闸",
  "date": "2026-09-19",
  "status": "accepted",
  "tasks": ["设计验收门"],
  "scope": "cluster-to-brief 慢档；dev 五簇上跑通，heldout 无干净验收集",
  "source": "scripts/eval/cluster-to-brief/README.md 的「为什么事实证据由脚本检索」与「判定包指纹」两节",
  "conditions": [
    "取值是在两个候选之间选：被引句 ±2 句窗口 vs 全簇 top-k 检索",
    "窗口取值首测信度更好（0% vs 6%），仍被淘汰 —— 理由是效度而非信度"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "based_on", "to": "experiment-scorer-retrieval-evidence-dev"},
    {"type": "based_on", "to": "experiment-scorer-detection-recall-natural"},
    {"type": "selects", "to": "mechanism-scorer-evidence-retrieval", "attributes": {"action": "adopt"}},
    {"type": "selects", "to": "mechanism-pack-fingerprint", "attributes": {"action": "adopt"}}
  ],
  "kind": "adopt",
  "action": "采用：慢档 scorer 改为「评分方全簇检索证据 + citedSentenceSuffices 单列只报不设门 + 事件清单去杂质 + 判定包/尺指纹闸」，并补块内冗余读数与消息源剥离一档",
  "invalidates_when": "在跨日期、未接触的簇上重测，检索缺口超过 15% 或两判官不一致率回到 5% 以上"
}
---

**决定**：慢档 scorer 改为四条：

1. 事实正确性的证据由脚本从整簇检索 top-8，与成稿引了谁无关（[[mechanism-scorer-evidence-retrieval]]）
2. 新增 `citedSentenceSuffices` 一维，只回答「被引那句本身够不够」，**只报不设门**
3. 事件清单剔除杂质文章（`--depurify`，零 LLM），机械判据：出处全为杂质文章的事件数 = 0
4. 判定包与尺各算一个指纹，尺一改旧判定自动隔离（[[mechanism-pack-fingerprint]]）

外加两条后补：块内冗余进快档（机械读数，只报不设门）；grading instructions 补「消息源剥离」一档。

**为什么窗口取值被淘汰**：它的 0% 漂移是拿效度换来的。窗口锚在成稿引的那一句上，
引得宽的臂天然拿到更多证据，而各臂每句出处 1.03~1.73 不等。
**信度可以靠改守则、投票压下去；效度是结构决定的。** 实测证实了这个判断——
把守则里证据范围写死之后，检索取值的不一致率降到 0%，比窗口取值还低。

**没做的**（明确欠着）：分歧/多方说法这一维仍然缺——事件清单每条只有
`{event, articleIds, nArticles, nSources}`，写不写各方说法分数一样。
清单本身已查出两类缺陷（第 29 条施事搬错、多组重复条目），会歪曲覆盖率，未修。
检索的 k 与块大小不再调——那是 scorer 的超参，跟简报写得好不好无关。
