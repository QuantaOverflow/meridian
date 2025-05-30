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

## [1.0.0] - 2024-01-01

### 初始版本
- 基础 AI Gateway 功能
- OpenAI 和 Workers AI 支持
- 基本的重试和故障转移机制
- Cloudflare Workers 部署支持 