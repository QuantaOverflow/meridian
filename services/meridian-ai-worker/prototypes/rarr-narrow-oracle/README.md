# RARR 六项修法合并对照（扔掉型原型）

**问题**：六项 RARR 修法一起上，效果如何？

两臂同批同时跑——Workers AI 在 `temperature: 0` 下仍不确定，且 R2 归档是几天前另一次部署的，都不能当「现在的基线」，只有两臂之差才是改动的效果：

- `baseline`：旧 prompt（含 ABSENT 分支、无举证字段）+ 全量 25 份 oracle + 旧 G2（整段逐字）、无 G5、无删除预算
- 改动臂：六项修法

**跑**：`pnpm run probe`（`probe.ts`、`rarr-arm.ts`、`baseline-prompt.ts`）
