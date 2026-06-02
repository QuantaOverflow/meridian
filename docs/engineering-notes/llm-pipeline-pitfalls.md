# Meridian LLM Pipeline 工程踩坑记

> 本文记录在把 Meridian 从原 Gemini 栈迁移到 Qwen/DashScope（经 Cloudflare AI
> Gateway）并跑通本地 E2E 简报链路过程中暴露的若干工程问题。每条采用
> **现象 → 根因 → 修复 → 教训** 的结构，所有引用均给出 `file:line` 便于复核。
>
> 跑通后的链路概览：
>
> ```
> RSS 抓取 → embedding (multilingual-e5-small, 384d)
>          → 聚类 (UMAP + HDBSCAN)
>          → 故事验证 (qwen-plus per cluster)
>          → 情报分析 (qwen-long, top-K importance)
>          → 简报合成 (qwen-long) + TLDR (qwen-plus)
>          → DB 落库
> ```

---

## 1. CF AI Gateway Universal Endpoint 不支持 Custom Provider

**现象**：把 DashScope 接入 Cloudflare AI Gateway 后，所有走 Universal Endpoint
的调用都返回 `400 - invalid provider`，而直接 curl DashScope OpenAI 兼容端点
是通的。

**根因**：CF AI Gateway 的 Universal Endpoint
（`/v1/{account}/{gateway}` + body 内带 provider 数组）只接受 Cloudflare 官方
登记过的 provider slug；像 `dashscope` 这类用户自建的 Custom Provider 必须走
**provider-specific path**：`{gatewayUrl}/custom-{slug}/{base-relative-path}`。
这是文档里没显式写、但在控制台 "Test request" 抓包才能看出来的差异。

**修复**：在 `services/meridian-ai-worker/src/services/ai-gateway.ts:216-244`
针对 Custom Provider 分支单独走 `executeCustomProviderViaGateway()`，绕开
Universal pipeline。维护一个 `customSlugs` 集合作为路由判定。

**教训**：跨 provider 抽象层一旦遇到"网关 + Custom Provider"组合，要预设
Universal endpoint 不可达，分支路由是默认形态而不是 fallback。

---

## 2. Embedding 向量空间静默错配（同维不同空间）

**现象**：换 Qwen 栈后，部分历史文章的 cosine 相似度排序"看起来不对"，但
DB schema (`vector(384)`) 没报错，调用链路也没异常。

**根因**：原 backend 通过 ai-worker 用 `@cf/baai/bge-small-en-v1.5`（英文向量
模型，384 维）生成 embedding；而 `meridian-ml-service` 已经配置成
`sentence-transformers/multilingual-e5-small`（多语向量模型，同样 384 维）。
**维度相同**所以 DB 写入和聚类计算都不会报错，**但向量空间不同** — 同一句
话在两个模型里的方向完全不同，聚类质量直接劣化。

**修复**：`apps/backend/src/lib/services/ai-services.ts:24` 改成直接调
`meridian-ml-service` 的 `/embeddings`，跳过 ai-worker 这层转发，强制全链路
共用同一个模型。同时清理 DB 里旧空间的历史向量重新生成。

**教训**：embedding 是 LLM pipeline 里最容易 silent fail 的一层 —
schema 校验不会救你，模型名必须当 hard contract 锁死。

---

## 3. Hyperdrive 本地连接强制 `user:password` 格式

**现象**：本地 PostgreSQL 用 trust 模式，`postgresql://postgres@localhost/db`
本来能直连，但 `wrangler dev` 启动报 `Invalid connection string`。

**根因**：Wrangler Hyperdrive binding 的 `localConnectionString` 解析器要求
URI 必须含 `user:password@`，即便密码值只是占位符。

**修复**：`apps/backend/wrangler.jsonc:32` 改为
`postgresql://shiwenjie:dev@localhost:5432/meridian_local`，本地 PG 用户加个
任意密码。

