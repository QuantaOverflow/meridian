# Meridian AI Worker - 综合指南

## 📖 概述

Meridian AI Worker 是基于 Cloudflare AI Gateway 的增强版多 LLM 服务调用 Worker，提供统一的 AI 服务接口，支持多个 AI 提供商（OpenAI、Anthropic、Workers AI、Google AI）。本指南提供详细的架构设计、API 使用说明、部署配置和故障排除信息。

### 🎯 设计目标

- **统一接口**: 通过单一端点访问多个 AI 提供商
- **高性能**: 基于 Cloudflare Workers 全球边缘网络
- **可扩展**: 模块化设计，易于添加新的 AI 提供商
- **企业级**: 内置认证、成本跟踪、缓存和监控功能
- **兼容性**: 完全兼容 Cloudflare AI Gateway 标准

---

## 🏗️ 架构设计

### 系统架构图

```
                    ┌─────────────────────────────────────┐
                    │         客户端应用 (Client Apps)      │
                    └─────────────────┬───────────────────┘
                                      │ HTTP/HTTPS 请求
                                      ▼
                    ┌─────────────────────────────────────┐
                    │         负载均衡 (Load Balancer)     │
                    └─────────────────┬───────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────┐
│                Cloudflare Edge Network                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┤
│  │           Meridian AI Worker                            │
│  │                                                         │
│  │  ┌─────────────────────────────────────────────────────┤
│  │  │         HTTP 服务层 (Hono.js)                       │  ← 路由处理、CORS、请求解析
│  │  ├─────────────────────────────────────────────────────┤
│  │  │       认证与安全层 (Auth Layer)                     │  ← 身份验证、权限控制
│  │  ├─────────────────────────────────────────────────────┤
│  │  │    AI Gateway 增强服务 (Enhancement Service)       │  ← 成本跟踪、缓存、监控
│  │  ├─────────────────────────────────────────────────────┤
│  │  │    业务逻辑层 (AI Gateway Service)                 │  ← 核心业务逻辑、能力路由
│  │  ├─────────────────────────────────────────────────────┤
│  │  │      基础设施层 (Infrastructure)                    │  ← 重试、日志、元数据
│  │  ├─────────────────────────────────────────────────────┤
│  │  │     提供商适配层 (Provider Layer)                   │  ← AI 提供商抽象与适配
│  │  └─────────────────────────────────────────────────────┘
│  └─────────────────────────────────────────────────────────┘
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              AI 提供商网络 (AI Providers)                    │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │  OpenAI  │  │Anthropic │  │Workers AI│  │Google AI │     │
│  │   API    │  │   API    │  │   API    │  │   API    │     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### 核心组件详解

#### 1. HTTP 服务层 (Hono.js)
- **功能**: 请求路由、CORS 处理、中间件管理
- **技术**: Hono.js 框架，轻量级且高性能
- **特性**: 
  - 自动 TypeScript 类型支持
  - 内置 CORS 中间件
  - 灵活的路由配置

#### 2. 认证与安全层
- **API 密钥验证**: 支持多种 API 密钥格式
- **AI Gateway 令牌**: 专用的 Gateway 访问令牌
- **请求签名**: 可选的请求签名验证机制
- **访问控制**: 基于来源的访问控制

#### 3. AI Gateway 增强服务
- **成本跟踪**: Token 级别的精确成本计算
- **智能缓存**: 基于内容哈希的缓存机制
- **性能监控**: 请求延迟、成功率等指标收集
- **日志记录**: 结构化日志输出

#### 4. 业务逻辑层
- **能力路由**: 根据请求类型自动选择提供商
- **负载均衡**: 在多个提供商间分散请求
- **故障转移**: 自动切换到备用提供商

#### 5. 提供商适配层
- **统一接口**: 所有提供商实现相同的基础接口
- **格式转换**: 自动转换不同提供商的请求/响应格式
- **错误处理**: 统一的错误处理和重试机制

---

## 🔌 API 使用指南

### 统一 AI 接口

#### 基础端点

```http
POST /ai
Content-Type: application/json
Authorization: Bearer your-api-key
```

#### 请求格式

```typescript
interface AIRequest {
  capability: 'chat' | 'embedding' | 'image-generation' | 'vision' | 'audio'
  provider?: string  // 可选，不指定则自动选择
  data: ChatRequest | EmbeddingRequest | ImageRequest | VisionRequest | AudioRequest
  metadata?: {
    user_id?: string
    session_id?: string
    trace_id?: string
    tags?: Record<string, string>
  }
}
```

### 聊天对话接口

#### 基础聊天请求

```json
{
  "capability": "chat",
  "provider": "openai",
  "data": {
    "messages": [
      {
        "role": "user",
        "content": "你好，介绍一下自己"
      }
    ],
    "model": "gpt-4",
    "max_tokens": 1000,
    "temperature": 0.7
  }
}
```

#### 流式响应

```json
{
  "capability": "chat",
  "data": {
    "messages": [
      {
        "role": "user", 
        "content": "写一首诗"
      }
    ],
    "model": "gpt-4",
    "stream": true
  }
}
```

#### 视觉理解请求

```json
{
  "capability": "vision",
  "provider": "openai",
  "data": {
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "这张图片里有什么？"
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "data:image/jpeg;base64,/9j/4AAQSkZJRgABA..."
            }
          }
        ]
      }
    ],
    "model": "gpt-4-vision-preview"
  }
}
```

### 文本嵌入接口

```json
{
  "capability": "embedding",
  "provider": "openai",
  "data": {
    "input": "这是要进行嵌入的文本",
    "model": "text-embedding-ada-002"
  }
}
```

### 图像生成接口

```json
{
  "capability": "image-generation",
  "provider": "openai",
  "data": {
    "prompt": "一只可爱的猫咪坐在花园里",
    "size": "1024x1024",
    "quality": "standard",
    "n": 1
  }
}
```

### 音频处理接口

```json
{
  "capability": "audio",
  "provider": "openai",
  "data": {
    "file": "data:audio/mp3;base64,//uQxAAA...",
    "model": "whisper-1",
    "language": "zh"
  }
}
```

### 响应格式

#### 成功响应

```json
{
  "success": true,
  "data": {
    // 具体的响应数据，根据请求类型不同
  },
  "metadata": {
    "provider": "openai",
    "model": "gpt-4",
    "usage": {
      "prompt_tokens": 10,
      "completion_tokens": 50,
      "total_tokens": 60
    },
    "cost": {
      "input_cost": 0.0001,
      "output_cost": 0.0015,
      "total_cost": 0.0016
    },
    "latency_ms": 1234,
    "cached": false
  }
}
```

#### 错误响应

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid model specified",
    "details": {
      "field": "model",
      "value": "invalid-model"
    }
  },
  "metadata": {
    "provider": "openai",
    "request_id": "req_123456"
  }
}
```

