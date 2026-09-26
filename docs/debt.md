# 技术债

来源：2026-09-23 模块耦合梳理（commit `536faa8`，静态读代码，未跑运行时追踪）。
每条待裁决：**修 / 接受（写明理由）/ 延后（写明触发条件）**。裁决后在条目下补一行「裁决」并注明日期，不删条目。

已顺手处理（不在下表）：删 ML 服务打印 token 的两行、删 backend 未使用的 `AI` binding 与 `@cloudflare/ai` 依赖、删无调用方的 `MLService` / `analyzeArticleClusters`。

---

## 需要动手的安全后续

### S1. ML 服务 token 已进过日志
- 现象：`services/meridian-ml-service/src/dependencies.py` 曾在每次请求 `print` 收到的 token **和服务端配置的 `settings.api_token`**。代码已删，但历史日志里已有明文。
- 待办：重新部署 ml-service（容器镜像）后轮换 `API_TOKEN`（ml cf-worker）与 `MERIDIAN_ML_SERVICE_API_KEY`（backend），两边同步。
- 待裁决：何时轮换；是否需要清理旧日志。
- 裁决（2026-09-26）：随 D3 结掉，不轮换、不清旧日志。ml Worker 关了公网口（`workers_dev`/`preview_urls` 均 false），token 校验与两边的 secret 整条删除，泄露的值已不能认证任何东西。旧日志没核实是否已过期（Workers Logs 最多保留 7 天）。

---

## 架构 / 耦合

### D1. AutoBrief 工作流单文件 2053 行（2026-09-25）
- 位置：`apps/backend/src/workflows/auto-brief-generation.ts`，17 个 `step.do`，触及 pg / R2 / ml / ai-worker 四类资源。
- 背景：CF Workflow 的 step 必须在同一个 `run()` 里编排，集中本身是平台形态；问题在于领域逻辑（数据集准备、聚类后处理、journey 统计）也内联在里面。
- 代价：改一处要读全文；难以单测单步逻辑。
- 选项：a) 只把 step 内的纯函数抽到 `lib/core/`，编排留原地；b) 维持现状。
- 待裁决：是否值得拆；若拆，是否只做 a。
- 裁决（2026-09-26）：选 a，已做。一期的输入（时间窗、取正文、质量门、同源去重、embeddings 读回）→ `lib/core/run-corpus.ts`；候选故事的下标、选中、分层、出块与文章去向 → `lib/core/story-ledger.ts`（一个 storyId 贯穿全程，`any` 24→1）；保存简报 → `lib/save-brief-report.ts`（与 `brief_runs.report_id` 同事务、重试幂等）。step 名与边界不变，replay 零差异。文件 2053 → 1685 行，剩下的是编排与观测。

