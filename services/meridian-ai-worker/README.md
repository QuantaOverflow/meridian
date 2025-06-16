# Meridian AI Worker

Meridian情报简报系统的AI服务工作器，提供统一的AI Gateway接口，支持多个AI提供商。

## 🏗️ 项目结构

```
meridian-ai-worker/
├── 📁 src/                        # 核心源码
│   ├── index.ts                   # 主要API端点
│   ├── types.ts                   # TypeScript类型定义
│   ├── 📁 capabilities/           # AI能力实现
│   │   ├── chat.ts               # 对话能力
│   │   ├── embedding.ts          # 嵌入生成
│   │   ├── image.ts              # 图像处理
│   │   └── index.ts              # 能力导出
│   ├── 📁 services/              # 核心服务层
│   │   ├── ai-gateway.ts         # AI Gateway核心服务
│   │   ├── intelligence.ts       # 情报分析服务
│   │   ├── embedding.ts          # 嵌入生成服务（待废弃）
│   │   ├── auth.ts               # 认证服务
│   │   ├── retry.ts              # 重试机制
│   │   ├── logger.ts             # 日志服务
│   │   ├── metadata.ts           # 元数据管理
│   │   └── 📁 providers/         # AI提供商适配器
│   ├── 📁 config/                # 配置管理
│   │   └── providers.ts          # AI提供商配置
│   └── 📁 prompts/               # AI提示词模板
├── 📁 docs/                      # 项目文档
│   ├── API_GUIDE.md              # API使用指南
│   ├── QUICK_DEPLOY.md           # 快速部署指南
│   ├── INTEGRATION_GUIDE.md      # 集成开发指南
│   ├── NEW_SERVICE_INTEGRATION.md # 新服务集成指南
│   ├── ARCHITECTURE.md           # 架构设计文档
│   ├── AI_GATEWAY_CONFIGURATION.md # AI Gateway配置
│   └── PROJECT_COMPREHENSIVE_GUIDE.md # 项目综合指南
├── 📁 tests/                     # 测试文件
│   ├── 📁 fixtures/              # 测试数据和夹具
│   ├── auth.test.ts              # 认证测试
│   ├── metadata.test.ts          # 元数据测试
│   └── retry.test.ts             # 重试机制测试
├── 📁 scripts/                   # 开发和部署脚本
│   ├── create-new-service.js     # 新服务生成脚本
│   ├── setup-local-env.sh        # 本地环境设置
│   ├── test-deployment.sh        # 部署测试
│   ├── base-test.sh              # 基础测试
│   └── setup-env.sh              # 环境配置
├── 📁 .wrangler/                 # Cloudflare Workers构建缓存
├── 📁 dist/                      # 构建输出目录
├── 📄 CHANGELOG.md               # 版本变更日志
├── 📄 package.json               # 项目依赖配置
├── 📄 wrangler.toml              # Cloudflare Workers配置
├── 📄 tsconfig.json              # TypeScript配置
├── 📄 vitest.config.ts           # 测试配置
└── 📄 .dev.vars                  # 开发环境变量
```

## 📋 部署状态

| 组件 | 状态 | 说明 |
|------|------|------|
| 代码质量 | ✅ 就绪 | 所有编译错误已修复，类型安全 |
| 功能测试 | ✅ 通过 | 所有端点正常响应 |
| 配置支持 | ✅ 完整 | 环境变量和自动化脚本就绪 |
| 部署就绪 | ✅ 已部署 | 生产环境运行中 |
| AI提供商 | ✅ 3个 | OpenAI、Workers AI、Google AI Studio |

**当前部署**: `https://meridian-ai-worker.swj299792458.workers.dev`

## 🌟 核心功能

### 🎯 Meridian 专用端点

- **📰 文章分析**: `POST /meridian/article/analyze` - 结构化文章内容分析
- **🔍 嵌入生成**: `POST /meridian/embeddings/generate` - 向量嵌入生成
- **🔧 配置管理**: `GET /meridian/config` - 服务配置和状态查询

### 🤖 支持的AI提供商

| 提供商 | 模型数量 | 主要能力 | 成本效益 | 状态 |
|--------|----------|----------|----------|------|
| **Google AI Studio** | 3个 | Chat (Gemini) | 🟢 低成本 | ✅ 已配置 |
| **Workers AI** | 5个 | Chat, Embedding (多语言), Image | 🟢 边缘计算 | ✅ 已配置 |
| **OpenAI** | 7个 | Chat, Embedding, Image, Audio | 🟡 高质量 | ✅ 已配置 |

### 🛡️ 企业级功能

- 🚀 **统一 AI Gateway 接口** - 通过 Cloudflare AI Gateway 统一访问
- 🔄 **智能故障转移** - 自动切换到可用提供商
- 📈 **请求重试机制** - 指数退避重试策略  
- 🎯 **能力路由** - 基于 AI 能力的智能模型选择
- 📊 **成本跟踪** - Token级别成本监控
- ⚡ **边缘缓存** - 相同请求缓存优化

## 🚀 快速开始

### 1. 环境配置

```bash
# 基础配置（必需）
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_GATEWAY_ID="meridian-ai-gateway-dev" 
export CLOUDFLARE_API_TOKEN="your-api-token"

# AI 提供商密钥（至少配置一个）
export OPENAI_API_KEY="sk-..."
export GOOGLE_AI_API_KEY="AIza..."
```

### 2. 部署

```bash
npm install
npm run deploy
```

### 3. 验证