### 兼容性端点

为了保持向后兼容，提供了以下传统端点：

```http
POST /chat          # 聊天对话
POST /embedding     # 文本嵌入
POST /image         # 图像生成
POST /vision        # 视觉理解
POST /audio         # 音频处理
```

### 管理端点

#### 健康检查

```http
GET /health
```

```json
{
  "status": "healthy",
  "timestamp": "2025-05-27T10:00:00.000Z",
  "service": "meridian-ai-worker",
  "version": "2.0.0",
  "ai_gateway": {
    "authentication": true,
    "cost_tracking": true,
    "caching": true,
    "metrics": true,
    "logging": true,
    "default_cache_ttl": 3600
  },
  "providers": {
    "available": ["openai", "anthropic", "workers-ai"],
    "openai_configured": true,
    "anthropic_configured": true,
    "workers_ai_configured": true,
    "account_id": "configured",
    "gateway_id": "configured"
  }
}
```

#### 提供商列表

```http
GET /providers
```

```json
{
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "capabilities": ["chat", "embedding", "image-generation", "vision", "audio"],
      "models": {
        "chat": ["gpt-4", "gpt-3.5-turbo"],
        "embedding": ["text-embedding-ada-002"],
        "image-generation": ["dall-e-3", "dall-e-2"]
      }
    }
  ]
}
```

#### AI Gateway 配置

```http
GET /ai-gateway/config
```

---

## ⚙️ 部署配置

### 环境要求

- **Node.js**: >= 18.0.0
- **npm/pnpm**: 最新稳定版
- **Cloudflare 账户**: 需要 Workers 和 AI Gateway 服务

### 必需环境变量

#### Cloudflare 基础配置

```bash
# Cloudflare 账户 ID
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id

# AI Gateway ID
CLOUDFLARE_GATEWAY_ID=your_cloudflare_ai_gateway_id

# Cloudflare API Token (需要 AI Gateway 权限)
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
```

#### AI 提供商配置

```bash
# OpenAI (推荐)
OPENAI_API_KEY=sk-your_openai_api_key

# Anthropic
ANTHROPIC_API_KEY=sk-ant-your_anthropic_api_key

# Google AI
GOOGLE_API_KEY=AIzaSyYour_google_api_key
```

