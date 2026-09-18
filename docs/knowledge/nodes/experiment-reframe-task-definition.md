---
{
  "id": "experiment-reframe-task-definition",
  "type": "experiment",
  "title": "只换任务定义不加约束：已知失败题检出 3/8 → 7/8，误拦仅 +1",
  "date": "2026-09-18",
  "status": "recorded",
  "tasks": ["治事实关系错"],
  "scope": "17 条题全部取自已消耗的 heldout c28/c51 与已调优的开发批，且按已知失败挑选；定性死活判断，非通过率、非泛化证据",
  "source": "scripts/eval/cluster-to-brief/out/atomic-evidence/reframe-probe-v0.20/REFRAME-PROBE-RESULT.md",
  "conditions": [
    "三臂同题、同 batch 大小（2）、同一次运行内交错跑完；对照臂 A′ 真跑而非引用历史 results，以消除题集与 batching 混淆",
    "@cf/zai-org/glm-4.7-flash，真 Workers AI REST+Gateway，skip-cache、thinking 关闭、temperature 0；无远程 judge",
    "判据跑前冻进 plan.json：主读数=8 条已知失败题中 status 翻成 unsupported 且 errorChoice 指对片段的条数；打架读数=9 条正常题误拦数；误拦比 A′ 多 2 条以上即判该臂以误拦换漏放",
    "题目正常与错误成对共用同一句窗口，17 条不是 17 个独立事件",
    "新增文件仅 reframe-seeds.mjs / reframe-probe.mjs，未改任何冻结组件；事后复跑 heldout-eval.mjs 不报 drift"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "yields", "to": "lesson-restate-before-judge"}
  ],
  "kind": "probe",
  "outcome": "mixed",
  "inputs": "17 条 = 8 条已知失败题（heldout 三条漏放 + 一条拦对但解释错，v0.17 两条、v0.18 两条漏放）+ 9 条正常对照（含 heldout 那条已知误拦）",
  "evaluation": "代码按预注册判据计分；首轮计分脚本用 errorChunk 判 span 命中，而冻结的 processChoices 只回 errorSpan，导致 A′ 每次正确拦截被静默记为未命中（首轮误报 A′=0/8）。改为按 span 文本反查区间，只离线重算不重跑，results.json 原样保留，纠正值另存 scores-corrected.json",
  "result": "A′ 检出 3/8、误拦 0/9；B（先述后判，schema 增 sourceSays/claimSays 且排在 status 之前）检出 7/8、误拦 1/9；C（反向举证 find-the-difference）把 17 条全判 unsupported，误拦 9/9，按预注册规则作废。B 唯一漏放为 27,000 km² 题：sourceSays 已正确复述 `27,000 sq km (10,400 square miles)`、claimSays 为 `27,000 square miles`，两侧并排摆着仍判 supported",
  "cost": "27 逻辑调用 / 27 HTTP / 45251 已知 tokens / 118.4 累计请求秒；0 合同重试、0 unknown usage、51 行全完成、未删题；美元价未查询",
  "record_completeness": "complete"
}
---

历史上这 8 条在各自批次里全是失败题，但同一 prompt 重跑的 A′ 拦住了 3 条——这批题对 batching
与跑间波动敏感，基线不是 0。若拿历史记录当对照会报成 0→7，虚高一倍多。跑 A′ 的价值就在这里。

窄语法规则路线的对照：v0.16→v0.19 四个版本一路加约束，检出增量跨全部批次为 0，heldout 还有
factorGuard 消融坐实（去掉后结果逐项相同）。改任务定义是首次动任务定义本身，方向与
[[opinion-based-prompting-validated]] 记录的旁证一致。

C 的高检出不是检出：它一条 supported 都没给。任务定义可以翻，但不能翻成「假定有错去找」。

下一步不是往 B 上叠约束（那是退回加约束的老路），而是：拆开「加两个前置字段」与「改任务定义」
各自的贡献；在未接触、跨事件的新材料上验 B。两者都需要新材料，而材料口径取决于
[[lesson-acceptance-unit-block-not-sentence]]。

### 关联维护状态

首次结构检查时 `lesson-restate-before-judge` 尚未落盘；后续会话补齐该节点后恢复原有 `yields` 关联。本次结构修复没有生成新经验或改变实验读数。

对单风险判定机制的局部证据关联，按 schema 改为 `mechanism-specialist-question-gate` 的 `based_on → experiment-reframe-task-definition`；仅记录已知失败探针中判定步可改善的证据，不支持机制整体达标或泛化。
