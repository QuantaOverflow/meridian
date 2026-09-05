# 原型共用数据（不入库）

聚类相关原型共用的输入与中间产物。**整个目录被 .gitignore 挡住**，因为 fixture 含 384 维
embedding（两个窗口 11MB），cluster-sweep 是 1615 个标签文件（95MB）。

| 内容 | 是什么 | 怎么重建 |
|---|---|---|
| `fixture-F{1,2}.jsonl` | 窗口内全部文章的 id/title/publish_date/source_id/embedding | `scripts/eval/clustering/gold/build-titles.sh` 导 id 清单，再按 id 从 DB 取 embedding |
| `fixture-F{1,2}-text-fields.jsonl` | 同批文章的结构化字段（地点/要点/实体/题材词） | 同上，取 articles 表的分析字段 |
| `cluster-sweep/*.json` | 各配置跑出的聚类标签，`{arm, fixture, config, labels:{articleId: clusterId}}` | 重跑对应原型的扫描脚本 |

窗口定义见 `scripts/eval/clustering/gold/meta-F{1,2}.json`。
