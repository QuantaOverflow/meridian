---
{
  "id": "lesson-run-variance-needs-epochs",
  "type": "lesson",
  "title": "同一版配置每次跑结果不同——单次运行的结论会把归因指向错的改动",
  "date": "2026-09-20",
  "status": "recorded",
  "tasks": ["设计验收门"],
  "scope": "direct-raw exec 臂,温度 0.1/0.3、无 seed;7 簇 ×3 次与 17 簇 ×3 次两批",
  "source": "docs/knowledge/nodes/experiment-prod-day-real-distribution.md",
  "conditions": ["Workers AI 不提供 seed;窗口步与写作步都重跑才算一次独立重复"],
  "evidence_origin": "local_record",
  "relations": [],
  "kind": "failure_mode",
  "invalidates_when": "同一配置连跑 3 次,各轴读数极差接近 0"
}
---

**实例**:
- c28 的「块内是否跨事件」三次是 `mixed / ok / mixed`,单次运行会得出相反结论。
- c28 的飞行员营救线在 v6 单次运行里写到了,连跑三次则 0/3 都没写——当初「v6 覆盖两条线」是运气。
- 我曾把「营救线消失」归因到刚加的杂烩规则上,实际是窗口步重跑后那几条重点的报道篇数从 4 变 3、
  掉出了必写档。**单次运行下的归因把因果指错了一整轮。**

**可操作**:默认 k=3;单次结果标成假设;报均值与极差而不是单值;
任何「改了 X 所以 Y 变好」的说法,先确认 Y 的极差小于观察到的差值。
