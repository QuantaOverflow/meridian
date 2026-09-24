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

---

## 架构 / 耦合

### D1. AutoBrief 工作流单文件 2271 行
- 位置：`apps/backend/src/workflows/auto-brief-generation.ts`，17 个 `step.do`，触及 pg / R2 / ml / ai-worker 四类资源。
- 背景：CF Workflow 的 step 必须在同一个 `run()` 里编排，集中本身是平台形态；问题在于领域逻辑（数据集准备、聚类后处理、journey 统计）也内联在里面。
- 代价：改一处要读全文；难以单测单步逻辑。
- 选项：a) 只把 step 内的纯函数抽到 `lib/core/`，编排留原地；b) 维持现状。
- 待裁决：是否值得拆；若拆，是否只做 a。

### D2. frontend 直连数据库、原生 SQL 绕过类型
- 位置：`apps/frontend/src/server/**`，19 处 `` sql` `` 原生 SQL，join `brief_stories` / `story_clusters` / `reports`；连接走 `NUXT_DATABASE_URL`，不经 Hyperdrive，也不经 backend 的 `/reports`（该路由已于 2026-09-24 删除，选 b 需新建接口）。
- 代价：表结构事实上成为对外 API；改列名时 typecheck（项目唯一验收门）抓不住原生 SQL。
- 选项：a) 改用 drizzle 查询构造器，让改列名能被 typecheck 捕获；b) 走 backend API；c) 接受，改 schema 时人工 grep frontend。
- 待裁决：选哪条。

### D3. backend → ML 服务走公网 URL
- 位置：`MERIDIAN_ML_SERVICE_URL = https://meridian-ml-service.swj299792458.workers.dev`（`apps/backend/wrangler.jsonc`），调用见 `lib/services/ai-services.ts`、`lib/services/clustering.ts`。
- 代价：多一跳公网；需自管 token（见 S1）；`*.workers.dev` 在国内会被 RST（影响本地开发）。
- 选项：改为 service binding（ml cf-worker 已是 Worker，可直接绑）。
- 待裁决：是否迁；迁后是否仍保留 token 校验。

### D4. ai-worker 用 `(env as any)` 访问 binding
- 位置：`services/meridian-ai-worker/src/services/llm-call-logger.ts:92`、`sensor-log.ts:34`、`span-log.ts:68,99`（`ARTICLES_BUCKET` ×3、`CF_VERSION_METADATA` ×1）。
- 根因：`CloudflareEnv extends Record<string, string | undefined>`（`src/types.ts:491`），索引签名只允许 string，非字符串 binding 无法声明，只能 cast。`ai-gateway.ts:88,685` 的 `env.AI` 也是同一原因。
- 代价：binding 改名或删除后 typecheck 全绿，日志静默写不进去。
- 选项：去掉索引签名、显式声明 binding（需排查所有 `env[动态 key]` 用法）；或改用 `wrangler types` 生成的 `Env`。
- 待裁决：是否修、修到哪一层。

### D5. 单模型、单网关依赖
- 位置：`services/meridian-ai-worker/src/services/call-llm.ts` `PHASE_DEFAULTS`，9 个 phase 都用 `@cf/zai-org/glm-4.7-flash`，无跨厂商兜底。
- 背景：2026-08-12 从 DashScope 迁来就是为了摆脱凭证依赖（见文件内注释），属有意取舍。
- 代价：Workers AI 或该模型不可用时整份简报出不来。
- 待裁决：接受，还是给简报关键 phase 加兜底。

---

## 命名 / 死代码

### D6. `AIWorkerService.generateEmbedding` 实际不调 ai-worker
- 位置：`apps/backend/src/lib/services/ai-services.ts:118`，实际请求 ML `/embeddings`。
- 选项：把方法移到 ML 客户端（`clustering.ts` 的 `ClusteringService` 旁）或改名。
- 待裁决：是否改。

### D7. binding 名 `MY_WORKFLOW`
- 位置：`apps/backend/wrangler.jsonc`，对应 `auto_brief_generation`。
- 选项：改为 `AUTO_BRIEF` 之类；只改 binding 名，不改 workflow 名，不影响已有实例。
- 待裁决：是否改。

