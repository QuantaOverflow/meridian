---
{
  "id": "lesson-single-link-merge-falsified",
  "type": "lesson",
  "title": "单链聚合已证伪：7 期实测 32 个多条组里 21 个内部存在没过线的配对，14 条巨团是串出来的",
  "date": "2026-09-01",
  "status": "recorded",
  "tasks": ["改去重", "治故事过拆"],
  "scope": "7 期真实数据，阈值固定 0.94，唯一变量是聚合方式（单链 → 全链）。没有金标，所以「少合的 29 条里哪些是正确地不合、哪些是误拆」量不出来",
  "source": "apps/backend/src/lib/core/story-dedup.ts 的 buildMergeGroups 注释（已于 2026-09-22 前后随清理删除）；文献部分为 Hassanzadeh et al. VLDB'09 (PVLDB 2(1):1282-1293)",
  "conditions": [
    "阈值不变 0.94，两种聚合跑同一批数据，属受控对照",
    "本仓上游的 candidate-grouping.ts 早就是全链，story-dedup 这一层是漏网的"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "supports",
      "to": "measure-story-merge-threshold-094",
      "attributes": {"scope": "给出「≥3 条的组不确认」这条豁免成立的前提：只有全链保证组内每一对都过线"}
    },
    {
      "type": "cautions",
      "to": "measure-story-merge-threshold-094",
      "attributes": {"scope": "过线 ≠ 同一发生——原型实测判官对「同题材不同发生」仍有假阳，全链只消除串联，不消除判错"}
    }
  ],
  "kind": "failure_mechanism",
  "invalidates_when": "出现带金标的对照，量出全链少合的 29 条里误拆占多数；或改用不依赖两两阈值的聚合方式"
}
---

## 对照表（7 期，阈值不变 0.94）

| 聚合 | 组数 | 合掉的故事 | 最大组 | ≥3 条的组 | 其中「组内全对最小 < 阈值」 |
|---|---:|---:|---:|---:|---:|
| 单链 | 76 | 257 | 14 | 32 | **21** |
| 全链 | 91 | 228 | 6 | 27 | **0** |

32 个多条组里 **21 个（66%）内部存在没过线的配对**；14 条的巨团正是这么串出来的，
全链下最大只有 6 条。

**代价**：少合 29 条故事。「正确地不合」与「误拆」的比例**无金标可量**——这是本条的缺口。

## 文献

单链 = transitive closure / connected components。Hassanzadeh et al. VLDB'09
(PVLDB 2(1):1282-1293) 的受控实验实测其精度显著低于其他所有算法，
失效模式（chaining、阈值越松越严重）与上表吻合。

## 顺带消失的缺陷

原「中东伞」缺陷——单链把霍尔木兹谈判、卡塔尔斡旋、六个月盘点串成一片
（A↔B、B↔C 过线而 A↮C）——随之消失。全链要求组内**所有对**都过线，构造上不可能串联。

## 但「≥3 条不确认」仍有缺口

单链时代所谓「多条边互相印证」是假的（就是上表的 21/32）。全链下组内每一对都过线，
这条豁免才第一次有依据。**但过线 ≠ 同一发生**：原型实测判官对「同题材不同发生」仍有假阳
（美国遣返阿富汗人 × Milo 被遣返，两两问也判成一件事）。