### 可选环境变量

#### 认证与安全

```bash
# AI Gateway 专用认证令牌
AI_GATEWAY_AUTH_TOKEN=your_secure_gateway_auth_token

# API 密钥列表 (逗号分隔)
GATEWAY_API_KEYS=prod_key_1,prod_key_2,dev_key_1

# 允许的来源 (CORS)
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# 认证跳过 (开发环境)
SKIP_AUTHENTICATION=false
```

#### 成本跟踪

```bash
# 启用成本跟踪
AI_GATEWAY_ENABLE_COST_TRACKING=true

# 每日预算限制 (美元)
AI_GATEWAY_DAILY_BUDGET_LIMIT=100

# 成本告警阈值 (百分比)
AI_GATEWAY_COST_ALERT_THRESHOLD=80

# 成本跟踪精度
AI_GATEWAY_COST_PRECISION=4
```

#### 缓存配置

```bash
# 启用缓存
AI_GATEWAY_ENABLE_CACHING=true

# 默认缓存 TTL (秒)
AI_GATEWAY_DEFAULT_CACHE_TTL=3600

# 聊天缓存 TTL
AI_GATEWAY_CHAT_CACHE_TTL=1800

# 嵌入缓存 TTL
AI_GATEWAY_EMBEDDING_CACHE_TTL=7200
```

#### 监控与日志

```bash
# 启用指标收集
AI_GATEWAY_ENABLE_METRICS=true

# 启用日志记录
AI_GATEWAY_ENABLE_LOGGING=true

# 日志级别
AI_GATEWAY_LOG_LEVEL=info

# 性能监控
AI_GATEWAY_ENABLE_PERFORMANCE_MONITORING=true
```

#### 重试配置

```bash
# 最大重试次数
AI_GATEWAY_MAX_RETRIES=3

# 基础延迟 (毫秒)
AI_GATEWAY_BASE_DELAY_MS=1000

# 最大延迟 (毫秒)
AI_GATEWAY_MAX_DELAY_MS=10000

# 退避乘数
AI_GATEWAY_BACKOFF_MULTIPLIER=2
```

### 部署步骤

#### 1. 克隆项目

```bash
git clone <repository-url>
cd meridian-ai-worker
```

#### 2. 安装依赖

```bash
npm install
# 或
pnpm install
```

#### 3. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑环境变量
nano .env
```

#### 4. 配置 Cloudflare Secrets

```bash
# 设置生产环境密钥
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put CLOUDFLARE_GATEWAY_ID
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY

# 可选的增强功能配置
wrangler secret put AI_GATEWAY_AUTH_TOKEN
wrangler secret put GATEWAY_API_KEYS
```

#### 5. 本地测试

```bash
# 运行单元测试
npm test

# 运行功能测试
npm run test:functional

# 本地开发服务器
npm run dev
```

#### 6. 部署到生产环境

```bash
# 部署到 Cloudflare Workers
npm run deploy

# 或者指定环境
wrangler publish --env production
```

#### 7. 验证部署

```bash
# 健康检查
curl https://your-worker.your-subdomain.workers.dev/health

# 测试 AI 接口
curl -X POST https://your-worker.your-subdomain.workers.dev/ai \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{"capability":"chat","data":{"messages":[{"role":"user","content":"Hello"}],"model":"gpt-3.5-turbo"}}'
```

### 自动化部署脚本

项目提供了自动化部署脚本，简化配置过程：

```bash
# 快速设置 (本地开发)
./scripts/setup-dev.sh

# 生产环境配置
./scripts/setup-production.sh

# 功能测试
./scripts/test-all.sh

# 部署验证
./scripts/validate-deployment.sh
```

---

## 🔧 故障排除

### 常见问题

#### 1. 部署失败

**问题**: Worker 部署时出现错误

**可能原因**:
- Cloudflare API Token 权限不足
- 账户 ID 或 Gateway ID 配置错误
- 网络连接问题

**解决方案**:
```bash
# 验证 Cloudflare 配置
wrangler whoami

# 检查 AI Gateway 配置
curl -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai-gateway/gateways"

# 重新生成 API Token (需要 AI Gateway 权限)
```

#### 2. API 请求失败

**问题**: 请求返回 401 或 403 错误

**可能原因**:
- API 密钥未配置或已过期
- 认证头部格式错误
- AI Gateway 令牌无效

**解决方案**:
```bash
# 检查 API 密钥配置
wrangler secret list

