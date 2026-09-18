---
{
  "id": "claim-minimal-unit-representation",
  "title": "最小单元是「谓词+类型化论元」，去修饰留主谓宾骨架，「谁说的」单独建模",
  "date": "2026-09-12",
  "status": "candidate",
  "source": "docs/engineering-notes/fact-compression-representations.md",
  "invalidates_when": "无（这是调研给的形状，能不能用取决于模型档次与目标）",
  "type": "mechanism",
  "tasks": [
    "改报告层结构",
    "降低报告层成本"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [],
  "legacy_type": "claim",
  "legacy_relations": {},
  "kind": "representation",
  "input": "新闻原句",
  "output": "最小单元是「谓词+类型化论元」，去修饰留主谓宾骨架，「谁说的」单独建模",
  "limits": "无（这是调研给的形状，能不能用取决于模型档次与目标）",
  "verification": "proposed"
}
---
六条证据链拼出来的形状，**组合本身没人端到端测过**（证据强度中等）。配套的红线清单可直接用：
否定词、基数词、限定词、时间/地点论元**永不删**；可删的是插入语、形容词子树、评价性副词。

两条要分开看的推论：它是**为了检索与核对**设计的，不是为了省 token——Dense X 的实测写得很直白，
「命题化不降 token，是索引重构」。把它当降本手段用，见 falsified-minimal-unit-compression。
