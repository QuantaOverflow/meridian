---
{
  "id": "experiment-frontier-dev5-blind",
  "type": "experiment",
  "title": "新 scorer 上五臂 × dev 五簇盲判：direct-raw-routed 被支配，逐句接地的优势落在引用质量一轴",
  "date": "2026-09-19",
  "status": "recorded",
  "tasks": ["演化组合架构"],
  "scope": "dev 五簇（1/7/36/37/43），heldout 两簇已被消耗、无干净验收集。n=5 且七簇全部来自同一次生产运行（cron-brief-1789477249362，2026-09-15），不是从簇的总体独立抽样",
  "source": "eval/cluster-to-brief/frontier.mjs 与 out/frontier.json、out/_blind/",
  "conditions": [
    "**盲判**：判定包拷进洗过牌的代号目录（P/Q/R/S/T），判官看不到臂名，判完按 MAP.json 回填",
    "五条轴在跑之前声明：核心层覆盖、正确性(fatal/hard/distortion)、引用不足率、块内冗余率、成本",
    "判官模型同一轮必须一致（全部 opus），由 judge-pack meta 的 judgeModel 记录、frontier.mjs 断言",
    "22 个格子；c37 上三个臂判 not_a_single_event（该簇期望 split-or-reject，属正确行为，不进判定",
    "块内冗余是机械读数（同块两句引同一条原句），只报不设门"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "yields", "to": "lesson-grounding-is-citation-quality"},
    {"type": "yields", "to": "lesson-small-sample-flips"}
  ],
  "kind": "prototype_evaluation",
  "outcome": "mixed",
  "inputs": "五臂：direct-raw / direct-raw-routed / direct-raw-routed-storyline / direct-raw-grounded / structure-router；dev 五簇全量原文；成稿合计 528 句",
  "evaluation": "快档纯代码 + 慢档判官（盲判、opus）+ frontier.mjs 按五条轴做支配判定。非人工金标",
  "result": "direct-raw 覆盖 20/21=95.2%、引用不足 27.6%、冗余 18.5%、硬错 1、失真 18、调用 28；direct-raw-routed 88.9%/33.1%/12.4%/4/15/23；direct-raw-routed-storyline 88.9%/21.8%/11.0%/3/11/18；direct-raw-grounded 76.2%/**14.8%**/14.7%/2/8/28；structure-router 44.4%/5.7%/6.9%/0/5/19（仅 29 句）。**direct-raw-routed 被 routed-storyline 支配**，是本仓第一个被明确淘汰的臂。其余四臂互不支配——5 条轴 5 个点，支配关系天然稀少，frontier 成员本身信息量低于各轴取值",
  "cost": "零远程 LLM；两轮共 10 个判官约 179 万 subagent token，墙上时间约 20 分钟",
  "record_completeness": "complete"
}
---

**structure-router 是「几乎不写东西」的典型**：各轴读数都漂亮（硬错 0、冗余 6.9%、引用不足 5.7%），
但只写了 29 句，五个簇里三个核心层覆盖不合格（c1 3/6、c36 2/7、c43 1/3）。
这是 [[lesson-scorer-steers-search]] 里那个陷阱的再现：零错是没写东西的副产品。

**块内冗余这条轴今天才有，一上来就分得出臂**：direct-raw 18.5%、grounded 14.7%、
routed-storyline 11.0%。也就是说 direct-raw 每 5 句就有 1 句在重复同块内说过的事，
而在此之前没有任何指标记录它。

**样本量的限制要贴在读数旁边**：n=5 时配对符号检验只有 5:0 全胜才到 p<0.05。
95.2% 与 88.9% 的差距**不构成证据**；能站住的只有量级差异——
grounded 的引用质量（14.8% vs 27.6%，近 2 倍）、structure-router 的覆盖崩塌（44% vs 95%）。
