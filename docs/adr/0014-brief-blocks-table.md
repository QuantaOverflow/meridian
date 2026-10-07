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

- 2026-09 起已发布的生产期 32 期（report 80–119）。
- **09-01 到 09-14 的 14 期（report 80–93）没有 brief-v3 记录**，记录从 report 99（2026-09-20）起才有。没有记录就没有块与故事对应的依据
  （这 14 期每期还有 18–33 个 `cluster_id` 被多个故事共用，按 `cluster_id` 也对不回去），按用户定的规则不回填。
- 09-20 到 10-07 的 18 期（report 99–119）全部回填，共 432 块：写完后库里每期的块数与记录的成功块数相等，重跑一遍结果不变；每期写出来的块都对得上唯一的故事，标题与正文都在成稿里。
  其中 3 期不足 25 块（09-27 20 块、10-03 21 块、10-04 16 块），是当期选中的故事本来就少，记录里没有失败块。

往期的记录只在生产 bucket；staging 的 bucket 里只有 staging 自己跑出的期。回填 staging 库时脚本只读生产 bucket 的这一个前缀。
生产库的 migration 与回填没有做，留给用户读完 PR 后定。

## 块上的国家归属（2026-10-08 补，国家页）

块多了两列：`placement_country`（落点国家）与 `mention_countries`（涉及的国家，不含落点国家）。写块时按故事的成员文章算好存下
（`insertBriefBlocks` → `lib/reader/story-countries.ts`），保存简报与回填走同一份；国家页 `GET /reader/countries/:code/blocks` 只按这两列过滤。

- **为什么存而不是读时算**：归属挂在成员文章上，读时算要把所有块的成员文章都 join 一遍；存下来是一次索引查找。代价是地点归一表补了新写法后旧块不会变，重跑回填脚本即刷新（跳过的期已有的块只重算这两列）。
- **落点**用地图首页的同一份规则：规则从前端挪到 `packages/contracts/src/placement.ts`，没改（ADR 0009 决定 4）。
- **涉及**是这一步新定的：落点之外，被至少 2/3 的成员文章提到的国家（地点或关键实体），加上没有落点的跨地区故事铺开的那几国。
  门槛取地图连线量过的那个（ADR 0009「连线」：≥2/3 时 121 个故事里强行关联 2 条；≥1/2 时 7 条）。与连线不同的是并列的都算——连线只能挑一个，列表不用挑。
  这条没有另外量过精度，是照连线的读数推的。
- staging 库上的读数（18 期回填 432 块 + 当晚 Staging 运行那期 25 块，共 457 块）：454 块有落点，分在 69 个国家（美国 159、英国 35、法国 25）；
  131 块至少涉及一国（伊朗 25、俄罗斯 19、乌克兰 13）。伊朗：落点 6 块、涉及 25 块；俄罗斯：落点 14 块、涉及 19 块。
  对这两国逐块核对过：不经归一表、直接看成员文章的原始地点与关键实体，落点一节每块都有至少 30% 的成员地点写的是该国，涉及一节每块都有至少 2/3 的成员写到该国；
  把一期的 `published_at` 临时置空，它的块随即从接口消失，放回后恢复。

## 搜索（2026-10-08 补）

`GET /reader/search?q&limit&offset`（`lib/reader/search-blocks.ts`）搜块上的 `search` 列（标题权重 A、正文 B），只含已发布各期的块。没有新的表或列。

- **查询串交给 `websearch_to_tsquery('english', …)`**：多个词是「都要有」、引号是短语、`-词` 排除；任何输入都不会让它报语法错，只有停用词的查询什么都不命中。它不管的两种输入在接口的参数校验里拦下、回 400（backend 与前端的 `/api/search` 两侧都拦）：带 NUL 字符的查询串（Postgres 的 text 存不了，放过去是 500）和超过 100000 的 offset（超出 bigint 同样是 500）。
  词形还原由 `english` 配置做。空查询与超过 200 字回 400；搜索页在这两种情况下不去问 backend，只出说明。
- **折叠在 backend 做，分页按组数**：同一线索（`brief_stories.story_cluster_id`）的块归成一组，没并进线索的块自成一组。在前端按页折的话，同一线索会被页边界切开。
  每组带最新的 10 块与总块数（一条线索可以跨几十期，不设上限一页的响应没有上界）。过了线索门槛（≥2 期）的组带线索标题与期数，口径同线索页；没过门槛的簇照常成组，只是不带线索链接。
- **排序**：组按组内最高的 `ts_rank_cd`，相同则最新的在前；组内最新的在前。排序合不合意没有机器裁判。
- 没做命中词高亮与摘录（`ts_headline`）：块只有 3–5 句，直接给全文。
- staging 库上的读数（457 块）：搜正文里的词 `withdrawn` 命中它所在的块，命中块数与库里直接数的一致；搜 `negotiating` 命中只写着 `negotiations` 的块；
  搜 `ceasefire` 得 5 组 13 块，3 组不止一块，组内同一线索、线索不跨组；把一期的 `published_at` 临时置空，它的块随即搜不到，放回后恢复。

## 关注与 Following 页（2026-10-08 补）

