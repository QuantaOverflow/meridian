---
{
  "id": "lesson-candidate-group-threshold-090",
  "type": "lesson",
  "title": "候选分组阈值 0.90 的来历：0.85→0.87→0.90→0.91 四点扫描，0.91 起掉崖丢真事件；全链凝聚在 0.90 上组中位数 2 篇、最大 16 篇；标定方法文件已随本轮清理移出 git",
  "date": "2026-08-21",
  "status": "recorded",
  "tasks": ["治故事过拆", "改聚类/切分链路"],
  "scope": "apps/backend/src/lib/core/candidate-grouping.ts 的 completeLinkage 函数与 CANDIDATE_GROUP_THRESHOLD 常量；判据为簇内文章 embedding 两两余弦相似度；标定样本为 2026-08-20/21 两天独立数据 + 人工严口径（scripts/eval/story-validation/rubric.md 定义的 correct/umbrella/wrongPair/borderline 四分类）复验",
  "source": "apps/backend/src/lib/core/constants.ts:69-77（CANDIDATE_GROUP_THRESHOLD 常量头注释）；apps/backend/src/lib/core/candidate-grouping.ts:13-14, 26-32；commit 9bef77b 提交说明",
  "conditions": [
    "阈值作用在文章 embedding 之间（簇内两两余弦），不是在故事质心之间——与 measure-story-merge-threshold-094（0.94，作用于故事质心）是不同层的同名机制，两者标定时间相近（08-21 vs 08-30）但样本、判据对象都不同，不要混为一谈",
    "算法选全链凝聚（complete-linkage）而非单链：单链任意一对超阈值就并、会串联成巨团；全链要求组内所有对都超阈值。candidate-grouping.ts 头注释明确记录『本仓上游的 candidate-grouping.ts 早就是全链，story-dedup 那一层是漏网的』（见 lesson-single-link-merge-falsified 的 conditions）——即本仓两处独立引入的聚合层，候选分组这一处从一开始就选对了算法，story-dedup 那一处后来才补上",
    "『严精度』『前 15 条精度』的定义与人工标注方法论，见 scripts/eval/story-validation/rubric.md——该文件本轮清理已删除（git status 显示为待提交的 D），可用 `git show HEAD:scripts/eval/story-validation/rubric.md` 或对应引入提交 b7ab0ea 恢复查看。⚠️ 该文件是标注方法论说明（什么算『同一发生』、umbrella/wrongPair 怎么区分），不包含本节点记录的阈值扫描数字表——扫描数字唯一的留存位置是 constants.ts 的头注释和 commit 9bef77b 的提交说明，两者互为印证",
    "0.90 这一行的『严精度 89-92%』『前 15 条精度 93.3%』与 experiment-story-validation-verify-stage-tradeoff 记录的『严精度 75.7%→89.2%』『前 15 条精度 53.3%→93.3%』是同一批复验数据（判官+复核两段式相对旧架构的整体表现），本节点不重复该实验的完整记录，只摘录阈值扫描本身的对照表"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "cautions",
      "to": "lesson-single-link-merge-falsified",
      "attributes": { "scope": "补充说明：本仓两处独立的聚合层（候选分组 vs story-dedup）里，候选分组这一处从设计之初就是全链，不是 lesson-single-link-merge-falsified 记录的那次『单链→全链』修复所覆盖的对象；两者共享『全链优于单链』这个算法原理，但不是同一次实验" }
    }
  ],
  "kind": "observation",
  "invalidates_when": "换 embedding 模型后重新扫描阈值-精度曲线；或按 docs/engineering-notes/cluster-to-story-segmentation.md §7.2（本地文件，未入 git）建议的方向换成自适应判据（BIC 式模型选择或基于图模块度的 Leiden 递归终止），不再依赖固定的两两阈值一刀切——见 experiment-set-partition-literature-review 记录的『0.90 这种取值方式本身在文献里没有先例』"
}
---

## 阈值扫描原文

`constants.ts:69-77`：

> 0.90 来自 2026-08-20/21 两天独立数据的扫描 + 人工严口径（scripts/eval/story-validation/rubric.md）复验：
>   0.85（原型初值，随手定） 严精度 58-60%，配复核后 85-87%，前15精度 33-53%
>   0.87                  严精度 70%
>   0.90                  严精度 76-84%，配复核后 89-92%，**前15精度两天都是 93.3%**
>   0.91 起掉崖：一次丢 4 个人工确认的真事件（4 篇的 Face the Nation 当期综述、3 篇的官员回应等）
> 上限卡在 0.90 的理由是「0.91 开始丢真事件」，不是「组太大」——0.90 下组中位 2 篇、最大 16 篇。

## 掉崖的具体样本

0.91 一次性丢掉的 4 个人工确认真事件里，明确记录了两个具体样本：一个是 4 篇报道同一期
Face the Nation 节目的综述，一个是 3 篇报道官员回应的组。这两个样本的共同特征是**成员数
偏多但确实是同一发生**（例如 §2.4 的规范：节目当期综述算合法成员），说明 0.91 这一档
开始把『成员多但真实』的组也当成过度合并切碎——阈值的上限不是被『组变得太大』卡住的，
而是被『继续收紧就开始误伤真实的多成员事件』卡住的。

## 全链凝聚为什么选这个算法

`candidate-grouping.ts:26-32`：

> 算法选全链(complete-linkage)不选单链：单链任意一对超阈值就并，会串联成巨团；
> 全链要求组内**所有**对都超阈值，不串联。实测在 0.90 上组中位数 2 篇、最大 16 篇。

这与 [[lesson-single-link-merge-falsified]] 记录的 story-dedup 层『单链→全链』修复是
同一个算法原理的两次独立应用：单链只要链上任意相邻一对过线就会传递合并，容易把 A-B、
B-C 都过线但 A-C 不过线的三者串成一团；全链要求组内所有两两对都过线，构造上不可能出现
这种串联。候选分组这一层从设计之初就选了全链，没有经历 story-dedup 那次『先用错、
再改对』的过程。

## 这批读数比现存节点多出的部分

`experiment-story-validation-verify-stage-tradeoff` 已经记录了 0.90 这一档的头条精度数字
（严精度 89.2%、前 15 条精度 93.3%），但没有记录：
- 0.85/0.87 两档更宽松阈值下的对照精度（58-60%、70%）；
- 0.91 起的悬崖及其具体丢失样本；
- 全链凝聚在 0.90 下的组规模分布（中位 2、最大 16）。

这三块是本节点补上的、此前未蒸馏的部分。

## 关联

阈值取值方式本身的文献适用边界（『两两一刀切无先例』），见
[[experiment-set-partition-literature-review]]。全链算法原理与另一层聚合的对照见
[[lesson-single-link-merge-falsified]]，故事质心层另一个同名机制的独立标定见
[[measure-story-merge-threshold-094]]。头条精度数字的完整实验记录见
[[experiment-story-validation-verify-stage-tradeoff]]。
