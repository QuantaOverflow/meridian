---
{
  "id": "lesson-scorer-steers-search",
  "type": "lesson",
  "title": "scorer 的缺陷会把架构搜索牵到错方向：门在卡引用质量、覆盖率在惩罚正确剔杂质",
  "date": "2026-09-19",
  "status": "recorded",
  "tasks": ["设计验收门", "演化组合架构"],
  "scope": "cluster-to-brief harness；证据来自 c1 的四变体对照与 dev 五簇的多臂读数，均非人工金标",
  "source": "docs/knowledge/nodes/experiment-scorer-evidence-width-c1.md 与 experiment-crossover-routed-storyline-dev.md",
  "conditions": [
    "「引用错位 18%、真没依据 0 条」这个比例只在 c1 上量过，别的簇未测",
    "覆盖率分母的污染只核过 c1（18 条里 4 条出处全为杂质文章）；其余簇未逐条核"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "cautions", "to": "attempt-routed-storyline-direct-raw", "attributes": {"scope": "该臂在 c43 的硬错 2>1 出自有缺陷的 scorer，未坐实是真事实错"}},
    {"type": "cautions", "to": "mechanism-raw-candidate-discovery", "attributes": {"scope": "凡是靠「丢掉引用不当的候选」拿到的硬错下降，都要先排除是在迎合旧门"}}
  ],
  "kind": "diagnostic_observation",
  "invalidates_when": "scorer 改成证据由评分方检索、且事件清单剔除杂质文章之后，在未接触簇上重测这两条"
}
---

**核心：凡是 scorer 看不见的缺陷，演化搜索就不会去修；凡是 scorer 错算的东西，搜索会主动往那个方向走。**

四条已确认的缺陷，前两条会主动误导搜索，后两条只是看不见：

**（a）`hard ≤ 1` 这道门实际在卡引用质量。** 判官只看成稿引的那一句，缺的成分常在紧邻句里。
c1 实测：**真没依据 0 条、引错句子 9 条（18%）**，这 9 条在旧四档里全被算成错误。
后果是最有效的过门手段变成「引得更宽更准」而不是「写得更准」——而各臂在这条路径上已有明显差距：
每句平均出处 crossover 1.73、direct-raw 1.60、structure-router 1.03。

**（b）覆盖率的分母混进了杂质事件。** c1 的 18 条事件里 4 条（22%）出处全部来自杂质文章。
crossover 正确剔掉科索沃，次层覆盖因此 4/6 → 2/6 —— **因为做对了事而被扣分**。
核心层（设门那一层）无污染，6 条全干净。

**（c）没有块内冗余这一维。** 实测 direct-raw 每 10 句就有 1 句重复同块内说过的事，
crossover 6%。四个判官都主动报了，没有任何指标记录它。

**（d）没有观点/分歧这一维。** 事件清单每条只有 `{event, articleIds, nArticles, nSources}`。

### 这个病已经骗过一次

[[attempt-structured-verifier-interface]] 那条线之外，本仓的逐句接地臂（direct-raw + 局部接地过滤）
在旧尺上硬错 5 → 1，看着是赢。但它赢的机制是**把引用不当的候选整条丢掉**，正好迎合了 (a)。
同轮用检测器指标一算：为清掉 5 条硬错毁了 66 条判官判为正确的句子，**精度 6%、召回 100%**。
只看三维判据会把它当成功经验固化下来。

### 可操作的推论

- 同一段接地检查放在 solver 里叫机制、放在 scorer 里叫判据，**两边要用不同的指标族**：
  前者用精度/召回，后者用三维判据。只看一侧会得出相反结论。
- 判官会主动报 grading prompt 的缺陷，这个机制有效：本轮 7 个判官里 6 个报了
  （守则表被 `---` 腰斩、剥标记留标点残渣、近重复句、引证错配、事件清单截断、检索漏召）。
  「发现文件缺陷要说出来」这条指令值得固化进判官守则。
- 尺永远不完美，目标不是完美的尺，是**缺陷不会把搜索带到危险方向**。(a)(b) 必须修，(c)(d) 属扩目标可以欠着。

---

### 2026-09-19：`invalidates_when` 已触发

本条的 `invalidates_when` 写的是「scorer 改成证据由评分方检索、且事件清单剔除杂质文章之后，
在未接触簇上重测这两条」。这三件事当天全部做完了（[[decision-scorer-retrieval-evidence]]、
[[experiment-heldout-replacement-candidate]]）。重测结果：

- **(a) 门在卡引用质量** → 已修。证据改由全簇检索，引用质量拆成 `citedSentenceSuffices` 单列。
  逐句接地的「硬错 5→1」被证伪，见 [[lesson-grounding-is-citation-quality]]
- **(b) 覆盖率分母混进杂质事件** → 已修（`--depurify`，机械判据：出处全为杂质文章的事件数 = 0）
- **(c) 没有块内冗余这一维** → 已补（快档机械读数，同块两句引同一条原句）
- **(d) 没有观点/分歧这一维** → **仍缺**。事件清单已加 `variants` 存口径分歧，
  但「简报有没有告诉读者这里存在分歧」还没有判据

本条的**诊断部分仍然成立**（凡是 scorer 看不见的缺陷，演化搜索就不会去修），
作废的只是 (a)(b) 的现状描述与逐句接地那条归因。
