# HDBSCAN leaf 切分（扔掉型原型）

**问题**：把一个大簇的切分交给 HDBSCAN 自己的层级（`cluster_selection_method='leaf'`），跟当时生产的「complete-linkage 文章两两 cos ≥0.90」比，切成几块？

背景：HDBSCAN 内部本来就建了密度树，最后只挑一层输出。生产用 `'eom'`（挑最稳定那层），官方文档确认 EOM 会丢弃「本来存在但不够稳定」的子结构；`'leaf'` 直接取叶子。参数一直在 `services/meridian-ml-service/src/clustering.py`，只是从没换过值。

**跑**：`python probe.py` / `scan.py`（读数在 `FINDINGS.md`）

**注**：2026-09-05 聚类已换成不降维凝聚，HDBSCAN 整条路径退居回滚位，本原型的问题随之作废，留档备查。
