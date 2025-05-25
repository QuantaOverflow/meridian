# Meridian AI Worker

基于 Cloudflare AI Gateway 的简化多 LLM 服务调用 Worker。

> 📘 **完整文档**: 查看 [综合指南](./COMPREHENSIVE_GUIDE.md) 获取详细的架构设计、API 使用、部署和故障排除信息。

## 架构设计

┌─────────────────────────────────────┐
│         HTTP 服务层 (Hono.js)        │  ← 路由处理、CORS、请求解析
├─────────────────────────────────────┤
│       认证与安全层 (Auth Layer)       │  ← 身份验证、权限控制
├─────────────────────────────────────┤
│    业务逻辑层 (AI Gateway Service)    │  ← 核心业务逻辑、能力路由
├─────────────────────────────────────┤
│      基础设施层 (Infrastructure)      │  ← 重试、日志、元数据
├─────────────────────────────────────┤
│     提供商适配层 (Provider Layer)     │  ← AI 提供商抽象与适配
└─────────────────────────────────────┘

## 功能特性

- 🚀 **统一的 AI Gateway 请求格式** - 通过 Cloudflare AI Gateway 统一访问多个 AI 提供商
- 🔄 **多提供商支持** - 支持 OpenAI、Workers AI、Anthropic 等主流 LLM 提供商
- 🛡️ **自动故障转移和回退机制** - 智能故障处理，确保服务高可用性
- ⚡ **智能缓存策略** - 基于内容的自动缓存，提升响应速度并降低成本
- 💰 **成本跟踪** - 实时成本估算和跟踪，支持自定义标签
- 🔐 **AI Gateway 认证** - 支持 AI Gateway 访问令牌认证
- 📊 **增强监控** - 完整的请求日志、指标收集和分析
- 📈 **智能重试** - 可配置的重试策略和错误处理
- 🎯 **能力路由** - 基于 AI 能力的智能模型选择

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
# 必需的 Cloudflare 密钥
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put CLOUDFLARE_GATEWAY_ID
wrangler secret put CLOUDFLARE_API_TOKEN

# 至少一个 AI 提供商密钥
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY

# AI Gateway 增强功能（可选）
wrangler secret put AI_GATEWAY_AUTH_TOKEN
wrangler secret put AI_GATEWAY_ENABLE_COST_TRACKING
wrangler secret put AI_GATEWAY_ENABLE_CACHING
wrangler secret put AI_GATEWAY_ENABLE_METRICS
```

> 📘 **配置详情**: 查看 [AI Gateway 配置指南](./docs/AI_GATEWAY_CONFIGURATION.md) 获取完整的环境变量配置说明。

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

## 项目结构

```text
├── src/
│   ├── index.ts                        # 主入口和路由
│   ├── types.ts                        # 类型定义
│   ├── services/
│   │   ├── ai-gateway.ts               # AI Gateway 核心服务
│   │   ├── ai-gateway-enhancement.ts   # AI Gateway 增强功能
│   │   └── providers/                  # LLM 提供商适配器
│   │       ├── openai.ts
│   │       ├── workers-ai.ts
│   │       └── anthropic.ts
│   ├── config/
│   │   └── providers.ts                # 提供商配置（含 AI Gateway 配置）
│   └── capabilities/                   # AI 能力处理器
│       ├── chat.ts
│       ├── embedding.ts
│       └── ...
├── docs/
│   └── AI_GATEWAY_CONFIGURATION.md    # AI Gateway 配置指南
└── wrangler.toml                      # Cloudflare Workers 配置
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

## 环境变量配置

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | Cloudflare 账户 ID |
| `CLOUDFLARE_GATEWAY_ID` | ✅ | AI Gateway ID |
| `CLOUDFLARE_API_TOKEN` | ✅ | Cloudflare API Token |
| `OPENAI_API_KEY` | ✅ | OpenAI API 密钥 |
| `ANTHROPIC_API_KEY` | ❌ | Anthropic API 密钥 |
| `GOOGLE_API_KEY` | ❌ | Google API 密钥 |

### AI Gateway 增强功能变量

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `AI_GATEWAY_AUTH_TOKEN` | ❌ | - | AI Gateway 认证令牌 |
| `AI_GATEWAY_ENABLE_COST_TRACKING` | ❌ | false | 启用成本跟踪 |
| `AI_GATEWAY_ENABLE_CACHING` | ❌ | false | 启用智能缓存 |
| `AI_GATEWAY_DEFAULT_CACHE_TTL` | ❌ | 3600 | 默认缓存 TTL（秒） |
| `AI_GATEWAY_ENABLE_METRICS` | ❌ | false | 启用增强指标收集 |
| `AI_GATEWAY_ENABLE_LOGGING` | ❌ | false | 启用详细日志记录 |

## 开发指南

### 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 快速健康检查
npm run health

# 查看 AI Gateway 配置状态
npm run config

# 查看可用提供商
npm run providers

# 运行集成测试
npm run test:integration

# 运行性能测试
./test-performance.sh
```

### 开发脚本说明

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 启动本地开发服务器 |
| `npm run build` | 构建项目 |
| `npm run deploy` | 部署到 Cloudflare Workers |
| `npm run deploy:prod` | 部署到生产环境 |
| `npm run test` | 运行单元测试 |
| `npm run test:integration` | 运行集成测试 |
| `npm run health` | 快速健康检查 |
| `npm run config` | 查看 AI Gateway 配置状态 |
| `npm run providers` | 查看可用提供商列表 |

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

## 文档资源

- [AI Gateway 配置指南](docs/AI_GATEWAY_CONFIGURATION.md) - 详细的配置说明和故障排除
- [部署清单](DEPLOYMENT_CHECKLIST.md) - 生产部署步骤和验证
- [项目完成报告](PROJECT_COMPLETION_REPORT.md) - 完整的项目总结和技术详情

## 贡献指南

欢迎提交 Issues 和 Pull Requests 来改进这个项目！

## 许可证

MIT License

## 流程图

graph TD
    A[HTTP 请求] --> B[CORS 中间件]
    B --> C[路由匹配 /ai]
    C --> D[AIGatewayService.processRequestWithAuth]
    D --> E[AuthenticationService 验证]
    E --> F[解析 AI 请求]
    F --> G[生成请求元数据]
    G --> H[RetryService 包装]
    H --> I[构建 Universal Request]
    I --> J[AI Gateway 统一端点]
    J --> K[Cloudflare 智能路由]
    K --> L[提供商 API 调用]
    L --> M[响应映射]
    M --> N[元数据增强]
    N --> O[返回 HTTP 响应]
```