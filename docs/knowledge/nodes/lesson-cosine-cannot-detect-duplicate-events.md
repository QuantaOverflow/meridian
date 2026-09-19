---
{
  "id": "lesson-cosine-cannot-detect-duplicate-events",
  "type": "lesson",
  "title": "e5 余弦分不开「同一事件的两种措辞」与「同一话题的两件事」——归并阈值调不动",
  "date": "2026-09-19",
  "status": "recorded",
  "tasks": ["设计验收门"],
  "scope": "本地 e5-small(384 维已归一化)对事件清单里的单句事件描述;未试别的向量模型、未试加数字/实体特征",
  "source": "scripts/eval/cluster-to-brief/build-checklist.mjs 的 --merge-audit",
  "conditions": [
    "真重复的判定是肉眼确认(c36 三对),样本很小",
    "只测了 e5-small 的裸余弦,没测「共享 articleId + 数字集合交集 + 实体重叠」这类组合判据"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "cautions", "to": "mechanism-checklist-tiering", "attributes": {"scope": "归并失败导致的错误分层,靠调阈值修不了"}}
  ],
  "kind": "failure_mechanism",
  "invalidates_when": "换向量模型或加入数字/实体硬特征后,两类分布出现可分的间隔"
}
---

原本的判断是「归并阈值 `MERGE_TH = 0.90` 没有标定记录,偏高会让同一事件劈成两条,调一下就行」。
实测**调不动** —— 两类的余弦分布完全重叠,而且假的排在真的前面:

| | cos |
|---|---|
| c36 **真重复**(Oman 推迟会议的两种写法) | 0.899 |
| c51 **非重复**(Amodei 说该放缓 ↔ Musk 表示支持) | **0.900** |
| c36 真重复(El Gaia 被击中 ↔ IRGC 反驳) | 0.897 |
| c51 非重复(Amodei 说该放缓 ↔ Nadella 表示同意) | 0.897 |
| c28 **语义相反**(使馆暂停运作 ↔ 使馆恢复应急运作) | 0.899 |

最后一行最能说明问题:**两条描述相反动作的事件,余弦 0.899。**

按 [0.80, 0.90) 这个区间统计,dev+heldout 报出 2938 对「疑似未归并」,
c51 的「碰到核心层」是核心层条数的 5650% —— 这不是读数,是噪声。

### 处置

检测器降级为**线索**:每簇只打余弦最高的 3 对供人工排查,**不报总数、不写进清单文件、不跨轮比较**。
一个分不开类别的信号不该产出计数。
留着是因为排序还有点用 —— 肉眼在 c36 找到的三对真重复都落在 top-3 里
(一个簇三个样本,不是保证)。

### 对这笔债的意义

债的性质变了:不是「便宜的修法存在、本轮没空」,而是**便宜的修法不存在**。
要真修得换机制 —— 让 LLM 判两条是不是同一事件,或者用「共享 articleId + 数字集合交集 + 实体重叠」
做硬判据。那是新工作,不是调参。见 [[decision-hold-checklist-tiering]]。
