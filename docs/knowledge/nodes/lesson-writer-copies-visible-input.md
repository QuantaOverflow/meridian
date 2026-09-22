---
{
  "id": "lesson-writer-copies-visible-input",
  "type": "lesson",
  "title": "渲染给写作层看见什么，它就抄什么：概述整句抄、小标题抄进正文、内部字段抄、引用号抄",
  "date": "2026-09-12",
  "status": "recorded",
  "tasks": ["治事实关系错", "改报告层结构"],
  "scope": "brief-writer-v3 一线（glm-4.7-flash 档写作模型，材料为 report-v3 报告）的零散实测病例，每条 1–2 例，多为 Goal 1/G3 迭代过程中的观察；不是统计，是「这条路已经走过且失效」的清单",
  "source": "services/meridian-ai-worker/src/utils/brief-writer-v3.ts 头注释与 services/brief-writer-v3.ts（均已于 2026-09-22 随清理删除，报告层本身也已退役）",
  "conditions": [
    "写作模型为 glm-4.7-flash 档；强模型是否同样照抄未测",
    "每条病例的样本量都是个位数，逐条列出是为了保留「已知失效」的事实，不是为了给比率"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "based_on",
      "to": "experiment-natural-error-rate-v3",
      "attributes": {"scope": "该实验的写作层归因（15/15 错在写作层、句内融合为主）与本条的照抄病例互为补充；本条只保留渲染契约相关的病例，不宣称新的错误率"}
    },
    {
      "type": "cautions",
      "to": "mechanism-write-once-at-end",
      "attributes": {"scope": "把改写集中到最后一步之后，那一步能看见的任何东西都可能被整句抄——渲染契约（不给概述/小标题/内部字段/引用号）是该机制的前置条件"}
    }
  ],
  "kind": "failure_mechanism",
  "invalidates_when": "换到能稳定区分「材料」与「待写内容」的模型档次，或渲染层改造后在同样材料上不再出现整句照抄"
}
---

## 抄什么

- **抄概述与 stance**：报告层模型写好的句子会被**整句抄**（Goal 1 实测）。这是渲染层
  不给概述、不给当事方 stance 的直接原因。
- **抄小标题**：桩实测模型会把 `Disputes` 这种小标题抄进正文。
- **抄内部字段**：fact id / skeleton / articleId / variants 只要渲染出来就会出现在正文里。
- **抄引用号**：实测正文出现 `[904687:2] Saudi-backed government forces reported …`。

## 顺带记下的同族病例（同一批注释，均已删除）

- **按词面挑参照事实会挑错事件**：措辞修正（Goal 2）按词面选参照事实，把 c13 的简讯换成了
  另一件事，Goal 2.1 因此删掉。
- **无回应字眼的背景被拼成因果**：一句纯背景（「2015 年联军介入」）被写成
  `In response, … a blockade`（c3 实测）。
- **同姓不同当事方**：报道只写姓，照抄分不清是谁（c13 实测）；而规则里要求「家属也点全名」后，
  模型就给家属都补上了姓（G3 Round 3 实测）——**约束的两侧都会翻车**。
- **专名凭记忆补/写错**：Rawdhah → Rawhdah；写出材料里根本没有的 Muailibi。
- **引语不逐字**：c0 原句 Canada "lives because of the United States"，
  模型写成 "Canada lives because of the United States."（引号范围被改）。
- **长度兜底只能靠代码**：c0/brief 两次压缩重写后仍 229 字符；c18/brief 216 字符的一句
  找不到逗号边界，只能退到连词/介词前截。（重写治长度已证伪，见 [[falsified-length-rewrite]]。）
- **更新事实的位置决定模型写哪个值**：写作仍照排在最前的「killing six people」写
  （c13 简讯、头条实测），所以更新必须挂在**旧值那一行旁边**，不能另起一行。
