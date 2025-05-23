# Meridian AI Worker v2.0 

一个基于 Cloudflare Workers 的统一 AI 网关服务，支持多种 AI 能力和提供商。

## 🚀 新特性 (v2.0)

### 基于能力的架构
- **统一接口**: 支持聊天、嵌入、图像生成、音频和视觉等多种 AI 能力
- **多提供商支持**: OpenAI、Anthropic、Cloudflare Workers AI
- **智能路由**: 根据能力自动选择最佳提供商
- **故障转移**: 自动切换到备用提供商

### 支持的能力

| 能力 | OpenAI | Anthropic | Workers AI |
|------|--------|-----------|------------|
| 聊天 (Chat) | ✅ | ✅ | ✅ |
| 嵌入 (Embedding) | ✅ | ❌ | ✅ |
| 图像生成 (Image) | ✅ | ❌ | ✅ |
| 音频 (Audio) | ✅ | ❌ | ❌ |
| 视觉 (Vision) | ✅ | ✅ | ❌ |

## 📋 API 端点

### 统一 AI 端点 (推荐)
```
POST /ai
```

### 能力特定端点
```
POST /chat           # 聊天对话
POST /embed          # 文本嵌入
POST /images/generate # 图像生成
```

### 信息端点
```
GET /health          # 健康检查
GET /providers       # 获取可用提供商
GET /capabilities/:capability/providers # 获取支持特定能力的提供商
```

## 🔧 使用示例

### 1. 聊天对话

```bash
curl -X POST https://your-worker.domain.workers.dev/ai \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "chat",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "provider": "openai",
    "model": "gpt-4"
  }'
```

### 2. 文本嵌入

```bash
curl -X POST https://your-worker.domain.workers.dev/ai \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "embedding",
    "input": "This is a sample text for embedding",
    "provider": "openai",
    "model": "text-embedding-3-large"
  }'
```

### 3. 图像生成

```bash
curl -X POST https://your-worker.domain.workers.dev/ai \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "image",
    "prompt": "A beautiful sunset over mountains",
    "provider": "openai",
    "model": "dall-e-3",
    "size": "1024x1024"
  }'
```

### 4. 视觉理解

```bash
curl -X POST https://your-worker.domain.workers.dev/ai \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "vision",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "What is in this image?"},
          {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
        ]
      }
    ],
    "provider": "openai",
    "model": "gpt-4-vision-preview"
  }'
```

## 🛠️ 高级功能

### 自动故障转移

```json
{
  "capability": "chat",
  "messages": [{"role": "user", "content": "Hello"}],
  "fallback": true
}
```

### 模型自动选择

```json
{
  "capability": "chat",
  "messages": [{"role": "user", "content": "Hello"}],
  "provider": "openai"
}
```

### 温度和最大令牌控制

```json
{
  "capability": "chat",
  "messages": [{"role": "user", "content": "Write a story"}],
  "temperature": 0.8,
  "max_tokens": 2048
}
```

## 📊 响应格式

所有响应都包含统一的元数据：

```json
{
  "capability": "chat",
  "id": "chatcmpl-123",
  "provider": "openai",
  "model": "gpt-4",
  "cached": false,
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 25,
    "total_tokens": 35
  },
  "choices": [...],  // 能力特定的数据
  "data": [...]      // 能力特定的数据
}
```

## 🔒 环境变量

```bash
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_GATEWAY_ID=your_gateway_id
CLOUDFLARE_API_TOKEN=your_api_token
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
```

## 📈 性能优化

- **缓存**: 自动缓存响应 1 小时
- **并行处理**: 支持批量请求
- **智能路由**: 根据模型能力自动选择最佳提供商
- **成本优化**: 优先使用免费的 Workers AI 模型

## 🔄 向后兼容性

v2.0 完全兼容 v1.0 的 `/chat` 端点，现有应用无需修改即可继续使用。

## 🎯 未来计划

- [ ] 流式响应支持
- [ ] 音频处理能力
- [ ] 批量请求处理
- [ ] 请求限流和配额管理
- [ ] 实时监控和分析
