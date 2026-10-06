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

「按录像作答」这一段（查 key、miss 的 diff、生成给 ai-worker 的变量、向量缓存）有自己的测试，不起 wrangler、不连外部服务：
`pnpm -F @meridian/backend test:replay`（手写的小录像在 `fixtures/`；Cloudflare REST API 由测试里起的本地服务假冒）。

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

### 一次调用核查（`one_call`，ADR 0012）多出来的两类调用

2026-10-06 起逐句核查可以配成 `one_call`，它在 provider 边界上多了两类调用：

- **DashScope 的 chat 调用**走 HTTP，不经 binding，**从录像作答**。重放配置把 `DASHSCOPE_BASE_URL` 指到 runner 的本地服务
  （`/dashscope`），请求体就是发给厂商的那份；key 与上面的 chat 调用**同一个算法**。录像里每条记了走的是哪条通道
  （`request.provider`），通道对不上也是 miss。miss 时回 400（通道不重发、调用方回退到 agent；不回 401，那会让这一块
  之后的核查都不去 DashScope）——判 FAIL 靠的是 runner 记下的 miss，不靠 ai-worker 报不报错。
- **向量调用**（bge-m3）经 binding，一批（最多 50 句）调一次，**不从录像作答，从本地向量缓存作答**（下一小节）。

**逐句核查的模式随录像走**：录像里有 `brief_block_v6_check_one_call` 的调用就按 `one_call` 重放，没有就按 `agent`
——这次改动之前的录像照旧能重放，chat 调用的 key 没有变。

### 向量：本地缓存，没有的现算

生产不存句子向量（一簇几 MB），调用日志里的向量调用只有条数。录向量是本地排查的事，不为它改生产代码
（2026-10-06 定），所以向量在本地取：

- 重放跑的是真代码，替身照样收到每一批文本。runner 按 `sha256(model, 这一批文本)`（顺序也算）查
  `data/<wf>/vectors/<key>.json`，有就答。
- 没有就**调一次真模型**算出来：`POST https://api.cloudflare.com/client/v4/accounts/<account>/ai/run/@cf/baai/bge-m3`，
  存进上面的目录再答。同一期第二次重放起全部来自缓存，不再调模型。
- 凭据：`CLOUDFLARE_API_TOKEN`（环境变量 → `test/replay/.replay.env` → `apps/backend/.dev.vars`，与读生产 R2 正文是同一个变量），
  token 要有 **Workers AI** 权限——只有 R2 读权限的 token 会被 403。缓存里没有又没有可用的 token，这一批直接报错，
  报告里列为失败。`REPLAY_CF_API_BASE` 可以把现算的请求指到别处（缺省 `https://api.cloudflare.com/client/v4`）。
- 报告里有一行「向量调用 N 批：缓存作答 a 批，现算 b 批」，并与生产那期调用日志记的批数比对，对不上判 FAIL
  （本地送去算向量的文本与生产不同）。现算会花真钱（bge-m3 的 neurons，量很小，没量过）。
- 向量调用没有 miss：没有生产的文本可比，文本变了只是另算一批。送去算向量的文本变没变，要靠它的下游
  ——证据包变了，核查调用就 miss。

**没解决的问题：现算的向量未必与生产逐位相同。** 向量差一点，「按意思搜」的排序就可能不同，证据包不同，
发给 DashScope 的核查 prompt 就与录像不同，表现为核查调用的 miss——代码一行没改也会 miss。会不会这样只能拿一期
真实的 `one_call` 生产运行重放一次才知道，现在还没有这样的运行（第一期是 2026-10-06 21:00 那期）。
**如果真是这样**：replay 覆盖不了一次调用核查，它只由单元测试守（ai-worker 的 `test/`）；届时 `one_call` 的期不能整期重放。
同一份缓存内部是自洽的（第二次重放与第一次用同一批向量），所以这个问题第一次重放就会暴露，不会时有时无。

**基线。** 第一期 `one_call` 模式的生产运行就是新的基线。更早的录像只能按 `agent` 模式回放（上面已自动处理）；
拿它们去验 `one_call` 的代码没有意义——核查调用全都会 miss，这是预期。

