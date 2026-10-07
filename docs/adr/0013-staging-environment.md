# ADR 0013：Staging 环境——数据是生产库的分支、Staging 运行走 cron 那条路、ml-service 共用生产

- 状态：已采纳，2026-10-07
- 日期：2026-10-07
- 相关：`apps/backend/wrangler.jsonc` 与 `services/meridian-ai-worker/wrangler.toml` 的 staging 段、根 `wrangler.toml` 的 preview 段、
  `scripts/check-staging-isolation.mjs`、`scripts/staging-run.mjs`（拷正文在 `scripts/staging-copy-bodies.mjs`，判定记录在 `scripts/staging-verdicts.mjs`）、`scripts/deploy.sh`；术语在 `GLOSSARY.md`「运维台」的「Staging 运行」；
  spec 与票在本地 `.scratch/staging-env/`（不入库，本文是它们的入库结论）

## 背景

三个 worker 只有生产一套配置，本地 dev 直连生产的 R2。改了 prompt 或 workflow 之后，唯一的整链路验证是部署到生产、
等当晚的生产运行跑完；坏了的成稿读者直接看到。每天只有一次生产运行、一份简报，没法按流量灰度。
调试用的手动运行也写进生产的库与 bucket（ADR 0011 因此规定运维台不算它们）。

## 决定

1. **两个用途**：上线前验证（跑一次 Staging 运行），和调试的落脚处（手动运行改在 staging 上做）。
   上线前验证只用于大的功能或架构变更；小改动直接部署生产（每个改动都走会拖慢开发，用户 2026-10-07 定）。
2. **隔离的边界**。staging 有自己的一份：backend 与 ai-worker 两个 worker、Postgres（Neon 分支 `staging`）、Hyperdrive、
   R2 bucket、队列与 DLQ、workflow 名、Durable Object namespace、AI Gateway（`meridian-ai`，生产是 `meridian-gateway`）、
   后台 token。前端用 Pages 的 preview 环境（分支 `staging`），不建第二个项目。
3. **ml-service 共用生产**。它不存数据，共用不破坏隔离；独立一份要再推一个 470MB 的镜像。
   两个限制：聚类或 embedding 的改动在 staging 验不了；同时改 backend 与 ml-service 之间接口的改动也验不了
   （staging 的新 backend 调到的是生产的旧 ml-service）。出现这两种情况时再补。
4. **数据是生产库的分支，每次 Staging 运行前 reset**。staging 不抓取（Durable Object 不初始化、没有 cron）。
   Neon 分支是写时复制的快照，reset 一次就拿到生产最新的文章、分析结果与事件追踪状态。
   文章正文不在库里：简报 workflow 严格从 R2 取正文、取不到不回退，所以 reset 之后还要把近两天文章的正文从生产 bucket 拷到
   staging bucket（`scripts/staging-copy-bodies.mjs` 经 Cloudflare REST 拷，只读生产、只写 staging，已有的跳过；REST 有限速，
   头一次拷一两千篇要几分钟）。没给 staging 的 worker 配生产 bucket 的 binding 来省掉这一步：binding 没有只读的，配了就破了决定 6。
   最初的设计以为不用拷，第一次 Staging 运行在聚类处报 `Dataset is empty` 才发现。
   拷完对 staging 库跑一次 migrate，被测分支带的 migration 因此先在生产数据的副本上跑过。
   代价：之前的 Staging 运行从 staging 的读者页与运维台消失（各次运行在 bucket 里的详细记录不受影响）；
   staging 运维台的 Trends 显示的是生产的历史。调试时可以跳过 reset，在同一份数据上连跑。
5. **Staging 运行走 cron 那条路**。成稿只在 `triggeredBy` 是 cron 时发布，运维台只按 `cron-brief-` 前缀认生产运行（ADR 0011 决定 4）。
   要验的正是这条路，所以 staging 有一个需后台 token 的入口，内部调 cron 用的同一个触发函数。
   这个入口只在 `ENVIRONMENT` 是 `staging` 时存在，生产上回 404——否则生产上的手动运行能冒充生产运行，绕过「按触发方式认定」。
   生产上原有的手动运行入口不动：定时触发失败后的补救要靠它。
