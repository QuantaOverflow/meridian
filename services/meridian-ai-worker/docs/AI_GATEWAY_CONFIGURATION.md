# AI Gateway 增强功能配置指南

本文档详细说明了 Meridian AI Worker 的 Cloudflare AI Gateway 增强功能配置。

## 概述

AI Gateway 增强功能提供以下能力：
- 🔒 **认证和安全** - AI Gateway 访问令牌认证
- 💰 **成本跟踪** - 自动跟踪 API 调用成本
- ⚡ **智能缓存** - 基于内容的智能缓存策略
- 📊 **增强监控** - 详细的指标收集和日志记录

## 环境变量配置

### 必需变量
```bash
# Cloudflare 基础配置
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_GATEWAY_ID=your-gateway-id
CLOUDFLARE_API_TOKEN=your-api-token

# 至少一个 AI 提供商 API 密钥
OPENAI_API_KEY=your-openai-key
```

### AI Gateway 增强功能变量（可选）

#### 认证配置
```bash
# AI Gateway 认证令牌
AI_GATEWAY_AUTH_TOKEN=your-gateway-auth-token
```

#### 成本跟踪配置
```bash
# 启用自动成本跟踪
AI_GATEWAY_ENABLE_COST_TRACKING=true
```

#### 缓存配置
```bash
# 启用智能缓存
AI_GATEWAY_ENABLE_CACHING=true

# 默认缓存 TTL（秒）
AI_GATEWAY_DEFAULT_CACHE_TTL=3600
```

#### 监控配置
```bash
# 启用增强指标收集
AI_GATEWAY_ENABLE_METRICS=true

# 启用详细日志记录
AI_GATEWAY_ENABLE_LOGGING=true
```

## 使用 Wrangler 设置环境变量

### 设置必需变量
```bash
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put CLOUDFLARE_GATEWAY_ID
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put OPENAI_API_KEY
```

### 设置增强功能变量
```bash
# 认证
wrangler secret put AI_GATEWAY_AUTH_TOKEN

# 功能开关
wrangler secret put AI_GATEWAY_ENABLE_COST_TRACKING
wrangler secret put AI_GATEWAY_ENABLE_CACHING
wrangler secret put AI_GATEWAY_DEFAULT_CACHE_TTL
wrangler secret put AI_GATEWAY_ENABLE_METRICS
wrangler secret put AI_GATEWAY_ENABLE_LOGGING
```

## 功能详解

### 1. 认证和安全

当设置 `AI_GATEWAY_AUTH_TOKEN` 时，所有请求都会包含认证头部：
```typescript
headers: {
  'cf-aig-authorization': `Bearer ${token}`
}
```

### 2. 成本跟踪

启用成本跟踪时，系统会：
- 自动计算每个请求的估算成本
- 在请求头中包含成本信息
- 支持自定义成本标签和项目ID

示例头部：
```typescript
headers: {
  'cf-aig-custom-cost': JSON.stringify({
    cost: 0.002,
    currency: 'USD',
    model: 'gpt-4',
    tokens: { input: 100, output: 50 }
  })
}
```

### 3. 智能缓存

缓存策略基于请求内容生成唯一键：
- 模型名称
- 请求参数（messages、temperature 等）
- 系统提示词
- 用户输入

示例头部：
```typescript
headers: {
  'cf-aig-cache-key': 'gpt-4:hash12345',
  'cf-aig-cache-ttl': '3600'
}
```

### 4. 增强监控

启用监控时，系统会收集：
- 请求/响应指标
- 错误率和延迟
- 成本分析
- 使用模式

## 最佳实践

### 1. 环境分离
为不同环境使用不同的配置：

```bash
# 开发环境
wrangler secret put AI_GATEWAY_ENABLE_LOGGING --env development

# 生产环境
wrangler secret put AI_GATEWAY_ENABLE_METRICS --env production
```

### 2. 缓存策略
- 对于聊天完成，使用较短的 TTL（15-30分钟）
- 对于嵌入生成，使用较长的 TTL（几小时）
- 对于图像生成，考虑禁用缓存

### 3. 成本优化
- 启用成本跟踪监控使用情况
- 使用缓存减少重复请求
- 根据成本数据优化模型选择

### 4. 安全考虑
- 始终使用 AI Gateway 认证令牌
- 定期轮换认证凭据
- 监控异常访问模式

## 故障排除

### 常见问题

1. **认证失败**
   ```
   错误: AI Gateway authentication failed
   解决: 检查 AI_GATEWAY_AUTH_TOKEN 是否正确设置
   ```

2. **缓存未生效**
   ```
   问题: 请求没有被缓存
   检查: AI_GATEWAY_ENABLE_CACHING 是否设置为 true
   ```

3. **成本跟踪不准确**
   ```
   问题: 成本计算异常
   检查: 模型配置中的 cost_per_token 是否正确
   ```

### 调试模式

启用调试日志：
```bash
wrangler secret put AI_GATEWAY_ENABLE_LOGGING --env development
```

查看 Worker 日志：
```bash
wrangler tail --env development
```

## 配置验证

可以通过 API 端点验证配置：

```bash
curl -X GET "https://your-worker.your-subdomain.workers.dev/health" \
  -H "Content-Type: application/json"
```

响应将包含当前配置状态：
```json
{
  "status": "healthy",
  "ai_gateway": {
    "authentication": true,
    "cost_tracking": true,
    "caching": true,
    "metrics": true,
    "logging": false
  }
}
```

## 更多资源

- [Cloudflare AI Gateway 文档](https://developers.cloudflare.com/ai-gateway/)
- [Workers 环境变量文档](https://developers.cloudflare.com/workers/platform/environment-variables/)
- [Wrangler CLI 参考](https://developers.cloudflare.com/workers/wrangler/)
