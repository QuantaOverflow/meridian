# 录制重放全链路测试（layer 2）

拿一期生产 brief run 的 LLM 录像，在本地把整条 `AutoBriefGenerationWorkflow` 原样重跑，
再把产出与生产那期逐字段比对。是 characterization test：不判断简报好不好，只回答
「这次改动之后，同样的输入 + 同样的模型回答，产出和生产还一样吗」。

```bash
pnpm -F @meridian/backend replay cron-brief-1790168539876          # 全链路 + 比对
pnpm -F @meridian/backend replay cron-brief-1790168539876 --slice  # 只重放一条 cluster_judge
```

退出码 0 = 零 miss、录像全部用完、产出与生产一致；1 = 其余一切；2 = 用法/环境错误。
报告落 `data/<wf>/out/<时间>/report.md`，miss 的请求 diff 落同目录 `miss-N.diff`。

## 切在哪

**切点是 LLM provider 边界**：ai-worker 的 Workers AI binding `env.AI`。重放配置把它从
`[ai]` 换成指向 `replay-ai-worker.js` 的 service binding（`entrypoint: ReplayAI`），
ai-worker 代码里 `env.AI.run(model, inputs)` 就成了对替身的 RPC 调用——**走的就是生产那条
binding 路径**（`executeWorkersAIViaBinding`），不是 REST。prompt 构造、解析、重试、backend
的 workflow 编排全是真代码。没有任何生产代码为此改动。

替身不做匹配，把 `(model, inputs)` 转给 runner 起的本地 HTTP 服务；runner 按
`sha256(model, messages, temperature, max_tokens, 解码参数)` 查录像，同 key 多条按 call_index
依次出队。**不做任何文本归一化**——查过 prompt 里没有日期 / workflowId / 随机数
（story_rank 的洗牌按轮次定种子）。查不到 = **miss**：替身抛错，runner 找最像的一条录像，
写出 unified diff。miss 本身就是信号：改动改变了发给模型的内容。

其余外部依赖：

| 依赖 | 重放时 |
|---|---|
| Postgres | Neon 分支（`REPLAY_DATABASE_URL`，经 `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` 注入 Hyperdrive） |
| R2 | 本地模拟桶 `meridian-replay-articles`，每次跑用全新 `--persist-to`，只播种这一期的 630 篇正文 |
| ml-service | 本地 uvicorn + 真模型（聚类是确定性的，不录像） |
| 输入文章 | 生产那期聚类快照里全部 article id，以 `article_ids` 传给 `/admin/briefs/generate`；其余参数取 `brief_runs.params` |

生成的 wrangler 配置在 `data/<wf>/out/<时间>/gen/`，从仓库里的 `wrangler.jsonc` / `wrangler.toml`
派生，只改外部依赖；它们的 `.dev.vars` **不含任何真实密钥**（ai-worker 唯一的模型通道是 `AI`
binding，已指向替身，不可能绕过替身打真模型）。

## 准备

1. Neon 分支（非破坏，从 production 分出）：连接串写进 `test/replay/.replay.env`（gitignored）：
   `REPLAY_DATABASE_URL=postgresql://...`
2. 凭据（只读）：`apps/backend/.dev.vars` 里的 `API_TOKEN`（读生产 backend 的录像路由）与
   `CLOUDFLARE_API_TOKEN`（读生产 R2 正文，只 GET）。worktree 里没有时自动去主 checkout 找。
3. ml-service 的 `.venv` 与 `model-cache`（同样会去主 checkout 找；或设 `ML_SERVICE_VENV` / `ML_MODEL_DIR`）。
4. `npx wrangler@4.120.0`（首次需下载）。

第一次跑会自动执行 `fetch-recording.mjs` 把录像、正文、生产产出拉到 `data/<wf>/`
（**gitignored：仓库公开，录像含文章正文**）。`--fetch` 强制重拉。

## 比对什么

生产产出取自 Neon 分支（分支是生产的拷贝，那期的行就是生产写下的）+ 生产 R2 的
`observability/brief-v3/<wf>.json`：

- `brief_runs`：status、篇数、簇数、故事数、块数、正文长度
- `reports`：title、content、tldr_prose、篇数/源数、`clustering_params.stats`
- `brief_stories`（按 id 序）：cluster_id、title、importance、article_count、article_ids、selected_for_intel
- brief-v3 块记录：每块的标题、档位、正文、逐句出处、窗口/重试计数

不比：id、时间戳、workflow_id、`triggeredBy`、
`story_cluster_id` / `centroid` / `lead_article_id`（跨期归并，依赖分支建立时刻的其它期数据）。

## 守卫

- workflow 以 `TERMINATED_NO_STORIES` 结束或 0 条故事 → FAIL（取不到正文时 workflow 会提前退出、
  LLM 段一次不跑；2026-09-24 实测空 R2 在现行代码下落 `FAILED`，旧笔记说的是 `TERMINATED_NO_STORIES`，两种都拦）
- 替身 0 次被调用 → FAIL
- 录像有没被用到的 → FAIL（本地少发了请求）
- 同一请求被打的次数多于录像 → miss

`--skip-seed` 不播种 R2，用来自检这条守卫（预期 FAIL）。默认第一次 miss 就收尾（后面的产出必然偏离）；
`--no-fail-fast` 跑到底看全部 miss（ai-worker 与 workflow 各有重试，一处改动会连带几十次 miss，
终端只打印 diff 不同的首例，每次仍各落一个 `miss-N.diff`）。

## 抓不到什么

- **模型行为变化**：回答来自录像，换模型 / 模型漂移测不到。
- **不进 key 的请求字段**：录像只记了 messages / temperature / max_tokens / 解码参数；
  `chat_template_kwargs`（关思维链）不在录像里，改它测不到。
- **binding 本身**：替身的返回形状是按 glm-4.7-flash 经 binding 的形状构造的（OpenAI 兼容、
  正文在 content），真 binding 的形状若变了测不到。
- **生产平台行为**：step 被平台 canceled 重试、1MB step 输出上限、并发限流，本地都不复现。
- **失败过的 LLM 调用**：录像里 error 非空的调用暂不支持重放（遇到直接报错）；录像按
  `phase-callIndex` 存 R2，同 key 的重复调用在生产侧就被覆盖了，这类调用重放会 miss。
- **ml-service 版本**：用的是本 checkout 的代码，不是生产镜像。聚类若与生产不同，
  会表现为 cluster_judge 的 miss（这本身是信号）。
