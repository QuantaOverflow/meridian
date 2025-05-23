# Meridian AI Worker v2.0 - Project Summary

## 🎯 项目概述

Meridian AI Worker 是一个基于 Cloudflare Workers 的统一 AI 网关服务，通过 Cloudflare AI Gateway 提供对多个 AI 提供商的统一访问。v2.0 版本采用全新的基于能力的架构，支持聊天、嵌入、图像生成等多种 AI 能力。

## 🏗️ 架构升级

### v2.0 重大改进

🔄 **从提供商优先到能力优先的架构转变**

- **v1.0**: 以提供商为中心，每个提供商只支持聊天功能
- **v2.0**: 以能力为中心，支持多种 AI 能力和智能提供商选择

### 新架构特点

1. **基于能力的设计**
   - 统一的 AI 能力抽象：chat、embedding、image、audio、vision
   - 每种能力都有专门的处理器和配置
   - 智能路由：根据能力自动选择最佳提供商

2. **多能力支持**
   - 聊天对话：OpenAI、Anthropic、Workers AI
   - 文本嵌入：OpenAI、Workers AI  
   - 图像生成：OpenAI、Workers AI
   - 音频处理：OpenAI（规划中）
   - 视觉理解：OpenAI、Anthropic

3. **增强的提供商管理**
   - 统一的配置文件定义所有提供商和模型
   - 支持能力查询和模型选择
   - 智能故障转移和负载均衡

## 📁 新项目结构

```
src/
├── index.ts                    # 主入口文件，v2.0 API 端点
├── types.ts                    # 统一类型定义：请求、响应、能力
├── config/
│   └── providers.ts           # 提供商和模型配置中心
├── services/
│   ├── ai-gateway.ts          # 核心网关服务 v2.0
│   └── providers/             # 提供商实现
│       ├── base.ts            # 抽象基类
│       ├── openai.ts          # OpenAI 提供商
│       ├── anthropic.ts       # Anthropic 提供商
│       └── workers-ai.ts      # Workers AI 提供商
├── capabilities/              # 🆕 能力处理器
│   ├── index.ts               # 能力注册中心
│   ├── chat.ts                # 聊天能力处理
│   ├── embedding.ts           # 嵌入能力处理
│   └── image.ts               # 图像生成能力处理
├── test-v2.js                 # 🆕 v2.0 测试套件
└── API_GUIDE.md               # 🆕 详细 API 使用指南
```
   wrangler secret put OPENAI_API_KEY
   ```

3. **本地开发**
   ```bash
   npm run dev
   ```

4. **验证设置**
   ```bash
   node scripts/verify.js
   ```

### 📡 API 端点

- **GET /health** - 健康检查
- **GET /providers** - 获取可用提供商列表
- **POST /chat** - 聊天接口（支持所有提供商）
- **POST /chat/stream** - 流式聊天（待实现）

### 🔧 支持的提供商

- **OpenAI**: GPT-4, GPT-3.5-turbo 等模型
- **Workers AI**: Cloudflare 托管的开源模型
- **Anthropic**: Claude 系列模型

### 🎯 使用示例

```javascript
// 基础聊天请求
const response = await fetch('/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [
      { role: 'user', content: 'Hello, how are you?' }
    ],
    provider: 'openai',
    model: 'gpt-4o-mini',
    fallback: true  // 启用故障转移
  })
});
```

### 📊 AI Gateway 功能

通过 Cloudflare AI Gateway，您可以获得：

- **实时分析**: 请求量、令牌使用、成本统计
- **缓存**: 自动缓存相同请求，节省成本
- **速率限制**: 控制请求频率
- **日志记录**: 完整的请求日志
- **故障转移**: 自动切换提供商

### 🔒 安全性

- 环境变量安全存储
- API 密钥不会暴露在代码中
- 支持认证 Gateway（可选）
- CORS 配置

### 📈 扩展性

架构设计支持轻松添加新的 LLM 提供商：

1. 创建新的提供商适配器
2. 实现 `BaseProvider` 接口
3. 在 `ai-gateway.ts` 中注册
4. 更新类型定义

### 📝 下一步

1. **部署**: 参考 `DEPLOYMENT.md` 部署到生产环境
2. **测试**: 使用 `test-api.sh` 测试所有端点
3. **监控**: 在 Cloudflare Dashboard 查看分析数据
4. **优化**: 根据使用情况调整缓存和限制策略

### 💡 技术亮点

- **简洁架构**: 核心逻辑不到 200 行代码
- **TypeScript**: 完整类型支持，开发体验佳
- **Hono框架**: 轻量级，专为 Cloudflare Workers 优化
- **统一格式**: 所有提供商都返回标准化响应
- **错误处理**: 完善的错误处理和用户反馈

这个项目展示了如何以最简单的方式构建一个功能完整的多 LLM 服务代理，充分利用 Cloudflare AI Gateway 的强大功能，同时保持代码的简洁性和可维护性。
