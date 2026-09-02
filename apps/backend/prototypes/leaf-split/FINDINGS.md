# HDBSCAN 层级切分（eom/leaf）离线实验 —— 结论

问：把簇内切分从「complete-linkage 文章两两 cos ≥0.90」换成 HDBSCAN 自己的层级
（`cluster_selection_method='eom'/'leaf'`），会更好吗？

答：**不是免费的改进，是换了个位置站在「纯度 vs 完整性」的权衡曲线上。**
leaf 少丢 37pp 的文章，代价是划分明显变脏——读标题就能看出坏例子。

零 LLM、零成本。8 期真实数据，402 簇 / 7843 篇。

---

## 主结果（`sweep2.py`，公平版）

输入 = R2 快照 `observability/clustering/{wf}.json` 的**原始簇成员**（候选分组之前），
两种算法喂同一批。参数照搬生产（UMAP n_components 5 / n_neighbors 15 / min_dist 0.1 /
cosine；HDBSCAN mcs 3 / ms 1 / eps 0.35）。

```
全链0.90      1161 组 + 3909 篇进不了任何组（49.8%）  最大 25 篇
HDBSCAN-eom   1252 块 +  696 篇进不了任何组（ 8.9%）
HDBSCAN-leaf  1456 块 + 1009 篇进不了任何组（12.9%）  最大 14 篇
```

**49.8% 与生产实测对得上**（`candidate-grouping.ts` 注释：2026-08-20 全量 1254 篇里
592 篇落单 = 47%）——这是输入正确的旁证。

## ⚠️ 划分质量：leaf 明显更脏（决定性）

「少丢文章」不是白来的：`min_cluster_size=3` 只要够 3 篇就成块，不管这 3 篇像不像。
全链要求组内**每一对**都 ≥0.90，所以宁可让文章落单。

真实坏例（`diff.json`，读标题即可判）：

- 簇 22（尼泊尔洪灾）leaf 第 3 块：
  `Anita Mui's mother dies at 102` + `97-year-old woman survived 4 days under debris` +
  `California couple recounts surviving Nepal flood`
  —— 香港歌手母亲去世 / 尼泊尔老太获救 / 加州夫妇幸存，**靠「老人」这个词粘在一起**
- 簇 35 leaf 第 1 块：`Malaysia's push for 15 million Muslim tourists` +
  `Pakistan expands defence umbrella` + `Oil prices today`
  —— 只是都在中东/穆斯林世界

送进 ④ 的组会变脏，而 ④ 的判官精度 89-92% 正是在**干净的组**上测出来的。

## 权衡总表

| | 全链 0.90（现行） | HDBSCAN eom | HDBSCAN leaf |
|---|---|---|---|
| 丢文章 | 49.8% ❌ | 8.9% ✅ | 12.9% ✅ |
| 划分纯度 | 高 ✅ | 未逐条看 | **低** ❌ |
| 最大块 | 25 篇 | — | 14 篇 |

两个指标方向相反。**现行的 49.8% 是有意的**：`candidate-grouping.ts` 明写「落单的文章不进
判官，也就不会成故事」，并验过「85/85 全捕获人工确认的真事件」。宁可丢一半，也要保证
送进 LLM 的每组都干净。

⚠️ 但那次验证是 2026-08-20 做的，源池 08-17 才扩过（11→17 行，进稿 230→600/天）。
**样本量翻倍后没重验过 85/85 那个读数。**

## 容量墙：确定不存在

leaf 最大块 14 篇、全链最大 25 篇。fable proposal §3.2 担心的
「A′ 把 91 篇大事件保成一个组 → 撞 ④ 容量墙」**实测不会发生**——leaf 根本不保整。
（据此已修正 proposal 里 A′ 的排序论证。）

## 三个被推翻的判断（都是我自己的）

1. **「eom 丢子结构、leaf 更细，所以 leaf 能拿到子结构」** ❌
   实测两者只差 1-2 块（`probe.py`）。这是从 hdbscan 官方文档的一般性描述推来的，
   在这个数据上不是主导因素。
2. **「epsilon 压住了 eom 与 leaf 的差别」** ❌
   eps 0 → 0.5 扫下来读数纹丝不动（`scan.py`）。UMAP 降维后簇间距本就 >0.5，
   没有需要强制合并的对。真正的主导旋钮是 `min_cluster_size`（3 → 5 让块数 7-8 → 4）。
3. **「leaf 丢 17% 是主要风险，全链只丢 8 篇」** ❌
   **测量错误**：第一版 `sweep.py` 喂的是 `brief_stories.article_ids`，那是全链已经筛过的
   幸存者——等于让全链当自己的考官。改喂原始簇成员后，真实情况反转（全链 49.8%）。
   靠「跟生产实测的 592 篇落单对不上」才发现。

## 可复用的教训

- **测量的输入不能由被测对象之一产生。** 这条今天栽了一次。
- **参数不能跨尺度照搬。** 生产的 `eps 0.35` 是在全量 1254 篇的全局几何上调的，
  用于簇内重跑时落在完全无效区间。
- **任何比率型指标先对齐分母。** 「1456 块 vs 1161 组」看起来 leaf 切得更碎，
  真相是全链把一半文章扔了、剩下的当然好切。
- **库的实际行为别靠推理。** 连着两次假设 eom/leaf 的行为，两次都错。
- `wrangler r2 object get` **必须带 `--remote`**，否则读本地模拟 R2、报
  "The specified key does not exist"（CLAUDE.md 有记，我没照做）。

## 这条路还剩什么

不建议直接换 leaf。若要继续，方向是**在两个指标之间找更好的操作点**而不是二选一：

- eom 比 leaf 保守（丢 8.9%、块数 1252），划分质量未逐条看过，**值得先看**
- `min_cluster_size` 是主导旋钮，但调大只会让块更粗更脏
- 真正的判据缺失：没有金标就无法知道「丢掉的 49.8% 里有多少真事件」，
  也无法给两个指标定权重。方案见 `docs/engineering-notes/PROPOSAL-fable-segmentation.md` §5

## 复现

```bash
cd apps/backend/prototypes/leaf-split
# 先拉 R2 快照（必须 --remote）
npx wrangler r2 object get "meridian-articles-prod/observability/clustering/<wf>.json" \
  --pipe --remote > .cache/clustering_<wf>.json
V=../../../../services/meridian-ml-service/.venv/bin/python
$V sweep2.py      # 公平版全量扫 → diff.json（278 个差异簇，给人判）
$V probe.py       # 单期 8 个大簇，三算法对照
$V scan.py        # eps / mcs 扫描
```

依赖用 ml-service 自己的 venv（hdbscan / umap 都在里面），不用另装。
`sweep.py` 是**有偏的第一版**，保留仅为记录那次测量错误，别用它的读数。