**教训**：Wrangler 一些边角配置的校验比生产严格。本地 dev 字符串永远写完整
形态最省事。

---

## 4. Workflow 内部用启发式硬编码覆盖用户参数（shadowing bug）

**现象**：通过 generate API 把 `clusteringOptions` 显式传到 brief 生成接口，
日志却显示用的还是默认值；调小 `min_cluster_size` 没效果。

**根因**：`apps/backend/src/workflows/auto-brief-generation.ts:598-613`
在拿到用户 options 之后又用 `Math.floor(dataset.articles.length / 10)` 等
启发式公式重新构造了一份本地变量并向下传，**用户传入的对象在这里被静默覆盖**。

**修复**：把启发式逻辑改成默认值生成器，只在 `clusteringOptions === undefined`
时才使用：

```ts
const effectiveClusteringOptions = clusteringOptions ?? {
  umapParams: { n_neighbors: ... },
  hdbscanParams: { min_cluster_size: ..., min_samples: 1 },
};
```

并加 log `(${clusteringOptions ? 'user-provided' : 'heuristic-default'})`
让"哪个分支生效"可观测。

**教训**：当一个函数同时接受外部参数和提供默认计算时，**默认计算必须放在
`??` / `||` 的右侧**，绝不能写成"先算默认再判断是否覆盖"——后者一旦写错就是
最难发现的 shadowing bug。

---

## 5. `maxStoriesToGenerate` 在 intelligence step 未被 enforce

**现象**：触发 brief 时显式设 `maxStoriesToGenerate=3`，但日志显示情报分析
处理了全部 15 个 story，连带 step 超时 + token 大量浪费。

**根因**：参数被透传到了 workflow，但在 `auto-brief-generation.ts` 进入
情报分析这一步时**没有按 importance 排序后截断**，直接 `for story of allStories`
跑了全集。

**修复**：在情报分析 step 入口加 `.slice(0, maxStoriesToGenerate)`
（`auto-brief-generation.ts:893`），并按 `importance` 降序排。

**教训**：API 参数从 controller 透传到 workflow step 这种长链路里，**每一层
都要自己 enforce 一次**，不要假设上游已经做了。

---

## 6. Workflow step timeout 与串行长上下文 LLM 调用错配

**现象**：情报分析 step 永远跑不完，触发 Cloudflare Workflow 的自动重试，
导致同一批 token 被重复消耗 N 次后还是失败。

**根因**：Cloudflare Workflow `step.do()` 默认 timeout 是 2 分钟，但情报分析
里塞了 N 个 **串行** `qwen-long` 调用，每次 prompt ~52k 字符、输出 ~16k 字符，
单次实测 30–90 秒。N≥3 就必然超时，N=15 时永远过不去。

**修复**：`auto-brief-generation.ts:885-895` 显式把这一 step 的 timeout 提到
30 分钟，并把"按 importance 排序 + slice(top-K)"作为前置 step（见 §5）。

```ts
const intelligenceStepConfig: WorkflowStepConfig = {
  retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
  timeout: '30 minutes',
};
```

**教训**：编排引擎的默认 timeout 是给"普通业务 step"设计的，**任何含 LLM
长上下文调用的 step 都必须显式覆盖**。一个串行 N×30s 的 step 在 2min 默认下
就是炸弹。

---

## 7. 提示词与数据形态错配：迭代过头与回拨

**现象**：第一版跑出 17 个 cluster **全部** 被故事验证打成 NO_STORIES，简报
为空。

**根因**：原 prompt 假设的输入是"突发新闻、同事件多家报道"，要求
"同一事件 3+ 篇报道才算 story"。但 Meridian 的实际输入是
**多源每日聚合**（BBC/Guardian/Al Jazeera/NPR/France24/HN 各自一篇/几篇），
同一 cluster 里典型形态是"中东主题 + 5 个独立事件"，永远凑不出 3 篇同事件
报道。

