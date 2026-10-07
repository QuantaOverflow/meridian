---
paths:
  - "apps/backend/**"
  - "services/meridian-ai-worker/**"
---

# Workers 硬规矩（backend + ai-worker）

## 1. 本地验证

- **ai-worker 单端点**：`cd services/meridian-ai-worker && pnpm wrangler dev --port 8787`，
  curl 打 `/meridian/<endpoint>`。本目录 `wrangler` 依赖 `^4.141.0`（remote R2 binding 需要 `>= 4.37`）。
- **backend + ai-worker 联调**：单条命令多 `-c`，两个分开的 `wrangler dev` 进程不会自动互连，
  service binding 名是 `AI_WORKER`：
  `pnpm wrangler dev -c apps/backend/wrangler.jsonc -c services/meridian-ai-worker/wrangler.toml`。
  backend 配置文件是 `.jsonc` 不是 `.toml`，两种格式混用没问题。
- **backend 调 ML（binding `ML_SERVICE`）**：本地没有 Container，先起 uvicorn（:8081，见
  `services/meridian-ml-service/README.md`「本地开发」），再多加一个
  `-c services/meridian-ml-service/dev-shim/wrangler.jsonc`（同名 Worker `meridian-ml-service`，原样转发到 uvicorn）。
  没加时启动输出里 `env.ML_SERVICE` 是 `[not connected]`，ML 调用直接报错。
- **R2 是生产桶，不是模拟桶**：`apps/backend/wrangler.jsonc` 与 `services/meridian-ai-worker/wrangler.toml`
  的 `r2_buckets` 都写了 `remote: true`（bucket 是 `meridian-articles-prod`）。本地 `wrangler dev`
  **直连生产 R2**，本地写入会落进生产桶——调观测/日志类写入前先看第 3 节的 `x-observe: inline`。
- **浏览器抓取也是真实的**：backend 的 `browser` binding（`BROWSER`）同样 `remote: true`（`quickAction` 没有本地模拟），
  本地触发浏览器降级会产生真实 Browser Run 用量。测试里给 `env.BROWSER` 塞按 Response 契约回包的假对象
  （`apps/backend/test/lib/article-fetchers.spec.ts`），不连真服务。
- **本地整期跑完先看取正文失败数**：远程 R2 在本机并发高峰会被 loadShed，`fetchBody` 记 `R2_FETCH_ERROR`、只打 warn，
  文章被静默丢出这期语料（2026-09 实测高峰那小时失败近半）。本地 e2e / 手动整期跑完，看日志
  `[AutoBrief] 并行获取文章内容完成 ... 取正文失败 N 篇`：**N > 0 这次读数作废**，降并发或重跑，不拿缺文章的语料下结论。replay 用本地模拟桶，不受此影响。
- **Workflow 本地触发**：`curl -X POST http://localhost:8787/admin/briefs/generate -H 'Authorization: Bearer <API_TOKEN>'`，
  或 `wrangler workflows instances list <WORKFLOW_NAME>` 查实例状态。
- **typecheck 坑 1**：`pnpm typecheck` 走 turbo 整包缓存，显示 `FULL TURBO` 等于没验；要验证就进包内直接跑
  `./node_modules/.bin/tsc --noEmit`，并做反向对照（塞个类型错确认会红）。
- **typecheck 坑 2**：backend 的 pnpm 包名是 `@meridian/backend`（见 `apps/backend/package.json`），
  写成 `meridian-backend` 时 `pnpm -F` 判定「未匹配项目」并静默退出 0。

## 2. Workflow

- **长 fan-out 每项一个 step**：CF 平台约 2% 的 invocation 会被 canceled，挤进一个 step 等于一次抖动丢整期。
- **单 step 输出 ~1MB 上限**：大对象卸 R2、step 只回 key。已落地例子（`apps/backend/src/workflows/auto-brief-generation.ts`）：
  embeddings 卸 R2、brief-block-v6 每块只回写出的 3–5 句、不回切句表。
  新 step 要传大对象照此模式。
