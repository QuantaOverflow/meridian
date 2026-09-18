---
{
  "id": "falsified-five-slot-srl",
  "title": "强迫模型逐字摘抄五槽论元（SRL 抽取式）：glm-flash 95 个框架里 55 个把整句塞进谓词槽",
  "date": "2026-09-11",
  "status": "live",
  "source": "docs/adr/0004-brief-writer-v3.md",
  "invalidates_when": "换到能稳定做结构化论元抽取的模型档次（且成本账仍划算）",
  "type": "lesson",
  "tasks": [
    "改报告层结构",
    "改抽取prompt"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [
    "模型档次 = Workers AI 上的便宜档"
  ],
  "evidence_origin": "historical_document",
  "relations": [
    {
      "type": "cautions",
      "to": "claim-minimal-unit-representation",
      "attributes": {
        "scope": "强迫模型逐字摘抄五槽论元（SRL 抽取式）：glm-flash 95 个框架里 55 个把整句塞进谓词槽；成立条件见正文，失效条件：换到能稳定做结构化论元抽取的模型档次（且成本账仍划算）"
      }
    }
  ],
  "legacy_type": "falsified",
  "legacy_relations": {
    "refutes": [
      "claim-minimal-unit-representation"
    ]
  },
  "kind": "failure_or_literature_warning"
}
---
簇 0：`glm-4.7-flash` 95 个框架里 **55 个把整句塞进谓词槽**，等于没结构化；换 `glm-5.3`、
`deepseek-v4-pro` 各有新崩法；**开思考链三个模型全不可用**（3046 超时 / 思考链复读 / 正文为空）。

**边界要划准**：元凶不是约束解码（同样的 JSON schema，改成「一句自由文本 + 出处」就正常），
而是**逼模型逐字摘抄论元**。2026-09-14 的 codex 原型又验了一次：同样结构化输出，但让模型
写短句 + 挂出处，glm-flash 一次没崩、出处 100% 有效（见 falsified-minimal-unit-compression）。
