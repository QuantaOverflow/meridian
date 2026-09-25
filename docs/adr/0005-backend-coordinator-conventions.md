# ADR 0005：backend 作为协调层的约定（补记）

- 状态：已采纳（补记 2025-07 的四份阶段总结，2026-09-12 核对现行代码后蒸馏；原文件已删除）
- 来源：`apps/backend/docs/` 下的 `LIBRARY_CLEANUP_SUMMARY.md`、`CLUSTERING_OPTIMIZATION_SUMMARY.md`、
  `OPTIMIZATION_SUMMARY.md`、`REFACTORING_SUMMARY.md`（见 git 历史）

## 仍然成立的决定

1. **backend 是薄协调层，错误谁的谁处理**：backend 负责编排与转发；ai-worker 自己处理模型错误与重试，ml-service 自己处理计算错误。
   backend 用原生异常 + try/catch，**不用 Result 包装（neverthrow 那一套）**——当时实测错误处理代码减少一大半，调用链更直。
   现状：代码里已无 `neverthrow` 引用，`apps/backend/package.json` 里的这个死依赖已于 2026-09-23 移除
2. **聚类请求只带 embedding 与元数据，不带正文**：ml-service 的聚类只用向量；正文由下游步骤按需从 R2 取。
   现状：`apps/backend/src/lib/services/ml-service.ts` 文件头仍写着这条
3. **测试跑在 Workers 的 vitest pool 里**（`@cloudflare/vitest-pool-workers`）：测试里不能用 Node 的 `fs` 读文件，测试数据要内联或走 Workers 可用的方式
   - 现状：`package.json` 的 `test:safe`（指向已不存在的 `scripts/run-tests.sh`，当时为多文件并发撞同一张表写的逐个运行脚本）已于 2026-09-23 移除

## 已失效、不再参考的内容

- 统一 API 工具库 `lib/api-utils.ts` 与当时的路由精简方案：文件已不存在，`debug.ts` 路由也已删除——路由结构以现行 `apps/backend/src/routers/` 为准
- 各文档里的测试数量、耗时、性能百分比：当时的一次性读数
