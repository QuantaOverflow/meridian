# Meridian AI Worker v2.0 - 综合指南

## 📋 目录

- [项目概述](#项目概述)
- [架构设计](#架构设计)
- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [API 使用指南](#api-使用指南)
- [生产环境配置](#生产环境配置)
- [重试机制](#重试机制)
- [监控与可观测性](#监控与可观测性)
- [部署指南](#部署指南)
- [故障排除](#故障排除)
- [升级记录](#升级记录)

---

## 🎯 项目概述

Meridian AI Worker 是一个基于 Cloudflare Workers 的统一 AI 网关服务，通过 Cloudflare AI Gateway 提供对多个 AI 提供商的统一访问。v2.0 版本采用全新的基于能力的架构，支持聊天、嵌入、图像生成等多种 AI 能力。

### 核心价值

- 🚀 **统一接口**: 一个端点访问多个 AI 提供商
- 🔄 **智能路由**: 基于能力自动选择最佳提供商
- 🛡️ **高可用性**: 自动故障转移和重试机制
- ⚡ **高性能**: 内置缓存和智能优化
- 📊 **可观测性**: 完整的监控和分析

### v2.0 重大改进

🔄 **从提供商优先到能力优先的架构转变**

- **v1.0**: 以提供商为中心，每个提供商只支持聊天功能
- **v2.0**: 以能力为中心，支持多种 AI 能力和智能提供商选择

---

## 🏗️ 架构设计

### 新架构特点

1. **基于能力的设计**
   - 统一的 AI 能力抽象：chat、embedding、image、audio、vision
   - 智能路由：根据能力自动选择最佳提供商

2. **多能力支持**
   - 聊天对话：OpenAI、Anthropic、Workers AI
   - 文本嵌入：OpenAI、Workers AI
   - 图像生成：OpenAI、Workers AI
   - 视觉理解：OpenAI、Anthropic

3. **增强的提供商管理**
   - 统一的配置文件定义所有提供商和模型
   - 智能故障转移和负载均衡

### 项目结构

```
src/
├── index.ts                    # 主入口文件，v2.0 API 端点
├── types.ts                    # 统一类型定义：请求、响应、能力
├── config/
│   └── providers.ts           # 提供商和模型配置中心
├── services/
│   ├── ai-gateway.ts          # 核心网关服务 v2.0
│   ├── auth.ts                # 认证服务
│   ├── metadata.ts            # 元数据服务
│   ├── retry.ts               # 重试服务
│   ├── logger.ts              # 日志服务
│   └── providers/             # 提供商实现
│       ├── base.ts            # 抽象基类
│       ├── openai.ts          # OpenAI 提供商
│       ├── anthropic.ts       # Anthropic 提供商
│       └── workers-ai.ts      # Workers AI 提供商
├── capabilities/              # 能力处理器
│   ├── index.ts               # 能力注册中心
│   ├── chat.ts                # 聊天能力处理
│   ├── embedding.ts           # 嵌入能力处理
│   └── image.ts               # 图像生成能力处理
└── tests/                     # 测试文件
    ├── auth.test.ts           # 认证测试
    ├── metadata.test.ts       # 元数据测试
    └── retry.test.ts          # 重试测试
```

### AI Gateway 合规性

项目完全符合 Cloudflare AI Gateway Universal Endpoint 规范：

- ✅ **统一端点格式**: 所有请求使用标准数组格式
- ✅ **智能故障转移**: AI Gateway 原生多提供商切换
- ✅ **完整监控**: 统一的日志和分析
- ✅ **性能优化**: 原生缓存和速率限制

---

## 🌟 功能特性

### 支持的AI能力

| 能力 | 描述 | 支持的提供商 |
|------|------|-------------|
| **Chat** | 聊天对话 | OpenAI, Anthropic, Workers AI |
| **Embedding** | 文本嵌入 | OpenAI, Workers AI |
| **Image** | 图像生成 | OpenAI, Workers AI |
| **Vision** | 视觉理解 | OpenAI, Anthropic (规划中) |
| **Audio** | 音频处理 | OpenAI (规划中) |

### 核心特性

1. **智能路由**
   - 根据请求能力自动选择最佳提供商
   - 支持指定提供商或自动选择

2. **故障转移**
   - 自动检测提供商故障
   - 智能切换到备用提供商
   - 完整的重试机制

3. **性能优化**
   - 内置缓存机制
   - 智能负载均衡
   - 并发请求控制

4. **安全性**
   - API 密钥验证
   - Origin 验证和 CORS
   - 请求签名验证

5. **可观测性**
   - 完整的请求日志
   - 性能指标收集
   - 错误跟踪和分析

---

## 🚀 快速开始

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

# 设置网关认证密钥
wrangler secret put GATEWAY_API_KEYS
```

### 3. 本地开发

```bash
npm run dev
```

### 4. 运行测试

```bash
npm test
```

### 5. 部署

```bash
npm run deploy
```

---

## 📡 API 使用指南

### 统一AI端点

**POST /ai** - 支持所有AI能力的统一端点

#### 聊天对话

```bash
curl -X POST https://your-worker.domain/ai \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "chat",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "model": "gpt-3.5-turbo",
    "provider": "openai",
    "fallback": true
  }'
```

#### 文本嵌入

```bash
curl -X POST https://your-worker.domain/ai \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "embedding",
    "input": "Text to embed",
    "model": "text-embedding-ada-002",
    "provider": "openai"
  }'
```

#### 图像生成

```bash
curl -X POST https://your-worker.domain/ai \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "image",
    "prompt": "A beautiful sunset over mountains",
    "model": "dall-e-3",
    "provider": "openai",
    "size": "1024x1024"
  }'
```

### 兼容性端点

- **POST /chat** - v1.0 兼容的聊天端点
- **POST /embed** - 文本嵌入专用端点
- **POST /images/generate** - 图像生成专用端点

### 查询端点

- **GET /health** - 健康检查
- **GET /providers** - 获取可用提供商列表
- **GET /capabilities/:capability/providers** - 查询特定能力的提供商

---

## ⚙️ 生产环境配置

### API 提供商配置

#### OpenAI 配置

```bash
# .env 或 Cloudflare Worker 环境变量
OPENAI_API_KEY=sk-your-openai-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_ORGANIZATION=org-your-organization-id  # 可选
```

**支持的模型：**
- gpt-4, gpt-4-turbo, gpt-3.5-turbo
- text-embedding-ada-002, text-embedding-3-small
- dall-e-3, dall-e-2

#### Anthropic Claude 配置

```bash
ANTHROPIC_API_KEY=sk-ant-your-anthropic-api-key-here
ANTHROPIC_BASE_URL=https://api.anthropic.com
```

**支持的模型：**
- claude-3-opus-20240229, claude-3-sonnet-20240229
- claude-3-haiku-20240307, claude-2.1

#### Workers AI 配置

```bash
# Workers AI 使用 Cloudflare 账户凭据
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-api-token
```

### 安全配置

#### API 密钥管理

```bash
# 生产环境强密钥
GATEWAY_API_KEYS=prod_gw_1a2b3c4d5e6f7g8h9i0j,prod_gw_k1l2m3n4o5p6q7r8s9t0

# 请求签名验证
ENABLE_REQUEST_SIGNATURE=true
SIGNATURE_SECRET=your-very-long-secret-key-at-least-64-characters-long

# 来源验证
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

#### 密钥轮换策略

1. **定期轮换**: 建议每30-90天轮换一次
2. **渐进式更新**: 先添加新密钥，再移除旧密钥
3. **应急撤销**: 发现泄露时立即撤销相关密钥

### 性能优化配置

#### 重试机制配置

```bash
# 生产环境重试配置
RETRY_MAX_ATTEMPTS=3
RETRY_BASE_DELAY=1000
RETRY_MAX_DELAY=30000
RETRY_BACKOFF_FACTOR=2
RETRY_ENABLE_JITTER=true
```

#### 并发控制

```bash
# 并发控制
MAX_CONCURRENT_REQUESTS=100
REQUEST_TIMEOUT=30000
```

---

## 🔄 重试机制

### 重试策略

#### 默认配置

```typescript
{
  maxAttempts: 3,           // 最大重试次数
  baseDelay: 1000,          // 基础延迟 1秒
  maxDelay: 30000,          // 最大延迟 30秒
  backoffFactor: 2,         // 退避因子
  jitter: true              // 添加随机抖动
}
```

#### 指数退避算法

延迟计算公式：
```
delay = min(baseDelay * (backoffFactor ^ attempt), maxDelay)
```

实际延迟时间：
- 第1次重试：1秒 + 抖动
- 第2次重试：2秒 + 抖动  
- 第3次重试：4秒 + 抖动

### 重试条件

#### 自动重试的错误类型

1. **网络错误**: 连接超时、网络不可达
2. **临时性服务错误**: 500, 502, 503, 504
3. **速率限制**: 429 Too Many Requests

#### 不重试的错误类型

1. **客户端错误**: 400, 401, 403, 404
2. **认证错误**: API key 无效、权限不足
3. **格式错误**: 请求格式错误、参数缺失

### 抖动机制

为避免"惊群效应"，系统会在延迟时间基础上添加随机抖动：
```
finalDelay = delay * (0.5 + Math.random() * 0.5)
```

---

## 📊 监控与可观测性

### 元数据收集

#### 请求元数据

每个请求都会收集以下元数据：

```json
{
  "requestId": "req_1234567890abcdef",
  "timestamp": 1716540000000,
  "source": {
    "ip": "192.168.1.1",
    "userAgent": "Mozilla/5.0...",
    "origin": "https://app.example.com"
  },
  "auth": {
    "authenticated": true,
    "apiKeyHash": "sha256:abcdef...",
    "errors": []
  },
  "processing": {
    "provider": "openai",
    "model": "gpt-3.5-turbo",
    "startTime": 1716540000000,
    "endTime": 1716540001500,
    "duration": 1500
  },
  "performance": {
    "tokenUsage": {
      "promptTokens": 10,
      "completionTokens": 20,
      "totalTokens": 30
    },
    "latency": 1500,
    "cost": 0.0001
  },
  "cloudflare": {
    "country": "US",
    "region": "California",
    "colo": "SFO"
  }
}
```

#### 错误跟踪

```json
{
  "error": {
    "type": "AuthenticationError",
    "message": "Invalid API key",
    "statusCode": 401,
    "retryable": false,
    "code": 1001
  }
}
```

### 日志级别

- **INFO**: 成功的操作和重要事件
- **WARN**: 警告和非致命错误
- **ERROR**: 错误和异常情况
- **DEBUG**: 详细的调试信息

### 性能指标

#### 关键指标

1. **响应时间**: 请求处理延迟
2. **成功率**: 请求成功百分比
3. **错误率**: 各类错误的分布
4. **令牌使用**: 各提供商的令牌消耗
5. **成本分析**: 按提供商和模型的成本

#### 监控仪表板

通过 Cloudflare Dashboard 查看：
- 请求量趋势
- 错误分析
- 性能指标
- 成本统计
- 缓存命中率

---

## 🚀 部署指南

### 环境准备

1. **Cloudflare 账户设置**
   ```bash
   # 安装 Wrangler CLI
   npm install -g wrangler
   
   # 登录 Cloudflare
   wrangler login
   ```

2. **AI Gateway 设置**
   - 在 Cloudflare Dashboard 中创建 AI Gateway
   - 记录 Account ID 和 Gateway ID

3. **环境变量配置**
   ```bash
   # 必需的环境变量
   wrangler secret put CLOUDFLARE_ACCOUNT_ID
   wrangler secret put CLOUDFLARE_GATEWAY_ID
   wrangler secret put CLOUDFLARE_API_TOKEN
   wrangler secret put OPENAI_API_KEY
   wrangler secret put GATEWAY_API_KEYS
   ```

### 部署流程

1. **本地测试**
   ```bash
   npm run dev
   curl http://localhost:8787/health
   ```

2. **运行测试套件**
   ```bash
   npm test
   ```

3. **部署到生产环境**
   ```bash
   npm run deploy
   ```

4. **验证部署**
   ```bash
   curl https://your-worker.domain/health
   ```

### 域名配置

1. **自定义域名**
   ```bash
   wrangler route publish
   ```

2. **SSL 证书**
   - Cloudflare 自动提供 SSL 证书
   - 支持自定义证书上传

---

## 🔧 故障排除

### 常见问题

#### 1. 认证失败

**问题**: API 请求返回 401 Unauthorized

**解决方案**:
```bash
# 检查 API 密钥是否正确设置
wrangler secret list

# 重新设置密钥
wrangler secret put GATEWAY_API_KEYS

# 验证请求格式
curl -H "Authorization: Bearer your-api-key" /health
```

#### 2. 提供商连接失败

**问题**: 特定提供商请求失败

**解决方案**:
```bash
# 检查提供商 API 密钥
wrangler secret put OPENAI_API_KEY

# 测试提供商连接
curl -X POST /ai -d '{"capability":"chat","provider":"openai",...}'

# 启用故障转移
curl -X POST /ai -d '{"fallback":true,...}'
```

#### 3. 重试次数过多

**问题**: 请求延迟时间过长

**解决方案**:
```bash
# 调整重试配置
wrangler secret put RETRY_MAX_ATTEMPTS 2
wrangler secret put RETRY_MAX_DELAY 10000

# 检查网络连接
# 监控提供商状态
```

#### 4. 内存或CPU限制

**问题**: Worker 超出资源限制

**解决方案**:
- 优化请求处理逻辑
- 启用请求缓存
- 升级 Worker 套餐

### 调试工具

#### 1. 日志查看

```bash
# 实时日志
wrangler tail

# 过滤特定日志级别
wrangler tail --format pretty | grep ERROR
```

#### 2. 性能分析

```bash
# 检查 Worker 指标
wrangler analytics

# 查看详细统计
curl /health
```

#### 3. 测试工具

```bash
# 运行完整测试套件
npm test

# 测试特定功能
npm test -- auth.test.ts
```

---

## 📈 升级记录

### v2.0 升级完成 ✅

#### 重大改进

- ✅ **基于能力的新架构**: 支持聊天、嵌入、图像生成等多种 AI 能力
- ✅ **智能提供商选择**: 根据能力自动选择最佳提供商
- ✅ **统一 API 接口**: 单个端点支持所有 AI 能力
- ✅ **向后兼容**: 完全兼容 v1.0 的 `/chat` 端点
- ✅ **增强的类型系统**: 更完善的 TypeScript 支持
- ✅ **配置中心化**: 所有提供商和模型配置集中管理
- ✅ **AI Gateway 合规**: 符合 Cloudflare AI Gateway Universal Endpoint 规范

#### AI Gateway 合规性修复

- **Universal Endpoint 支持**: 实现了 AI Gateway 的统一端点格式
- **数组化请求格式**: 支持多提供商数组请求以实现智能回退
- **改进的错误处理**: 增强的故障转移机制
- **请求格式优化**: 更新为使用 `query` 字段而不是 `body`

#### 测试覆盖率

- ✅ **auth.test.ts**: 15个测试全部通过
- ✅ **metadata.test.ts**: 19个测试全部通过  
- ✅ **retry.test.ts**: 19个测试全部通过
- ✅ **总体**: 53个测试全部通过

### 技术债务清理

1. **类型定义统一**: 所有接口使用统一的类型系统
2. **错误处理改进**: 更完善的错误分类和处理
3. **代码质量提升**: 更好的代码组织和可维护性

---

## 📚 参考资源

### 官方文档

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare AI Gateway 文档](https://developers.cloudflare.com/ai-gateway/)
- [OpenAI API 文档](https://platform.openai.com/docs)
- [Anthropic API 文档](https://docs.anthropic.com/)

### 相关工具

- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Vitest 测试框架](https://vitest.dev/)
- [TypeScript](https://www.typescriptlang.org/)

### 社区资源

- [Cloudflare Workers 社区](https://community.cloudflare.com/c/developers/workers/)
- [GitHub 仓库](https://github.com/your-org/meridian-ai-worker)

---

## 🤝 贡献指南

### 开发流程

1. **创建功能分支**
   ```bash
   git checkout -b feature/new-capability
   ```

2. **开发和测试**
   ```bash
   npm run dev
   npm test
   ```

3. **提交代码**
   ```bash
   git commit -m "Add new capability support"
   git push origin feature/new-capability
   ```

4. **创建 Pull Request**

### 代码规范

- 使用 TypeScript 进行类型检查
- 遵循 ESLint 规则
- 编写完整的单元测试
- 更新相关文档

---

## 📄 许可证

本项目采用 MIT 许可证，详见 [LICENSE](LICENSE) 文件。

---

**最后更新**: 2025年5月24日  
**版本**: v2.0  
**维护者**: Meridian Team
