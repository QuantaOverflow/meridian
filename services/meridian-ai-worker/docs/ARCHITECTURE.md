# Meridian AI Worker - 架构文档

## 🏗️ 项目架构概览

### 📋 项目定位

Meridian AI Worker 是专为 Meridian 情报简报系统设计的 AI 服务层，基于 Cloudflare Workers 构建。它为后端系统提供统一的 AI 能力调用接口，包括文章分析、嵌入生成、聊天对话等核心功能。

### 🎯 核心架构模式

#### 分层架构
```
┌─────────────────────────────────────────┐
│             HTTP 接口层                  │  ← Hono Web Framework
├─────────────────────────────────────────┤
│           AI Gateway 服务层               │  ← AI Gateway Service  
├─────────────────────────────────────────┤
│           AI 提供商适配层                 │  ← Provider Adapters
├─────────────────────────────────────────┤
│           基础设施层                     │  ← Cloudflare AI Gateway
└─────────────────────────────────────────┘
```

---

### 🗂️ 目录结构

```
src/
├── index.ts                    # 主入口，HTTP路由定义
├── types.ts                    # 核心类型定义
├── services/                  # 核心服务层
│   ├── ai-gateway.ts         # AI Gateway 主服务
│   ├── intelligence.ts       # 智能分析服务
│   ├── retry.ts              # 重试机制
│   ├── auth.ts               # 认证服务
│   ├── logger.ts             # 日志服务
│   ├── metadata.ts           # 元数据管理
│   ├── ai-gateway-enhancement.ts  # Gateway 增强功能
│   └── providers/            # AI 提供商适配器
│       ├── openai.ts         # OpenAI 适配器
│       ├── google-ai.ts      # Google AI 适配器  
│       ├── workers-ai.ts     # Workers AI 适配器
│       ├── anthropic.ts      # Anthropic 适配器
│       └── mock.ts           # 开发测试适配器
├── capabilities/             # AI 能力处理器
│   ├── chat.ts               # 聊天能力
│   ├── embedding.ts          # 嵌入能力
│   └── image.ts              # 图像能力
├── config/
│   └── providers.ts          # 提供商配置
└── prompts/
    └── articleAnalysis.ts    # 文章分析提示词模板
```

---

### 🧩 核心组件

#### 1. **AI Gateway Service**
主要职责：
- 统一的 AI 请求入口
- 提供商选择和路由
- 错误处理和重试机制
- 元数据收集和监控

#### 2. **Provider Adapters**
支持的AI提供商：
- **OpenAI**: GPT系列、DALL-E、Embeddings
- **Google AI Studio**: Gemini系列
- **Cloudflare Workers AI**: 开源模型
- **Anthropic**: Claude系列
- **Mock Provider**: 开发测试

#### 3. **Capability Handlers**
AI能力抽象：
- **Chat**: 对话聊天
- **Embedding**: 向量嵌入生成
- **Image**: 图像生成

---

### 🔄 核心API端点

#### Meridian 专用端点
```typescript
// 文章分析 - 核心业务功能
POST /meridian/article/analyze
POST /meridian/analyze

// 嵌入生成 - 向量检索支持
POST /meridian/embeddings/generate

// 通用聊天接口
POST /meridian/chat
POST /meridian/chat/stream

// 智能分析
POST /meridian/intelligence/analyze-story

// 数据处理
POST /meridian/articles/get-processed
POST /meridian/briefs/save
```

#### 系统端点
```typescript
// 健康检查
GET /health

// 基础测试
GET /test
```

---

### 🛡️ 企业级特性

#### 1. **可靠性**
- 智能重试机制（指数退避）
- 提供商故障转移
- 超时控制和断路器

#### 2. **可观测性**
- 结构化日志记录
- 请求追踪和元数据收集
- 性能指标监控

#### 3. **安全性**
- API 密钥验证
- CORS 跨域控制
- 请求签名验证

#### 4. **性能优化**
- Cloudflare AI Gateway 缓存
- 边缘计算优化
- 智能缓存策略

---

### ⚙️ 配置管理

#### 环境变量
```bash
# Cloudflare 基础配置
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_GATEWAY_ID  
CLOUDFLARE_API_TOKEN

# AI 提供商密钥
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_AI_API_KEY
```

#### 部署特性
- **零停机部署**: Cloudflare Workers 边缘部署
- **全球分发**: 自动边缘节点分发
- **弹性伸缩**: 自动负载处理
- **成本效益**: 按使用量计费

---

### 🚀 技术优势

#### 1. **架构优势**
- 模块化设计，松耦合
- 完整的 TypeScript 类型安全
- 清晰的职责分离
- 易于测试和维护

#### 2. **性能优势**
- 边缘计算延迟优化
- 智能缓存减少重复调用
- 批量处理降低成本
- 自动故障转移保证可用性

#### 3. **运维优势**
- 结构化日志便于调试
- 完整的监控和告警
- 简化的部署流程
- 环境变量统一管理 