其余外部依赖：

| 依赖 | 重放时 |
|---|---|
| Postgres | Neon 分支（`REPLAY_DATABASE_URL`，经 `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` 注入 Hyperdrive） |
| R2 | 本地模拟桶 `meridian-replay-articles`，每次跑用全新 `--persist-to`，只播种这一期的 630 篇正文 |
| ml-service | 本地 uvicorn + 真模型（聚类是确定性的，不录像）；backend 的 `ML_SERVICE` binding 经 `services/meridian-ml-service/dev-shim` 转发过去 |
| 输入文章 | 生产那期聚类快照里全部 article id，以 `article_ids` 传给 `/admin/briefs/generate`；其余参数取 `brief_runs.params` |

生成的 wrangler 配置在 `data/<wf>/out/<时间>/gen/`，从仓库里的 `wrangler.jsonc` / `wrangler.toml`
派生，只改外部依赖；它们的 `.dev.vars` **不含任何真实密钥**：ai-worker 的两条模型通道都已改道——`AI`
binding 指向替身；`DASHSCOPE_BASE_URL` 指向 runner 的本地服务，`DASHSCOPE_API_KEY` 是占位值
`replay-not-a-real-key`（通道见不到 key 会在发请求前就拒绝，所以得给一个）——worker 不可能绕过去打真模型。
唯一会调真模型的是 runner 自己：向量缓存里没有的批次（见上）。

## 准备

1. Neon 分支（非破坏，从 production 分出）：连接串写进 `test/replay/.replay.env`（gitignored）：
   `REPLAY_DATABASE_URL=postgresql://...`
2. 凭据（只读）：`apps/backend/.dev.vars` 里的 `API_TOKEN`（读生产 backend 的录像路由）与
   `CLOUDFLARE_API_TOKEN`（读生产 R2 正文，只 GET；重放 `one_call` 的期还要 Workers AI 权限，现算向量用）。
   worktree 里没有时自动去主 checkout 找。
3. ml-service 的 `.venv` 与 `model-cache`（同样会去主 checkout 找；或设 `ML_SERVICE_VENV` / `ML_MODEL_DIR`）。
4. `npx wrangler@4.120.0`（首次需下载）。

第一次跑会自动执行 `fetch-recording.mjs` 把录像、正文、生产产出拉到 `data/<wf>/`
（**gitignored：仓库公开，录像含文章正文**）。`--fetch` 强制重拉。

## 比对什么

生产产出取自 Neon 分支（分支是生产的拷贝，那期的行就是生产写下的）+ 生产 R2 的
`observability/brief-v3/<wf>.json`：

- `brief_runs`：status、篇数、簇数、故事数、块数、正文长度
- `reports`：title、content、tldr_prose、used_articles/used_sources
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
- **DashScope 请求里不进 key 的部分**：`enable_thinking: false` 与请求头（`cf-aig-skip-cache`、鉴权）不在录像里，
  改它们测不到。
- **向量调用本身**：没有生产的文本和向量可比，只比批数；现算走 REST、生产走 binding，两边回的向量是否相同没验过（见上）。
- **核查的 epoch 数**：重放不设 `BRIEF_CHECK_EPOCHS`（按缺省 1）；生产那期若不是 1，核查调用数对不上。
- **binding 本身**：替身的返回形状是按 glm-4.7-flash 经 binding 的形状构造的（OpenAI 兼容、
  正文在 content），真 binding 的形状若变了测不到。
- **生产平台行为**：step 被平台 canceled 重试、1MB step 输出上限、并发限流，本地都不复现。
- **失败过的 LLM 调用**：录像里 error 非空的调用暂不支持重放（遇到直接报错）；录像按
  `phase-callIndex` 存 R2，同 key 的重复调用在生产侧就被覆盖了，这类调用重放会 miss。
- **ml-service 版本**：用的是本 checkout 的代码，不是生产镜像。聚类若与生产不同，
  会表现为 cluster_judge 的 miss（这本身是信号）。
