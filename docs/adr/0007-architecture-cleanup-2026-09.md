# ADR 0007：2026-09 架构清理——一个概念一个负责人，平台接线改用 binding

- 状态：已采纳，全部上线（2026-09-26）
- 来源：2026-09-23 模块耦合梳理（`docs/debt.md`）与随后的架构报告（① ② ③、A2–A7）；逐条裁决记在 `docs/debt.md`

## 问题的共同形状

同一份知识散在多处、没有唯一负责人：前端直连数据库读写、同一个默认值有三份、跨服务的数据格式两边各抄一份、
一期里同一个故事每一步换一个下标。改一处漏一处，typecheck 拦不住，只能等运行时出错。

## 决定

每个概念收进一个负责的 module，放到 seam 后面；调用方只经 seam 打交道。

| 概念 | 负责的 module | 模式 | 行为变化 |
|---|---|---|---|
| 源的增删改（sources 行 ⇔ 抓取 DO） | backend `lib/sources.ts` | 聚合根：写入时守住「表里有 ⇔ DO 在跑」 | 修 bug（新增源不启动 DO、改 url 不同步） |
| 读者页与后台的读数 | backend `lib/reader/`（`/reader/*`） | 查询服务 / 读模型；去掉 Integration Database 反模式 | 零（`/api/*` 快照逐字节比对） |
| 前端调 backend | 前端 `lib/backend.ts`（读）、`lib/sourceActions.ts`（写） | 被驱动方 adapter；不另抽 port，替换发生在 HTTP seam | 修 bug（对 backend 500 回 success） |
| LLM 调用 | ai-worker `callLLM` / `callLLMUntilAccepted` | 删掉只剩一个实现的 provider / capability / gateway 层（deletion test） | 零 |
| 一期里的故事 | backend `lib/core/story-ledger.ts` | 一个 storyId 贯穿全程的账本（单一数据源） | 零（replay 无差异）；来源数现只在 `compute:source_coverage` 算一次记入账本，报告里的 B6（三处口径不一）是否因此消除未单独验证 |
| 一期的输入 | backend `lib/core/run-corpus.ts` + `CRON_BRIEF_PARAMS` | 默认值与时间窗条件只写一次 | 手动触发改用 cron 同一组默认值 |
| 跨服务约定 | `packages/contracts` | Shared Kernel：只放约定不放实现 | 零 |

平台接线同一轮改为 binding：backend → ml 走 service binding，ml 关公网、删 token（debt D3 / S1）；
浏览器抓取改 Browser Run binding 的 `quickAction`（compatibility_date 升到 2026-03-24）。

## 刻意没做的抽象

- 前端 backend 客户端不抽 port interface：只有一个实现，替换只发生在测试，HTTP seam 已够用。出现第二种调用方式时再抽。
- ml 的请求/响应格式不跨语言共享：`ml-service.ts` 与 `schemas.py` 各一份，靠 replay 兜底。接口变多时让 FastAPI 导出 OpenAPI 再生成 TS 类型。

## 延后

- 抓取 DO 按 url 命名（会变的自然键当身份）→ debt D15，现有两道防护已管住。
- 读者接口与后台共用 `API_TOKEN` → debt D16。
- 每期的 embedding 数据集只写不删 → debt D17（删源时的 R2 正文已会一并删除）。

## 验证

每批合并后跑 typecheck、四套测试、knip、replay（零差异）；生产以 Current Version ID 判定部署，
以 cron 期与一次手动期 `brief_runs` 为 COMPLETED 判定链路。
