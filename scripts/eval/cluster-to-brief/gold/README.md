# gold/ —— 判官的人工标注

`gold/<axis>.json` 是某一轴的人工标注。它的唯一用途:量判官的真阳率 / 真阴率
(`node judge-alignment.mjs --axis=<axis> --run=out/<runId>`)。

**为什么非要有它**:2026-09-20 那轮三个临时判官在一天生产数据上判了 51 篇 / 248 句,报出 72 条旗标;
人工复核第二遍发现只有约 22% 是读者可见的错,其余是「出处挂错位置」被判成了编造 ——
判官的真阳率约 0.22,而当时没人知道。所以 CONTRACTS.md §5 写着:
**没与人工对齐过的判官,它报的比例只能当量级参考,不能进对比表。**

## 格式

```json
{
  "axis": "citation-support",
  "labels": [
    { "cluster": 3, "run": 1, "ref": "b1s3", "label": "fail", "note": "「首次」这个成分被引句里没有" }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `axis` | 轴名,必须与文件名一致(`judge-alignment.mjs` 会核) |
| `cluster` | 簇 id,对应 `out/<runId>/c<clusterId>.json` |
| `run` | 第几次重复(`run.json` 的 `epoch`)。标注挂在**某一稿**上,换一稿就不再是同一条句子 |
| `ref` | `b<块序号>s<句序号>`(都从 1 起);整篇一条的轴(`event-mixing`)写 `brief` |
| `label` | 只有 `pass` / `fail`。判不准的**不要写进金标** —— 拿不确定的标注去量判官,量的是两边的不确定 |
| `note` | 一句理由。分歧表会把它和判官的理由并排打出来给人复核,所以别省 |

`run` 可省;省了就对任何 epoch 都算数。`run.json` 里有 `epoch` 时 `judge-alignment.mjs`
自动按它筛 —— 悄悄跨 epoch 比对会把另一稿的标注算进来,而这不报错。

## 怎么标

1. 先挑样本:**别只挑判官报了旗标的句子**。只标旗标句就只能算出精度,算不出真阳率
   (漏报那一格永远是空的),而漏报恰恰是 `actor-swap` / `strength-distortion` 的主要失效。
   做法:随机抽一批句子标全,再补标判官报旗标的那些,两部分都记进同一个文件。
2. 标的时候读那一轴 `judges/<axis>.md` 的「判什么」和「你可以读什么」,**用同一套证据范围**。
   人看全簇、判官只看被引句,那量出来的分歧是范围差异,不是判官的偏差。
3. 分界那一条特别容易在人工这边也搞错:**事实在簇内别处有、只是不在被引句里 → `citation-support`
   的 `fail`,不是 `invented-fact` 的 `fail`。** 这正是上一轮 4 倍虚高的来源。
4. 标够 **30 条**再拿去比较臂。不足 30 条 `judge-alignment.mjs` 会打警告:
   置信区间比臂间差异还宽,这时的 TPR/TNR 只能当量级参考。

## 文件

- `<axis>.example.json` —— 格式样例,不参与任何计算(`judge-alignment.mjs` 只读 `<axis>.json`)。
- `practice-risk-v1/` —— 另一件事(练习集),与本目录的判官金标无关。
