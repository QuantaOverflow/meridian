# HDBSCAN 层级切分（leaf）离线实验 —— 结论

问：把簇内切分交给 HDBSCAN 自己的层级（`cluster_selection_method='leaf'`），
比现行的「complete-linkage 文章两两 cos ≥0.90」切得少吗？

答：**少 30-50%，但给不出「一件事一块」，切分层有明确下界。** 顺带否掉两个推测。

数据：`cron-brief-1787749254358`（152 条 story）最大的 8 个簇。零 LLM，零成本。
参数照搬生产 `BRIEF_CLUSTERING_OPTIONS`（UMAP n_components 5 / n_neighbors 15 /
min_dist 0.1 / cosine；HDBSCAN mcs 3 / ms 1 / eps 0.35）。

## ① leaf vs eom vs 全链 0.90（`probe.py`）

```
簇   文章  现行故事数  几何(全链0.90)  HDBSCAN-eom  HDBSCAN-leaf   leaf噪声  最大块
62     49          16              11            7             8          8      10
68     31          13              12            6             6          0      10
39     21          10               9            3             4          6       4
43     27           9               8            4             5          2       9
2      29           8               7            2             5          9       6
45     34           7               4            5             7          1       8
9      14           7               7            3             3          0       6
48     19           7               7            4             4          0       6
```

- **leaf 普遍比全链 0.90 少切 30-50%**（簇 68：12 组 → 6 块）
- **leaf 与 eom 差别只有 1-2 块**——这**推翻了**「eom 丢子结构、leaf 更细」这个从官方文档
  一般性描述推来的解释。文档说的行为对不对是一回事，在这个数据上是不是主导因素是另一回事
- **leaf 会产出噪声篇**（簇 62 有 8 篇、簇 2 有 9 篇进不了任何块）。全链下落单文章至少能落进
  2 篇的小组或被 `≥2 篇` 门槛显式过滤，leaf 的噪声篇**直接消失**——这是新增的漏报面

## ② epsilon / min_cluster_size 扫描（`scan.py`，簇 62）

```
eps    mcs   eom块  eom噪声   leaf块  leaf噪声   eom最大  leaf最大
0.0    3         7        6        8         8        10        10
0.1    3         7        6        8         8        10        10
0.2    3         7        6        8         8        10        10
0.35   3         7        6        8         8        10        10     ← 生产值
0.5    3         7        6        7         6        10        10
0.0    5         4        5        4         5        14        14
0.35   5         4        5        4         5        14        14
```

**两条结论：**

1. **`cluster_selection_epsilon` 在这个尺度上无作用**（0 → 0.5 读数纹丝不动）。UMAP 降维后
   簇间距离本来就大于 0.5，没有需要强制合并的对。生产那个 0.5→0.35 的调优是在**全量 1254 篇**
   上做的，几何完全不同——**参数不能跨尺度照搬**，这次实测坐实。
   （这也否掉了「epsilon 压住了 eom 与 leaf 的差别」这个推测。）
2. **`min_cluster_size` 是唯一主导旋钮**：3 → 5 让块数从 7-8 掉到 4，最大块 10 → 14 篇。

## ③ 切分层的天花板

`mcs=5` 已经是能给的最粗粒度（再粗就没块了），49 篇仍切成 **4 块**、噪声 5 篇。

**HDBSCAN 这条路给不出 1 块。**它的任务是找密度峰，而一件大事的不同侧面
（学校撤离 / 水电站救援 / 外交争议）在向量空间里本来就是多个峰。

→ 这支持 `PROPOSAL-fable-segmentation.md` §8 的判断：**A′ 交付的是「少切」，不是「能粘」**。
无论切分层怎么升级，残余碎片总要有一层能粘回去。

## ⚠️ 这个探针不能回答什么

**只数块数，不判对错**——没有金标。「11 → 8」同时兼容两种解释：修好了碎片化 / 把两件事混成
一块。方向和风险在同一个数字里，分不开。要判对错必须先建金标
（方案见 `PROPOSAL-fable-segmentation.md` §5）。

## 复现

```bash
cd apps/backend/prototypes/leaf-split
../../../../services/meridian-ml-service/.venv/bin/python probe.py [workflow_id]
../../../../services/meridian-ml-service/.venv/bin/python scan.py
```

依赖用 ml-service 自己的 venv（hdbscan / umap 都在里面），不用另装。