关注项（国家、线索）只记在读者的浏览器里，没有账号、没有新表。`GET /reader/following?countries&threads&limit&offset`（`lib/reader/following-blocks.ts`）
每次由前端把关注项带上来，返回命中任一关注项的已发布块，最新的在前。

- **关注一个国家 = 落点在该国的块 + 涉及该国的块**（块上的 `placement_country` 与 `mention_countries`，同国家页）；每块带 `matches`，涉及的那种标 `via: mention`，页面上写 Involves。
  关注一条线索 = 所属故事并进这条线索（`brief_stories.story_cluster_id`）的块。几个关注项取并集，一块只出现一次。
- **关注项放在查询串里**（逗号分隔，前端转发前去重、排序，同一组关注项是同一条请求）：每类最多 100 个，超过回 400。不在地点归一表里的国家代码略过而不是报错——读者本地存的关注项可能比表旧。
- **浏览器里存两样**（`apps/frontend/src/lib/follows.ts`）：`meridian-follows`（关注项的数组；线索的标题在关注时记一份，显示以后端带回的最新标题为准）与
  `meridian-following-last-visit`（上次打开 Following 页的时刻）。读写都包着 try/catch：读不到、不是合法 JSON、条目形状不对都按没有算，写不进去时关注只在这次会话里生效。
- **new 标记**：块所属那一期的生成时刻（`reports.created_at`，块的对外形状里只有它）严格晚于上次访问才标；第一次来一律不标（否则整页都是 new）。
  打开 Following 页即记一次访问，所以刷新后标记消失；页面开着的时候增减关注项不影响已标的。
- Following 页的数据在浏览器里取（服务端不知道关注了什么），服务端只渲染外壳。实体的关注见下面「实体页」。
- staging 库上的读数（457 块）：关注伊朗得 31 块（落点 6、涉及 25），与库里直接数的一致，每块的归属都含伊朗；关注线索 2177 得 25 块，与库里一致；两者并集 56 块；
  把一期的 `published_at` 临时置空，它的块随即消失，放回后恢复。线索 2177 出现在 40 期里，但有块的只有回填过的 18 期——关注一条老线索，Following 页上只看得到 09-20 之后的块。

## 实体页（2026-10-08 补）

块多了两列：`entities`（实体归一后的写法，GIN 索引）与 `entity_names`（逐项对应的显示写法）。写块时按故事的成员文章的 `key_entities` 算好存下
（`insertBriefBlocks` → `lib/reader/story-countries.ts` 的 `loadBlockAttribution` → `story-entities.ts`），保存简报与回填走同一份；回填脚本重跑即刷新。
接口三处（`lib/reader/entity-blocks.ts`、`following-blocks.ts`）：`GET /reader/entities/blocks?name&limit&offset`（实体页）、
`GET /reader/block-entities?ids`（一批块各自的实体链接）、`GET /reader/following` 多一个 `entities` 参数。

- **写法只归一大小写与首尾空白，不合并别名**（用户定）：`Volodymyr Zelenskyy`（11 块）与 `Volodymyr Zelensky`、`Flavio Bolsonaro`（6 块）与 `Flávio Bolsonaro`（5 块）各是各的。实体页上写明「按原样的名字匹配，别的拼法另列」。
  显示写法取各块存的写法里最常见的那种，同一个实体在实体页与各块下写法一致。
- **一块的实体 = 被至少一半成员文章提到的写法**。「任一成员提到」时顺带一提的名字太多：staging 的 457 块上，出现在 ≥3 块的写法 740 种；按一半算剩 153 种（含国家）。
  这个比例没有单独量过精度，是看分布定的。
- **能归成国家的写法不是实体**（用户定）：写块时就不存，它的块在国家页（块上的落点与涉及）。查这种写法时接口回 `{ kind: 'country', country }`，页面 302 到国家页。
  判定用地点归一表（`places.ts` 的 `countryOfEntity`），所以美国的州名、`Gaza`、`United Nations` 也按表归到对应的国家页。
- **媒体名不是实体**（用户定）：`story-entities.ts` 里一张写法表（生产近 30 天出现 6 篇以上的媒体写法加源池里的名字，约 80 个）。源表 `sources.name` 是 `BBC World News` 这种，对不上关键实体里的 `BBC`，所以没有用它。
  代价：媒体自己是新闻主角的块也不挂它（staging 上 `CNN` 有 12 块过得了一半这条线，其中有「CNN 被拒绝随行采访」这种）。表是手写的，会漏。
