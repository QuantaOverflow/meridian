---
{
  "id": "decision-hold-checklist-tiering",
  "type": "decision",
  "title": "暂缓修复事件清单的分层可靠性:只修核心层内容,分层与完整性欠着",
  "date": "2026-09-19",
  "status": "accepted",
  "tasks": ["设计验收门"],
  "scope": "cluster-to-brief 的覆盖轴;本轮只保证「臂间比较可用」,不保证覆盖率绝对值",
  "source": "docs/knowledge/nodes/measure-checklist-core-audit.md 与 lesson-cosine-cannot-detect-duplicate-events.md",
  "conditions": [
    "各臂共用同一份清单,所以分层的系统性偏差对臂间比较是对称的",
    "核心层 21 条的内容已校核并修正,分层本身未验"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "based_on", "to": "measure-checklist-core-audit"},
    {"type": "based_on", "to": "lesson-cosine-cannot-detect-duplicate-events"},
    {"type": "selects", "to": "mechanism-checklist-tiering", "attributes": {"action": "hold"}}
  ],
  "kind": "hold",
  "action": "暂缓:不调归并阈值、不重抽清单、不校核次层与尾层。只修核心层内容(6 条改写 + 15 条补口径分歧),并保留 --merge-audit 作为人工排查线索",
  "invalidates_when": "某轮臂间排名翻转可归因到分层;或需要报覆盖率的绝对值而非臂间比较;或核心层校核结果与某臂的覆盖判定直接冲突"
}
---

**这是一笔明确记下的技术债,不是「这个机制天生如此」。**

### 欠着什么

1. **分层不可靠**。核心层门槛由 `maxSupport` 推出,而支持篇数经过一道阈值 0.90 的归并。
   归并漏掉时同一事件劈成两条、支持篇数被分走、双双掉出核心层,**不报错**。
   c36 肉眼已确认三对(会议推迟 6+3、El Gaia 4+3、Perim 岛 4+3)。
2. **完整性未验**。「该有而没抽到」的事件查不到 —— `EVENTS_PER_ARTICLE=2` 是硬上限,
   漏抽的事件不在分母里,所有臂都不会因此扣分。
3. **次层 24 条、尾层 96 条未校核**(本轮只核了核心层 21 条 = 清单的 14.9%)。

### 为什么现在不修

- **调阈值修不了**。[[lesson-cosine-cannot-detect-duplicate-events]] 实测:
  真重复 0.899、非重复 0.900、语义相反的两条 0.899,分布完全重叠。
  要修得换机制(LLM 判同一性,或数字/实体硬特征),那是新工作。
- **臂间比较不受影响**。各臂共用同一份清单,系统性偏差对称。而本轮要的就是臂间比较。
- 继续修尺会踩 `ship-first-default` 那条:尺可以无限修,修到最后一行产品代码没动。

### 代价(接受了什么)

- 覆盖率的**绝对值不可信**,只能做臂间相对比较
- 核心层分辨率极低(2–7 条/簇),6 个百分点的差距不构成证据
- 次层 24 条不计分,而它给出的排序与核心层相反

### 还款触发

写在 `invalidates_when` 里,三条任一成立就要还:排名翻转可归因到分层、需要绝对值、
或核心层校核与某臂的覆盖判定直接冲突。

### 还款路线(已知)

不是调阈值。候选两条:**(a)** 用 LLM 判两条事件是不是同一件;
**(b)** 硬特征判据 —— 共享 articleId + 数字集合交集 + 实体重叠。(b) 更便宜,且机械可判,未试。
