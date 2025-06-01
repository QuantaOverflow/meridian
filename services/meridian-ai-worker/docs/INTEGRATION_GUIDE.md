# 新服务集成指南

本指南说明如何在 `meridian-ai-worker` 中集成新的AI功能。

## 🎯 集成原则

### 核心原则
1. **统一管理**: 所有AI调用都通过 `AIGatewayService`
2. **类型安全**: 完整的TypeScript类型定义
3. **配置统一**: 通过 `providers.ts` 统一配置
4. **错误一致**: 统一的错误处理和响应格式

### 架构流程
```
新功能端点 → AIGatewayService → Provider适配器 → Cloudflare AI Gateway → AI提供商
```

## 📋 集成步骤

### 1. 添加新端点
在 `src/index.ts` 中添加新的HTTP端点：

```typescript
app.post('/meridian/new-feature', async (c) => {
  try {
    const body = await c.req.json()
    
    // 参数验证
    if (!body.requiredParam) {
      return c.json({ 
        success: false,
        error: 'Invalid request: requiredParam is required'
      }, 400)
    }

    // 创建AI Gateway Service
    const aiGatewayService = new AIGatewayService(c.env)
    
    // 构建AI请求
    const aiRequest = {
      capability: 'chat' as const, // 或其他能力
      messages: [{ role: 'user', content: body.prompt }],
      provider: body.options?.provider,
      model: body.options?.model,
      temperature: body.options?.temperature || 0.7
    }

    // 处理请求
    const result = await aiGatewayService.chat(aiRequest)
    
    return c.json({
      success: true,
      data: result,
      metadata: {
        provider: result.provider,
        model: result.model,
        processingTime: result.processingTime
      }
    })
  } catch (error: any) {
    console.error('New feature error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to process request',
      details: error.message
    }, 500)
  }
})
```

### 2. 扩展Provider配置
在 `src/config/providers.ts` 中为新功能添加模型支持：

```typescript
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  'workers-ai': {
    models: [
      {
        name: '@cf/meta/llama-3.1-8b-instruct',
        capabilities: ['chat', 'new-capability'], // 添加新能力
        endpoint: '/ai/run/@cf/meta/llama-3.1-8b-instruct',
        // ... 其他配置
      }
    ]
  }
}
```

### 3. 类型定义扩展
在 `src/types.ts` 中添加新的类型（如需要）：

```typescript
// 扩展能力类型
export type AICapability = 'chat' | 'embedding' | 'image' | 'new-capability'

// 新请求类型
export interface NewFeatureRequest extends BaseAIRequest {
  capability: 'new-capability'
  customParam: string
}

// 扩展联合类型
export type AIRequest = ChatRequest | EmbeddingRequest | NewFeatureRequest
```

### 4. 添加Capability Handler（如需要）
在 `src/capabilities/` 中添加新的处理器：

```typescript
// src/capabilities/new-feature.ts
export class NewFeatureCapabilityHandler {
  capability: 'new-capability' = 'new-capability'

  buildProviderRequest(request: NewFeatureRequest, model: ModelConfig): any {
    return {
      // 构建提供商特定的请求格式
      messages: [{ role: 'user', content: request.customParam }],
      max_tokens: 1000
    }
  }

  parseProviderResponse(response: any): NewFeatureResponse {
    return {
      capability: 'new-capability',
      result: response.choices?.[0]?.message?.content || '',
      // ... 其他字段
    }
  }
}
```

## 💡 实际示例

### 文档摘要功能集成

**1. 添加端点**：
```typescript
app.post('/meridian/summarize', async (c) => {
  try {
    const { document, maxLength = 200 } = await c.req.json()
    
    const aiGatewayService = new AIGatewayService(c.env)
    
    const prompt = `请将以下文档总结为不超过${maxLength}字的摘要：\n\n${document}`
    
    const result = await aiGatewayService.chat({
      capability: 'chat',
      messages: [{ role: 'user', content: prompt }],
      provider: 'workers-ai',
      model: '@cf/meta/llama-3.1-8b-instruct',
      temperature: 0.3
    })
    
    return c.json({
      success: true,
      summary: result.choices?.[0]?.message?.content || '',
      metadata: { provider: result.provider, model: result.model }
    })
  } catch (error) {
    return c.json({ success: false, error: error.message }, 500)
  }
})
```

**2. 更新提供商配置**：
```typescript
// 在已有模型的capabilities中添加 'summarization'
capabilities: ['chat', 'summarization']
```

## 🔧 测试和验证

### 本地测试
```bash
# 启动开发服务器
npm run dev

# 测试新端点
curl -X POST http://localhost:8787/meridian/new-feature \
  -H "Content-Type: application/json" \
  -d '{"requiredParam": "test value"}'
```

### 部署测试
```bash
# 部署到测试环境
wrangler deploy --env staging

# 验证功能
curl -X POST https://your-worker.workers.dev/meridian/new-feature \
  -H "Content-Type: application/json" \
  -d '{"requiredParam": "test value"}'
```

## 📚 最佳实践

### 1. 错误处理
- 始终使用统一的错误响应格式
- 提供有意义的错误消息
- 记录详细的错误日志

### 2. 性能优化
- 使用合适的AI模型（成本vs性能）
- 实现适当的缓存策略
- 控制请求超时时间

### 3. 安全考虑
- 验证所有输入参数
- 避免在日志中泄露敏感信息
- 使用适当的认证机制

### 4. 可维护性
- 保持代码模块化
- 编写清晰的注释
- 更新相关文档

## 🚀 部署和监控

### 部署清单
- [ ] 本地测试通过
- [ ] 类型检查无错误
- [ ] 环境变量配置正确
- [ ] 文档已更新

### 监控要点
- API响应时间
- 错误率统计
- AI提供商成本
- 用户使用模式 