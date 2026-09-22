---
{
  "id": "lesson-dev-winner-fails-heldout",
  "type": "lesson",
  "title": "dev 上覆盖最高的臂在 heldout 上不合格——反复调过的集合选出来的第一名不可信",
  "date": "2026-09-19",
  "status": "superseded",
  "tasks": ["演化组合架构", "设计验收门"],
  "scope": "direct-raw 与 direct-raw-routed-storyline 在 dev 五簇与 heldout 两簇上的对照;同尺同判官模型",
  "source": "docs/knowledge/nodes/experiment-heldout-replacement-candidate.md 与 experiment-production-baseline-same-scorer.md",
  "conditions": [
    "heldout 两簇此前从未被任何臂产出过成稿",
    "c51 检索缺口 24–33%(dev 12%),正确性读数偏高 —— 但这对两个臂是同向的,不影响相对比较"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "supersedes", "to": "lesson-small-sample-flips", "attributes": {"scope": "把「三簇→五簇结论会翻」推进到「dev→heldout 结论会翻」,前者的论据仍然成立"}}
  ],
  "kind": "diagnostic_observation",
  "invalidates_when": "在跨日期的新 heldout 上重测,dev 与 heldout 的排序一致"
}
---

| | dev 五簇 核心层覆盖 | heldout 慢档 |
|---|---|---|
| `direct-raw` | **90.5%(最高)** | **两簇都不合格**(c28 62.5%<66.7%、c51 硬错 2>1) |
| `direct-raw-routed-storyline` | 88.9% | **两簇全过** |

**dev 上的第一名,到了未见过的数据上就不合格。** 两者在 dev 上只差 1.6 个百分点 ——
而 [[lesson-small-sample-flips]] 已经说过,n=5 时这个量级的差距不构成证据。
这一轮把那条推进了一步:**不只是「差距不显著」,是排序会反过来**。

### 为什么会反

`direct-raw` 不做任何筛选,靠**写得多**拿覆盖(dev 151 句 vs 118 句)。
写得多在干净簇上是优势,在脏簇上同时把杂质和错误一起带进来:
heldout 上它硬错 4、失真 4,而带筛选的那个是 2 和 0。
dev 五簇里只有 c36 一个真正脏的簇(23%),不足以暴露这个取舍;
heldout 的 c51 是 41%。

### 可操作

- **dev 上的排名只能当候选筛选,不能当结论。** 结论要 heldout。
- 而 heldout 是**一次性**的:这一轮已经把 28/51 用掉了。下次要结论,得先取新的、跨日期的簇。
- 扩样本的瓶颈不在判官成本(零 API、十几分钟一轮),在于每个新簇要人工按标题标杂质、
  且重跑各臂需要可用的 LLM key。