6. **隔离靠检查脚本，不靠人看**。wrangler 的 binding 不继承，staging 漏配一项是 undefined 报错，不会落到生产；
   会漏到生产的只有把生产的资源名或 id 抄进 staging 段。`scripts/check-staging-isolation.mjs` 挂在 `pnpm typecheck` 里，断言：
   staging 段里任何位置的字符串值都不等于生产的 worker 名或任一资源标识（Hyperdrive id、bucket、队列、DLQ、workflow 名、service 名；
   不分类别、不分大小写——把生产队列名填进 staging 的 DLQ 也算），唯一放行的是 `ML_SERVICE` 指向 `meridian-ml-service`；
   staging 没有 cron；backend 的 `ENVIRONMENT` 两边取值正确（ai-worker 没有代码读它，不设）；ai-worker 的 staging 不走生产的 AI Gateway。
   配置不自己解析：让 wrangler 把同一份文件按生产和 staging 各读一遍，比的是它真正会部署出去的两份结果。
   （第一版手写了 TOML 与 JSONC 的解析，审查复现出 7 种漏过去的写法，如单引号写生产 bucket 名，所以换掉了。）
   它管的是两个 worker 的配置。管不到的一处：`.staging.env` 里拷正文用的 Cloudflare token 能读写账户下所有 bucket，
   「只读生产、只写 staging」靠 `scripts/staging-copy-bodies.mjs` 里写死的两个 bucket 名保证。
7. **机器判流水线健康，人读成稿**。`scripts/staging-run.mjs` 跑完后读这次运行在运维台里已有的标记，不另写判据：
   失败或没选出新闻 → 红，命令非零退出；降级、慢、贵 → 黄，通过并打印；`late`（按日历的判据）忽略。
   成稿质量在 staging 读者页上读。运行的终态先写、汇总后写（隔几十秒），「贵」要看汇总，所以脚本到终态后再等汇总最多 5 分钟。
   轮询中途断了（连续 5 次拿不到回答）不记判定，用 `--attach <运行 id>` 接上。
8. **部署生产时提醒，不拦**。`scripts/deploy.sh` 部署生产的 backend 或 ai-worker 时，查当前提交有没有一次通过的 Staging 运行
   （两个 worker 当时部署的都是这个提交、不 dirty；同一提交跑过多次看最近一次），没有就打印警告，照常部署。硬拦会在紧急回滚时挡路；ml-service 不查，它本来就过不了 staging。
9. **判定记录放本机**（`.staging-verdicts.jsonl`，gitignored）。它不能放 staging 的库，库每次运行前被重置；
   放 bucket 要给脚本加写 R2 的路。单人单机维护，本机文件够用；换机器不带过去，第一次部署会多看到一次提醒。
10. **staging 的网页公开、不加登录**，每个页面有 STAGING 横幅并声明不让搜索引擎收录。读者数据接口与生产一样要后台 token，
    公开的只有网页本身。

## 已知的限制

- **reset 会把生产库里 RUNNING 的运行记录一起带过来**。cron 的并发保护只认「两小时内有 RUNNING 的行」，所以在生产运行进行中
  （北京时间 21:00 后约半小时）reset，或生产有一次崩掉没回写终态的运行时，staging 的触发会回 409，挡着的是一个在 staging 永远不会结束的 id。
  等生产那次跑完再 reset。
- **只拷近两天的正文**。在 staging 上做手动运行、指定更早的日期或文章时取不到正文，先用 `--body-days N` 多拷几天。
- 拷正文、reset、migrate 这三步没有自动化测试，只在真跑时验过。

## 没做的

- ml-service 的 staging 容器（见决定 3）。
- staging 上的抓取与文章处理链路：binding 都配了，但不初始化 Durable Object、不往队列发消息。
- CI 自动部署 staging、PR 自动跑 Staging 运行、没过 staging 不许部署生产的硬拦。
- 运维台 Cost 页与 Worker 报错数在 staging 下的读数：它们按生产的脚本名查 Cloudflare 用量，staging 的 backend 没有放 `CF_ANALYTICS_TOKEN`，这些面板显示 unavailable。
- 本地 dev 仍直连生产的 R2。
