---
{
  "id": "mechanism-repetition-detector",
  "type": "mechanism",
  "title": "复读检测：句级（同句 ≥3 次 / 不同句占比 <0.8）+ 词级（12 词片段 ≥4 次），挡 glm-4.7-flash 复读",
  "date": "2026-09-12",
  "status": "live",
  "tasks": ["提高链路健壮性", "设计验收门"],
  "scope": "glm-4.7-flash 经 Workers AI 产出的简报正文；误判读数来自旧 25 个块的一次回放（verify V1.3），不是多期统计",
  "source": "services/meridian-ai-worker/src/services/call-llm.ts / brief-block-v6.ts 的 detectRepetition（仍在生产使用）；判据与读数原记于 brief-writer-v3 一线的注释，该文件已于 2026-09-22 删除",
  "conditions": [
    "配套的 frequencyPenalty 0.2 等防复读参数同时生效；代码侧检测是第二道，不能替代参数",
    "误判读数的样本是旧的 25 个块，换模型或换块长度未重测"
  ],
  "evidence_origin": "local_record",
  "relations": [],
  "input": "一次 LLM 调用产出的正文文本",
  "output": "是否复读的布尔判定（供调用方重试或作废该块）",
  "limits": "阈值按「块」这一量级的文本标的，很短的文本上 ≥3 次/占比 0.8 可能误伤；只认字面重复，不认换措辞的绕圈；样本只有 25 块的一次回放，没有跨期误判率",
  "invalidates_when": "换掉 glm-4.7-flash 档的写作模型后复读形状改变，或出现同句合法重复 ≥3 次的正文体裁（如逐条列举）"
}
---

## 两条判据

1. **句级**——同一句（>25 字符）出现 ≥3 次，**或** ≥10 句里不同句占比 <0.8。
2. **词级**——任一 12 词片段出现 ≥4 次。这条治的是「复读但不断句」：模型把同一段话滚动重复
   却没有可切分的句号，句级判据看不见。

## 读数

旧 25 个块上只判出一块（12,407 字符，同一句 78 遍），**其余 0 误判**（verify V1.3）。
样本是一次回放的 25 块，不是多期统计。

## 为什么留着

glm-4.7-flash 的复读是反复发生的事故形状（本仓已四次）。参数侧（frequencyPenalty）和代码侧
检测是两道独立的闸，参数不保证，检测才能兜住。
