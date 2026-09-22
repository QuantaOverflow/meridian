---
{
  "id": "method-morphological-architecture-space",
  "type": "mechanism",
  "title": "用形态分析拆解设计维度、约束组合并生成真正异质的架构候选",
  "date": "2026-09-21",
  "status": "candidate",
  "tasks": ["演化组合架构", "提高架构异质性", "生成架构候选"],
  "scope": "cluster-to-brief 及以后有架构同质化风险的不确定性探索；当前只记录候选生成方法，不表示已在本仓实施或验证有效",
  "source": "Tom Ritchey, General morphological analysis as a basic scientific modelling method, Technological Forecasting & Social Change 126 (2018) 81-91, https://www.swemorph.com/pdf/tfsc-gma-basic.pdf；用户于 2026-09-21 要求记录为后续开发演化 insight",
  "conditions": [
    "先用已排序的质量属性场景明确问题、约束和评价标准，再定义设计维度",
    "维度优先描述中间表示、信息选择、控制流、职责分配、writer 可见上下文、验证方式和最终组装权等结构差异，不把 prompt 措辞或阈值微调伪装成新架构",
    "组合前执行交叉一致性检查，排除职责重复、数据无法传递、硬约束冲突和预算不可接受的组合",
    "只把可行且能回答新未知的少量组合送入原型评估，并继续使用同一版冻结验收尺"
  ],
  "evidence_origin": "external_literature_not_reproduced_and_project_retrospective_inference",
  "relations": [
    {
      "type": "requires",
      "to": "method-quality-attribute-scenarios"
    }
  ],
  "input": "按重要性排序并冻结的质量属性场景、已有架构家族与谱系、可复用 tactics、结构性设计维度、硬约束和实验预算",
  "output": "显式形态场：每个设计维度及其取值、已覆盖区域、不兼容关系，以及少量尚未验证但结构上异质且内部一致的候选架构",
  "limits": "形态分析只负责展开和收窄设计空间，不证明组合有效，也不替代最小原型、对照实验、Pareto 评价或 MAP-Elites/QD；维度选择本身依赖判断，维度过细会产生伪异质性，维度过多会造成组合爆炸；当前尚无本仓前后对照实验",
  "invalidates_when": "连续实践表明显式形态场不能产生区别于既有家族的新候选、不能改善探索覆盖，或维护与一致性检查成本持续高于避免的重复探索成本时，应缩减、重构或停止使用"
}
---

这个方法补的是演化流程里“候选架构从哪里来”。Pareto、NSGA-II 和 MAP-Elites/QD 可以比较、筛选或保存已有候选，但不会自动保证候选的结构真正不同；形态分析先把架构拆成若干设计维度，再从兼容取值中构造候选。

## Meridian 的起始形态场

下表是后续探索可调整的起始维度，不是已经冻结的 DSL 或完整枚举：

| 设计维度 | 候选取值示例 |
| --- | --- |
| 证据获取 | direct raw window / evidence extraction / atomic fact ledger |
| 中间表示 | 无显式表示 / storyline / evidence graph / event or fact table |
| 控制流 | 单次生成 / router 分流 / 多阶段规划与写作 |
| 职责分配 | 通用处理 / 按风险分工 / 按叙事功能分工 |
| 验证方式 | 自检 / deterministic contract / independent critic |
| 最终组装权 | writer 自由生成 / outline 后写作 / 局部写作后确定性组装 |

当前多数活跃候选共享 direct-raw 主干，差异集中在上游筛选或 gate；这说明已有候选在形态场中可能聚集于少数相邻格子。新候选应优先改变多个结构维度，例如“事件规划 → 原子事实账本 → 显式覆盖计划 → 事实级证据检索 → 局部写作 → 确定性组装”，而不是只改提示词、阈值或 verifier。

## 后续使用步骤

1. 从最高优先级质量属性场景和历史失败中选择本轮要打开的设计问题。
2. 列出少量结构性维度及互斥取值，同时把现有候选映射进去，先看哪些区域已被重复覆盖。
3. 做交叉一致性检查：删除逻辑冲突、接口不通、职责重复或成本超限的组合。
4. 从剩余组合中选择少量能回答新未知、且与当前家族有明确结构距离的候选做最小原型。
5. 原型仍需独立评估；有效局部能力另提炼为 tactic，完整组合是否有效不能由部件成绩相加得到。
6. 如果使用 MAP-Elites/QD，可把这些结构维度压缩成行为描述子，用于保存不同架构区域的代表，而不是让同一家族近亲占满活跃种群。

## 证据边界

形态分析是外部成熟的设计空间建模方法；上面的 Meridian 维度与流程是结合现有架构同质性回顾得到的拟用方法。本节点没有新增代码、没有生成候选、没有运行实验，也没有证明它能改善本项目的最终质量或探索效率。
