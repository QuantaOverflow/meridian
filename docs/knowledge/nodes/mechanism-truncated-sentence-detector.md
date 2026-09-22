---
{
  "id": "mechanism-truncated-sentence-detector",
  "type": "mechanism",
  "title": "残句检测：四条字面判据，误报上限约 5%，判错的代价只是少一条原话",
  "date": "2026-09-12",
  "status": "historical",
  "tasks": ["设计验收门"],
  "scope": "英文原文句（抓取后的文章句），用于筛掉被截断/粘连的句子；5% 是 verify V1.4 给的误报上限，不是逐条核实出的精度",
  "source": "services/meridian-ai-worker/src/utils/brief-writer-v3.ts 的 isTruncatedSentence（已于 2026-09-22 随清理删除；判据与读数仅存于本节点）",
  "conditions": [
    "只对英文句成立：判据依赖大小写与英文助动词",
    "判错的后果是少引一条原话，不改变正文内容——这是能接受 5% 误报的前提"
  ],
  "evidence_origin": "local_record",
  "relations": [],
  "input": "一条候选原文句",
  "output": "是否为残句（截断或粘连）的布尔判定，为真则不拿它当可引用的原话",
  "limits": "只认字面特征，语义完整但缺标点的句子会被误杀（约 5% 上限）；非英文文本不适用；不修复句子，只筛除",
  "invalidates_when": "抓取层改动使句子边界质量变化，或下游改成「残句也要用、必须修复」——那时筛除就不够了"
}
---

## 四条判据（任一命中即判残句）

1. 没有句末标点——**结尾括号署名不算**（如 `(FRANCE 24 with AFP)`）。
2. 小写开头。
3. 句末标点 / 闭引号 / 方括号后**紧贴大写字母**——粘连的典型形状：
   `…'.”Recommended`、`[Reuters]US`。
4. 小写实词后直接接「大写词 + has/have/had/is/was/will」——两句被拼在一起的形状。

## 误报上限

**约 5%**（verify V1.4）。这是上限不是实测精度。**可以接受的理由是代价不对称**：
判错只是少一条原话，不影响正文内容，也不会引入新内容。
