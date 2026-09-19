---
{
  "id": "experiment-crossover-routed-storyline-dev",
  "type": "experiment",
  "title": "路由门+主线筛选接上 direct-raw：dev 五簇通过 4/5，direct-raw 同批 2/5",
  "date": "2026-09-19",
  "status": "recorded",
  "tasks": ["演化组合架构"],
  "scope": "dev 五簇（7/1/36/37/43），heldout 未跑。慢档读数出自旧 scorer（证据=成稿自引的单句），该 scorer 的缺陷当天另测出来，见 lesson-scorer-steers-search——覆盖与快档不受影响，硬错/失真的绝对值不可信",
  "source": "scripts/eval/cluster-to-brief/out/{direct-raw,direct-raw-routed,direct-raw-routed-storyline}/ 与 out/verify-*-dev.json、out/slow-*-dev.json",
  "conditions": [
    "四个臂同一批固定输入（fixtures 的 7 簇，dev 5 个），同一套快档脚本",
    "慢档判官为 Claude subagent（继承主会话 opus），非 glm；判定包合并两臂句子、打散去标识后盲判，同一句在两臂都出现时只判一次回填两边",
    "对照臂 direct-raw 在同一轮重跑，不引用 2026-09-16 的旧读数",
    "行内引用号在打散前统一剥除（A 臂 31/151 句带、B 臂 8/118 带，不剥会 100% 泄漏臂身份）；剥除后留下 ,. 这类标点残渣，判官确认不影响事实判定",
    "两臂句子几乎不重合（各簇共有 0/0/1/0/2 句），去重未省下工作量"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "yields", "to": "lesson-scorer-steers-search"}
  ],
  "kind": "prototype_evaluation",
  "outcome": "mixed",
  "inputs": "dev 五簇全量原文；crossover 产出 118 句、direct-raw 151 句；慢档合并判定包 266 句、五个独立判官各判一簇",
  "evaluation": "快档纯代码（schema/出处可解析/杂质率/二元判据）；慢档由判官判覆盖与四档正确性，再经 score-slow 汇总。盲判但非人工金标，判官与写作层不同族（写作是 glm-4.7-flash）",
  "result": "快档 crossover 5/5 通过、direct-raw 3/5（c1、c37 卡杂质率）。慢档 crossover 4/5（c43 硬错 2>1）、direct-raw 4/5（c7 硬错 1>0）。快慢合并：**crossover 4/5、direct-raw 2/5**。慢档汇总：断言 118 vs 151、fatal 0 vs 0、硬错 3 vs 3、失真 6 vs 10、核心层覆盖（两臂都写了的 4 簇）16/18 vs 17/18。c1 成稿杂质率 42.4%→0% 且句数 33→16；c37 由路由门判不可写（direct-raw 硬写后杂质 47.8%）。另测：块内冗余（同块两句引同一条原句）direct-raw 15 条/10%、crossover 7 条/6%",
  "cost": "路由门单独跑复用全部窗口缓存，零新增窗口调用；加主线筛选后窗口失效，重跑约 16 窗口 + 4 次选择调用。慢档判官为本地 subagent，零远程 LLM。美元价未查询",
  "record_completeness": "complete"
}
---

**这是本仓第一个在同一把尺、同一次运行上完成的多臂对照**，此前三臂只在 c36 单簇、且是跨次读数。

**两个供体各自的贡献可以分开看**：只加路由门的中间臂（`out/direct-raw-routed/`）在 c1 上杂质率 50%，
比原臂还差——**c1 的解药是主线筛选，不是路由门**；而 c37 的解药是路由门，主线筛选救不了它。

**跑间波动当场被测到**：候选池逐条相同、只重跑一次选择调用，c36 的块数从 2026-09-16 那次的 3 变成 5。
这是"对照臂必须同次跑"的直接证据。

**未完成**：c43 仍不合格；heldout 两簇已被核验器线消耗，无干净验收集；本轮所有硬错/失真读数
出自后来被发现有缺陷的 scorer，需在新 scorer 上复跑才能下最终结论。
