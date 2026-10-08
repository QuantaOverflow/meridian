# ADR 0016：搜索——简报块的关键词全文检索

- 状态：已采纳，2026-10-08
- 日期：2026-10-08
- 相关：`apps/backend/src/lib/reader/search-blocks.ts`、`packages/contracts/src/reader-search.ts`、`apps/frontend/src/pages/search.vue`；检索列与索引在表 `brief_blocks` 上（ADR 0014）

## 背景

读者要能跨期搜简报块。用户定：Postgres 关键词全文检索（英文），只搜已发布各期的块标题与正文；不做按意思搜（每次查询要唤醒 ml 容器，会把它拖成常驻），不搜原始文章。

## 决定

`GET /reader/search?q&limit&offset`（`lib/reader/search-blocks.ts`）搜块上的 `search` 列（标题权重 A、正文 B），只含已发布各期的块。没有新的表或列。

- **查询串交给 `websearch_to_tsquery('english', …)`**：多个词是「都要有」、引号是短语、`-词` 排除；任何输入都不会让它报语法错，只有停用词的查询什么都不命中。它不管的两种输入在接口的参数校验里拦下、回 400（backend 与前端的 `/api/search` 两侧都拦）：带 NUL 字符的查询串（Postgres 的 text 存不了，放过去是 500）和超过 100000 的 offset（超出 bigint 同样是 500）。
  词形还原由 `english` 配置做。空查询与超过 200 字回 400；搜索页在这两种情况下不去问 backend，只出说明。
- **折叠在 backend 做，分页按组数**：同一线索（`brief_stories.story_cluster_id`）的块归成一组，没并进线索的块自成一组。在前端按页折的话，同一线索会被页边界切开。
  每组带最新的 10 块与总块数（一条线索可以跨几十期，不设上限一页的响应没有上界）。过了线索门槛（≥2 期）的组带线索标题与期数，口径同线索页；没过门槛的簇照常成组，只是不带线索链接。
- **排序**：组按组内最高的 `ts_rank_cd`，相同则最新的在前；组内最新的在前。排序合不合意没有机器裁判。
- 没做命中词高亮与摘录（`ts_headline`）：块只有 3–5 句，直接给全文。
- staging 库上的读数（457 块）：搜正文里的词 `withdrawn` 命中它所在的块，命中块数与库里直接数的一致；搜 `negotiating` 命中只写着 `negotiations` 的块；
  搜 `ceasefire` 得 5 组 13 块，3 组不止一块，组内同一线索、线索不跨组；把一期的 `published_at` 临时置空，它的块随即搜不到，放回后恢复。

## 没验证的

- 搜索结果的排序合不合意、搜索页好不好用没有机器裁判；导航栏加了 Search 之后在窄屏（375px）会不会折行没有量过。
