---
{
  "id": "mechanism-block-overlap-sensor",
  "type": "mechanism",
  "title": "块间重复传感器：块内文档频率自校准 + 两路信号（稀有词共享 / 长 n-gram），不用专名词表",
  "date": "2026-08-31",
  "status": "historical",
  "tasks": ["设计验收门"],
  "scope": "一期简报内部的块两两比较；英文小写正文；离线运行。从未接入 assembleBrief，无线上数据",
  "source": "services/meridian-ai-worker/src/utils/block-overlap.ts + eval/block-overlap/baseline.ts（commit c4988c1 引入，已于 2026-09-22 随清理删除；机制描述仅存于本节点）",
  "conditions": [
    "同一期内块数 ≥2，且块正文足够长（短块会让归一量虚高，必须同时读绝对量）",
    "阈值 0.22 的来历与样本量见 measure-block-overlap-threshold，换 prompt 需重标"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "justified_by", "to": "measure-block-overlap-threshold"}
  ],
  "input": "一期简报的全部块正文（小写英文），无需外部词表、无需 LLM 调用",
  "output": "每个块对一个 cont 重合度（S1、S2 两路各给绝对量与归一量），超阈的块对列表；用于人工排查，不产出放行/拦截判定",
  "limits": "① 测重合度，判不了「该共享」与「照抄」的区别，所以只能当传感器不能当门；② 只看字面，换措辞讲同一件事抓不到；③ 只测块对，不测一个事件占了几块——碎片化是它结构上的盲区；④ 只有 7 对样本支撑阈值，其中 2 对人工核实；⑤ 零调用零成本，但需要块数 ≥2 且块够长",
  "invalidates_when": "简报改用大小写混排或非英文正文（df 自校准与 n-gram 判据都按小写英文设计），或改成由 LLM 判两块是否照抄后重合度不再需要"
}
---

## 判据设计与为什么这么设计

**不用专名词表。** 简报写作 prompt 明写 `use lowercase by default`，靠大小写识别专名是死路。
改用**块内文档频率 df 自校准**：在本期所有块上统计词的分布，稀有词由数据自己定，不靠外部词表。

两路信号，**任一路超阈即报**：

- **S1 稀有词共享**——抓「改写着抄」：两块共享了本期里罕见的词。
- **S2 长 n-gram**——抓「逐字抄」：长片段完全一致。

两路都同时给**绝对量和归一量**，因为短块会让归一量虚高（少量共享词就能占很大比例）。

## 状态

**这套阈值是离线 baseline，从未接入生产**（注释原文：从未接入 `assembleBrief`）。
所以既没有线上误报率，也没有「上线后重复率降了多少」的读数。
后续若要重建同类传感器，df 自校准 + 双路信号这套判据可直接复用，阈值必须在新 prompt 下重标。
