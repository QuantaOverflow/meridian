# 🚀 Meridian AI服务解耦部署指南

## 架构概览

我们已经将AI服务从backend解耦到独立的`meridian-ai-worker`中，使用Cloudflare Service Bindings实现高性能通信。

```
┌─────────────────┐    Service Binding     ┌─────────────────┐
│   Backend       │◄──────────────────────►│  AI Worker      │
│   Worker        │                        │                 │
│                 │                        │ ┌─────────────┐ │
│ ┌─────────────┐ │                        │ │   Gemini    │ │
│ │  Workflows  │ │                        │ │   OpenAI    │ │
│ │  Scrapers   │ │                        │ │ Workers AI  │ │
│ │  APIs       │ │                        │ │ Anthropic   │ │
│ └─────────────┘ │                        │ └─────────────┘ │
└─────────────────┘                        └─────────────────┘
```

## 🎯 优势

- **⚡ 性能**: Service Binding避免HTTP开销
- **🔒 安全**: 内部通信，无需公网暴露  
- **💰 成本**: 避免出站HTTP请求费用
- **📊 监控**: Cloudflare AI Gateway统一管理

## 📋 部署步骤

### 1. 部署AI Worker

```bash
# 进入AI Worker目录
cd services/meridian-ai-worker

# 设置环境变量（清单以 .dev.vars.example 为准）
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put CLOUDFLARE_GATEWAY_ID
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put AI_GATEWAY_TOKEN
wrangler secret put DASHSCOPE_API_KEY

# 可选：其他 provider。**生产链路不走它们**——2026-08 起 LLM 全量走 Workers AI
# （binding，无需 key），DashScope 作跨 provider 兜底。这几个只在离线对照实验里用。
wrangler secret put GOOGLE_AI_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY

# 部署AI Worker
wrangler deploy
```

### 2. 配置Backend Service Binding

更新 `apps/backend/wrangler.toml`：

```toml
name = "meridian-backend"

# 🎯 Service Binding to AI Worker
[[services]]
binding = "AI_WORKER"
service = "meridian-ai-worker"

# 其他绑定...
```

### 3. 部署Backend

```bash
# 进入Backend目录
cd apps/backend

# 部署Backend（自动绑定AI Worker）
wrangler deploy
```

## 🔧 使用方式

### 在Workflow中使用AI Worker

```typescript
import { createAIWorkerClient } from '../lib/aiWorkerClient'

export class ProcessArticles extends WorkflowEntrypoint<Env, ProcessArticlesParams> {
  async run(event: WorkflowEvent<ProcessArticlesParams>, step: WorkflowStep) {
    const env = this.env
    
    // 创建AI Worker客户端
    const aiClient = createAIWorkerClient(env)
    
    // 分析文章
    const analysisResult = await step.do('analyze article', async () => {
      const result = await aiClient.analyzeArticle(article.title, article.text)
      if (result.isErr()) throw result.error
      return result.value
    })
    
    // 生成嵌入
    const embeddingResult = await step.do('generate embedding', async () => {
      const searchText = generateSearchText({ title: article.title, ...analysisResult })
      const result = await aiClient.generateEmbedding(searchText)
      if (result.isErr()) throw result.error
      return result.value
    })
  }
}
```

## 🎨 API接口

### AI Worker服务接口

AI Worker提供两种调用方式：

1. **Service Binding** (推荐)
2. **HTTP API** (外部访问)

### Service Binding接口

```typescript
// 文章分析
const result = await env.AI_WORKER.analyzeArticle({
  title: "Article Title",
  content: "Article Content",
  options: {
    provider: "workers-ai",
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  }
})

// 嵌入生成
const embedding = await env.AI_WORKER.generateEmbedding({
  text: "Text to embed",
  options: {
    provider: "workers-ai",
    model: "@cf/baai/bge-small-en-v1.5"
  }
})
```

### HTTP API接口

```bash
# 文章分析
curl -X POST https://meridian-ai-worker.your-subdomain.workers.dev/meridian/article/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Article Title",
    "content": "Article Content",
    "options": {
      "provider": "workers-ai"
    }
  }'

# 嵌入生成
curl -X POST https://meridian-ai-worker.your-subdomain.workers.dev/meridian/embeddings/generate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Text to embed",
    "options": {
      "provider": "workers-ai"
    }
  }'
```

## 🔐 环境变量配置

### AI Worker必需变量

```bash
# Cloudflare AI Gateway配置
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_GATEWAY_ID=your-gateway-id
CLOUDFLARE_API_TOKEN=your-api-token

# AI提供商API密钥
# 生产链路全量走 Workers AI（binding，无需 key）；DashScope 是唯一的必需 key，
# 作为 `other` 兜底阶段使用（见 services/meridian-ai-worker/src/services/call-llm.ts 的 DEFAULT_MODELS）
DASHSCOPE_API_KEY=your-dashscope-key
```

### 可选变量

```bash
# 其他AI提供商
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key

# AI Gateway增强功能
AI_GATEWAY_ENABLE_COST_TRACKING=true
AI_GATEWAY_ENABLE_CACHING=true
AI_GATEWAY_DEFAULT_CACHE_TTL=3600
AI_GATEWAY_ENABLE_METRICS=true
AI_GATEWAY_ENABLE_LOGGING=true
```

## 📊 监控和日志

### Cloudflare Dashboard

1. **Workers & Pages** → **meridian-ai-worker**
2. 查看实时指标、日志和错误
3. 监控AI Gateway使用情况和成本

### AI Gateway分析

1. **AI** → **AI Gateway** 
2. 查看请求统计、成本分析
3. 监控缓存命中率和性能

## 🚨 故障排除

### 常见问题

1. **Service Binding连接失败**
   ```bash
   # 确保两个Worker都已部署
   wrangler deployments list --name meridian-ai-worker
   wrangler deployments list --name meridian-backend
   ```

2. **AI提供商认证失败**
   ```bash
   # 检查密钥配置
   wrangler secret list --name meridian-ai-worker
   ```

3. **性能问题**
   - 检查AI Gateway缓存配置
   - 监控每个AI提供商的响应时间
   - 优化模型选择（Flash vs Pro）

### 调试命令

```bash
# 测试AI Worker健康状态
curl https://meridian-ai-worker.your-subdomain.workers.dev/health

# 查看AI Worker配置
curl https://meridian-ai-worker.your-subdomain.workers.dev/meridian/config

# 查看AI Gateway配置
curl https://meridian-ai-worker.your-subdomain.workers.dev/ai-gateway/config
```

## 🔄 迁移清单

### 从直接AI调用迁移到Service Binding

- [ ] 部署AI Worker
- [ ] 配置Service Binding
- [ ] 更新Backend代码使用新客户端
- [x] 移除旧的AI SDK依赖
- [ ] 测试功能一致性
- [ ] 监控性能和成本

## 📈 预期收益

- **性能提升**: 减少50-80ms的HTTP往返时间
- **成本优化**: 避免出站请求费用，使用AI Gateway缓存
- **运维简化**: 统一AI服务管理和监控
- **扩展性**: 轻松添加新的AI提供商和模型 