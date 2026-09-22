---
{
  "id": "measure-block-overlap-threshold",
  "type": "lesson",
  "title": "块间重复传感器阈值 0.22 的全部依据：3 期 900 对里挑出的 7 对梯子，只有 2 对人工逐句核实过",
  "date": "2026-08-31",
  "status": "recorded",
  "tasks": ["设计验收门"],
  "scope": "report 76/77/78 三期简报、约 900 个块对；判为阳性/阴性的共 7 对，其中只有 0.52 与 0.19 两对做过人工逐句核实，其余靠标题相似 + 共享专名判断。n=3 期，不是验过的精度，没有 precision/recall 读数",
  "source": "services/meridian-ai-worker/src/utils/block-overlap.ts 与 eval/block-overlap/baseline.ts 的头注释（引入于 commit c4988c1，已于 2026-09-22 随奥卡姆剃刀清理删除；读数仅存于本节点）",
  "conditions": [
    "判据为传感器自身的 cont（块间内容重合度），不是余弦相似度",
    "全部读数来自离线 baseline 脚本，传感器从未接入 assembleBrief，没有任何线上运行数据",
    "三期简报由同一套 prompt 生成；换写作 prompt 后重合度分布未知"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "cautions",
      "to": "mechanism-block-overlap-sensor",
      "attributes": {"scope": "阈值 0.22 只被 7 对样本支撑、2 对人工核实，换 prompt 或换期数就要重标；不能当稳定精度用"}
    }
  ],
  "kind": "observation",
  "invalidates_when": "写作 prompt 或分段方式改变（重合度分布随之移动），或补了带人工金标的多期样本重新标定出不同的阈值"
}
---

## 产生它的病例

report 78 的块「himalayan glacial collapse kills over 900 in nepal」整段在写块
「evacuation of students from flooded nepalese schools」的内容——同一所学校、同一个校长、
同样的 69 所学校 / 两辆巴士。此前**没有任何一把尺能看见这种块间照抄**。

## 阈值梯子（全部支撑证据）

| cont | 对 | 判定依据 |
|---:|---|---|
| 0.52 | 78[5,6] 冰川崩塌 ↔ 学校疏散 | **人工核实：整段照抄** |
| 0.48 | 77[17,22] 泽连斯基无人机 ↔ CIA 局长访莫斯科 | 未人工核实 |
| 0.40 | 78[9,10] Modi 乌兹别克 ↔ Modi-普京会晤 | 交接文档已判重复 |
| 0.30 | 76[11,12] 对伊六个月僵局 ↔ 对伊六个月军事行动 | 标题几乎同名 |
| 0.26 | 78[4,10] 俄中伊聚首 ↔ Modi-普京（跨节） | 同一场 SCO 峰会 |
| 0.23 | 78[1,2] 石油协议 ↔ 专家质疑可行性 | **人工核实：块 2 无新信息** |
| 0.19 | 78[7,8] 加拿大贸易战两块 | 交接文档判为不重复 |

已知阴性落在 0.19，已知/疑似阳性从 0.22 起 → 阈值取 **0.22**。
**这是两点之间插的一根针，不是分布分离度的测量。**

## 三条已知局限（写在原注释里）

1. **同节两块讲同一事件的不同侧面本来就共享专名**。传感器测的是重合度，判不了「该共享」
   与「照抄」的区别——所以它是传感器，不是门。
2. **只看正文字面**。换完全不同措辞讲同一件事抓不到。
3. **只测块对，不测「一个事件占了几块」**。report 76 的尼泊尔 11 块两两只有 0.18–0.22——
   切得越碎，单对重合越像正常值。碎片化这个病本传感器结构上看不见
   （那个病本身见 [[lesson-llm-oversplits-single-large-event]]）。
