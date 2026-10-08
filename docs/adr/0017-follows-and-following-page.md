# ADR 0017：关注与 Following 页——关注项只记在读者的浏览器里

- 状态：已采纳，2026-10-08
- 日期：2026-10-08
- 相关：`apps/frontend/src/lib/follows.ts`（浏览器里的存取）、`apps/frontend/src/pages/following.vue`、`apps/backend/src/lib/reader/following-blocks.ts`、`packages/contracts/src/reader-following.ts`；国家归属见 ADR 0015，实体见 ADR 0018

## 背景

读者要能只看自己关心的新块。用户定：国家、实体、线索可关注，主题不可（太宽，关注了等于整份简报）；没有账号，关注项存浏览器本地；单独一个 Following 页，不动地图首页的内容；只在读者自己打开网站时生效，不主动通知。

## 决定

关注项（国家、线索）只记在读者的浏览器里，没有账号、没有新表。`GET /reader/following?countries&threads&limit&offset`（`lib/reader/following-blocks.ts`）
每次由前端把关注项带上来，返回命中任一关注项的已发布块，最新的在前。

- **关注一个国家 = 落点在该国的块 + 涉及该国的块**（块上的 `placement_country` 与 `mention_countries`，同国家页）；每块带 `matches`，涉及的那种标 `via: mention`，页面上写 Involves。
  关注一条线索 = 所属故事并进这条线索（`brief_stories.story_cluster_id`）的块。几个关注项取并集，一块只出现一次。
- **关注项放在查询串里**（逗号分隔，前端转发前去重、排序，同一组关注项是同一条请求）：每类最多 100 个，超过回 400。不在地点归一表里的国家代码略过而不是报错——读者本地存的关注项可能比表旧。
- **浏览器里存两样**（`apps/frontend/src/lib/follows.ts`）：`meridian-follows`（关注项的数组；线索的标题在关注时记一份，显示以后端带回的最新标题为准）与
  `meridian-following-last-visit`（上次打开 Following 页的时刻）。读写都包着 try/catch：读不到、不是合法 JSON、条目形状不对都按没有算，写不进去时关注只在这次会话里生效。
- **new 标记**：块所属那一期的生成时刻（`reports.created_at`，块的对外形状里只有它）严格晚于上次访问才标；第一次来一律不标（否则整页都是 new）。
  块取回来才记一次访问（没有关注项时打开即记），所以刷新后标记消失；取数失败的那次不算——读者什么都没看到，记了的话那些块下次就不再标 new。页面开着的时候增减关注项不影响已标的。
- Following 页的数据在浏览器里取（服务端不知道关注了什么），服务端只渲染外壳。实体的关注见 ADR 0018。
- staging 库上的读数（457 块）：关注伊朗得 31 块（落点 6、涉及 25），与库里直接数的一致，每块的归属都含伊朗；关注线索 2177 得 25 块，与库里一致；两者并集 56 块；
  把一期的 `published_at` 临时置空，它的块随即消失，放回后恢复。线索 2177 出现在 40 期里，但有块的只有回填过的 18 期——关注一条老线索，Following 页上只看得到 09-20 之后的块。

## 没验证的

- 关注与 Following 页的交互（点关注、刷新后仍在、new 标记的边界）只在本机的浏览器测试里跑过，staging 上只验了接口与页面能打开，没有在真浏览器里点过。
- localStorage 一读就抛的浏览器（禁用站点数据）里整个站点起不来：`@nuxtjs/color-mode` 与 `nuxt-auth-utils` 读它没有保护，这在关注功能之前就是这样。关注自己的读写有保护，测试里只让本站的 key 抛。
- 读者页的导航栏在窄屏上本来就比屏幕宽（无头 Chromium、没有加载网络字体时量的：375px 宽的屏上这一行 516px），加了 Following 之后是 579px；地图首页的导航改成了折行。真机上长什么样没有看过。