- **embedding 不在 ProcessArticles 逐篇算**：逐篇调 ml-service 会不断重置容器 `sleepAfter` 让它常驻，
  改到简报 workflow 聚类前批量补算（「补算 embedding 批次」step）。
- **历史遗留 step 名不改**：`logStep('story_validation', …)`
  现在记的是簇判定，沿用旧名——它是历史观测数据的查询键，改名换来的只是名字好看，代价是新旧 run
  无法按同一键对比（裁决见 `docs/debt.md` D13）。
- **已退役模块代码已删，别按旧文档找**：故事验证层/候选分组/storyline 两段式、情报报告层
  （逐故事情报分析→报告→写作层 v3）、b′ 分段写、RARR、覆盖对账。现行链路是「一簇 = 简报里一块」的 brief-block-v6。

## 3. 观测

- **新 step 用 `logStep` 包**（backend workflow 侧，`WorkflowObservability.logStep`，
  `apps/backend/src/lib/observability/index.ts`）。ai-worker 侧没有单独的 `traced()` helper——
  请求级观测靠 `observeMiddleware` 按 `AsyncLocalStorage` 自动挂（`services/meridian-ai-worker/src/services/observe.ts`）。
- **日志走 `Logger`，不写裸 `console.*`**：backend 用 `apps/backend/src/lib/core/logger.ts`，ai-worker 用
  `services/meridian-ai-worker/src/utils/logger.ts`（同形状的两份副本，不放 contracts）。一行一个扁平 JSON，
  键名表见根 README「Monitoring」的 Logs & traces；上下文里的错误字符串用 `error_message`，`error` 留给异常对象。
- **`logStep` 可在 step 外调用、重放安全**：它每次读 R2 已有指标再合并写回，workflow 重放时已记过的条目保留原样；
  别再往 `WorkflowObservability` 里加只存在内存、跨 step 累积的状态。
- **本地调 ai-worker 带 `x-observe: inline`**（不写 R2）：记录随响应 JSON 的 `observation` 字段带回，
  开发/验收脚本用。本地 `wrangler dev` 直连生产桶，不带这个头写了就是污染生产 R2
  （`services/meridian-ai-worker/src/services/observe.ts`）。
- **LLM 调用走 `callLLM`**（`services/meridian-ai-worker/src/services/call-llm.ts`），经 `loggedChat` 才会挂进 span / 落 `llm-calls/`。
  eslint 拦直接 import 底层 `chat()` / `dashScopeChat()` 与直接调 `env.AI.run`；豁免只有两处：eval 透传口 `/meridian/chat`（不记，理由写在 import 处），
  与句子向量的唯一入口 `services/meridian-ai-worker/src/services/embed-texts.ts`（向量调用套不进 chat，它自己记日志）。

## 4. LLM 调用

- **改 prompt**（`services/meridian-ai-worker/src/prompts/`）先跑 `eval/` 评估再合。
- **glm-4.7-flash 防复读**：生产写作调用（`brief_block_v6` phase）**特意不设 `frequency_penalty`**——
  实测加到 0.4 会导致窗口引用越界被拒、丢材料（`services/meridian-ai-worker/src/services/call-llm.ts` 的 `PHASE_DEFAULTS` 注释）。真正挡复读的是
  代码侧 `detectRepetition`（`services/meridian-ai-worker/src/services/brief-block-v6.ts`），新 phase 复读风险高时先接这个，
  不要默认加 `frequency_penalty`（2026-09-25 起 ai-worker 已不透传它，真要加得先在 `/meridian/chat` 与
  `ai-gateway.ts` 两处白名单接上）。
- **换模型必实测关闭 thinking 后正文落哪个字段**：`glm-*` 落 `content`，`qwen3-*` 落 `reasoning_content`
  且 `content` 恒为 null，两者不通用。单一真源 `services/meridian-ai-worker/src/config/thinking.ts`；
  接新 reasoning 模型先照这个方法实测再接白名单。