### D2. frontend 直连数据库、原生 SQL 绕过类型
- 位置：`apps/frontend/src/server/**`，19 处 `` sql` `` 原生 SQL，join `brief_stories` / `story_clusters` / `reports`；连接走 `NUXT_DATABASE_URL`，不经 Hyperdrive，也不经 backend 的 `/reports`（该路由已于 2026-09-24 删除，选 b 需新建接口）。
- 代价：表结构事实上成为对外 API；改列名时 typecheck（项目唯一验收门）抓不住原生 SQL。
- 选项：a) 改用 drizzle 查询构造器，让改列名能被 typecheck 捕获；b) 走 backend API；c) 接受，改 schema 时人工 grep frontend。
- 待裁决：选哪条。
- 裁决（2026-09-26）：选 b，已解决。读者页与后台源页面的查询搬到 backend 的 `apps/backend/src/lib/reader/`（`/reader/*`、`GET /admin/sources*`），
  CTE / LATERAL 仍是原生 SQL，但表名列名走 drizzle 的表 / 列对象，改列名 typecheck 能拦住；前端去掉 `@meridian/database` 依赖与 `NUXT_DATABASE_URL`。

### D3. backend → ML 服务走公网 URL
- 位置：`MERIDIAN_ML_SERVICE_URL = https://meridian-ml-service.swj299792458.workers.dev`（`apps/backend/wrangler.jsonc`），调用见 `lib/services/ml-service.ts`（2026-09-26 起 ML 调用只在这一个客户端里）。
- 代价：多一跳公网；需自管 token（见 S1）；`*.workers.dev` 在国内会被 RST（影响本地开发）。
- 选项：改为 service binding（ml cf-worker 已是 Worker，可直接绑）。
- 待裁决：是否迁；迁后是否仍保留 token 校验。
- 裁决（2026-09-26）：迁，已解决；token 删除。backend 经 service binding `ML_SERVICE`（HTTP fetch 形式）调 ml Worker，删 `MERIDIAN_ML_SERVICE_URL`；ml Worker 设 `workers_dev: false` + `preview_urls: false`，FastAPI 删 `verify_token`（做法同 ai-worker）。部署后的镜像核对只靠 `scripts/check-container-deploy.sh` 与每期聚类的 `buildIdentityCheck`，不加转发 `/health` 的路由。本地 dev / replay 由 `services/meridian-ml-service/dev-shim/` 顶替 ml Worker。分三次部署：backend 带 token 切 binding → ml 删校验并关公网口 → backend 删 token；最后删两边 secret。

### D4. ai-worker 用 `(env as any)` 访问 binding
- 位置（2026-09-25）：`services/meridian-ai-worker/src/services/llm-call-logger.ts:82`、`sensor-log.ts:28`（`ARTICLES_BUCKET` ×2）；`span-log.ts` 与 `CF_VERSION_METADATA` 已删。
- 根因：`CloudflareEnv extends Record<string, string | undefined>`（`src/types.ts`），索引签名只允许 string，非字符串 binding 无法声明，只能 cast。`ai-gateway.ts:33,86` 的 `env.AI` 也是同一原因。
- 代价：binding 改名或删除后 typecheck 全绿，日志静默写不进去。
- 选项：去掉索引签名、显式声明 binding（需排查所有 `env[动态 key]` 用法）；或改用 `wrangler types` 生成的 `Env`。
- 待裁决：是否修、修到哪一层。
- 裁决（2026-09-26）：修，手写显式类型（不上 `wrangler types`）。`CloudflareEnv` 改为 `{ AI: Ai; ARTICLES_BUCKET?: R2Bucket }`（`src/types.ts`），全仓 `env.` 用法只有这两个 binding、没有字符串 vars、没有 `env[动态 key]`；两处 `(env as any)` 已删，读不存在的 binding 现在 typecheck 报错。

### D5. 单厂商依赖（只有 Workers AI）
- 位置：`services/meridian-ai-worker/src/services/call-llm.ts` `PHASE_DEFAULTS`，简报链路全部 phase 用 `@cf/zai-org/glm-4.7-flash`（文章分析 qwen3 → glm 两档，仍同一厂商），无跨厂商兜底；2026-09-24 起 AI Gateway 通道与 DashScope 已删，要接非 CF 厂商经 CF AI Gateway 重接。
- 背景：2026-08-12 从 DashScope 迁来就是为了摆脱凭证依赖（见文件内注释），属有意取舍。
- 代价：Workers AI 或该模型不可用时整份简报出不来。
- 待裁决：接受，还是给简报关键 phase 加兜底。

---

## 命名 / 死代码
- 裁决（2026-09-26）：接受，暂不加跨厂商兜底。迁到 Workers AI 本就是为了摆脱外部凭证（DashScope key 失效曾让管线静默停摆 12 天）；加兜底等于把凭证风险请回来。触发条件：Workers AI 或 glm-4.7-flash 真出现导致整期简报失败的故障。

### D6. `AIWorkerService.generateEmbedding` 实际不调 ai-worker
- 位置：`apps/backend/src/lib/services/ai-services.ts:112`，实际请求 ML `/embeddings`。
- 选项：把方法移到 ML 客户端（`clustering.ts` 的 `ClusteringService` 旁）或改名。
- 待裁决：是否改。
- 裁决（2026-09-26）：移。`generateEmbedding` 与聚类合成唯一的 ML 客户端 `apps/backend/src/lib/services/ml-service.ts`（`createMLService`），传输只写一处，两个方法都返回 `ServiceResult<T>`；`clustering.ts` 已并入该文件。

### D7. binding 名 `MY_WORKFLOW`
- 位置：`apps/backend/wrangler.jsonc`，对应 `auto_brief_generation`。
- 选项：改为 `AUTO_BRIEF` 之类；只改 binding 名，不改 workflow 名，不影响已有实例。
- 待裁决：是否改。
- 裁决（2026-09-26）：已改为 `AUTO_BRIEF`。只改 binding 名，workflow 名 `auto_brief_generation` 与已有实例不受影响。

### D8. `articleAnalysisSchema` 两处各写一份
- 位置：`apps/backend/src/prompts/articleAnalysis.prompt.ts` 与 `services/meridian-ai-worker/src/prompts/articleAnalysis.ts`；backend 那份只给 `lib/core/utils.ts` 的 `generateSearchText` 当类型用。当前字段一致。
- 选项：抽到共享包；或 backend 只保留类型。
- 待裁决：是否合并。
- 裁决（2026-09-26）：合并到共享包 `@meridian/contracts`（`packages/contracts`）。实际有 3 份（另一份手抄在 `processArticles.workflow.ts`），现只剩一份：ai-worker 用它 safeParse，backend 只取类型；backend 的 `prompts/articleAnalysis.prompt.ts` 已删。

### D9. `/meridian/intelligence/analyze-single-story` 无调用方
- 位置：`services/meridian-ai-worker/src/index.ts:261`。
- 牵连：删它会连带 `services/intelligence.ts`（529 行）、`prompts/intelligenceAnalysis.ts`、`utils/intelligence-report-builder.ts`、`types/intelligence-types.ts` 的部分内容，以及 `PHASE_DEFAULTS` 里的 `intelligence_analysis` / `intel_grounding_verify` 等 phase；本地原型 `apps/backend/prototypes/intel-*` 仍 import 其 prompt。
- 待裁决：整条旧情报链路是否正式退役（需对照 ADR 0003/0004 确认没有回退需要）。

- 裁决（2026-09-23）：退役并删除。依据：9-22 的 `6068038` 已删 backend 客户端与工作流接线，留在 ai-worker 的这一侧已无法用于回滚，真要回滚只能 git revert；v6 上线后生产 4/4 次 COMPLETED（9–18 分钟，旧链路 26–60 分钟）。已删：端点、`services/intelligence.ts`、`prompts/intelligenceAnalysis.ts`、`utils/intelligence-report-builder.ts`、`types/intelligence-types.ts`、因此失去调用方的 `utils/ai-response-parser.ts`、phase `intelligence_analysis` / `intel_grounding_verify`、sensor kind `intel_parse`、backend `perStoryIntelStepConfig`；ROADMAP 的 P1 移入「已作废的路线」。本地原型 `prototypes/intel-*` 因此无法运行，需要时从 git 历史取回。

### D10. ML `/clustering/auto` 只有测试在用
- 位置：`services/meridian-ml-service/src/main.py:318`，调用方仅 `services/meridian-ml-service/test/*`。backend 侧客户端已删。
- 待裁决：删端点连同测试，还是保留作手工调试口。

- 裁决（2026-09-23）：已解决，删除。连同删掉的还有同样无调用方的 `GET /`、`/metrics`、`/config`，整个 `test/` 目录（8 个手动脚本，未接入任何 runner，其中 3 个调用的路由早已不存在），以及 vulture 核实过的死代码与恒为 null/空的响应字段（`optimization_result`、`clustering_stats.silhouette_score`、`clusters[].keywords` / `summary`）。现存路由只剩 backend 在用的 `GET /health`、`POST /embeddings`、`POST /ai-worker/clustering`。

- 进展（2026-09-24）：`test/` 已重建，现只有 `/ai-worker/clustering` 的 golden 快照测试（`bfbd43c`）。

### D11. 过时文档 `apps/backend/docs/clustering-service-usage.md`
- 现象：通篇介绍已删的 `analyzeArticleClusters` / `MLService` 与不存在的 `MockClusteringService`。
- 待裁决：删除，还是按现行 `ClusteringService` 重写。
- **已结（2026-09-24）**：删除。聚类契约以 `apps/backend/src/lib/services/clustering.ts` 为准（2026-09-26 起该文件并入 `ml-service.ts`）。

### D12. knip 的盲区
- 现象：knip 看不到 wrangler binding 与 HTTP 路由，所以 D9、D10 以及已删的 `AI` binding 都没被上一轮死代码清理发现。
- 选项：写一个脚本比对 `wrangler.*` binding 与 `env.<NAME>` 使用、比对路由与调用方（按「机制优先于 prose」）。
- 待裁决：是否值得做。
- 裁决（2026-09-26）：延后。binding 比对可以写脚本，但路由有没有真实调用方判不了，收益有限；清理仍按入口可达性人工追。触发条件：再出现一次 binding 或配置项死了很久才被发现。

### D13. 报告层退役后遗留的无效读数与死配置（退役前就已存在）
- `brief_runs.intelligence_analyses`：v6 上线后每次仍写 25，实际已没有情报分析这一步，读数有误导性。
- `apps/backend/src/routers/observability.ts:786` 读取 `stepBreakdown['intelligence_analysis']`，该 step 已不再产生，取到的恒为空。
- ai-worker `PHASE_DEFAULTS` / `LLMCallPhase` 中 `story_validation`、`story_merge` 无调用方；`SensorKind` 中 `story_validation_parse` 无调用方。
- 待裁决：字段改名或弃用、删读取点、删死 phase。

- 进展（2026-09-24）：第二条的读取点随 `a311349` 删无调用方的 observability 路由一并消失。`intelligence_analyses` 现写的是出了块的故事数（`writtenBlocks.length`），不再恒为 25，但字段名仍误导；死 phase 与 `story_validation_parse` 仍在。
- 进展（2026-09-24）：死 phase `story_validation` / `story_merge` / `faithfulness_check` / `faithfulness_revise` 与死 SensorKind `brief_hygiene` / `story_validation_parse` 已删。剩：`intelligence_analyses` 字段名、workflow 里 `logStep('story_validation', …)` 的 step 标签名（改名会断开历史观测数据的连续性）。
- 裁决（2026-09-24）：`logStep('story_validation', …)` 的 step 标签**不改名**——它是历史观测数据的查询键，改名换来的只是名字好看，代价是新旧 run 无法按同一键对比。剩：`intelligence_analyses` 字段名。
- 裁决（2026-09-24）：`intelligence_analyses` 字段名**暂不改**（要做 migration）。读它时按「出了块的故事数」理解。

### D14. ai-worker 文档大面积过时
- `services/meridian-ai-worker/README.md` 仍列出已不存在的 `/meridian/story/validate`、`/analyze-stories`、`/generate-final-brief` 及 `StoryValidationService`；`docs/quota-limit-handling.md` 通篇以已删的 `IntelligenceService` 为例；`docs/ARCHITECTURE.md` 的服务列表同样过时。本次只删了直接指向已删代码的行。
- 进展：`services/meridian-ai-worker/docs/` 11 份文档经逐份核对全部过时，已整目录删除。
- 待裁决：README 正文（架构图、端点表、环境变量、npm 命令）按现状重写，还是删减到只剩指路。
- **已结（2026-09-24）**：README 已按现行代码重写（当时 9 条路由、2026-09-24 删 tldr 端点后 8 条，`callLLM(phase)`、实际读取的 env、pnpm / wrangler@4.120.0 命令）。

---

## 验收门本身

### G1. frontend typecheck 本来就是红的
- 现象：`apps/frontend/nuxt.config.ts(98,21): error TS2322: Type 'Plugin<any>[]' is not assignable to type 'PluginOption'`，在干净的 `536faa8` 上即失败，所以 `pnpm typecheck` 整体退出码为 1。
- 代价：门常红，就会被习惯性忽略。
- 待裁决：修掉（大概率是 vite 插件类型版本不一致）。
- 进展（2026-09-25）：根因确认是 node_modules 里有多组 vite 6.2.6 的 peer 变体（jiti / yaml 版本不同），nuxt 与
  `@tailwindcss/vite` 各链到一组。lock 经 `pnpm dedupe` 后 `pnpm install --frozen-lockfile` 重装，nuxt typecheck 为 0；
  但**增量** `pnpm add / remove` 后 node_modules 可能再链错、又红——遇到就 `pnpm install --frozen-lockfile` 重装。
  根治（让依赖图里只有一组 vite 变体，或在 nuxt.config 处理插件类型）未做。
- 裁决（2026-09-26）：延后根治。现在绿；再红时先 `pnpm install --frozen-lockfile`，同一季度第二次红再根治（依赖图收成一组 vite）。

### G2. `apps/backend/worker-configuration.d.ts` 与当前 wrangler 严重漂移
- 现象：跑 `wrangler types` 会改动约 1.3 万行（runtime 类型版本变化），本次只手删了 `AI: Ai;` 一行。
- 待裁决：是否单独提交一次重新生成（需确认新类型下 typecheck 仍绿）。
