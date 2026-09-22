# 抓取/解析正确率 — 开放编码 rubric（grounded，源自真实数据 n=6 精读 + 80 元数据）

判的是:**Readability 从抓到的页面抽出的"正文"——是真文章正文,还是抓取/解析失败的产物?**
真相只看 content 本身(blind:不看 pipeline 的 content_quality 标)。

## 三大类 + 子类

### A. REAL_ARTICLE(真正文,抽取成功)
有实质文章/博客 prose(叙述/报道/论证)。允许尾部挂少量 boilerplate(视频条/订阅语),只要主体是真正文。技术博客/个人博客算 REAL(只要是真内容)。

### B. EXTRACTION_FAILURE(抓取/解析失败,正文≈没拿到)— is_extraction_failure=true
内容主体不是文章正文,而是:
- `BLOCK_PAGE` — 反爬/403:"You don't have permission""Access Denied""are you a robot""Reference #...edgesuite"
- `PAYWALL_LOGIN` — 登录/订阅墙:"Log in or sign up to view""subscribe to read"
- `RATE_LIMIT` — "Rate limit""429""too many requests"
- `VIDEO_STUB` — 视频页只剩播放器文案:"To display this content from YouTube""enable advertisement tracking""Cover image ©"+时间戳,无正文
- `SITE_BOILERPLATE` — 只有站点 chrome:捐款条("Please Don't Scroll Past This")、cookie 墙、纯导航
- `NON_ARTICLE` — 根本非新闻页:商店/活动流/字谜/菜单清单/代码仓 PR/setup 文档/URL slug 当标题
- `TRUNCATED_STUB` — 真内容但被砍成极短 teaser(几句就断,非完整文章)

### C. LOW_NEWS_VALUE(真文本,低新闻值)— is_extraction_failure=false
抽取成功、是完整真 prose,但**新闻价值低**:论坛/HN 评论/个人观点 rant、榜单 listicle、社媒贴、互动小游戏式报道。**这不是抓取错误**,是内容选择问题,单列。

## 判别要点(从精读得出)
- **核心判据 = "有没有实质新闻/文章正文"**,不是"有没有 boilerplate"(真文章尾部也常挂视频/订阅条)。
- 短(<500字符)且全是错误/导航/播放器文案 → B。
- 长、是连贯报道/论证 → A 或 C(看新闻值)。
- 标题=域名("reuters.com""nytimes.com")或墙提示 → 强烈 B 信号(Readability 退化成 site_name)。
- france24 `/video/` 或纯 slug URL、politico `/live-updates/` → 常 B(视频/直播流无静态正文)。

## 输出(每条)
{id, gold_category(A/B-子类/C), is_extraction_failure(bool), note(一句:看到什么)}
独立于 pipeline 的 content_quality —— 之后用本金标反过来量 pipeline 门判得准不准。
