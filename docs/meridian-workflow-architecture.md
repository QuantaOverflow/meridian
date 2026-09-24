# Meridian 工作流架构文档

> 描述现行链路（简报块 v6，2026-09-21 起，commit `961aeca`）。代码是权威：
> 编排在 `apps/backend/src/workflows/`，跨 service 契约在 `apps/backend/src/lib/services/ai-services.ts`
> 与 `services/meridian-ai-worker/src/index.ts`。算法取舍与已证伪清单见 `docs/adr/0003-cluster-as-brief-block.md`。

## 总览

```
RSS 源 ──► SourceScraperDO（每源一个 DO，按 scrape_frequency 定时抓）
              │ 新文章写 articles 表，id 进队列
              ▼
        ARTICLE_PROCESSING_QUEUE ──► ProcessArticles workflow（逐篇：抓正文 → 分析 → 正文落 R2）
                                                  │
cron 0 13 * * *（UTC）──► AutoBriefGenerationWorkflow（每天一期）
        补算 embedding → 聚类 → 簇判定 → 排序选材 → 逐块写 → 分层拼装 → 标题/摘要 → 落库
```

三个 Worker 的分工：

| 组件 | 做什么 | 被谁调 |
|---|---|---|
| `apps/backend` | DO 抓取、队列、两个 workflow、admin / observability API | cron、队列、HTTP |
| `services/meridian-ai-worker` | 所有 LLM 调用（Workers AI `glm-4.7-flash` 为主，经 AI Gateway） | backend 经 service binding `AI_WORKER` |
| `services/meridian-ml-service` | embedding（`POST /embeddings`）与聚类（`POST /ai-worker/clustering`） | backend 经公网 URL `MERIDIAN_ML_SERVICE_URL` |

## 工作流 1：ProcessArticles（`processArticles.workflow.ts`）

触发：`index.ts` 的 `queue()` 把一批文章 id 交给 `startProcessArticleWorkflow`。参数 `{ articles_id: number[] }`。

1. **取文章**（`get articles`）：只处理未处理（`processedAt` 为空）、48 小时内发布、无 `failReason` 且在参数列表里的文章
2. **抓正文**：`DomainRateLimiter`（并发 8、全局冷却 1s、同域冷却 5s）；特定域名走浏览器渲染，其余先 fetch 失败再降级；
   PDF 直接标 `SKIPPED_PDF`；抓到的是拦截页/播放器壳等非正文时（`looksLikeNonArticleUrl` / `looksLikeExtractionFailure`）
   标 `FETCH_FAILED` + `failReason=EXTRACTION_JUNK:*`，不进分析
3. **文章分析**：ai-worker `POST /meridian/article/analyze`，产出 language、primary_location、completeness、
   content_quality、event_summary_points、thematic_keywords、topic_tags、key_entities、content_focus
4. **落盘**：正文进 R2（`ARTICLES_BUCKET`），分析字段与 `contentFileKey` 写 articles 表，状态 `PROCESSED`；
   分析失败标 `AI_ANALYSIS_FAILED`

**embedding 不在这里算**（2026-07 起）：逐篇调 ml-service 会不断重置容器 sleepAfter 让它常驻，
改到简报 workflow 聚类前批量补算。

## 工作流 2：AutoBriefGenerationWorkflow（`auto-brief-generation.ts`）

触发：cron `0 13 * * *` → `lib/scheduled/daily-brief.ts` 的 `runDailyBriefCron`（参数取 `CRON_BRIEF_PARAMS`，
`MAX_STORIES_TO_GENERATE=25`）；也可 `POST /admin/briefs/generate` 手动触发。binding 名 `MY_WORKFLOW`。

每个 run 在 `brief_runs` 表有一行（`persist:brief_run_start` → `complete` / `failed` / `terminated`），
有可对账的局部失败时终态记 `DEGRADED` 而非 `COMPLETED`。