### D8. `articleAnalysisSchema` 两处各写一份
- 位置：`apps/backend/src/prompts/articleAnalysis.prompt.ts` 与 `services/meridian-ai-worker/src/prompts/articleAnalysis.ts`；backend 那份只给 `lib/core/utils.ts` 的 `generateSearchText` 当类型用。当前字段一致。
- 选项：抽到共享包；或 backend 只保留类型。
- 待裁决：是否合并。

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
- **已结（2026-09-24）**：删除。聚类契约以 `apps/backend/src/lib/services/clustering.ts` 为准。

### D12. knip 的盲区
- 现象：knip 看不到 wrangler binding 与 HTTP 路由，所以 D9、D10 以及已删的 `AI` binding 都没被上一轮死代码清理发现。
- 选项：写一个脚本比对 `wrangler.*` binding 与 `env.<NAME>` 使用、比对路由与调用方（按「机制优先于 prose」）。
- 待裁决：是否值得做。

### D13. 报告层退役后遗留的无效读数与死配置（退役前就已存在）
- `brief_runs.intelligence_analyses`：v6 上线后每次仍写 25，实际已没有情报分析这一步，读数有误导性。
- `apps/backend/src/routers/observability.ts:786` 读取 `stepBreakdown['intelligence_analysis']`，该 step 已不再产生，取到的恒为空。
- ai-worker `PHASE_DEFAULTS` / `LLMCallPhase` 中 `story_validation`、`story_merge` 无调用方；`SensorKind` 中 `story_validation_parse` 无调用方。
- 待裁决：字段改名或弃用、删读取点、删死 phase。

- 进展（2026-09-24）：第二条的读取点随 `a311349` 删无调用方的 observability 路由一并消失。`intelligence_analyses` 现写的是出了块的故事数（`writtenBlocks.length`），不再恒为 25，但字段名仍误导；死 phase 与 `story_validation_parse` 仍在。
- 进展（2026-09-24）：死 phase `story_validation` / `story_merge` / `faithfulness_check` / `faithfulness_revise` 与死 SensorKind `brief_hygiene` / `story_validation_parse` 已删。剩：`intelligence_analyses` 字段名、workflow 里 `logStep('story_validation', …)` 的 step 标签名（改名会断开历史观测数据的连续性）。
- 裁决（2026-09-24）：`logStep('story_validation', …)` 的 step 标签**不改名**——它是历史观测数据的查询键，改名换来的只是名字好看，代价是新旧 run 无法按同一键对比。剩：`intelligence_analyses` 字段名。

### D14. ai-worker 文档大面积过时
- `services/meridian-ai-worker/README.md` 仍列出已不存在的 `/meridian/story/validate`、`/analyze-stories`、`/generate-final-brief` 及 `StoryValidationService`；`docs/quota-limit-handling.md` 通篇以已删的 `IntelligenceService` 为例；`docs/ARCHITECTURE.md` 的服务列表同样过时。本次只删了直接指向已删代码的行。
- 进展：`services/meridian-ai-worker/docs/` 11 份文档经逐份核对全部过时，已整目录删除。
- 待裁决：README 正文（架构图、端点表、环境变量、npm 命令）按现状重写，还是删减到只剩指路。
- **已结（2026-09-24）**：README 已按现行代码重写（9 条路由、`callLLM(phase)`、实际读取的 env、pnpm / wrangler@4.120.0 命令）。

---

## 验收门本身

### G1. frontend typecheck 本来就是红的
- 现象：`apps/frontend/nuxt.config.ts(98,21): error TS2322: Type 'Plugin<any>[]' is not assignable to type 'PluginOption'`，在干净的 `536faa8` 上即失败，所以 `pnpm typecheck` 整体退出码为 1。
- 代价：门常红，就会被习惯性忽略。
- 待裁决：修掉（大概率是 vite 插件类型版本不一致）。

### G2. `apps/backend/worker-configuration.d.ts` 与当前 wrangler 严重漂移
- 现象：跑 `wrangler types` 会改动约 1.3 万行（runtime 类型版本变化），本次只手删了 `AI: Ai;` 一行。
- 待裁决：是否单独提交一次重新生成（需确认新类型下 typecheck 仍绿）。
