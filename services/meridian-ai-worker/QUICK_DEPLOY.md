# Meridian AI Worker - 快速部署指南

**⏱️ 预计部署时间：5-10分钟**

本指南将帮助您快速部署 Meridian AI Worker 到 Cloudflare Workers 平台。

## 📋 前置要求

- **Node.js** v18+ 
- **npm** 或 **pnpm**
- **Cloudflare 账户**（免费账户即可）
- **AI 提供商 API 密钥**（至少一个）：
  - OpenAI API Key（推荐）
  - Anthropic API Key（可选）
  - Google AI API Key（可选）

## 🚀 快速开始

### 步骤 1: 克隆项目并安装依赖

```bash
# 克隆项目
git clone <项目地址>
cd meridian/services/meridian-ai-worker

# 安装依赖
npm install

# 安装 Wrangler CLI（如果尚未安装）
npm install -g wrangler
```

### 步骤 2: 配置 Cloudflare

#### 2.1 登录 Cloudflare

```bash
wrangler login
```

#### 2.2 获取必需的 Cloudflare 信息

1. **获取账户 ID**：
   - 访问 [Cloudflare Dashboard](https://dash.cloudflare.com)
   - 在右侧栏找到 "账户 ID"

2. **创建 AI Gateway**：
   - 导航到 **AI** → **AI Gateway**
   - 点击 **Create Gateway**
   - 记下 Gateway ID

3. **生成 API Token**：
   - 访问 **我的个人资料** → **API 令牌**
   - 创建自定义令牌，权限：`Workers:Edit`

### 步骤 3: 配置环境变量

#### 3.1 使用自动化配置脚本（推荐）

```bash
# 运行配置助手
./scripts/setup-env.sh
```

按照提示输入：
- Cloudflare 账户 ID
- Cloudflare Gateway ID  
- Cloudflare API Token
- OpenAI API Key（或其他 AI 提供商密钥）

#### 3.2 手动配置（备选）

```bash
# 必需配置
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put CLOUDFLARE_GATEWAY_ID
wrangler secret put CLOUDFLARE_API_TOKEN

# 至少配置一个 AI 提供商
wrangler secret put OPENAI_API_KEY
# 或
wrangler secret put ANTHROPIC_API_KEY
```

### 步骤 4: 本地测试（可选但推荐）

```bash
# 启动本地开发服务器
npm run dev
```

在另一个终端中测试：

```bash
# 健康检查
curl http://localhost:8787/health

# 测试 AI 功能
curl -X POST http://localhost:8787/ai \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "chat",
    "messages": [{"role": "user", "content": "Hello!"}],
    "provider": "openai"
  }'
```

### 步骤 5: 部署到生产环境

```bash
# 部署到 Cloudflare Workers
npm run deploy
```

部署成功后，您将看到类似的输出：
```
✨ Success! Deployed to https://meridian-ai-worker.<your-subdomain>.workers.dev
```

## 🧪 验证部署

### 5.1 运行自动化测试

```bash
# 设置您的部署 URL 并运行测试
export MERIDIAN_AI_WORKER_URL="https://meridian-ai-worker.<your-subdomain>.workers.dev"
./scripts/test-deployment.sh
```

### 5.2 手动验证

```bash
# 替换为您的实际部署 URL
BASE_URL="https://meridian-ai-worker.<your-subdomain>.workers.dev"

# 1. 健康检查
curl "$BASE_URL/health"

# 2. 配置验证
curl "$BASE_URL/ai-gateway/config"

# 3. 提供商列表
curl "$BASE_URL/providers"

# 4. AI 功能测试
curl -X POST "$BASE_URL/ai" \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "chat",
    "messages": [{"role": "user", "content": "Hello from production!"}],
    "provider": "openai"
  }'
```

## ✅ 成功标志

如果看到以下响应，说明部署成功：

```json
// GET /health
{
  "status": "healthy",
  "service": "Meridian AI Worker",
  "version": "1.0.0",
  "timestamp": "2025-01-XX..."
}

// POST /ai
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "choices": [...],
  "usage": {...}
}
```

## 🔧 高级配置（可选）

### 启用 AI Gateway 增强功能

```bash
# 成本跟踪
wrangler secret put ENABLE_COST_TRACKING # 输入: true

# 智能缓存
wrangler secret put ENABLE_CACHING # 输入: true
wrangler secret put DEFAULT_CACHE_TTL # 输入: 3600

# 详细监控
wrangler secret put ENABLE_METRICS # 输入: true
wrangler secret put ENABLE_LOGGING # 输入: true
```

### 设置自定义域名

1. 在 Cloudflare Dashboard 中添加您的域名
2. 配置 Workers 路由：

```bash
wrangler route add "api.yourdomain.com/*" meridian-ai-worker
```

## 🔗 下一步

- 📖 查看 [COMPREHENSIVE_GUIDE.md](./COMPREHENSIVE_GUIDE.md) 了解完整功能
- 🔧 阅读 [AI Gateway 配置指南](./docs/AI_GATEWAY_CONFIGURATION.md)
- 🧪 探索 API 端点和示例用法

## ⚠️ 故障排除

### 常见问题

1. **部署失败**：
   ```bash
   # 检查 wrangler 配置
   wrangler whoami
   wrangler secret list
   ```

2. **AI 请求失败**：
   - 确认 API 密钥配置正确
   - 检查 AI Gateway 设置
   - 验证网络连接

3. **权限错误**：
   - 确认 Cloudflare API Token 权限
   - 检查账户 ID 是否正确

### 获取帮助

- 查看错误日志：`wrangler tail`
- 检查配置状态：`curl https://your-worker.workers.dev/ai-gateway/config`
- 参考 [完整文档](./COMPREHENSIVE_GUIDE.md) 获取详细故障排除信息

---

**🎉 恭喜！您已成功部署 Meridian AI Worker**

现在您可以通过统一的 API 接口访问多个 AI 提供商的服务了！
