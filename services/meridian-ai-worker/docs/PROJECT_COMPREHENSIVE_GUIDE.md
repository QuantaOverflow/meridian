# Meridian AI Worker - 项目指南

## 🎉 项目概览

**版本**: v2.0.0  
**定位**: Meridian情报简报系统的AI服务层  
**基础**: Cloudflare Workers + Hono框架

### 核心功能

- ✅ **文章分析**: 结构化内容分析和实体提取
- ✅ **嵌入生成**: 384维向量生成用于语义搜索  
- ✅ **聊天对话**: 支持多提供商的对话接口
- ✅ **智能分析**: 故事聚合和重要性评估
- ✅ **数据处理**: 已处理文章获取和简报保存

---

## 🚀 技术架构

### AI 提供商支持

| 提供商 | 聊天 | 嵌入 | 图像 | 状态 |
|--------|------|------|------|------|
| Workers AI | ✅ | ✅ | ✅ | 推荐 |
| OpenAI | ✅ | ✅ | ✅ | 稳定 |
| Google AI | ✅ | ❌ | ❌ | 稳定 |
| Anthropic | ✅ | ❌ | ❌ | 可用 |

### 核心特性

- **智能路由**: 自动选择最佳AI提供商
- **错误恢复**: 智能重试和故障转移  
- **边缘计算**: 基于Cloudflare Workers的全球分发
- **类型安全**: 完整的TypeScript支持

---

## ⚙️ 部署配置

### 环境变量

**必需配置**:
```bash
# Cloudflare基础配置
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_GATEWAY_ID=your_gateway_id
CLOUDFLARE_API_TOKEN=your_api_token

# AI提供商密钥 (至少一个)
OPENAI_API_KEY=sk-your_openai_key
GOOGLE_AI_API_KEY=your_google_key
```

**可选配置**:
```bash
# 增强功能
ENABLE_COST_TRACKING=true
ENABLE_CACHING=true
LOG_LEVEL=info
```

### 部署流程

```bash
# 1. 安装依赖
npm install

# 2. 配置环境
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put OPENAI_API_KEY

# 3. 部署
wrangler deploy --env production

# 4. 验证
curl https://your-worker.your-subdomain.workers.dev/health
```

---

## 🛠️ 开发指南

### 可用脚本

- `npm run dev` - 本地开发服务器
- `npm test` - 运行测试套件
- `npm run build` - 构建项目

### API端点

#### 核心业务接口
```typescript
POST /meridian/article/analyze     # 文章分析
POST /meridian/embeddings/generate # 嵌入生成
POST /meridian/chat               # 聊天对话
POST /meridian/intelligence/analyze-story # 智能分析
```

#### 系统接口
```typescript
GET /health    # 健康检查
GET /test      # 基础测试
```

### 本地开发

1. **克隆项目**
```bash
git clone <repository>
cd meridian-ai-worker
```

2. **环境配置**
```bash
cp .dev.vars.example .dev.vars
# 编辑.dev.vars文件配置密钥
```

3. **启动开发**
```bash
npm run dev
```

---

## 🔧 维护运维

### 监控要点

- **健康检查**: 定期访问 `/health` 端点
- **错误日志**: 监控Cloudflare Workers日志
- **API成本**: 跟踪AI提供商使用情况

### 常见问题

#### 1. 嵌入维度不匹配
**症状**: 向量存储失败  
**解决**: 确保使用`@cf/baai/bge-small-en-v1.5`模型（384维）

#### 2. AI提供商调用失败
**症状**: 分析/聊天功能异常  
**解决**: 检查API密钥配置和网络连接

#### 3. 部署失败
**症状**: wrangler deploy错误  
**解决**: 验证Cloudflare配置和权限

### 维护建议

- **定期更新**: 每月检查依赖更新
- **密钥轮换**: 定期更新AI提供商API密钥  
- **性能监控**: 关注响应时间和成功率
- **成本控制**: 监控AI调用成本

---

## 📚 相关文档

- [架构设计](./ARCHITECTURE.md) - 系统架构和设计思路
- [API指南](./API_GUIDE.md) - 详细的API使用说明
- [集成指南](./INTEGRATION_GUIDE.md) - 新功能集成方法
- [快速部署](./QUICK_DEPLOY.md) - 部署配置指南
