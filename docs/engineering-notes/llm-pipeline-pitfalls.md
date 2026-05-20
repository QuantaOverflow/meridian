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

## 复盘总结

10 个问题按性质聚类：

| 类别 | 编号 | 共同教训 |
|---|---|---|
| Provider/网关边界 | 1, 8 | 跨 provider 抽象层必须显式建模"路径差异 + 内容审核差异" |
| 配置耦合 | 2, 3 | 模型名、连接字符串这类隐式 contract 必须 hard-code 在唯一来源 |
| 参数透传链路 | 4, 5 | 长链路里**每一层都要自己 enforce**，shadowing bug 是大敌 |
| 编排默认值 | 6 | LLM step 永远显式覆盖 timeout，默认值是"普通业务"设计的 |
| Prompt + 数据形态 | 7 | Prompt 改动**必须配 eval**，否则迭代是盲调；prompt 措辞影响远超直觉 |
| LLM 输出鲁棒性 | 9, 10 | JSON 输出 parser 必须容错；推理与结构化输出不能同步 |

下一阶段直接动机：
- **eval 框架**（来自 §7）—— 让 prompt 迭代有客观信号而不是盲调
- **per-step token & latency 观测**（来自 §6, §10）—— 给 cost / regression
  报告托底
- **provider 失败率监控**（来自 §1, §8）—— 给后续多 provider fallback 决策
  提供数据
