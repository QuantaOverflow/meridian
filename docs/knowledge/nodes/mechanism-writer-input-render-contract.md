---
{
  "id": "mechanism-writer-input-render-contract",
  "type": "mechanism",
  "title": "写作层输入渲染契约：不给概述、不给小标题、不给内部字段、按报道日排且讲清报道日≠发生日",
  "date": "2026-09-12",
  "status": "historical",
  "tasks": ["治事实关系错", "改报告层结构"],
  "scope": "brief-writer-v3 渲染层（报告 → 写作 prompt）；四条都是对着已知失效定的，不是先验设计。报告层已于 2026-09 退役，契约本身可复用到任何「材料 → 正文」的写作步",
  "source": "services/meridian-ai-worker/src/utils/brief-writer-v3.ts 头注释（已于 2026-09-22 随清理删除）",
  "conditions": [
    "适用于便宜模型档（glm-4.7-flash）的一次性写作调用",
    "每条对应的失效病例见 lesson-writer-copies-visible-input，样本均为个位数"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "justified_by", "to": "lesson-writer-copies-visible-input"}
  ],
  "input": "报告层产物（事实、出处、当事方、分歧、时间）",
  "output": "送进写作 prompt 的材料文本：只含事实句与必要标签，分段用小写标签，要点按报道日排序",
  "limits": "四条都是「堵已知的抄」，不保证模型不产生别的照抄形状；小写标签这条与「用大小写识别专名」互斥（简报 prompt 本身要求 lowercase）；报道日排序治的是因果倒置，不治句内融合致的关系错（那条的上限见 measure-detection-ceiling）",
  "invalidates_when": "换到不照抄材料的模型档次，或写作步改成能看见原句（届时「不给概述」的理由仍在，但内部字段的取舍要重定）"
}
---

## 四条

1. **不给概述、不给当事方 stance**——报告层模型写好的句子会被整句抄（Goal 1 实测）。
2. **不带小标题**，分段改用小写标签——桩实测模型会把 `Disputes` 这种小标题抄进正文。
3. **不带内部字段**（fact id / skeleton / articleId / variants）——模型会照抄。
4. **要点按报道日排**，治因果倒置；**并且 prompt 里要讲清「报道日不是事件发生日」**，
   否则模型会把报道顺序当成事件顺序，再写出一次因果倒置。

第 4 条的两半缺一不可：只排序不解释，等于把一个新的误导信号交给模型。