- **`json_schema` 约束式解码（Workers AI）**：已用于生产（`services/meridian-ai-worker/src/services/brief-block-v6.ts`）。返回 200 不代表关键字生效——
  `pattern` 曾被静默忽略、`minLength` 生效；逐模型支持情况官方不给列表（`services/meridian-ai-worker/src/services/call-llm.ts` 注释）。
  加之前必须挂不加约束的对照臂测主线召回，格式干净不等于内容没丢。
- **只有一条调用经 AI Gateway**：逐句核查配成 `one_call` 时走 DashScope（`services/meridian-ai-worker/src/services/dashscope.ts`，ADR 0012），
  每次都带 `cf-aig-skip-cache`——网关默认缓存会把同一句的多个核查 epoch 变成同一次回答。其余调用都是 `env.AI` binding 直连 Workers AI，
  不经网关。若怀疑样本不独立，先查是不是 `temperature` 传错（曾有 `|| 0.7` 吞掉 `0` 的先例）。
- **写作的复读检测别接到核查回复上**：`detectRepetition` 是给简报正文调的，核查回复逐部分抄原文，会被它误拒约 7%（ADR 0012 证伪清单）。
- **只在 Workers 生产才炸的两类 bug**（通用 Workers 运行时约束，非本仓当前已知故障）：
  模块级缓存不能持有 I/O 对象（socket/stream/body），只能缓存纯数据——backend 的 `getDb()`
  都在请求内新建（`apps/backend/src/lib/database/index.ts`），新代码别改成模块级缓存连接池；
  裸 `sql` 模板塞 `Date` 对象在 `nodejs_compat` 下会抛类型错，传参先 `.toISOString()`
  （仓内已有裸 sql 用法：`apps/backend/src/routers/events.router.ts`）。

## 5. 上线前验证：staging（ADR 0013）

- **大的功能或架构变更才走 staging，小改动直接部署生产**（用户 2026-10-07 定：每个改动都走会拖慢开发）。
  小改动——调 prompt 措辞、改阈值、修小 bug——照旧直接上，上线后读真实输出。拿不准算大还是小时问用户，不要自己默认走 staging。
- **怎么走**：两个 worker 各 `../../scripts/deploy.sh --env staging`，然后在仓库根 `node scripts/staging-run.mjs`。
  它先把 staging 的库重置成生产的最新副本、跑 migration、拷近两天的正文，再走 cron 那条路跑一次，按运维台的标记判红黄绿。
  绿或黄之后在 staging 读者页上读成稿（地址脚本会打印），再部署生产。
- **不带 `--env` 就是部署生产**。这时当前提交最近一次 Staging 运行没通过（或没跑过），脚本会提醒但不拦；小改动没走 staging 时看到这条提醒是正常的。
- **调试用的手动运行在 staging 上做**（`POST /admin/briefs/generate` 打 staging 的 backend），不写生产的库与 bucket。
  同一份数据上连跑用 `--no-reset`；要用两天以前的文章先 `--body-days N` 把正文拷过去。
- **staging 验不了的**：聚类与 embedding 的改动、backend 与 ml-service 之间接口的改动（ml-service 共用生产那一份）；抓取与文章处理链路（staging 不抓取）。这些仍只能上生产后看。
- **北京时间 21:00 后约半小时别跑**：重置会把生产那条 RUNNING 的运行记录带进 staging，触发回 409。
- **给 worker 加 binding 或变量，staging 段要跟着加**：wrangler 的 binding 与 `vars` 不继承，只写顶层的话 staging 上是 undefined，
  而本地测试与生产都是好的。加完跑 `wrangler deploy --dry-run --env staging` 看 binding 列表。
  staging 段里的资源名不得与生产相同，`scripts/check-staging-isolation.mjs`（在 `pnpm typecheck` 里）会拦。
- **轮询中途断了**（脚本退出但运行还在跑）：`node scripts/staging-run.mjs --attach <运行 id>` 接上，不要重新触发。
