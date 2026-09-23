---
{
  "id": "experiment-intel-grounding-judge-selection",
  "type": "experiment",
  "title": "intel-grounding 判官选型：Claude κ=0.779 通过（离线，未过真 API 复验）；qwen 现场重跑 κ=0.407 FAIL",
  "date": "2026-07-10",
  "status": "recorded",
  "tasks": ["设计验收门"],
  "scope": "仅 eval/intel-grounding/ 这把「情报报告是否忠实于其输入 RSS 文章」的判官；不代表 faithfulness/coverage-judge 等其他判官，也不代表情报层本身的忠实度水平",
  "source": "commit 36e186a（2026-07-10，fix(eval): 环1金标7条争议人裁终裁+政策入rubric+合成contradicted扩至26条）；eval/_data/intel-grounding-v1/labels.jsonl（100 条）、eval/_data/intel-grounding-v1/human-adjudicated.jsonl（24 条）、eval/_data/intel-grounding-v1/synthetic-contradicted.jsonl（26 条）；本地 gitignored 产物 eval/intel-grounding/out/judge-meta/*.json（2026-07-08~11，7 份，仅 qwen-max 与 deepseek-v3 两个 judge_model，无 claude-* 记录）",
  "conditions": [
    "judge-gold.jsonl 共 100 条 factual claim，终裁后 factual=88 supported / 4 unsupported / 8 contradicted；其中 7 条经用户二次人裁终裁（缺口类断言、日期可源内推算类归为 contradicted、复合 claim 逐成分核源，政策写进 rubric.md 的「人裁终裁政策」节）",
    "human-adjudicated.jsonl 24 条是另一批人裁样本，用于交叉核验",
    "synthetic-contradicted.jsonl 26 条为确定性最小扰动生成（negation 7、number/direction 等），双重逐字校验（扰动词在 claim 里、source_quote 在源里）后入库，不猜语义",
    "meta-eval.ts 的 gate：κ≥0.6（KAPPA_MIN）且幻觉类（unsupported/contradicted）召回≥0.7（RECALL_MIN）",
    "qwen 侧 judge_model=qwen-max，走真实 DashScope API（本地 out/judge-meta/meta-1783664090586.json，checked_at 2026-07-10T06:14:50Z，与 commit message 的 κ0.407 完全对得上）",
    "Claude 侧 commit message 称「Claude判官离线κ0.779/unsup0.75/contra0.875三闸全过（待真API重验）」——**离线**指未必经过 llm.ts 里真正打 Anthropic API 的 meta-eval.ts 流程；本地 out/judge-meta/ 现存的 7 份产物里 judge_model 只有 qwen-max 与 deepseek-v3，没有任何一份 judge_model=claude-*，说明这次真 API 复验从未发生或未留痕",
    "同批还有 judge_model=deepseek-v3 的两次本地真跑（2026-07-11），judge-gold.jsonl 上 κ=0.285、synthetic-contradicted.jsonl 上 κ=0，两者都远低于 0.6 门槛，Deepseek 未被 commit message 提及，可能是同一轮里顺手加测的第三家判官，结果同样 FAIL"
  ],
  "evidence_origin": "local_record",
  "relations": [
    { "type": "yields", "to": "lesson-intel-grounding-readme-stale" }
  ],
  "kind": "probe",
  "outcome": "mixed",
  "inputs": "judge-gold.jsonl 100 条 + human-adjudicated.jsonl 24 条 + synthetic-contradicted.jsonl 26 条，均为情报报告 claim 对其 RSS 源文章的 supported/unsupported/contradicted 三分类",
  "evaluation": "meta-eval.ts：Cohen's κ（chance-corrected）+ per-class TPR/TNR + gate（κ≥0.6 且幻觉类召回≥0.7）；dev 集调参、heldout 集报数，防过拟合",
  "result": "Claude 判官（离线核算）：κ=0.779，unsupported 召回 0.75，contradicted 召回 0.875，三闸全过——但这组数字**未经过真实 API 调用复验**，commit message 自己标注「待真API重验」，本地找不到对应的真跑记录。qwen-max 判官（真实 API 现场重跑）：κ=0.407 < 0.6，FAIL；在 synthetic-contradicted 26 条上召回 14/26=0.538，其中 entity 类 0/3、direction 类 1/4、9/26 被误判成 supported——构成可定量描述的盲区签名。deepseek-v3（真实 API，同批本地产物，commit message 未提及）：judge-gold 上 κ=0.285，synthetic-contradicted 上 κ=0，同样 FAIL。",
  "cost": "未知——commit message 未记录调用量与费用；judge-gold 100 条 + synthetic 26 条 + human-adjudicated 24 条的多轮标注、多模型验证成本未留痕",
  "record_completeness": "summary_only"
}
---

## 为什么这组读数值钱

