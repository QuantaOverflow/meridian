# Meridian AI Worker - 变更日志

## [2.0.0] - 2024-01-15

### 🎯 重大更新
- **新增 Google AI Studio 支持**: 集成 Gemini 1.5 系列模型
- **Meridian 专用端点**: 为 Meridian 情报简报系统定制的接口
- **架构优化**: 重构分层架构，提升可维护性和扩展性

### ✨ 新增功能

#### AI 提供商支持
- ✅ **Google AI Studio**: 3个 Gemini 模型
- ✅ **Workers AI**: 4个模型（对话、嵌入、图像）
- ✅ **OpenAI**: 7个模型（对话、嵌入、图像、音频）

#### Meridian 专用端点
- 📰 `POST /meridian/article/analyze` - 文章内容结构化分析
- 🔍 `POST /meridian/embeddings/generate` - 向量嵌入生成
- 🔧 `GET /meridian/config` - 配置信息查询

### 🔧 改进优化
- **分层架构**: 6层清晰的架构分层
- **Provider 适配器**: 统一的提供商接口
- **错误处理**: 全面的错误处理和重试机制
- **类型安全**: 完整的 TypeScript 类型覆盖

### 🐛 问题修复
- ✅ 修复 Google AI Provider 的类型错误
- ✅ 解决环境变量命名不一致问题
- ✅ 统一提供商注册名称

### 🚀 部署状态
- **部署地址**: `https://meridian-ai-worker.swj299792458.workers.dev`
- **当前版本**: v2.0.0
- **支持的模型**: 14个 AI 模型
- **可用端点**: 8个端点

### 🔄 迁移指南

#### 从 v1.x 升级到 v2.0

1. **环境变量更新**:
   ```bash
   # 新增 Google AI 支持
   export GOOGLE_AI_API_KEY="your-google-ai-key"
   ```

2. **API 调用更新**:
   ```javascript
   // 新的 Meridian 专用端点
   const response = await fetch('/meridian/article/analyze', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       title: 'Article Title',
       content: 'Article Content',
       options: { provider: 'google-ai-studio' }
     })
   })
   ```

### 🎯 下一版本规划

#### v2.1.0 (计划)
- [ ] Anthropic Claude 3.5 Sonnet 支持
- [ ] 批处理请求优化
- [ ] 增强监控仪表板

---

## [1.1.0] - 2025-05-31

### 🚀 Major Improvements

#### AI Gateway 统一管理实现
- **完全统一所有AI服务端点**: 所有AI相关端点现在都通过 `AIGatewayService` 统一管理
- **移除直接AI调用**: 不再直接调用 `c.env.AI.run`，确保所有请求都经过AI Gateway
- **统一缓存和成本跟踪**: 所有AI请求现在都享受统一的缓存策略、成本跟踪和重试逻辑

#### 具体改进的端点：

1. **`/meridian/embeddings/generate`**
   - ✅ 从直接使用 `EmbeddingService` 改为使用 `AIGatewayService.embed()`
   - ✅ 修复类型错误：使用 `input` 而不是 `text` 属性
   - ✅ 添加完整的错误处理和响应格式统一

2. **`/meridian/analyze`**
   - ✅ 从直接调用 `c.env.AI.run` 改为使用 `AIGatewayService.chat()`
   - ✅ 保持原有的JSON解析逻辑
   - ✅ 添加统一的元数据响应

3. **`/meridian/article/analyze`**
   - ✅ 从直接调用 `c.env.AI.run` 改为使用 `AIGatewayService.chat()`
   - ✅ 保持ProcessArticles工作流兼容性
   - ✅ 改进错误处理和默认值逻辑

4. **`/test`**
   - ✅ 从直接调用 `c.env.AI.run` 改为使用 `AIGatewayService.chat()`
   - ✅ 提供更详细的测试响应信息

5. **`IntelligenceService` (情报分析服务)**
   - ✅ 从直接调用 `this.env.AI.run` 改为使用 `AIGatewayService.chat()`
   - ✅ 保持原有的情报分析逻辑和响应格式
   - ✅ 添加统一的元数据响应（provider、model、processingTime、cached等）
   - ✅ 改进类型安全性，使用 `CloudflareEnv` 类型

#### 技术改进：

- **类型安全**: 修复了 `EmbeddingRequest` 接口的类型错误
- **代码清理**: 移除了不再使用的 `EmbeddingService` 导入
- **一致性**: 所有端点现在都使用相同的错误处理和响应格式
- **可观测性**: 所有AI请求现在都包含统一的元数据（provider、model、processingTime、cached等）
- **服务统一**: `IntelligenceService` 现在也通过 AI Gateway 统一管理

#### 好处：

1. **统一缓存**: 所有AI请求都通过AI Gateway的缓存机制，提高响应速度
2. **成本跟踪**: 完整的成本监控和分析能力
3. **重试逻辑**: 统一的重试策略提高系统可靠性
4. **监控和日志**: 完整的请求追踪和性能监控
5. **配置管理**: 通过 `providers.ts` 统一管理所有AI模型配置

### 🔧 Breaking Changes
- `EmbeddingService` 不再直接使用，所有嵌入生成请求现在通过 `AIGatewayService`
- `IntelligenceService` 构造函数现在需要 `CloudflareEnv` 类型参数
- 响应格式略有变化，增加了更多元数据字段

### 📝 Migration Guide
- 如果你有自定义代码直接使用 `EmbeddingService`，请改为使用 `AIGatewayService.embed()` 方法
- `IntelligenceService` 的使用方式保持不变，但现在享受AI Gateway的所有好处

---

## [1.0.0] - 2025-05-30

### Added
- Initial release of Meridian AI Worker
- Support for multiple AI providers (OpenAI, Anthropic, Workers AI, Google AI)
- AI Gateway integration with caching and cost tracking
- Article analysis capabilities
- Embedding generation
- Chat API with streaming support
- Intelligence analysis features

### Features
- Multi-provider AI support
- Request authentication and validation
- Retry logic with exponential backoff
- Comprehensive logging and monitoring
- Cost tracking and analytics
- Caching for improved performance 