```bash
# 健康检查
curl https://meridian-ai-worker.swj299792458.workers.dev/health

# 测试文章分析
curl -X POST "https://meridian-ai-worker.swj299792458.workers.dev/meridian/article/analyze" \
  -H "Content-Type: application/json" \
  -d '{"title": "测试标题", "content": "测试内容"}'
```

## 📡 API 使用

### Meridian 专用接口

#### 文章分析

```bash
curl -X POST "/meridian/article/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "新闻标题",
    "content": "新闻内容...",
    "options": {
      "provider": "google-ai-studio",
      "model": "gemini-1.5-flash-8b-001"
    }
  }'
```

#### 嵌入生成

```bash
# 标准文本嵌入
curl -X POST "/meridian/embeddings/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "要生成嵌入的文本",
    "options": {
      "provider": "workers-ai",
      "model": "@cf/baai/bge-base-en-v1.5"
    }
  }'

# 使用 BGE-M3 多语言嵌入
curl -X POST "/meridian/embeddings/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "text": ["Hello world", "你好世界", "こんにちは"],
    "options": {
      "provider": "workers-ai",
      "model": "@cf/baai/bge-m3"
    }
  }'

# BGE-M3 查询和上下文相似度评分
curl -X POST "/meridian/embeddings/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "AI technology",
    "contexts": [
      {"text": "Artificial intelligence is transforming industries"},
      {"text": "Machine learning algorithms improve over time"},
      {"text": "Cooking recipes vary by culture"}
    ],
    "options": {
      "provider": "workers-ai", 
      "model": "@cf/baai/bge-m3"
    }
  }'
```

### 通用 AI 接口

```bash
curl -X POST "/ai" \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "chat",
    "messages": [{"role": "user", "content": "Hello"}],
    "provider": "openai",
    "model": "gpt-3.5-turbo"
  }'
```

## 🔧 环境变量

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | Cloudflare 账户 ID |
| `CLOUDFLARE_GATEWAY_ID` | ✅ | AI Gateway ID |
| `CLOUDFLARE_API_TOKEN` | ✅ | Cloudflare API Token |
| `OPENAI_API_KEY` | 🔶 | OpenAI API 密钥 |
| `GOOGLE_AI_API_KEY` | 🔶 | Google AI API 密钥 |
| `ANTHROPIC_API_KEY` | ❌ | Anthropic API 密钥 |

## 🧪 测试和验证

```bash
# 健康检查
curl -s https://meridian-ai-worker.swj299792458.workers.dev/health | jq .

# 提供商状态
curl -s https://meridian-ai-worker.swj299792458.workers.dev/providers | jq .

# 功能测试
npm run test:integration
```

## 📈 监控

服务提供结构化日志和健康检查端点，支持以下监控：

- **可用性**: 服务健康状态和响应时间
- **成本**: 各提供商的Token使用量和成本
- **性能**: 请求延迟和缓存命中率
- **错误率**: 各提供商的错误率和故障转移频率

## 🔄 版本历史

### v2.0.0 (当前版本)
- ✅ 新增 Google AI Studio 支持
- ✅ 优化 Meridian 专用端点
- ✅ 修复 TypeScript 类型错误
- ✅ 改进错误处理和日志记录

## 📚 文档

- [架构设计](./docs/ARCHITECTURE.md) - 详细的系统架构和技术设计
- [API 使用指南](./API_GUIDE.md) - 完整的 API 文档和示例
- [快速部署](./QUICK_DEPLOY.md) - 一键部署配置指南
- [变更日志](./CHANGELOG.md) - 版本变更记录和迁移指南

## 📞 技术支持

**当前部署地址**: `https://meridian-ai-worker.swj299792458.workers.dev`

如需技术支持或反馈问题，请查看相关文档或提交 Issue。

## Story Validation API

### POST /meridian/story/validate

基于 `intelligence-pipeline.test.ts` 契约的故事验证端点。

**输入格式:**
```typescript
{
  clusteringResult: {
    clusters: Array<{
      clusterId: number
      articleIds: number[]
      size: number
    }>,
    parameters: {
      umapParams: { n_neighbors, n_components, min_dist, metric },
      hdbscanParams: { min_cluster_size, min_samples, epsilon }
    },
    statistics: {
      totalClusters: number
      noisePoints: number
      totalArticles: number
    }
  },
  useAI?: boolean,  // 是否使用AI进行深度验证，默认 true
  options?: {
    provider?: string
    model?: string
  }
}
```

**输出格式:**
```typescript
{
  success: boolean,
  data: {
    stories: Array<{
      title: string
      importance: number  // 1-10
      articleIds: number[]
      storyType: "SINGLE_STORY" | "COLLECTION_OF_STORIES"
    }>,
    rejectedClusters: Array<{
      clusterId: number
      rejectionReason: "PURE_NOISE" | "NO_STORIES" | "INSUFFICIENT_ARTICLES"
      originalArticleIds: number[]
    }>
  },
  metadata: {
    totalClusters: number
    validatedStories: number
    rejectedClusters: number
    processingStatistics: object
  }
}
```

**验证逻辑:**
1. 聚类尺寸 < 3：标记为 "INSUFFICIENT_ARTICLES"
2. 聚类尺寸 >= 3：使用AI进行深度分析
   - single_story：创建单一故事，移除异常点
   - collection_of_stories：分解为多个独立故事
   - pure_noise：标记为 "PURE_NOISE"
   - no_stories：标记为 "NO_STORIES"
3. 重要性评分限制在1-10范围内
4. 故事至少需要2篇文章才能被接受
