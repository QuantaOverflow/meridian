# Meridian AI Worker - API 使用指南

## 📖 概述

Meridian AI Worker 提供基于 Cloudflare AI Gateway 的统一 AI 服务接口，支持多个 AI 提供商。本指南提供详细的 API 使用说明和故障排除信息。

## 🔌 API 接口详解

### Meridian 专用接口

#### 文章分析接口

```bash
POST /meridian/article/analyze
```

**请求参数**：
```json
{
  "title": "文章标题",
  "content": "文章内容",
  "options": {
    "provider": "google-ai-studio",  // 可选：google-ai-studio, openai, workers-ai
    "model": "gemini-1.5-flash-8b-001"  // 可选：具体模型名称
  }
}
```

**响应格式**：
```json
{
  "success": true,
  "data": {
    "language": "zh-CN",
    "primary_location": "Beijing",
    "completeness": "COMPLETE",
    "content_quality": "EXCELLENT",
    "event_summary_points": [...],
    "thematic_keywords": [...],
    "topic_tags": [...],
    "key_entities": [...],
    "content_focus": "Technology"
  },
  "metadata": {
    "provider": "google-ai-studio",
    "model": "gemini-1.5-flash-8b-001",
    "total_tokens": 250,
    "processingTime": 1250,
    "cached": false
  }
}
```

#### 嵌入生成接口

```bash
POST /meridian/embeddings/generate
```

**请求参数**：
```json
{
  "text": "要生成嵌入的文本内容",
  "options": {
    "provider": "workers-ai",  // 推荐：workers-ai（边缘计算优化）
    "model": "@cf/baai/bge-small-en-v1.5"  // 可选：具体模型名称
  }
}
```

**响应格式**：
```json
{
  "success": true,
  "data": [0.021270751953125, -0.0304718017578125, ...],  // 384维向量
  "model": "@cf/baai/bge-small-en-v1.5",
  "dimensions": 384,
  "text_length": 25,
  "metadata": {
    "provider": "workers-ai",
    "model": "@cf/baai/bge-small-en-v1.5",
    "processingTime": 150,
    "cached": false
  }
}
```

#### 通用聊天接口

```bash
POST /meridian/chat
```

**请求参数**：
```json
{
  "messages": [
    {
      "role": "user",
      "content": "你好，介绍一下自己"
    }
  ],
  "options": {
    "provider": "workers-ai",
    "model": "@cf/meta/llama-3.1-8b-instruct",
    "temperature": 0.7,
    "max_tokens": 1000
  }
}
```

#### 流式聊天接口

```bash
POST /meridian/chat/stream
```

#### 智能分析接口

```bash
POST /meridian/intelligence/analyze-story
```

#### 数据获取接口

```bash
POST /meridian/articles/get-processed
POST /meridian/briefs/save
```

### 系统接口

#### 健康检查

```bash
GET /health
```

**响应格式**：
```json
{
  "status": "ok",
  "timestamp": "2025-01-31T10:00:00.000Z",
  "service": "meridian-ai-worker"
}
```

#### 基础测试

```bash
GET /test
```

## 📊 响应格式

### 成功响应

```json
{
  "success": true,
  "data": {
    // 具体的响应数据，根据请求类型不同
  },
  "metadata": {
    "provider": "openai",
    "model": "gpt-4",
    "requestId": "req-12345",
    "processingTime": 1234,
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
    "cached": false
  }
}
```

### 错误响应

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
    "requestId": "req_123456"
  }
}
```

## 🔧 故障排除

### 常见问题

#### 1. 部署失败

**症状**: Worker 部署时出现错误

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

**症状**: 请求返回 401 或 403 错误

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

**症状**: 响应时间过长或超时

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

**症状**: AI 服务成本超出预算

**解决方案**:
```bash
# 设置每日预算限制
wrangler secret put AI_GATEWAY_DAILY_BUDGET_LIMIT 50

# 启用成本告警
wrangler secret put AI_GATEWAY_COST_ALERT_THRESHOLD 80

# 检查成本跟踪
curl https://your-worker.your-subdomain.workers.dev/meridian/config
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

# Meridian 配置
curl -s https://your-worker.your-subdomain.workers.dev/meridian/config | jq
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

## 💡 最佳实践

### 模型选择建议

- **文章分析**: 推荐 Google Gemini 1.5 Flash 8B（成本效益最高）
- **文本嵌入**: 推荐 Workers AI BGE（边缘计算优化）
- **高质量对话**: 推荐 OpenAI GPT-4（准确性最高）
- **图像生成**: 推荐 OpenAI DALL-E 3（质量最佳）

### 请求优化

- 使用适当的 `max_tokens` 限制控制成本
- 合理设置 `temperature` 参数
- 启用流式响应减少延迟感知
- 批量处理相似请求

### 错误处理

- 实现客户端重试机制
- 处理故障转移场景
- 监控错误率和成功率
- 设置合理的超时时间

---

**最后更新**: 2025年5月27日  
**版本**: v2.0.0  
**维护者**: Meridian AI Worker Team
