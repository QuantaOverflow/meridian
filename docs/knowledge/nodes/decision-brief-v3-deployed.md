---
{
  "id": "decision-brief-v3-deployed",
  "type": "decision",
  "title": "简报 v3 已于 2026-09-15 部署上线，至 09-17 已出三期；部署时用的是未提交的工作树代码",
  "date": "2026-09-18",
  "status": "live",
  "invalidates_when": "链路被回滚或替换、或三项缺陷修复后重新部署（那时另立节点记录新状态）",
  "tasks": ["上线简报v3"],
  "scope": "依据为 CF deployments API 与 Neon reports 表实查；本节点只记录部署与产出事实，不表示质量达标",
  "source": "Neon reports 表 id 94/95/96 与 CF accounts/*/workers/scripts/*/deployments",
  "conditions": [
    "meridian-ai-worker version 509eff62 部署于 2026-09-15T12:35Z，meridian-backend version 5dbd8364 部署于 2026-09-15T12:37Z",
    "reports 94（2026-09-15 13:53）/95/96 均含 v3 三节结构 top stories / more news / in brief；93 及更早为旧结构。正文长度从 3.3–5.7 万降到 1.6–1.8 万",
    "当时 HEAD 的 auto-brief-generation.ts 不含任何 v3 接线，线上版本无法从 git 复现；已于 2026-09-18 补提交（commit 320d9fe）"
  ],
  "evidence_origin": "production_record",
  "relations": [
    {"type": "supersedes", "to": "decision-brief-v3-production-state"},
    {"type": "based_on", "to": "experiment-natural-error-rate-v3"}
  ],
  "action": "已部署并持续产出；三项已知缺陷待修，止血优先级高于新一轮演化实验"
}
---

**纠正**：`decision-brief-v3-production-state` 正文的「未部署、未 commit」写于 2026-09-15 部署之前，
此后一直未更新。凡判断是否上线，查 CF Current Version 与 DB 产出，不要引用知识库节点或 commit
message（947ff49 标的「未接 backend」同样已过期）。

**读者已受影响的三项缺陷**（实测见 [[experiment-natural-error-rate-v3]]，同一份产品代码路径）：

1. relations 步伪造关系，且在 `prompts/briefWriterV3.ts` 里被置于
   `Notes on how events relate, taken from the original reporting:` 之下送进写作层。实测伪造 4 条、
   3 条写进正文；真实 update 与跨源冲突召回为 0。
2. `utils/brief-writer-v3.ts` 的 `renderReportForWriter` 没把 `fact.sources` 渲染进 `<key_points>`，
   写作时可回溯率 0/83。数据就在对象上，同文件 `numberedPoints` 已经带 sources，改动成本低。
3. `marks` check 精确率 33%、召回 20%、`groundingFixes` 全空——只标不改，标了照发，不构成核验层。

自然事实错误率实测 18.3%（簇级 95% CI [7.8%, 29.0%]），8 个多句 block 全部含错。该读数来自另一批
日期快照的输入，但跑的是同一份产品代码，大概率可迁移到线上这三期。
