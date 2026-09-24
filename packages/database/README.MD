# @meridian/database

Drizzle ORM 的表定义与连接工厂，backend、frontend 与 backend 的运维脚本共用。生产库是 Neon Postgres
（`ap-southeast-1`），backend 经 Hyperdrive 连接，frontend 直连。

- `src/schema.ts`：全部表与枚举。表对象以 `$` 开头（`$sources`、`$articles`、`$reports`、`$newsletter`、
  `$brief_runs`、`$story_clusters`、`$brief_stories`、`$cluster_rejections`）；`articles.embedding` 是 384 维 `vector`（pgvector，HNSW 索引）
- `src/database.ts`：`getDb(url)`
- `src/index.ts`：导出上面两者和常用的 drizzle 操作符
- `migrations/`：`drizzle-kit generate` 的产物，已应用的 migration 不改

## 命令

`drizzle.config.ts` 从环境变量 `DATABASE_URL` 读连接串（`dotenv`，可放在本目录 `.env`，模板见 `.env.example`）。

```bash
pnpm -F @meridian/database generate    # 按 schema.ts 生成新 migration
pnpm -F @meridian/database migrate     # 应用 migration
pnpm -F @meridian/database studio      # drizzle-kit studio
pnpm -F @meridian/database typecheck
pnpm -F @meridian/database seed        # 插入一个示例源（Hacker News）
```

改 schema 的流程：编辑 `src/schema.ts` → `generate` → 审阅生成的 SQL → 与 schema 改动一起提交。

本地需要一个带 pgvector 的 Postgres，例如：

```bash
docker run --name meridian-pg -e POSTGRES_PASSWORD=mysecretpassword -p 5432:5432 pgvector/pgvector:pg16
```
