---
{
  "id": "lesson-llm-oversplits-single-large-event",
  "type": "lesson",
  "title": "过拆只发生在单一大事件的大簇上：91 篇尼泊尔洪水被切成 22 个故事，占掉简报 25 个名额里的 11 个",
  "date": "2026-08-30",
  "status": "recorded",
  "tasks": ["改去重", "治故事过拆"],
  "scope": "两期真实数据 + 94 条人工金标（该批金标文件已丢失，只剩本节点转述的结论）；跨天复现一次。对照组为「杂物袋」簇，样本量未记录",
  "source": "apps/backend/src/lib/core/story-dedup.ts 头注释（该文件于 2026-09-22 前后随清理删除；原始 94 条金标文件注释自陈已丢失）",
  "conditions": [
    "故事由 LLM 在 story-validation 阶段从簇里切出；过拆是那一步的行为，不是聚类算法的行为",
    "简报名额当时为 25 个故事"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "cautions",
      "to": "mechanism-block-overlap-sensor",
      "attributes": {"scope": "碎片化表现为大量低重合度的块对（尼泊尔 11 块两两 0.18–0.22），块对传感器结构上看不见这个病"}
    }
  ],
  "kind": "failure_mechanism",
  "invalidates_when": "story-validation 的切分 prompt 或模型改变后，在同量级的大簇（80+ 篇同一事件）上重测不再出现同类碎片化"
}
---

## 病灶

**LLM 把一个大事件切得过碎。** 一场尼泊尔冰川溃决洪水的 **91 篇报道被切成 22 个故事**，
占掉简报 25 个名额里的 **11 个**，把「基辅无人机袭击致 37 死」「五角大楼封禁 Anthropic 被判违法」
等挤出简报。

**跨天复现**：8/28 同一场灾难 74 篇 → 14 个故事。

## 对照：不是所有簇都过拆

「一袋不相干小事」的杂物袋簇几乎不过拆，**过拆倍数只有 1.1–1.3**。
所以缺陷集中在**单一大事件的大簇**上——簇越像一件事，切得越碎。
这个对照很重要：它排除了「切分 prompt 整体偏碎」这个解释，指向「同一事件的多个侧面被当成
多件事」。

## 下游后果

碎片化之后，重复内容以「多个块各写事件一个侧面」的形式出现，
两两重合度反而低（report 76 的尼泊尔 11 块两两 0.18–0.22），
**越碎越不像重复**——见 [[measure-block-overlap-threshold]] 的第三条局限。
