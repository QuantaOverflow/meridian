# Meridian AI Worker

基于 Cloudflare AI Gateway 的简化多 LLM 服务调用 Worker。

> 📘 **完整文档**: 查看 [综合指南](./COMPREHENSIVE_GUIDE.md) 获取详细的架构设计、API 使用、部署和故障排除信息。

## 功能特性

- 🚀 统一的 AI Gateway 请求格式
- 🔄 支持多个 LLM 提供商（OpenAI、Workers AI、Anthropic）
- 🛡️ 自动故障转移和回退机制
- ⚡ 内置缓存和速率限制
- 📊 完整的请求日志和分析

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
# 设置 Cloudflare 密钥
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put CLOUDFLARE_GATEWAY_ID
wrangler secret put CLOUDFLARE_API_TOKEN

# 设置 LLM 提供商密钥
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
```

### 3. 本地开发

```bash
npm run dev
```

### 4. 部署

```bash
npm run deploy
```

## API 使用

### 聊天接口

```http
POST /chat
```

请求示例：

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  "provider": "openai",
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "max_tokens": 1000,
  "fallback": true
}
```

响应示例：

```json
{
  "id": "chat-1234567890",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "Hello! I'm doing well, thank you for asking."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 15,
    "total_tokens": 25
  },
  "provider": "openai",
  "cached": false
}
```

### 支持的提供商

- `openai` - OpenAI GPT 模型
- `workers-ai` - Cloudflare Workers AI
- `anthropic` - Anthropic Claude 模型

### 故障转移

设置 `fallback: true` 可以在主要提供商失败时自动切换到其他提供商。

## 架构设计

```text
├── src/
│   ├── index.ts              # 主入口和路由
│   ├── types.ts              # 类型定义
│   ├── services/
│   │   ├── ai-gateway.ts     # AI Gateway 服务
│   │   └── providers/        # LLM 提供商适配器
│   │       ├── openai.ts
│   │       ├── workers-ai.ts
│   │       └── anthropic.ts
```

## 特性说明

### 统一请求格式

所有请求都通过 Cloudflare AI Gateway 的统一端点，自动处理不同提供商的差异。

### 自动缓存

利用 AI Gateway 的缓存功能，相同请求会直接返回缓存结果，提高响应速度并降低成本。

### 智能故障转移

当主要提供商不可用时，自动切换到备用提供商，确保服务可用性。

### 请求分析

通过 AI Gateway 获得完整的请求分析和日志，便于监控和优化。

## 环境变量

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | Cloudflare 账户 ID |
| `CLOUDFLARE_GATEWAY_ID` | ✅ | AI Gateway ID |
| `CLOUDFLARE_API_TOKEN` | ✅ | Cloudflare API Token |
| `OPENAI_API_KEY` | ✅ | OpenAI API 密钥 |
| `ANTHROPIC_API_KEY` | ❌ | Anthropic API 密钥 |
| `GOOGLE_API_KEY` | ❌ | Google API 密钥 |

## 开发指南

### 添加新的提供商

1. 在 `src/services/providers/` 目录下创建新的提供商适配器
2. 实现 `buildRequest` 和 `mapResponse` 方法
3. 在 `ai-gateway.ts` 中注册新提供商
4. 更新类型定义和文档

### 本地测试

```bash
# 启动开发服务器
npm run dev

# 测试健康检查
curl http://localhost:8787/health

# 测试聊天接口
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "provider": "openai"
  }'
```

## 许可证

MIT License
