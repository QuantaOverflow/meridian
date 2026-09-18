---
{
  "id": "falsified-endtoend-longcontext-mds",
  "title": "「强模型整簇直读直写」不是效果上界：新闻多文档合成上 Joint Score < 20%，GPT-4 只覆盖不到 40%",
  "date": "2026-09-15",
  "status": "live",
  "source": "外部文献，本仓未复现 —— arXiv:2407.01370 (SummHay, EMNLP 2024) + arXiv:2309.09369 (DiverseSumm, NAACL 2024)",
  "invalidates_when": "出现在 6–14 篇全文输入、数百至数千字符叙事产出这个设定下，端到端优于流水线的实测",
  "type": "lesson",
  "tasks": [
    "改报告层结构",
    "提高写作层覆盖"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "external_literature_not_reproduced",
  "relations": [],
  "legacy_type": "falsified",
  "legacy_relations": {
    "supports": [
      "method-two-fighting-readings"
    ]
  },
  "kind": "failure_or_literature_warning"
}
---
**结论**：不要把「把整簇原文直接喂给一个强模型、一次写出正文」当作效果上界或目标形态。
它在本任务族上是**已知的弱解**，不是天花板。

**SummHay**(EMNLP 2024, arXiv:2407.01370)：新闻 + 对话两个 domain，单个 haystack 约 93K tokens、
9.2 个子主题、6.75 insight/子主题。**不带检索器、直接长上下文喂 GPT-4o / Claude 3 Opus，
Joint Score（覆盖 + 引用质量）低于 20%**；即使给 oracle 检索信号，最好的系统仍比人类表现（56%）
低 10+ 分。

**DiverseSumm**(NAACL 2024, arXiv:2309.09369)：245 个新闻故事、每个 10 篇文章（与本项目 6–14 篇同量级）。
**GPT-4 平均只覆盖不到 40% 的 diverse information**，且有**位置偏差——偏爱读首尾文章**，
「如何/什么」类问题的覆盖差于「谁/何时」。

**对本项目的两条直接影响**：
1. **撤回「强模型整簇直写 = 上界」这个前提**。2026-09-15 会话里曾以它为基准设计三臂对照实验，
   该设计的 A 臂前提不成立。
2. **位置偏差与 `pickSpreadArticles` 相互作用**：本仓的取样是「按时间等距 + 两端锚定」
   （story-dedup.ts，实测事实覆盖 9/10 优于最新优先的 7/10），而 DiverseSumm 说模型偏爱首尾。
   两端锚定在**喂**这个偏差——取样策略本身是对的（有实测），但下游模型会放大首尾，
   中段文章的事实更容易被漏。这条尚未在本仓实测，**是个待验的交互作用**。

**与本仓其他读数的张力**：本条说端到端不行，而 [[measure-pipeline-cascade-loss]] 说逐级压缩
流水线会系统性丢信息。两条方向相反，正是 [[method-two-fighting-readings]] 要的那种对照——
**结论不是「二选一」，而是「压缩程度与全局上下文之间有取舍」**。