| # | step | 做什么 | 外部调用 |
|---|---|---|---|
| 0 | `补算:查缺失清单` + `补算 embedding 批次 N` | 窗口内缺 embedding 的文章每批 50 篇补算；单批失败跳过（该批不进聚类） | ml-service `/embeddings` |
| 1 | `准备文章数据集` | 按时间窗取已分析、有 embedding 的文章；embeddings 卸到 R2、step 只回 key（1MB 输出上限） | — |
| 2 | `执行聚类分析` | 不降维 + 余弦距离 average linkage 凝聚（阈值 0.10、最小 3 篇成簇，参数见 `lib/core/constants.ts` 的 `BRIEF_CLUSTERING_OPTIONS`；UMAP+HDBSCAN 仅作回滚开关）。簇成员落 R2 `observability/clustering/<wf>.json` | ml-service `/ai-worker/clustering` |
| 3 | `簇判定` | **一簇 = 简报里一块**，每簇一次调用判 EVENT / NO_EVENT / UNSURE 并起名。判定失败或 NO_EVENT 仍出块（只进计数），标题退化成零 LLM 的主导专名。块的 importance 由 `blockImportance`（独立源数 + 篇数的对数公式，`lib/core/storyline.ts`）给出，不是 LLM 打分 | ai-worker `/meridian/cluster/judge` |
| 3b | `persist:brief_stories_and_rejections`、`compute:source_coverage` | 块写 `brief_stories`、拒绝写 `cluster_rejections`；算每块独立源数 | — |
| 4 | `故事重要性排序` | 对**全部**候选跑三轮洗牌 + Borda 聚合；失败则退回机械分（`lib/core/story-ranking.ts`，源覆盖加权）并在观测里记一笔。再按同事件配额（`PER_EVENT_BLOCK_CAP`）取前 `maxStoriesToGenerate` | ai-worker `/meridian/stories/rank` |
| 5 | 每个选中故事一个 step | 簇原文（R2 取正文，`pickSpreadArticles` 截到 30 篇）→ 一块逐句带出处的简报。端点内部：切句 → 切窗 → 每窗标重点 → 一次写作（lead/more 3–5 句、brief 1–2 句）→ 机械补出处。step 只回写出的句子，不回切句表 | ai-worker `/meridian/brief-block-v6` |
| 6 | `简报标题` | `assignTiers` 分 lead / more / brief 三节（写作前已算好），`renderBriefV3` 用代码拼 markdown；块记录落 R2 `observability/brief-v3/<wf>.json` | ai-worker `/meridian/brief-title` |
| 7 | `简报摘要` | 次日上下文用的 TLDR + 读者端散文摘要（best-effort，失败留 null） | ai-worker `/meridian/generate-brief-tldr`、`/meridian/generate-brief-summary` |
| 8 | `保存简报`、`persist:story_clusters` | 写 `reports`；跨期线索归并（best-effort，失败下次补） | — |

**为什么逐块一个 step**：CF 约 2% 的 invocation 会被平台 canceled，把 N 次调用挤进一个 step 等于一次抖动丢整期。

## 已退役（代码已删，别按旧文档找）

- 故事验证层 `story-validation`、候选分组、storyline 两段式 —— 2026-09-05 由簇判定取代
- 情报报告层（逐故事情报分析 → 报告 → 写作层 v3）—— 2026-09-21 由 brief-block-v6 取代，残余代码 2026-09-23 删除
- b′ 分段写、整篇合成 + 忠实度门 + RARR + 覆盖对账 —— 已删
- ProcessArticles 内逐篇 embedding —— 2026-07 改为简报 workflow 批量补算

依据与读数见 `docs/adr/0003-cluster-as-brief-block.md`、`docs/adr/0004-brief-writer-v3.md` 与 `docs/knowledge/INDEX.md`。

## 观测与测试

- 每步 `WorkflowObservability.logStep` 写 R2 `observability/<wf>.json`；按 run 查询见 `docs/OBSERVABILITY_GUIDE.md`
- LLM 原始 I/O 落 R2 `llm-calls/<wf>/`
- 纯函数有 golden 快照（`apps/backend/test/golden/`）；整期链路可用生产录像回放：
  `pnpm -F @meridian/backend replay <workflowId>`（`apps/backend/test/replay/README.md`）