# 验证 API 密钥有效性
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
  "https://api.openai.com/v1/models"

# 重新设置 API 密钥
wrangler secret put OPENAI_API_KEY
```

#### 3. 性能问题

**问题**: 响应时间过长或超时

**可能原因**:
- AI 提供商服务延迟
- 网络连接不稳定
- 缓存未生效

**解决方案**:
```bash
# 检查健康状态
curl https://your-worker.your-subdomain.workers.dev/health

# 启用缓存
wrangler secret put AI_GATEWAY_ENABLE_CACHING true

# 调整重试配置
wrangler secret put AI_GATEWAY_MAX_RETRIES 5
```

#### 4. 成本超支

**问题**: AI 服务成本超出预算

**解决方案**:
```bash
# 设置每日预算限制
wrangler secret put AI_GATEWAY_DAILY_BUDGET_LIMIT 50

# 启用成本告警
wrangler secret put AI_GATEWAY_COST_ALERT_THRESHOLD 80

# 检查成本跟踪
curl https://your-worker.your-subdomain.workers.dev/ai-gateway/config
```

### 调试工具

#### 1. 日志查看

```bash
# 查看实时日志
wrangler tail

# 过滤错误日志
wrangler tail --format pretty | grep ERROR
```

#### 2. 性能监控

```bash
# 健康检查
curl -s https://your-worker.your-subdomain.workers.dev/health | jq

# 提供商状态
curl -s https://your-worker.your-subdomain.workers.dev/providers | jq

# AI Gateway 配置
curl -s https://your-worker.your-subdomain.workers.dev/ai-gateway/config | jq
```

#### 3. 测试脚本

```bash
# 运行完整测试套件
npm run test:all

# 功能测试
npm run test:functional

# 性能基准测试
npm run test:benchmark
```

### 错误代码参考

| 错误代码 | 描述 | 解决方案 |
|----------|------|----------|
| `INVALID_API_KEY` | API 密钥无效或未配置 | 检查并重新设置 API 密钥 |
| `PROVIDER_UNAVAILABLE` | AI 提供商服务不可用 | 检查提供商状态，启用故障转移 |
| `RATE_LIMIT_EXCEEDED` | 请求频率超限 | 降低请求频率或升级服务套餐 |
| `BUDGET_EXCEEDED` | 成本预算超限 | 增加预算限制或优化使用 |
| `INVALID_REQUEST` | 请求格式错误 | 检查请求参数和格式 |
| `CACHE_ERROR` | 缓存服务错误 | 重启缓存服务或禁用缓存 |
| `AUTHENTICATION_FAILED` | 认证失败 | 检查认证配置和令牌 |

### 性能优化建议

#### 1. 缓存策略

```bash
# 为不同类型请求设置不同的缓存时间
wrangler secret put AI_GATEWAY_CHAT_CACHE_TTL 1800      # 30分钟
wrangler secret put AI_GATEWAY_EMBEDDING_CACHE_TTL 7200  # 2小时
wrangler secret put AI_GATEWAY_IMAGE_CACHE_TTL 3600     # 1小时
```

#### 2. 提供商选择

- **聊天对话**: 推荐 OpenAI GPT-4 或 Anthropic Claude
- **文本嵌入**: 推荐 OpenAI text-embedding-ada-002
- **图像生成**: 推荐 OpenAI DALL-E 3
- **成本敏感**: 考虑使用 Workers AI

#### 3. 请求优化

- 使用适当的 `max_tokens` 限制
- 合理设置 `temperature` 参数
- 启用流式响应减少延迟感知
- 批量处理相似请求

---

## 📊 监控与维护

### 关键指标

#### 1. 性能指标

- **响应时间**: 平均/P95/P99 响应时间
- **吞吐量**: 每秒请求数 (RPS)
- **错误率**: 4xx/5xx 错误百分比
- **可用性**: 服务正常运行时间

#### 2. 业务指标

- **API 调用量**: 按提供商和能力分类
- **成本跟踪**: 每日/每月 API 成本
- **缓存命中率**: 缓存效果监控
- **用户活跃度**: 唯一用户数和会话数

#### 3. 基础设施指标

- **CPU 使用率**: Workers 执行时间
- **内存使用**: 内存消耗监控
- **网络延迟**: 到 AI 提供商的网络延迟
- **并发连接**: 同时处理的请求数

### 告警配置

建议设置以下告警：

```bash
# 成本告警 (达到预算 80%)
AI_GATEWAY_COST_ALERT_THRESHOLD=80