这是本仓少数几次**真正跑过 κ 验收**的判官选型实测：三个候选家族（Claude / qwen-max /
deepseek-v3）在同一份人工终裁金标上，只有 Claude 过闸，另外两个都 FAIL，且失败模式不同——
qwen 在 entity/direction 类合成扰动上几乎瞎猜，deepseek 干脆在 synthetic 集上 κ=0（全猜
supported 或某个众数类）。这是判官选型问题的一个具体反例：**同一套 rubric、同一份金标，
换判官模型，κ 从 0.779 掉到 0.407 甚至 0**——选错判官比选错 prompt 更致命，且很难靠调
prompt 补救（qwen 与 deepseek 都没有再调过 prompt 重跑的记录，commit message 直接给出
"换非 Qwen 家族 judge" 的结论方向，与 README「还差什么」节写的路线一致）。

以后任何要接 LLM-judge 的 harness，都会重新面对「用哪家模型当判官」这个问题，这组读数是
可以直接引用的先例：**不要默认判官模型能通用**，尤其当被评对象本身也是由同家族模型生成时
（情报报告由 qwen-long 生成，若判官也用 qwen 家族，self-preference 风险更高，这也是
commit message 与 README「还差什么」节共同指出的方向）。

## Claude 的 0.779 比看起来脆弱

commit message 原文把 Claude 判官的结果标注为「离线」且「待真API重验」，这两个词组合起来
的含义是：κ=0.779 这个数字**不是**通过 `meta-eval.ts` 打真实 Anthropic API 跑出来的，而是
某种离线核算（很可能是当时的 Claude Code session 自己模拟/复核判定，而非独立调用）。
本地 `out/judge-meta/` 目录里现存的全部 7 份 meta 产物（2026-07-08～07-11，均是 gitignored
的运行报告，不在 git 里）逐一核对过 `judge_model` 字段，只有 `qwen-max` 和 `deepseek-v3`，
一份 `claude-*` 的记录都没有。也就是说，从 commit 36e186a 之后，**这次「待复验」从未兑现过**
——无论是因为真的没有再跑，还是跑过没有落盘。在没有找到反证之前，Claude κ=0.779 应该被当作
「一次未经独立 API 复验的乐观读数」，不能等同于 qwen/deepseek 那两组有真实 API 调用记录支撑
的失败读数。

## 第二个脆弱点：88/12 的分布让 κ 只是个点估计（2026-09-23 补）

上一节说的是「这个数没经过真 API 复验」。这一节说的是：**就算复验了，它也不该被当成硬读数。**

100 条里 88 条是 `supported`，少数类（4 unsupported + 8 contradicted）总共 **12 条**。

- 一个什么都不判、对所有条目都答 `supported` 的假判官，在这批上拿 **88% 准确率**
- κ 会校正这种偶然一致，所以 κ 比准确率诚实。但它的分母里少数类只有 12 条——
  判官在这 12 条上多对一条少对一条，κ 就大幅摆动。**0.779 是点估计，置信区间很宽**，
  而本节点原先只记了那个点

Hamel Husain 对 LLM-as-judge 的说法可以直接套在这里：agreement 是**陷阱指标**，
样本不平衡时判官把少数类全判错也能拿高一致率，**而少数类恰恰是你在乎的失败**——
这里就是幻觉（unsupported + contradicted）。

所以引用这组读数时：

1. 不要把 κ=0.779 引用到小数点后三位当结论
2. 该看的是**少数类那一侧的召回**（原记录有：unsupported 0.75、contradicted 0.875，
   分母分别是 4 和 8——同样是极小样本上的比例）
3. 三个判官之间的**排序**（Claude ≫ qwen ≫ deepseek）比任何单个数字可信，
   因为排序在这个分布下仍然稳健

顺带：这份金标自己的 `rubric.md` §6 明确要求「分层并过采稀有类，否则全是 supported，
幻觉类召回算不出来」。**本批没做到**——这是标注流程没执行到位，不是判官的问题。
分布与限制现已写进 `eval/_data/intel-grounding-v1/manifest.json` 的 `labelBalance`
与 `limitations`，`check.mjs` 会对账那个分布，手填错一个数就非零退出。

## 金标构成与人裁终裁

judge-gold.jsonl 的 100 条不是一次性标注定案的：commit 36e186a 是对其中 7 条争议样本做
第二轮人工终裁（用户本人裁定，带 note 留痕），终裁后 factual 类别分布是 88 supported /
4 unsupported / 8 contradicted。这次终裁同时把裁定标准写进了 `rubric.md` 的「人裁终裁
政策」节——起因是两个 session 对同一批样本裁出过相反结果，根因是当时 rubric 没有明确写
「缺口类断言算什么」「日期能不能源内推算」「复合 claim 要不要逐成分核」，堵上这个口子后
才有了可复现的终裁标准。这段方法论（分歧样本人裁、把裁定标准回写进 rubric）本身也值得
被后续判官选型工作复用，但本节点只记录数字读数，方法论部分见协作机制类节点（如后续需要，
可另开 [[mechanism-coverage-judge-triangulation]] 一类节点做跨 harness 的对比）。