- **门槛：出现在至少 5 个已发布的简报块里才有实体页**（`ENTITY_PAGE_MIN_BLOCKS`）。staging 上 19 期 457 块（448 块挂着至少一个实体，写法共 924 种）的分布：
  ≥3 块 105 个、≥4 块 62 个、≥5 块 43 个、≥6 块 32 个、≥8 块 19 个、≥10 块 12 个。取 5：43 个逐个看过名字，没有媒体、没有国家、没有明显不是实体的；
  取 3 时多出来的大多是只在一条线索里连着出现三天的人名，页的内容与线索页重复。门槛只数已发布的期，撤一期可能让一个实体掉到门槛以下（页变 404，关注它的人仍看得到它的块）。
  期数会涨，同一个数将来放进来的实体会变多；到时候再看要不要改成按期数算。
  过门槛的 43 个：Donald Trump（103 块）、Xi Jinping（18）、Houthis、Vladimir Putin（17）、Strait of Hormuz、White House（16）、Kyiv、Volodymyr Zelenskyy（11）、
  Andy Burnham、Madrid、OpenAI、RAF Fairford（10）、Benjamin Netanyahu、Christa Pike、Cornell University、Emmanuel Macron、Jane Doe（9）、Flydubai、Pope Leo XIV（8）、
  Abbas Araghchi、Chi Phi fraternity、Kathy Hochul、Marco Rubio、Maricarmen Abascal、Sam Altman（7）、Anthropic、Colleen Slemmer、Flavio Bolsonaro、Gyanesh Kumar、Jair Bolsonaro、
  Masoud Pezeshkian、TPLF（6）、Abiy Ahmed、Bill Lee、Elon Musk、European Union、Flávio Bolsonaro、Hamas、Hurricane Polo、Kim Yo Jong、Lourdes、Moscow、NATO（5）。
  其中不理想但没有拦的：`Jane Doe` 是一桩案子里原告的化名（9 块都是同一条线索）；地名（Kyiv、Madrid、Moscow、Lourdes）与人物、机构混在一起，关键实体没有类型，分不开。
- **块下的实体链接另开一个接口，没有加进块的对外形状**：`BriefBlock` 在第 1 步定下后只读。国家页、搜索、Following、实体页的前端 server 路由拿到块之后，
  按块号（去重、升序）问一次 `/reader/block-entities`，只列有实体页的实体。代价是每个列块的页多一趟到 backend 的往返。阅读页（整期正文）没有加实体链接。
- **Following 的约定加了东西**（第 4 步定的 `FollowMatch` 多一种 `{ kind: 'entity', key, name }`，请求多一个 `entities` 参数）：spec 第 5 步要求 Following 支持实体，只能加在这里；原有的字段与取值没动。
  实体的写法里可以有逗号，所以不是逗号分隔，而是一个实体一个 `entities=` 参数。关注一个实体命中挂着它的全部块，不论它过没过门槛。
- **实体页的地址是 `/entities?name=…`**，写法放在查询串里：写法可以带斜杠（`Reuters/Ipsos` 这种），放进路径要靠 `%2F`，各层代理对它的处理不一致。
- staging 库上的读数（回填 18 期 432 块 + 当晚 Staging 运行那期 25 块）：过门槛的 43 个实体，存下的块数都等于不经存下的列、直接按成员文章原始 `key_entities` 重算的块数；
  抽 Donald Trump（103 块）、Kathy Hochul（7 块）、NATO（5 块）三页，每块都有至少一半成员文章的关键实体含它，Following 关注它命中的块数与实体页一致；
  `Iran`、`us` 回国家页，`CNN` 与差一块的 `chatgpt`（4 块）404；最新 60 块的实体链接恰是各块存下的实体里过门槛的那些；
  把一期的 `published_at` 临时置空，Donald Trump 从 103 块变成 92 块，放回后恢复。

## 没验证的

- 保存简报时写块这条路只在 staging 上跑过一次整链路（运行 `cron-brief-1791393554743`，判定绿：25 块落库，等于写出来的块数，每块正文都在成稿里），没在生产跑过。
- 保存简报时算国家归属这条路同样只在 staging 上跑过一次（运行 `cron-brief-1791395981595`，判定绿：25 块都有落点国家，2 块有涉及国家）。
- 「涉及」的门槛没有单独量过误报；国家页好不好读没有机器裁判。
- 搜索结果的排序合不合意、搜索页好不好用没有机器裁判；导航栏加了 Search 之后在窄屏（375px）会不会折行没有量过。
- 关注与 Following 页的交互（点关注、刷新后仍在、new 标记的边界）只在本机的浏览器测试里跑过，staging 上只验了接口与页面能打开，没有在真浏览器里点过。
- localStorage 一读就抛的浏览器（禁用站点数据）里整个站点起不来：`@nuxtjs/color-mode` 与 `nuxt-auth-utils` 读它没有保护，这在关注功能之前就是这样。关注自己的读写有保护，测试里只让本站的 key 抛。
- 保存简报时算实体这条路只在 staging 上跑过一次整链路（运行 `cron-brief-1791403224409`，判定绿，$0.34：25 块里 24 块在保存时就写上了实体）。
- 实体页的内容让不让人觉得对没有机器裁判：一半成员这条线、门槛 5、媒体名的表都是看分布定的，没有量过误报与漏报。
- 实体页上的关注按钮、从一个实体页点到另一个实体页（同一路径只换查询串）只在本机的浏览器测试里跑过前者，后者没有测（fixture 里只有一个过门槛的实体）。
- 读者页的导航栏在窄屏上本来就比屏幕宽（无头 Chromium、没有加载网络字体时量的：375px 宽的屏上这一行 516px），加了 Following 之后是 579px；地图首页的导航改成了折行。真机上长什么样没有看过。
