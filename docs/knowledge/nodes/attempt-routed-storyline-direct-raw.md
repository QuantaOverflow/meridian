---
{
  "id": "attempt-routed-storyline-direct-raw",
  "type": "attempt",
  "title": "把 structure-router 的路由门与主线筛选接到 direct-raw 的生成上",
  "date": "2026-09-19",
  "status": "tested",
  "tasks": ["演化组合架构"],
  "scope": "dev 五簇；heldout 两簇已被别的线消耗，未跑。慢档读数来自旧 scorer（单句证据切片），其缺陷见 lesson-scorer-steers-search",
  "source": "scripts/eval/cluster-to-brief/arms/direct-raw/direct-raw.mjs（DIRECT_RAW_ROUTE_GATE / DIRECT_RAW_STORYLINE_FILTER 两个开关）",
  "conditions": [
    "两个开关都读 out/structure-router/structure-c<id>.json，必须先跑 arms/structure-router/run.mjs",
    "筛文章后窗口切分改变，不能复用 direct-raw 的窗口缓存；只加路由门时可以复用",
    "路由门排在筛选之后执行；对判不可写的簇，拒绝发生在任何 LLM 调用之前"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "addresses", "to": "goal-cluster-to-brief"},
    {"type": "varies_from", "to": "attempt-direct-raw", "attributes": {"changed": "生成前加两道上游处理：按主导主线筛文章、按结构分诊决定是否直接判不可写；生成与选材本身一字未改", "reason": "direct-raw 在 dev 上过不了的两个簇（c1 杂质放大、c37 该拒未拒）都不是生成质量问题，而 structure-router 在这两处恰好是对的"}},
    {"type": "incorporates", "to": "mechanism-shape-triage", "attributes": {"adaptation": "只取它的路由判定（single_story / topic_bag），不取 structure-router 用它做的文章筛选与写作"}},
    {"type": "incorporates", "to": "mechanism-dominant-storyline-filter", "attributes": {"adaptation": "筛完的文章交给 direct-raw 原样的窗口化生成，不交给 structure-router 自己的 writer"}},
    {"type": "evaluated_by", "to": "experiment-crossover-routed-storyline-dev"}
  ],
  "hypothesis": "direct-raw 的覆盖优势与 structure-router 的分诊/去杂优势互不冲突，合起来能同时拿到两头",
  "changes": "相对 attempt-direct-raw 只动上游两处；相对 attempt-structure-router 只取它的 router，丢掉它的 writer",
  "reason": "两个供体的优势都已在同一把尺上各自归因过：分诊在 dev 五簇上判对 4/5，主线筛选对人工标注精度 89–100%",
  "next_unknown": "c43 的硬错 2 条是真事实错还是旧 scorer 的引用质量误判；换新 scorer 后这个组合的优势还剩多少",
  "verification": "development"
}
---

按 `CONTEXT.md` 的定义这是一次 **crossover** 而不是 mutation：两个供体机制各自都有归因证据
（分诊 4/5，且是在两个 direct-raw 失败的簇上赢的；主线筛选对人工杂质标注 c1 双 100%），
不是把未证明的 trait 嫁接过来。

**只嫁接 router，不嫁接 writer。** structure-router 自己每簇只写 7–8 句、c36 核心层覆盖 1/7，
它的"干净"是"几乎没写"换来的（见 [[experiment-structure-router-c36]]）。要的是它前面那两步。

未完成事项：`c43` 仍不合格（硬错 2 > 1）。两条硬错从判官给的理由看像真事实错
（用 including 把两起不同日期的事件并成一起、原文说老师把孩子抱出成稿写成老师遇难），
但 **c43 没有在新 scorer 上复判过**，而旧 scorer 的硬错里有相当比例其实是引用错位，
所以「crossover 在 c43 上确实更差」这个结论**尚未坐实**。
