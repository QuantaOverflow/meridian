# Meridian AI Worker

基于 Cloudflare AI Gateway 的企业级多 LLM 服务调用 Worker，专为 Meridian 情报简报系统优化。

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
| **Workers AI** | 4个 | Chat, Embedding, Image | 🟢 边缘计算 | ✅ 已配置 |
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
curl -X POST "/meridian/embeddings/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "要生成嵌入的文本",
    "options": {
      "provider": "workers-ai",
      "model": "@cf/baai/bge-base-en-v1.5"
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
