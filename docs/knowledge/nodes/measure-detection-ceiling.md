---
{
  "id": "measure-detection-ceiling",
  "title": "便宜模型上的事实错检测上限：代码 45–49% 召回、逐句判官 82%/42%、整簇判官 26%/68%",
  "date": "2026-09-12",
  "status": "live",
  "source": "docs/adr/0004-brief-writer-v3.md",
  "invalidates_when": "换判官模型档次，或证据包构造方式改变（当前瓶颈就在证据包）",
  "type": "lesson",
  "tasks": [
    "治事实关系错",
    "设计验收门"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "historical_document",
  "relations": [
    {
      "type": "supports",
      "to": "falsified-rarr-default-on",
      "attributes": {
        "scope": "便宜模型上的事实错检测上限：代码 45–49% 召回、逐句判官 82%/42%、整簇判官 26%/68%；换判官模型档次，或证据包构造方式改变（当前瓶颈就在证据包）"
      }
    }
  ],
  "legacy_type": "measurement",
  "legacy_relations": {
    "supports": [
      "falsified-rarr-default-on"
    ]
  },
  "kind": "observation"
}
---
| 检测器 | 召回 | 精度 | 成本 |
|---|---|---|---|
| 代码逐句对齐到要点、在其出处里查数字/专名/说话人 | 45–49% | 36–47% | 0 |
| gpt-oss-120b 逐句判官（带检索证据 + 同类错误示例） | 82% | 42% | ~$8–16/月 |
| gpt-oss-120b 整簇长上下文判官 | 26% | 68% | 同量级 |

误报与漏报的**共同根因是证据包里缺关键原句**；按「与成稿相似」检索会捞回支持错误说法的材料。
Claude 盲审准是因为强模型把整簇原文一次读进上下文，Workers AI 这档复制不了。
生产现取零成本的代码检查器、**只标记不改稿**，标记只进内部观测。
