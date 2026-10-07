# ADR 0014：简报块另存一张表——保存简报时同事务写入，往期按 brief-v3 记录回填

- 状态：已采纳，2026-10-08
- 日期：2026-10-08
- 相关：`packages/database/src/schema.ts` 的 `$brief_blocks`、`packages/contracts/src/brief-block.ts`（块对外的形状）、
  `apps/backend/src/lib/save-brief-report.ts`（写入）、`apps/backend/src/lib/core/brief-v3.ts` 的 `briefBlockDrafts`（标题与正文的取法）、
  `apps/backend/scripts/backfill-brief-blocks.ts`（往期回填）；术语在 `GLOSSARY.md`「读者端」；
  spec 在本地 `.scratch/reader-explore/`（不入库，本文是第 1 步的入库结论）

## 背景

读者要能按「我关心什么」读：搜索简报块，看某个国家、某个实体的全部简报块，关注之后只看相关的新块。
这些都以「块」为单位跨期查询，而块此前不在库里：成稿是 `reports.content` 一整段 markdown，
块与故事的对应只存在于每期的 brief-v3 记录（R2 `observability/brief-v3/<workflowId>.json`），
地图首页每次请求读一份记录、现对一遍（`apps/backend/src/lib/reader/brief-map.ts`）。

## 决定

1. **每个写出来的块一行，另存表 `brief_blocks`**：所属期（`report_id`）、所属故事（`story_id`，唯一）、分档、期内顺序、标题、正文，
   加一个英文全文检索的生成列（标题权重 A、正文权重 B）与它的 GIN 索引。
   标题与正文就是读者页上那一块的：与 `renderBriefV3` 同一份输入、同一种取法（只去首尾空白）。
   期内顺序 `position` 从 0 起、只数写出来的块，与地图接口的 `blockIndex`、阅读页锚点 `story-{n+1}` 同口径。
2. **保存简报的同一个事务里写**。期与块同时出现或同时不出现；step 重试时事务开头发现本期已保存就直接返回，块不会写第二遍。
   所属故事由故事账本按选中下标给出 `brief_stories` 主键，不按标题、不按 `cluster_id`。
   对不上故事或没有正文的块不落库（记 error 日志），不为它让整期保存失败——成稿比检索重要。
3. **可见性不存在块上**。块对读者可见与否跟所属那一期走（`reports.published_at`），查询时 join 判。撤一期，它的块同时从各处消失；
   删一期，块随外键级联删除。
4. **对外的形状定在 `@meridian/contracts` 的 `BriefBlock`**，后面的搜索、国家页、实体页、Following 都在它之上加自己的字段。
5. **往期用脚本回填，依据只认 brief-v3 记录**。整期回填或整期跳过：这期有 run、有记录、每个写出来的块对得上恰好一个故事、
   每块的标题与正文都出现在 `reports.content` 里，才回填；否则跳过并报原因。每期一个事务里先删后写，可重跑。
   脚本默认只读，目标库只认本机与 staging，别的一律当生产拒绝（要加 `--production`）。

## 为什么不每次从整期正文里切

- **切得出文字，切不出归属**。正文里的块标题是写作层起的，与 `brief_stories.title` 不相等，按标题对不回故事；
  而国家、涉及、实体、线索都挂在故事的成员文章上。归属只能来自写块那一刻（账本）或 brief-v3 记录，读时再从 R2 取一份记录现对，
  跨期查询就是每期一次 R2 读。
- **全文检索要索引**。对整期正文建索引只能命中「哪一期」，命中不了「哪一块」；按块存才能直接用 Postgres 的 `tsvector` + GIN。
- **正文的 markdown 布局是给前端渲染用的**（`## ` 分节、`<u>**标题**</u>` 分条），把它再当数据格式解析，改一次版式就要回头改所有查询。

代价：同一段文字存了两份（`reports.content` 与 `brief_blocks.body`）。事后手改 `reports.content` 不会同步到块；
目前没有手改成稿的流程，出现时重跑回填脚本覆盖不了（记录里是原文），要另行处理。

## 回填范围与依据

用户定的范围是「2026-09 起、块与故事能对上的期」。2026-10-08 在 staging 库（生产副本）与生产 bucket（只读）上的读数：

- 2026-09 起已发布的生产期 31 期（report 80–118）。
- **09-01 到 09-14 的 14 期（report 80–93）没有 brief-v3 记录**，记录从 report 99（2026-09-20）起才有。没有记录就没有块与故事对应的依据
  （这 14 期每期还有 18–33 个 `cluster_id` 被多个故事共用，按 `cluster_id` 也对不回去），按用户定的规则不回填。
- 09-20 到 10-06 的 17 期（report 99–118）全部可回填，共 407 块：每期写出来的块都对得上唯一的故事，标题与正文都在成稿里。
  其中 3 期不足 25 块（09-27 20 块、10-03 21 块、10-04 16 块），是当期选中的故事本来就少，记录里没有失败块。

往期的记录只在生产 bucket；staging 的 bucket 里只有 staging 自己跑出的期。回填 staging 库时脚本只读生产 bucket 的这一个前缀。
生产库的 migration 与回填没有做，留给用户读完 PR 后定。

## 没验证的

- 保存简报时写块这条路只在 staging 上跑过整链路，没在生产跑过。
- 全文检索列只有单测覆盖（词形还原能命中）；查询接口与排序在后面的步骤做。
