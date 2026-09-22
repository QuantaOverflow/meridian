---
{
  "id": "lesson-workers-ai-structured-output-pitfalls",
  "type": "lesson",
  "title": "要结构化输出的两个坑：gpt-oss-120b 没有 enable_thinking 开关（content 恒空），json_schema 约束下召回减半",
  "date": "2026-09-11",
  "status": "recorded",
  "tasks": ["治事实关系错", "提高链路健壮性"],
  "scope": "关系表这一步（report-v3/writer-v3 的 relations 调用）在 Workers AI 上的实测。thinking 那条是 2026-09-11 一次实测（3000 token 预算）；json_schema 那条为被删注释的转述，原始运行记录未留，样本量与判据未知",
  "source": "services/meridian-ai-worker/src/prompts/briefWriterV3.ts 与 services/brief-writer-v3.ts 的注释（已于 2026-09-22 随清理删除）",
  "conditions": [
    "THINKING_OFF_MODELS 是本仓维护的「可关思维链」模型名单；gpt-oss-120b 不在其中，因为它压根没有这个开关",
    "json_schema 那条只保留结论方向，不给具体数字口径——原始读数已随注释消失"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "supports",
      "to": "falsified-bigger-writer-model",
      "attributes": {"scope": "补充 gpt-oss-120b 在本仓不可用的第二个理由：不止关系错更多，结构化产出这一步会直接拿不到 content"}
    }
  ],
  "kind": "observation",
  "invalidates_when": "Workers AI 为 gpt-oss-120b 提供思维链开关，或其 json_schema 实现改版后重测召回不再下降"
}
---

## 坑一：没有 enable_thinking 开关的模型会把预算烧在思维链里

**gpt-oss-120b 不在 `THINKING_OFF_MODELS` 名单里——因为它没有这个开关。**
2026-09-11 实测：关系表在 3000 token 预算下，**思维链烧到 14,437 字符仍未写完，
`content` 恒为空、直接抛错**。

判断要点：这不是「输出被截断」，是**正文字段从头到尾没开始写**。
换模型前必须实测「关掉 thinking 后正文落在哪个字段」，各家不同。

## 坑二：关系表用纯 JSON，不用 json_schema

本仓实测 **json_schema 约束下召回减半**，且 **`maxItems` 被模型当成「要凑满的数」**
（本该是上限，结果变成配额）。所以关系表这一步走纯 JSON 输出 + 自己解析，
不上 schema 约束。

（这条是被删注释的转述，原始运行记录未留存，只保留方向性结论。）