# 错误率告警 (超过 5%)
AI_GATEWAY_ERROR_RATE_THRESHOLD=5

# 响应时间告警 (超过 5 秒)
AI_GATEWAY_LATENCY_THRESHOLD=5000

# 可用性告警 (低于 99%)
AI_GATEWAY_AVAILABILITY_THRESHOLD=99
```

### 维护任务

#### 每日任务

- 检查成本使用情况
- 查看错误日志和告警
- 验证核心功能正常

#### 每周任务

- 更新 API 密钥（如需要）
- 检查提供商服务状态
- 分析性能趋势

#### 每月任务

- 评估成本优化机会
- 更新依赖包版本
- 备份重要配置

---

## 🔮 扩展开发

### 添加新的 AI 提供商

#### 1. 创建提供商类

```typescript
// src/services/providers/custom-provider.ts
import { BaseProvider } from '../../types'

export class CustomProvider implements BaseProvider {
  constructor(private apiKey: string) {}
  
  async chat(request: ChatRequest): Promise<AIResponse> {
    // 实现聊天接口
  }
  
  async embedding(request: EmbeddingRequest): Promise<AIResponse> {
    // 实现嵌入接口
  }
  
  getSupportedCapabilities(): AICapability[] {
    return ['chat', 'embedding']
  }
}
```

#### 2. 注册提供商

```typescript
// src/config/providers.ts
export const PROVIDERS = {
  // ...existing providers
  'custom': {
    name: 'Custom AI',
    capabilities: ['chat', 'embedding'],
    models: {
      chat: ['custom-chat-model'],
      embedding: ['custom-embedding-model']
    }
  }
}
```

#### 3. 更新服务初始化

```typescript
// src/services/ai-gateway.ts
private initializeProviders(): void {
  // ...existing code
  if (this.env.CUSTOM_API_KEY) {
    this.providers.set('custom', new CustomProvider(this.env.CUSTOM_API_KEY))
  }
}
```

### 添加新功能

#### 1. 扩展类型定义

```typescript
// src/types/index.ts
export interface NewFeatureRequest {
  // 定义新功能的请求结构
}

export interface NewFeatureResponse {
  // 定义新功能的响应结构
}
```

#### 2. 实现业务逻辑

```typescript
// src/services/new-feature.ts
export class NewFeatureService {
  async processRequest(request: NewFeatureRequest): Promise<NewFeatureResponse> {
    // 实现新功能逻辑
  }
}
```

#### 3. 添加路由

```typescript
// src/index.ts
app.post('/new-feature', async (c) => {
  const newFeatureService = new NewFeatureService(c.env)
  const result = await newFeatureService.processRequest(request)
  return c.json(result)
})
```

---

## 🔐 安全考虑

### 数据保护

- **API 密钥安全**: 使用 Cloudflare Secrets 存储敏感信息
- **传输加密**: 所有通信使用 HTTPS/TLS
- **访问控制**: 基于 API 密钥和来源的访问控制
- **数据不留存**: 不在 Worker 中持久化用户数据

### 最佳实践

1. **定期轮换 API 密钥**
2. **使用最小权限原则**
3. **启用请求日志审计**
4. **设置合理的成本限制**
5. **监控异常访问模式**

---

## 📝 版本历史

### v2.0.0 (2025-05-27)
- ✅ 完全重构，基于 Cloudflare AI Gateway
- ✅ 新增 AI Gateway 增强功能
- ✅ 统一 API 接口设计
- ✅ 完整的测试覆盖
- ✅ 性能优化和监控

### v1.x
- 初始版本，基础 AI 提供商集成

---

## 🆘 获取帮助

### 文档资源

- **快速部署**: [QUICK_DEPLOY.md](./QUICK_DEPLOY.md)
- **项目概览**: [README.md](./README.md)
- **AI Gateway 配置**: [docs/AI_GATEWAY_CONFIGURATION.md](./docs/AI_GATEWAY_CONFIGURATION.md)

### 支持渠道

- **问题反馈**: 创建 GitHub Issue
- **功能建议**: 提交 Feature Request
- **技术支持**: 联系开发团队

### 社区资源

- **Cloudflare Workers 文档**: https://developers.cloudflare.com/workers/
- **Cloudflare AI Gateway 文档**: https://developers.cloudflare.com/ai-gateway/
- **Hono.js 文档**: https://hono.dev/

---

**最后更新**: 2025年5月27日  
**版本**: v2.0.0  
**维护者**: Meridian AI Worker Team
