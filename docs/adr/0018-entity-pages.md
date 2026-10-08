# ADR 0018：实体页——简报块上存实体，按原样的写法开页

- 状态：已采纳，2026-10-08
- 日期：2026-10-08
- 相关：`apps/backend/src/lib/core/block-entities.ts`（一块的实体怎么算、媒体名的表）、`apps/backend/src/lib/reader/entity-blocks.ts`（门槛与查询）、`packages/contracts/src/reader-entity.ts`、`apps/frontend/src/pages/entities/index.vue`；术语见 `GLOSSARY.md`「实体」

## 背景

读者要能看某个人物、机构或地名的全部简报块。文章分析给的关键实体是没有类型的字符串，写法很乱（staging 上近 30 天 4.8 万种写法，77% 只出现一次）。用户定：做，设门槛；能归成国家的写法跳国家页；写法只归一大小写与首尾空白，不合并别名，接受同一个人分成几页；媒体名剔掉；不加 LLM 归一的步骤。

## 决定

块多了两列：`entities`（实体归一后的写法，GIN 索引）与 `entity_names`（逐项对应的显示写法）。写块时按故事的成员文章的 `key_entities` 算好存下
（`lib/core/brief-blocks.ts` 的 `writeBriefBlocks` → `block-entities.ts`），保存简报与回填走同一份；回填脚本重跑即刷新。
接口三处（`lib/reader/entity-blocks.ts`、`following-blocks.ts`）：`GET /reader/entities/blocks?name&limit&offset`（实体页）、
`GET /reader/block-entities?ids`（一批块各自的实体链接）、`GET /reader/following` 多一个 `entities` 参数。

- **写法只归一大小写与首尾空白，不合并别名**（用户定）：`Volodymyr Zelenskyy`（11 块）与 `Volodymyr Zelensky`、`Flavio Bolsonaro`（6 块）与 `Flávio Bolsonaro`（5 块）各是各的。实体页上写明「按原样的名字匹配，别的拼法另列」。
  显示写法取各块存的写法里最常见的那种，同一个实体在实体页与各块下写法一致。
- **一块的实体 = 被至少一半成员文章提到的写法**。「任一成员提到」时顺带一提的名字太多：staging 的 457 块上，出现在 ≥3 块的写法 740 种；按一半算剩 153 种（含国家）。
  这个比例没有单独量过精度，是看分布定的。
- **能归成国家的写法不是实体**（用户定）：写块时就不存，它的块在国家页（块上的落点与涉及）。查这种写法时接口回 `{ kind: 'country', country }`，页面 302 到国家页。
  判定用地点归一表（`places.ts` 的 `countryOfEntity`），所以美国的州名、`Gaza`、`United Nations` 也按表归到对应的国家页。
- **媒体名不是实体**（用户定）：`block-entities.ts` 里一张写法表（生产近 30 天出现 6 篇以上的媒体写法加源池里的名字，约 80 个）。源表 `sources.name` 是 `BBC World News` 这种，对不上关键实体里的 `BBC`，所以没有用它。
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
- **块下的实体链接另开一个接口，没有加进块的对外形状**：`BriefBlock`（ADR 0014）定下后不为单个功能加字段。国家页、搜索、Following、实体页的前端 server 路由拿到块之后，
  按块号（去重、升序）问一次 `/reader/block-entities`，只列有实体页的实体。代价是每个列块的页多一趟到 backend 的往返。阅读页的实体链接见下面「实体页的入口」。
- **Following 支持关注实体**（ADR 0017 的 `FollowMatch` 多一种 `{ kind: 'entity', key, name }`，请求多一个 `entities` 参数）；原有的字段与取值没动。
  实体的写法里可以有逗号，所以不是逗号分隔，而是一个实体一个 `entities=` 参数。关注一个实体命中挂着它的全部块，不论它过没过门槛。
- **实体页的地址是 `/entities?name=…`**，写法放在查询串里：写法可以带斜杠（`Reuters/Ipsos` 这种），放进路径要靠 `%2F`，各层代理对它的处理不一致。
- staging 库上的读数（回填 18 期 432 块 + 当晚 Staging 运行那期 25 块）：过门槛的 43 个实体，存下的块数都等于不经存下的列、直接按成员文章原始 `key_entities` 重算的块数；
  抽 Donald Trump（103 块）、Kathy Hochul（7 块）、NATO（5 块）三页，每块都有至少一半成员文章的关键实体含它，Following 关注它命中的块数与实体页一致；
  `Iran`、`us` 回国家页，`CNN` 与差一块的 `chatgpt`（4 块）404；最新 60 块的实体链接恰是各块存下的实体里过门槛的那些；
  把一期的 `published_at` 临时置空，Donald Trump 从 103 块变成 92 块，放回后恢复。

### 实体页的入口

第一版的实体页只能从国家页、搜索页、Following 页、实体页列出的块下面点进去；每期的阅读页上没有实体链接，也没有列表页，正常读简报的读者碰不到它。补了三处：

- 阅读页每个简报块下列出它的实体。另开 `GET /reader/briefs/:id/block-entities`（按块在正文里的顺序），前端 `/api/briefs/:slug/entities` 把顺序换成块的锚点 id。它与正文分两条请求取：实体链接是正文之外的导航，取不到时正文照常、只是没有链接；地图首页共用的 `/api/briefs/latest` 也不用为它多一次往返。回填范围之外的往期没有块，所以没有链接。
- 实体列表页：`/entities` 不带写法时列出全部有实体页的实体（`GET /reader/entities`，块数多的在前）。门槛与显示写法和实体页同一处算。
- 导航栏加 Names。读者页的导航在窄屏上已经放不下，这一项只在宽屏显示；窄屏从搜索页顶部的链接进。地图首页的导航会折行，两种宽度都显示。

## 没验证的

- 保存简报时算实体这条路只在 staging 上跑过一次整链路（运行 `cron-brief-1791403224409`，判定绿，$0.34：25 块里 24 块在保存时就写上了实体）。
- 实体页的内容让不让人觉得对没有机器裁判：一半成员这条线、门槛 5、媒体名的表都是看分布定的，没有量过误报与漏报。
- 实体页上的关注按钮、从一个实体页点到另一个实体页（同一路径只换查询串）只在本机的浏览器测试里跑过前者，后者没有测（fixture 里只有一个过门槛的实体）。
- 媒体名的表是手写的，过期了没有任何读数会提醒；实体列表页（`/entities`）上出现媒体名时补表。