**第一轮修复（过头）**：在 `prompts/storyValidation.ts` 加了
`thematic_umbrella` 分支 + "Aim to surface stories rather than reject" 的
显式引导。结果反过来 — 17 个 cluster 被验证为 15 个 valid story，几乎全过。

**第二轮回拨**：移除 `thematic_umbrella` 分支与"surface stories"引导，保留
2+ 文章阈值（从原 3+ 降下来）作为唯一放宽点。最终代码见
`prompts/storyValidation.ts` 与 `services/story-validation.ts:60-128`。

**教训**：
1. Prompt 改动**必须配套 eval**。两轮调整之间没有自动评估指标，全靠
   肉眼看跑通数据 — 这是为什么会"修一次过头一次"的根因。
2. Prompt 的"鼓励性措辞"（"Aim to surface", "Don't reject", "This is the
   COMMON case"）对 LLM 的影响远超直觉，要当成 hard signal 谨慎使用。
3. 修 prompt 与放宽阈值是**两个独立 lever**，不要同时拧；否则没法归因。

> 这是后续做 LLM-as-judge 评估框架最直接的动机来源。

---

## 8. DashScope 内容审核 (`data_inspection_failed`) 风险评估

**现象**：跑中东话题的文章分析时，零星出现 DashScope 返回
`400 data_inspection_failed`，提示
"Input data may contain inappropriate content"。

**实测命中率**：
- **单篇文章分析层**：125 篇里约 4 篇命中，~3.4%
- **简报合成层**（top-K importance 过滤后）：实测 **0%** 命中

**根因**：DashScope 对中东冲突相关的政治表述有合规过滤，单篇粒度有概率被
拒；简报合成阶段输入已经是 importance ≥ 一定阈值的精选 + 总结过的二次内容，
触发率显著下降。

**应对策略**：
- 文章分析层加重试 + 跳过（不让单篇失败拖垮整批）：
  `apps/backend/src/workflows/process-articles.ts` 的 batch 容错
- 简报合成层不做特殊处理（实测 0% 命中，再加重试反而增加延迟）
- 长远方案：备用 provider（OpenRouter 上的 Claude/GPT）作 fallback，但
  当前未实现

**教训**：跨 provider 抽象层做"国内/国外双栈"时，**内容审核口径差异是隐式
约束**，不能假设 prompt 行为一致。需要 per-provider 失败率监控才能给出
迁移决策。

---

## 9. Qwen 输出 JSON 非严格

**现象**：`storyValidation` 调用 qwen-plus 返回的 JSON 在 `JSON.parse()` 阶段
报错 `SyntaxError: Expected ',' or '}' after property value at position 88`。

**根因**：Qwen 模型在生成 JSON 时倾向于：
- 在字段后写 `// 注释`（尤其是 prompt 示例里出现过 `// ...` 的情况——模型会
  模仿示例的注释风格）
- 在数组/对象的最后一个元素后留 trailing comma
- 偶尔在 `{` 之前输出几句自然语言铺垫

**修复**：`services/story-validation.ts:218-245` 实现 `parseJSONFromResponse()`：

```ts
// 1) 三段候选：```json 代码块 → 第一个 { 到最后一个 } → 整段
// 2) 每段清洗：去掉 /* */ 块注释、// 行注释（避开 url 里的 ://）、尾随逗号
// 3) 依次 try JSON.parse，第一个成功即返回
```

**教训**：用国产 LLM 输出结构化 JSON 时，**parser 必须容错**。同时 prompt
示例里**不要写 `// ...` 风格注释**，否则模型会照抄。

---

## 10. Qwen 长 chain-of-thought 吃光 max_tokens

**现象**：storyValidation 让 Qwen "先简短推理再输出 JSON"，结果模型输出了
大段中文推理（"Let me think about this... cluster 1 has articles about
Smotrich/ICC..."），8000 tokens 用完时 JSON 还没开始。

