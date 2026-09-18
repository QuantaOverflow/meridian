---
{
  "id": "measure-vote-signal-undercount",
  "title": "票数（被几篇报道）有两个独立的少算机制：漏挑与漏合，c13 实测 17 条骨架本该 26 条",
  "date": "2026-09-15",
  "status": "live",
  "source": "apps/backend/prototypes/brief-v3-prod/out/runs/M1-1789308830116/（c13 observation 离线统计）",
  "invalidates_when": "去重改成不靠「向量候选 + 分组判定」的结构，或重要性不再由跨文章计数得出",
  "type": "lesson",
  "tasks": [
    "改去重",
    "改报告层结构"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "constrained_by",
      "to": "invariant-support-count"
    }
  ],
  "legacy_type": "measurement",
  "legacy_relations": {
    "depends_on": [
      "invariant-support-count"
    ]
  },
  "kind": "observation"
}
---
票数是写作层唯一的重要性信号（`skeleton = articles >= 2`），而它被系统性地少算。
两个机制互相独立，修法不同：

**一、漏挑**（2026-09-11 已记录，见 report-extraction-dedup 那轮）：一件事多篇报道，但抽取只从
1–2 篇里挑出来。例证「Greer 那句 3 篇都写了，只有 1 篇被挑中」。**修过**：检索原文 + LLM 确认，
骨架从 15 涨到 42，但主线只多救回 1 条——回报很差，没采用。

**二、漏合**（2026-09-15 实测）：两篇都抽出来了，去重没并上。c13（新德里楼塌，16 篇，簇本身干净，
不是多条新闻线混装）的 124 条单票事实里，跨文章、词面 Jaccard ≥0.3 的有 13 对，连通成 9 组，
**全部合并后骨架会从 17 涨到 26（+53%）**。

漏合又分两种，证据是分开的：

- **候选生成漏配**：一对几乎逐字相同的跨文章事实（"Gupta stated that no public activity will be
  permitted…" / "Rekha Gupta said no public activity will be permitted…"）**从没进过任何一次判定**。
  top-8 余弦 ≥0.7 加贪心非重叠分组（≤8）没把它俩配上。
  （保留：探针是字面子串匹配，只能证明那个措辞没出现过；但两条最终都是单票，没被合是确定的。）
- **模型违反明文规则**：调用 #2 把七条死亡人数的事实放在一起判，输出 `[[0,1,2,4,6],[3],[5]]`——
  五条「七人」合对了，却把「六人」「五人」拎出来单独成组。而 partition prompt 白纸黑字写着
  「同一个量的不同数值（数字、金额、日期、百分比）仍然算同一事实」，`figuresDiffer` 字段就是为此存在的。
  **这组是现成的回归用例**：正确行为是 5/6/7 合成一条并标 `figuresDiffer`。

**顺带的成本读数**：c13 的 48 次去重调用里，22 次（46%）结论是「全都不一样」，什么都没合成却照付
766 token 的规则说明书（见 measure-dedup-fixed-overhead）。送判条目 147、产出子组 100、实际合掉 47 条。

**别把这条读成「修了漏合就会变好」**：漏挑那次的经验是骨架变大 2–3 倍而主线只多 1 条。
骨架数是中间指标，成稿质量要另外量。
