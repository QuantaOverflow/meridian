---
{
  "id": "measure-writer-input-anatomy",
  "title": "写作层从未见过原句，只看改写后的事实句；而原句自足率约九成、只长 1.3–1.9 倍",
  "date": "2026-09-15",
  "status": "live",
  "source": "services/meridian-ai-worker/src/utils/brief-writer-v3.ts + M1-1789308830116 落盘报告",
  "invalidates_when": "写作层的材料渲染改动（`renderNumberedPoints` / `renderReportForWriter`），或抽取不再改写",
  "type": "lesson",
  "tasks": [
    "改报告层结构",
    "提高写作层覆盖"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_analysis",
  "relations": [
    {
      "type": "constrained_by",
      "to": "invariant-citation-resolvable"
    },
    {
      "type": "based_on",
      "to": "experiment-natural-error-rate-v3",
      "attributes": {"scope": "补充四簇M2回顾分析中写作材料的来源坐标渲染与事实融合观察；不改变原实验条件或宣称独立泛化验收"}
    }
  ],
  "legacy_type": "measurement",
  "legacy_relations": {
    "depends_on": [
      "invariant-citation-resolvable"
    ]
  },
  "kind": "observation"
}
---
**代码事实**：`renderNumberedPoints` 喂进写作 prompt 的只有 `p.text`——抽取改写后的自足事实句。
原句（`report.sentences`，全量保留）只出现在 `pointSourceText` 里，而那个函数**只被接地校验用**
（查名字/数字/引语在不在材料里），从不进 prompt。

所以一条事实从原句到成稿要过两次 LLM 转述：抽取改写一次、写作再写一次（外加偶尔一次接地修正）。
模型是在转述一份转述。

**当初改写成自足句的理由，实测只覆盖一成的情况**：

| 簇 | 原句条数 | 以代词/连接词开头 | 原句均长 | 改写句均长 | 长度比 |
|---|---:|---:|---:|---:|---:|
| c0 | 151 | 8（5.3%） | 180ch | 97ch | 1.87x |
| c3 | 167 | 17（10.2%） | 179ch | 116ch | 1.54x |
| c13 | 233 | 17（7.3%） | 159ch | 119ch | 1.33x |
| c18 | 36 | 7（19.4%） | 179ch | 117ch | 1.52x |

九成左右的原句单独拎出来就带主体，读得懂。长度比 1.33–1.87 倍，不是数量级差距。
`CITE_INSTRUCTIONS` 要求「self-contained sentence, name the actor (no he/it/they)」，
防的是一个约一成的问题，代价是全部事实过一遍 LLM 转述——而抽取 62.2% 的成本正是输出侧。

相关成本结构：抽取 49% / 去重 34% / voices 17%（四簇基线 extract 1177.8、dedup 817.7、voices 402.2 neurons）。
