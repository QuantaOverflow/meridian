---
{
  "id": "method-quality-attribute-scenarios",
  "type": "mechanism",
  "title": "先用带度量的质量属性场景澄清需求与重要性，再开始不确定性架构探索",
  "date": "2026-09-21",
  "status": "active",
  "tasks": ["演化组合架构", "设计验收门", "澄清需求"],
  "scope": "用于有不确定性的架构探索、原型设计、方案选择与重要验收尺设计；普通格式修改、明确机械修复和已经冻结且无新冲突的需求不强制执行",
  "source": "SEI, Quality Attribute Workshops (QAWs), Third Edition, CMU/SEI-2003-TR-016, https://www.sei.cmu.edu/library/quality-attribute-workshops-qaws-third-edition/",
  "conditions": [
    "先说明业务或任务目标，再收集实际相关人的关注点",
    "合并重复场景并按业务重要性排序，只细化最高优先级的少数场景",
    "每个细化场景明确 source、stimulus、environment、artifact、response、response measure",
    "场景与验收尺在当轮实验开始前冻结；后来改变时升版本并让所有候选在同一把新尺上重比"
  ],
  "evidence_origin": "external_literature_not_reproduced",
  "relations": [],
  "input": "业务或任务目标、相关人关注点、运行环境、已知约束与历史失败场景",
  "output": "按重要性排序、可转成架构驱动与验收用例的质量属性场景；每个场景包含触发来源、刺激、环境、受影响对象、期望响应和响应度量",
  "limits": "QAW 只澄清和排序质量需求，不负责生成架构、选择 tactics、证明某个候选达标或决定 Pareto frontier；本仓尚未对采用前后的开发效果做实证比较，当前依据是外部方法与用户采用决定",
  "invalidates_when": "轻量场景澄清在连续多轮不能减少需求歧义、不能改变实验优先级或其成本高于避免的返工；业务目标、场景或响应度量改变时应重新澄清和排序"
}
---

本项目采用的是 **轻量 QAW 前置步骤**，不是每轮召开完整工作坊，也不是先创建形式化 GOAL 节点。

开始有不确定性的开发前，先回答：谁在什么环境下给系统什么刺激、系统哪部分应怎样响应、用什么直接度量判断响应，以及这个场景相对其他场景为什么更重要。优先级来自业务影响和风险，不来自某个候选当前容易通过什么。

推荐最小模板：

```text
业务目标：
相关人及关注点：
场景优先级及理由：
source / stimulus / environment / artifact：
response / response measure：
本轮冻结边界：
```

场景澄清后再进入 ADD 式 tactics/架构选择、最小原型和 fitness functions。原型暴露真实新需求时可以修改场景，但必须记录独立业务理由、升验收版本，并避免只为让当前候选通过而移动球门。
