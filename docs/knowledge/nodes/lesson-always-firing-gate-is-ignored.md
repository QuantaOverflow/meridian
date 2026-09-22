---
{
  "id": "lesson-always-firing-gate-is-ignored",
  "type": "lesson",
  "title": "一道天天响的闸等于没有闸：期望值取错基准会让 mismatch 永久化，rollout 期的瞬时误报同理",
  "date": "2026-09-22",
  "status": "recorded",
  "tasks": ["运维容器部署"],
  "scope": "从部署身份断言的接线设计里推出的判断，适用于任何「期望值 vs 实际值」型告警；**推理，无实证**——本仓尚未接线，也没有统计过告警被忽略的比例",
  "source": "2026-09-22 清理轮中对部署身份断言的接线设计讨论",
  "conditions": [
    "前提是期望值由人或脚本单独维护，而被测对象有自己的发布节奏",
    "CF Containers 的渐进 rollout 会让新旧镜像在一段时间内同时在跑，这是瞬时误报的来源"
  ],
  "evidence_origin": "local_analysis",
  "relations": [
    {
      "type": "cautions",
      "to": "mechanism-image-build-stamp-assertion",
      "attributes": {"scope": "该机制的第二档（戳值比对）如果把期望填成 repo HEAD，就会变成永久 mismatch，闸最终必然被无视"}
    }
  ],
  "kind": "failure_mechanism",
  "invalidates_when": "出现能自动从「最近一次镜像构建」推导期望值的机制（人不再维护基准），或 rollout 能被断言方感知并跳过"
}
---

## 两个把闸变成噪声的做法

**一、期望值取错基准。** 若把期望 SHA 填成 **repo HEAD** 而不是
**「最近一次镜像构建的 SHA」**，那么任何只部署调用侧、不重建镜像的改动
（这类改动是多数）都会让期望走在镜像前面，**从此永久 mismatch**。
一道天天响的闸，最终必然被无视——它不是「偏严」，它是**零信息**。

**二、把渐进 rollout 期的瞬时不一致当故障。** CF Containers 的渐进 rollout 会让
新旧镜像同时在跑，断言在这段窗口内必然时真时假。

## 接线原则

**首轮只记不降级。** 先只落日志/观测，攒够「正常时它响几次」的读数，
再决定要不要让它影响流程。先降级后观测，等于用生产流量给一个没标定过的判据背书。