**根因**：Qwen-plus 对 "Reason briefly first" 这类指令的"briefly"理解
非常宽松，等同于打开 chain-of-thought 模式；同时长 prompt（每个 cluster 含
10+ 篇文章摘要）天然激发模型多想。

**修复**：
1. Prompt 改写为强制约束：
   ```
   **Output ONLY the JSON, no analysis, no reasoning, no prose before or
   after.** Wrap the JSON in a ```json fenced code block.
   ```
2. `max_tokens` 从 8000 调到 4000：既够 JSON 输出，又强制 LLM 不能多想

**教训**：让 LLM 输出 JSON 时，**任何"先想后说"的措辞都要删掉**。需要推理
就用另一次调用做（chain-of-thought 拆分），不要让同一次输出兼顾推理和结构化
结果。

---

## 11. Prompt↔Builder 字段契约漂移，且 structured output 救不了（qwen-long 仅 json_object）

**现象**：情报报告下游 `/stories/:id/intel` 的 `stakeholders`、`key_developments`
返回空；更早一版还直接吐 `"Entity 1" / "Fact 1"` 占位符污染简报。

**根因**：两处 prompt 约定与 builder 消费的字段名/形态不一致，纯靠
"prompt 里写结构 + 裸 `JSON.parse`"维系，没有任何 schema 强制：
- `intelligenceAnalysis.ts` 约定 `keyEntities.list`（嵌套），但 qwen-long 实际把
  `keyEntities` **拍平成数组**直接输出；builder 只读 `.list` → 匹配不上 → 返回空。
- prompt 根本不产 `factualBasis` 字段，builder 却去读它 → 永远空 → 老代码兜底成
  `"Fact 1/Fact 2"` 占位符。

**修复**：`utils/intelligence-report-builder.ts` 做防御性形态兼容（不依赖模型行为）：
`buildEntities` 同时接受 `keyEntities`（扁平数组）/ `keyEntities.list` / 历史
`entities` 三种形态；`extractFactualBasis` 从 `timeline[].description` 派生关键
发展；两处都把兜底从占位符改成空数组，绝不向下游注入假数据。

**为什么 structured output 不是这个 bug 的解**（重点，避免再有人走这条路）：
- AI Gateway 是透传代理，不剥离 `response_format`；瓶颈不在网关。
- qwen-long（`qwen-long-latest` / `qwen-long-2025-01-25`）**只支持
  `response_format:{type:"json_object"}`，不支持 strict `json_schema`**。
  json_object 只保证"输出是合法 JSON"，**不保证字段名和嵌套结构** —— 而本 bug
  恰恰是形态漂移，json_object 管不到。要强制 `keyEntities.list` 这种契约得用
  strict json_schema，目前只有 qwen3-max 等较新型号支持，换型号又是另一笔
  模型/成本/质量权衡。
- 且 json_object 有附带约束：prompt 必须含 "json" 关键字、thinking 模式不可用、
  **开启时不能设 `max_tokens`**（我们 intel 调用硬设了 8192，见
  `services/intelligence.ts:237`），还要求整个响应是纯 JSON —— 会砍掉 prompt 里
  "先 preliminary analysis 再 `<final_json>`"的 CoT 铺垫。
- 官方依据：<https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output>

**教训**：
1. prompt 与 builder 之间的字段名/嵌套是**隐式 hard contract**，prompt 一改就会
   悄悄漂移；消费端兜底要返回空、绝不注入占位符（占位符会被下游当真实数据编造）。
2. "上 structured output 就能强制结构"是常见误判 —— 必须先确认目标模型支持的是
   **json_object（仅合法性）还是 strict json_schema（含形态）**。在 qwen-long 上
   只有前者，治不了形态漂移。低风险止血永远是消费端做形态兼容。

---

## 12. 简报"编造反馈环"：TLDR 被当 context 回灌再被展开

**现象**：某天只识别出 1 个真 story，简报却产出 5–8 个带机制细节的整节
（"磁致伸缩光刻""pH 聚合物靶向治疗""zk-SNARK 仲裁电路"等根本不存在的内容）。

**根因**：闭环。`auto-brief-generation.ts` 每次取**前一天 brief 的 TLDR**当
"前日简报上下文"喂给今天的 brief（`index.ts` 把 `previousBrief.tldr` → summary →
`formatPreviousContext`）。而 TLDR 本身是 `[主题]|状态|实体|一句话` 的标识符表
（`tldrGeneration.ts` 规定的格式）。今天的 brief 无视 prompt 里的 guardrail，把这些
**只有标识符、没有事实**的主题展开成编造的整节 → 今天的 brief 又被压成 TLDR →
次日再回灌 → 滚雪球。取证发现编造主题在 brief 输入里**根本不存在**，是凭空生成。

**修复**：`auto-brief-generation.ts` 直接**砍掉 previousBrief 注入**
（`const previousBrief = null`）。断源 > 靠 prompt guardrail（实测 qwen-long 压不住）。

**教训**：
1. **任何"把 LLM 输出回灌成下一轮输入"的链路都要警惕自我放大**——尤其当回灌的是
   高度浓缩、只剩标识符的摘要时，下游会把标识符当种子编造。
2. prompt 写死的禁令（"NEVER expand"）对 qwen 系列约束力有限；**数据层断源才可靠**。
3. TLDR/摘要这类"记忆态"不是无害的——它会成为下一轮的事实来源，要么不回灌，
   要么只回灌"今天也有真 cluster"的主题（实测纯靠实体重叠过滤会漏，故选断源）。

---

## 13. dataset 选文章 `LIMIT` 无 `ORDER BY`，静默截掉最新文章

**现象**：新加的新闻源已成功抓取入库、已处理出 embedding，但**进不了简报**——
某次 brief 的 96 篇里只有 6 篇是新文章。

**根因**：`auto-brief-generation.ts` 的 dataset 查询 `WHERE 已处理+时间窗口` 后
直接 `.limit(100)`，**没有 `ORDER BY`**。窗口内合格文章常 >100（实测 374），
Postgres 无排序时按堆/插入顺序返回（偏向低 id=旧文章）→ LIMIT 抓的全是旧的，
刚插入的新文章（高 id）被截掉。日报却恰恰该优先最新。

**修复**：`.limit()` 前加 `.orderBy(desc($articles.publishDate))`，取最新 N 篇。

**教训**：任何 `LIMIT` 都必须配 `ORDER BY`——否则"取哪些"是数据库实现细节，
随数据增长悄悄漂移。"日报/最新"类查询尤其要按时间倒序，新数据源才进得来。

---

## 14. CF Workflow 单 step 输出 ~1MB 上限——embeddings 必须卸 R2

**现象**：把 `articleLimit` 提到 500 后，workflow 在 `prepare_dataset` 步报
`WorkflowInternalError`/`SQLITE_TOOBIG`（默认值历史上被压到 30 也是因为这个）。

**根因**：CF Workflow 把**每个 `step.do()` 的返回值持久化进内部 SQLite**（供重放/
恢复），单 step 输出有 ~1MB 上限。`prepare_dataset` 返回的 `LightweightArticleDataset`
带每篇 384 维 embedding，500 篇 ≈ 2.5MB，远超限。100 篇（~0.5MB）只是压着线没炸。

**修复**：embeddings **卸载到 R2**——`prepare_dataset` 把 embeddings 写
`datasets/{workflowId}/embeddings.json`，step 只返回轻量 `articles + embeddingsR2Key`；
step 返回后在 workflow body 里从 R2 读回挂到 dataset（**不要**包在 `step.do` 里，
否则又被序列化成 step 输出）。下游 assessArticleQuality/clustering 不变。

**教训**：
1. CF Workflow 的容量瓶颈是 **step 输出大小**，不是内存——大数组(embeddings/全文)
   绝不走 step 边界，存 R2 传 key（与项目"DB 元数据 + R2 原文"混合存储一致）。
2. step 之间传大对象用"R2 key + step 后读回"，读回放在 step 外（in-memory），
   避免二次序列化。

---

## 15. 简报质量的根因是**源覆盖**，不是聚类/prompt（最高杠杆所在）

**现象**：简报空、爱编造、聚类全判 PURE_NOISE、0 stories——一路当成
聚类参数/prompt/LLM 问题在修。

**根因（完整诊断链）**：编造 → 燃料来自回灌 TLDR（§12，已断）→ 但更根本是
brief 没真料 → validator 全判 PURE_NOISE → 聚类无多篇故事可聚 → **源稀疏**：
近 7 天仅 4 个活跃源、其中 **HN 占 65%（天生单篇、无冗余）**；配置的 7 个源里
**Reuters World / 联合早报 / 端傳媒 三个的 RSS URL 失效（404），一篇没抓到**
（`last_checked` 一直 null，但 `do_initialized_at` 已设——抓取排程了但每次 fetch 失败）。
聚类是为"多源海量、同事件多家重叠报道"设计的，4 源 + HN 主导的结构在它适用范围之外。

**修复**：修 端傳媒 URL（`/newsfeed`→`/rss`）、用 Guardian/Al Jazeera/NPR/France24
替代死源。验证：源丰富后同一事件被多家报道（"美伊停火"= Al Jazeera+Guardian+Politico），
聚类终于出真故事，**真实 story 数 2 → 9 → 29**。

**教训**：
1. **"编造是饿出来的不是坏出来的"被实证**——下游的编造/空洞是上游数据匮乏的症状，
   先喂饱上游（源覆盖）再谈夹编造/调 prompt。
2. **故事形成（聚类+验证）是最高杠杆**，而它又被**源覆盖**决定：聚类要靠"多家报同
   一事件"的冗余，源不重叠就无活可干。诊断要一路追到源，别停在算法层。
3. 死源排查信号：`sources.last_checked IS NULL` 但 `do_initialized_at` 非空 =
   排程了但 fetch 一直失败，**八成是 RSS URL 失效**（curl 一下，多半 404 返回 HTML）。

---

## 16. DBCV（几何聚类质量）对"语义 conflation"是盲的——几何调参反而更糟

**现象**：想用 ml-service 里现成的网格搜索（按 DBCV 选参）自动调聚类。实测对同一批
97 篇：固定参数 4 簇 DBCV=0.12，"DBCV 最优"反而塌成 **2 个巨簇** DBCV=0.50——
几何分数翻倍，但把无关主题揉得更狠（grab-bag 没裂开，反被吸进更大的簇）。

**根因**：DBCV/`validity_index` 衡量的是**几何**（簇在 UMAP 空间里是否致密、分得开），
不是**语义**（一簇=一个故事）。对一天的新闻，几何上最"干净"的划分就是 2 个大团，
而那正是我们最不想要的。两种"好"相关但不等价，grab-bag 正是几何 OK / 语义烂。

**修复/方向**：聚类 eval 不能用 DBCV 当目标函数。改用**语义参考划分**：强模型
（qwen-max）一次性把当天文章分成故事作 gold，再用确定性 **B-cubed**
（precision=conflation，recall=fragmentation）打分。LLM 只用一次产参考，打分无 LLM。
见 `scripts/eval/clustering/`。

**教训**：
1. **无监督聚类的内置指标（DBCV/silhouette）优化的是几何，不是业务语义**——
   直接拿来自动调参可能把系统往错方向推。先确认指标和业务目标是否一致。
2. 语义评估的成本/循环问题解法：**把昂贵的语义判断（产参考）做一次，把打分
   （确定性指标）做无数次**；参考用更强、且方法不同的模型，避免"自己评自己"。

---

## 17. 源管理 / Durable Object 运维坑

**现象**：改了 `sources.url` 但抓取还在用旧 URL；`/do/admin/initialize-dos` 对死源
不起作用；调 init 端点 401。

**根因 & 正确姿势**：
- **DO id 由 URL 派生**（`SOURCE_SCRAPER.idFromName(source.url)`）→ 改 URL =
  映射到**全新 DO**，旧 DO（存着旧 URL）还在跑。光改 DB 的 url **无效**，
  必须重新 init 让新 DO 拿到新 url。
- **`/do/admin/initialize-dos` 只挑 `do_initialized_at IS NULL` 的源**——死源
  （已初始化过）会被跳过。改 URL 后要用**单源** `POST /do/admin/source/:id/init`。
- **新增源**：`POST /admin/sources` 只插 DB（不碰 DO），且 `scrape_frequency` 默认
  60 会被 DO 当非法值降级成 tier 2——**插入时显式传 `1`**。然后 `initialize-dos`
  挑走新源（null）。init 会设 +5s alarm 立即抓一轮，之后 DO 靠自身 alarm 自循环
  （**无 cron**，全靠 DO 自调度）。
- init 端点要 `Authorization: Bearer <API_TOKEN>`（backend secret）。`wrangler secret
  put API_TOKEN` 设；`!` 非交互环境弹不出输入提示，用 `echo "val" | wrangler secret
  put API_TOKEN` 喂值。

**教训**：DO 的身份/状态独立于 DB 行——改 DB 不等于改 DO 行为。涉及 DO 的源变更
都要"改 DB + 重新 init"两步，且分清"批量 init 只管新源 / 单源 init 管任意"。

---

## 复盘总结

17 个问题按性质聚类：

| 类别 | 编号 | 共同教训 |
|---|---|---|
| Provider/网关边界 | 1, 8 | 跨 provider 抽象层必须显式建模"路径差异 + 内容审核差异" |
| 配置耦合 | 2, 3 | 模型名、连接字符串这类隐式 contract 必须 hard-code 在唯一来源 |
| 参数透传链路 | 4, 5 | 长链路里**每一层都要自己 enforce**，shadowing bug 是大敌 |
| 编排默认值 / 容量 | 6, 14 | LLM step 显式覆盖 timeout；大对象绝不走 step 输出（~1MB SQLite 限），卸 R2 |
| Prompt + 数据形态 | 7 | Prompt 改动**必须配 eval**；prompt 措辞影响远超直觉 |
| LLM 输出鲁棒性 | 9, 10, 11 | parser 容错；推理与结构化输出分离；structured output 仅 json_object 治不了形态漂移 |
| 自我放大 / 回灌 | 12 | LLM 输出回灌成输入会自我放大编造；数据层断源 > prompt 禁令 |
| 查询正确性 | 13 | `LIMIT` 必配 `ORDER BY`；"取最新"类按时间倒序，否则新数据进不来 |
| **根因层级** | **15** | **简报质量根因是源覆盖，不是算法/prompt——"编造是饿出来的"；诊断一路追到源** |
| 评估指标选型 | 16 | 无监督内置指标(DBCV)优化几何非语义，别拿来自动调参；语义评估靠"一次参考+确定性打分" |
| 运维 / DO | 17 | DO 身份独立于 DB 行，改源要"改 DB + 重新 init"两步 |

下一阶段直接动机：
- **源覆盖是当前 roadmap 主线**（来自 §15）—— 加更多会重叠报道的主流源
- **聚类语义 eval**（来自 §16）—— 用 B-cubed 量化故事形成质量、对比算法
- **下游容量**：intel/brief 仍受 maxStoriesToGenerate 与 brief 1MB 限制制约
  （§14 的 R2 卸载套路可复用到 intel 报告 / brief 输出）
