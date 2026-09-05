# RARR oracle 收窄（扔掉型原型）

**问题**：把 RARR 接地校验的 oracle 从「全部 25 份情报报告」收窄到 `rankSourcesByRelevance(claim, reports, k)` 检索出的 top-k 份，已确认误删的支持证据还留不留在 top-k 里？收窄若把该保留的证据挤出去，这个修法就会制造新的误删，不能做。

**跑**：`pnpm run probe`（`probe.ts`）
