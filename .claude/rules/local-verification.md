---
paths:
  - "apps/backend/**"
  - "services/meridian-ai-worker/**"
---

# 本地验证（不需要部署）

**原则：typecheck 通过 + 本地 curl 验证 = 可以 commit；部署只在功能确认后做。**

## 验证 ai-worker 单个端点（最常用，覆盖 90% 场景）

```bash
# Terminal 1：启动 ai-worker（secrets 从 .dev.vars 读，LLM 走真实 DashScope 会计费）
cd services/meridian-ai-worker && pnpm wrangler dev --port 8787

# Terminal 2：curl 打端点
curl -s -X POST http://localhost:8787/meridian/<endpoint> \
  -H "Content-Type: application/json" \
  -d '{ ... }' | jq .
```

不需要 backend，可以单独测 ai-worker 任何端点。启动时 wrangler 会打印
`Your worker has access to the following bindings`，确认 bindings 已连接。

## backend + ai-worker 联调（测 service binding 调用链）

```bash
# 必须用单命令多 -c，两个分开的 wrangler dev 进程不会自动互连
# 第一个 config = primary（暴露 HTTP），后续 = auxiliary（只通过 service binding 被调用）
pnpm wrangler dev \
  -c apps/backend/wrangler.toml \
  -c services/meridian-ai-worker/wrangler.toml
# backend 监听 8787（默认），ai-worker 作为 service binding 在内部解析
```

## R2 注意事项

- 本地 `wrangler dev` 默认用**本地模拟 R2**（非真实 bucket），写入的对象只在本次进程存在
- 如需读取生产 R2 里的真实 intel report，在 wrangler.toml 的 r2_buckets 加 `remote = true`
- Workflow 测试通常需要真实 R2（因为 intel report 由上一 step 写入），建议用 `--remote` 模式或 `remote = true`

## Workflow 本地触发

```bash
# wrangler dev 跑起来后，通过 HTTP 触发 workflow（见 backend admin 路由）
curl -X POST http://localhost:8787/admin/trigger-brief ...
# 或用 wrangler workflows 命令查看实例
wrangler workflows instances list <WORKFLOW_NAME>
```

## typecheck 的两个坑

- `pnpm typecheck` 走 turbo 整包缓存，显示 `FULL TURBO` 时等于没验。要进各包直接跑
  `./node_modules/.bin/tsc --noEmit`，并做反向对照（塞个类型错确认会红）。
- backend 的 pnpm 包名是 `@meridian/backend`。写成 `meridian-backend` 时 pnpm 判定
  「未匹配项目」并**静默退出 0**，看起来像通过了。
