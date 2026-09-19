---
{
  "id": "experiment-heldout-replacement-candidate",
  "type": "experiment",
  "title": "heldout 两簇首次启用：routed-storyline 4/4 全过、dev 第一名 direct-raw 垮掉、生产 0/4",
  "date": "2026-09-19",
  "status": "recorded",
  "tasks": ["演化组合架构"],
  "scope": "heldout 两簇(28 us airman 16 篇/13% 杂质、51 china 116 篇/41% 杂质)。**这一轮把它们消耗掉了** —— 对这三个候选,它们不再是未见过的数据",
  "source": "scripts/eval/cluster-to-brief/out/{direct-raw,direct-raw-routed-storyline,_production-r94}/ 的 c28/c51 产出与判定",
  "conditions": [
    "**heldout 此前从未被任何臂跑过**(2026-09-18 被 structured-verifier 那条线拿去造过注入题,但没有臂在上面产出过成稿)",
    "两个原型臂盲判(代号 X/Y 洗牌),生产无法盲判(它一句出处都没有)",
    "判官全部 sonnet,与 dev 那一轮同尺同模型",
    "运行前给两个原型加了 ALLOW_HELDOUT=1 显式闸,让消耗 heldout 这个动作在命令行留痕",
    "c51 的检索缺口明显偏高(direct-raw 20/82=24%、routed-storyline 25/76=33%,dev 五簇合计 12%)—— 116 篇的簇里 top-8 覆盖不住,**正确性读数因此偏高**"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "yields", "to": "lesson-dev-winner-fails-heldout"},
    {"type": "yields", "to": "lesson-storyline-filter-holds-on-superbag"}
  ],
  "kind": "prototype_evaluation",
  "outcome": "passed",
  "inputs": "三个候选 × 两个 heldout 簇;成稿 direct-raw 82 句、routed-storyline 70 句、生产 20 句",
  "evaluation": "快档纯代码 + 慢档判官(新尺)。两档都过才算通过",
  "result": "**快档+慢档合计:routed-storyline 4/4、direct-raw 2/4、生产 0/4**。c28 核心层覆盖 87.5% / 62.5% / **12.5%**;c51 次层 12/20 / 11/20 / 5/20。硬错 2 / 4 / 3,失真 0 / 4 / 0。direct-raw 两簇慢档都不合格(c28 覆盖 62.5%<66.7%、c51 硬错 2>1),而它在 dev 上覆盖是最高的 90.5%。生产 c28 只写 4 句、8 条核心事件命中 1 条",
  "cost": "生成侧 c51 两臂 173.5s + 109.7s、c28 48.9s + 36.2s,Workers AI 几分钱;判官侧 3 个约 60 万 subagent token",
  "record_completeness": "complete"
}
---

### 延迟这条不成立,收回

此前把「全量读在大簇上撞 300 秒超时」列为替换的头号风险,依据是生产实测
「91 篇 283k 字符 → 300 秒硬失败」。**外推错了**:那是一次把全部原文塞进单次调用撞的,
而原型是**切窗口分别调用**。实测 c51 116 篇:direct-raw 16 窗口 **173.5s**、
routed-storyline 10 窗口 **109.7s**(主线筛选先剔到 62 篇,省 37%)。

教训:把别的架构的失效模式往新架构上外推之前,先查现成的 run.json —— 这个数据一直在文件里。

### 路由门在超级袋上判错了形态,但没有后果

c51 路由门判 `single_story`(主导成分 62/116 = 53.4%、margin 50%),
而 expectations 标的是 `super-bag`、期望拆 ≥3 块。**两个臂实际都拆了 5 块** ——
拆块是写作层做的,不是路由门。所以二元判据过了,这次误判没造成后果。
但它说明:**路由门的「是不是一件事」判定在多主题混合的大簇上不可靠**,
将来若有链路依赖它的判定结果(而不只是当一个建议),这里会是失效点。

### 顺带查出一个本仓自己的 bug

判官报告:`splitSentences` 把 `Reps.` 当成句末,把一句话切成三个碎片(`b1s11/12/13`),
连带其中一句检索到的 8 条证据全部跑偏。`Reps` 不在 `lib.mjs` 的缩写白名单里,
dev 五簇没出现过这个词。

**不能直接改**:`splitSentences` 必须与生产 `services/meridian-ai-worker/src/utils/report-v3.ts`
逐字一致(`sources[].sentence` 的编号按它来),改一边不改另一边会让出处**静默指向错误的句子**。
要改得两边同步 + 重跑 296 篇一致性自测。已记入债。
