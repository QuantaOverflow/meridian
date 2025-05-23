# 部署指南

## 前提条件

1. **Cloudflare 账户**
   - 注册 Cloudflare 账户
   - 获取 Account ID（在右侧边栏可以找到）

2. **AI Gateway 设置**
   - 在 Cloudflare Dashboard 中创建 AI Gateway
   - 记录 Gateway ID

3. **API 密钥**
   - Cloudflare API Token（需要 Workers 和 AI Gateway 权限）
   - OpenAI API Key
   - Anthropic API Key（可选）

## 环境变量配置

使用 wrangler 设置环境变量：

```bash
# Cloudflare 配置
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put CLOUDFLARE_GATEWAY_ID
wrangler secret put CLOUDFLARE_API_TOKEN

# AI 提供商密钥
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY  # 可选
```

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 在另一个终端测试
curl http://localhost:8787/health
```

## 部署到生产环境

### 1. 部署到开发环境
```bash
npm run deploy
```

### 2. 部署到生产环境
```bash
npm run deploy:prod
```

## 验证部署

### 1. 健康检查
```bash
curl https://your-worker-subdomain.your-account.workers.dev/health
```

### 2. 测试聊天功能
```bash
curl -X POST https://your-worker-subdomain.your-account.workers.dev/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "provider": "openai"
  }'
```

## 自定义域名（可选）

1. 在 `wrangler.toml` 中配置自定义域名：
```toml
[env.production]
routes = [
  { pattern = "ai.yourdomain.com", custom_domain = true }
]
```

2. 重新部署：
```bash
npm run deploy:prod
```

## 监控和日志

### 查看实时日志
```bash
wrangler tail
```

### 在 Cloudflare Dashboard 中查看
- Workers & Pages > meridian-ai-worker > Logs
- AI Gateway > your-gateway > Analytics

## 故障排除

### 常见问题

1. **环境变量未设置**
   ```
   Error: Environment variables not configured
   ```
   解决：确保所有必需的环境变量都已通过 `wrangler secret put` 设置

2. **AI Gateway 错误**
   ```
   Error: AI Gateway error: 401 Unauthorized
   ```
   解决：检查 CLOUDFLARE_API_TOKEN 权限和 CLOUDFLARE_GATEWAY_ID 是否正确

3. **提供商 API 错误**
   ```
   Error: 401 Unauthorized from OpenAI
   ```
   解决：检查 OPENAI_API_KEY 是否有效

### 调试模式

在本地开发时，可以在 `.env` 文件中设置环境变量：

```bash
# 复制示例文件
cp .env.example .env

# 编辑 .env 文件
# 注意：.env 文件仅用于本地开发，不要提交到版本控制
```

## 性能优化

1. **缓存设置**
   - AI Gateway 自动缓存相同请求
   - 默认缓存时间：1小时
   - 可通过 `cf-aig-cache-ttl` 头部调整

2. **并发限制**
   - Cloudflare Workers 自动处理并发
   - 可在 AI Gateway 设置速率限制

3. **成本优化**
   - 使用缓存减少 API 调用
   - 启用故障转移避免重复计费
   - 在 AI Gateway Dashboard 监控使用情况

## 更新和维护

### 更新代码
```bash
git pull origin main
npm install
npm run deploy
```

### 更新依赖
```bash
npm update
npm run deploy
```

### 备份配置
定期备份 `wrangler.toml` 和环境变量配置。
