---
{
  "id": "experiment-scorer-retrieval-evidence-dev",
  "type": "experiment",
  "title": "scorer 换成全簇检索证据：两判官不一致率 18% → 0%，逐句接地的硬错优势随之消失",
  "date": "2026-09-19",
  "status": "recorded",
  "tasks": ["设计验收门", "演化组合架构"],
  "scope": "cluster-to-brief harness 的慢档；信度在 c43 上量（两臂各两个独立判官，63 句），反向检验在 c7/c37 上做。heldout 未跑，无人工金标",
  "source": "scripts/eval/cluster-to-brief/{retrieval.mjs,grading-instructions.mjs,scorer-id.mjs,compare-verdicts.mjs} 与 out/direct-raw{,-grounded}/verdict-c43.judge{A,B}.json",
  "conditions": [
    "证据由脚本用成稿句去整簇原文检索 top-8（本地 e5-small，384 维已归一化），与成稿引了谁无关",
    "成稿声称的出处另行呈现，只用于新增的 citedSentenceSuffices 一维，守则写明两维互不回改",
    "事件清单先做去杂质（--depurify，零 LLM），否则覆盖率分母里混着只有杂质文章报道的事件",
    "成稿正文里泄漏的行内引用号在组装判定包时剥除并合并重复标点（direct-raw c43 36 句里 16 处）",
    "判官为 Claude subagent（opus），各判官只读判定包一个文件，互不可见"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "yields", "to": "lesson-grounding-is-citation-quality"},
    {"type": "yields", "to": "lesson-source-stripping-undetected"}
  ],
  "kind": "prototype_evaluation",
  "outcome": "passed",
  "inputs": "c43 两臂成稿（direct-raw 36 句、direct-raw-grounded 27 句）各两个独立判官；反向检验用 c7/c37 两臂各一个判官",
  "evaluation": "compare-verdicts.mjs 按句聚合到最严档后比对：二元不一致率（ok 对非 ok，与旧读数同口径）、四档不一致率、非 ok 条数（打架读数）、citedSentenceSuffices=false 集合的 Jaccard、覆盖不一致。全部零 LLM",
  "result": "**信度**：direct-raw 二元与四档不一致率均 0/36 = 0%、引用维 Jaccard 1.0（13/13 完全相同）、覆盖 0/46 不一致；grounded 均 0/27 = 0%、Jaccard 0.8、覆盖 1/46。打架读数未塌（非 ok 句 5/5 与 2/2）。旧尺同口径是 18%。**反向检验**：逐句接地在旧尺上的硬错优势出现在 c7 与 c37（direct-raw 硬错 1、grounded 0），新尺上两臂硬错全为 0，优势消失；同时 grounded 在 c37 核心层覆盖 0/3 判不合格，direct-raw 3/3 通过。**注意**：覆盖 0/3 这一项旧尺也已给出（旧清单核心层同样 3 条、同样 0/3），新尺改变的是收益侧不是代价侧。**机械读数**：检索缺口 direct-raw 4/50、grounded 1/34",
  "cost": "零远程 LLM 调用；本地 e5-small 句向量按簇缓存。8 个判官合计约 79 万 subagent token，墙上时间约 9 分钟",
  "record_completeness": "complete"
}
---

**先前的倾向是「窗口取值 0% 漂移、检索取值 6% 漂移，所以窗口更好」。这个比较把信度与效度混在一起了。**

窗口锚在成稿引的那一句上，所以引得宽的臂天然拿到更多证据，而各臂每句出处实测 1.03~1.73 不等
——这个差距会原样搬进正确性读数，scorer 量的成了引用行为。**信度可以靠改守则、投票压下去；
效度是结构决定的，改措辞改不动。** 所以取检索，再把信度压回去；实测压到 0%，比窗口取值还低。

事实性评测文献一致的做法也是证据由评分方检索（AlignScore 切块逐句取最高、SummaC 全句对 NLI、
MiniCheck 句级分类器）。但不能换成整簇一次直读——见 [[measure-detection-ceiling]]，整簇判官召回只有 26%。

### 反向检验的结论要说准

它证明的是**收益侧是假的**：逐句接地「硬错 5 → 1」那个优势在新尺上为 0。
它**没有**证明代价侧是新发现的——c37 核心层覆盖 0/3 在旧清单上同样成立，
旧尺的两个通道当时就给出了互相矛盾的信号，而被写进结论当主指标的是硬错那一条。

### 判官主动报出的真缺陷（尚未修）

- 事件清单第 29 条把施事从 settler 写成 forces、并加了原句没有的地名（四个判官里三个独立报出）
- 清单有重复条目：#4/#26 是同一次打击、#23/#38 是同一名孕妇、#45/#46 同出一句——分母虚高
- 固定 k=8 会拿不相干句子填满证据位，判官容易读成「查过了没有支持」
- 语料污染：`992068:4` 的 `kill 500 NAZA` 里 NAZA 是片名，词元被替换过
