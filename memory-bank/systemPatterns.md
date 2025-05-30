# System Patterns - Meridian

## 系统架构概览

### 高层架构
Meridian采用微服务架构，基于Cloudflare生态系统构建：

```
[RSS Sources] → [Scraper CF Workers] → [Metadata DB]
      ↓
[Article Processor CF Workflows] → [Content Extraction]
      ↓
[AI Analysis (Gemini)] → [Processed Articles DB]
      ↓
[Python Brief Generation] → [Clustering (UMAP/HDBSCAN)]
      ↓
[Final Brief Generation] → [Reports DB] → [Frontend API] → [Nuxt UI]
```

### 关键架构决策

#### 1. Cloudflare Workers 作为计算层
**决策**: 使用Cloudflare Workers处理RSS抓取和文章处理
**原因**:
- 全球边缘计算，低延迟
- 自动扩缩容
- 成本效益
- 与Cloudflare生态集成良好

#### 2. Monorepo 结构
**决策**: 使用Turborepo管理多个应用和包
**结构**:
```
apps/
  ├── backend/          # Cloudflare Workers API
  ├── frontend/         # Nuxt 3 应用
  └── briefs/           # Python 简报生成
packages/
  └── database/         # 共享数据库模式
services/
  ├── meridian-ai-worker/     # AI 处理服务
  └── meridian-ml-service/    # ML 聚类服务
```

#### 3. AI 模型选择
**决策**: 主要使用Google Gemini模型
- **Gemini 2.0 Flash**: 主要工作负载（经济性）
- **Gemini 2.5 Pro**: 复杂分析任务（准确性）
**原因**:
- 成本效益（Flash模型几乎免费）
- 多模态能力
- 长上下文支持
- API稳定性

## 核心组件设计

### 1. 数据抓取层 (Scraper)
**组件**: `apps/backend/src/workflows/`
**职责**:
- RSS feed 监控和抓取
- 文章元数据提取
- 重复检测和过滤

**设计模式**:
- Cron-triggered workflows
- 批量处理
- 错误重试机制

### 2. 内容处理层 (Processor)
**组件**: `apps/backend/src/routers/`
**职责**:
- 文章全文提取
- 内容清理和标准化
- AI相关性分析

**设计模式**:
- Pipeline pattern
- Strategy pattern（不同提取策略）
- Circuit breaker（外部API失败处理）

### 3. AI分析层
**组件**: `services/meridian-ai-worker/`
**职责**:
- 文章内容分析
- 相关性评分
- 结构化数据提取

**设计模式**:
- Producer-Consumer pattern
- Template Method（不同AI任务）
- Adapter pattern（多AI提供商）

### 4. 聚类分析层
**组件**: `services/meridian-ml-service/`
**职责**:
- 文章向量化（Embeddings）
- 聚类算法（UMAP + HDBSCAN）
- 主题识别

**设计模式**:
- Pipeline pattern
- Strategy pattern（不同聚类算法）
- Factory pattern（聚类参数配置）

### 5. 简报生成层
**组件**: `apps/briefs/`
**职责**:
- 聚类分析和排序
- 简报结构生成
- Markdown格式输出

**设计模式**:
- Template Method
- Builder pattern（简报构建）
- Observer pattern（进度跟踪）

### 6. API层
**组件**: `apps/backend/src/routers/`
**职责**:
- RESTful API endpoints
- 数据验证
- 缓存管理

**设计模式**:
- Repository pattern
- Middleware pattern
- Response caching

### 7. 前端层
**组件**: `apps/frontend/`
**职责**:
- 用户界面
- 简报展示
- 管理功能

**设计模式**:
- Component composition
- State management
- Reactive data flow

## 数据流模式

### 1. 实时数据流
```
RSS监控 → 实时抓取 → 元数据存储 → 优先级队列 → 内容处理
```

### 2. 批处理数据流
```
定时触发 → 批量抓取 → 批量处理 → AI分析 → 数据库更新
```

### 3. 简报生成流
```
已处理文章 → 向量化 → 聚类 → 排序 → AI分析 → 简报生成 → 存储
```

## 扩展性考虑

### 水平扩展
- Cloudflare Workers 自动扩展
- 数据库连接池管理
- 缓存层优化

### 垂直扩展
- AI模型选择策略
- 资源分配优化
- 性能监控

### 可靠性设计
- 重试机制
- 错误处理
- 数据一致性保证
- 监控和告警

## 安全模式

### API安全
- 请求验证
- 速率限制
- 身份认证

### 数据安全
- 敏感数据加密
- 访问控制
- 审计日志

## 性能优化模式

### 缓存策略
- Edge caching
- Database query optimization
- Static asset optimization

### 资源优化
- Lazy loading
- Bundle splitting
- Image optimization 

## AI Service Architecture

### Option 1: Direct Cloudflare AI Usage (Simpler)
```typescript
// In backend wrangler.toml
[ai]
binding = "AI"

// Direct usage in workflows
const analysis = await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
  prompt: `分析文章: ${content}`
});
```

**优点**：
- 更简单，少一层抽象
- 直接使用官方绑定

**缺点**：
- 只能使用 Cloudflare AI 模型（有限）
- 无法使用 Google Gemini（我们的主要AI）
- 业务逻辑分散在各个地方
- 难以统一管理和优化

### Option 2: 自定义 AI Worker 服务（我们的选择）
```typescript
// Service Binding to our custom worker
const analysis = await env.MERIDIAN_AI_WORKER.analyzeArticle({
  title: article.title,
  content: article.content,
  options: { provider: 'google', model: 'gemini-1.5-flash' }
});
```

**优点**：
- 支持多个AI提供商（Google Gemini + Cloudflare AI）
- 统一的业务逻辑和提示词管理
- 智能重试、缓存、成本优化
- 类型安全的 TypeScript 接口
- 易于扩展新的AI提供商

**缺点**：
- 稍微复杂一些的架构

### 为什么选择自定义 AI Worker？

1. **Google Gemini 支持**：Cloudflare AI 不支持 Google Gemini，但 Gemini 2.0 Flash 性价比最高
2. **业务特化**：我们需要专门的文章分析提示词和逻辑
3. **多提供商策略**：主用 Gemini，Cloudflare AI 作为备用
4. **统一管理**：所有AI调用的监控、缓存、重试都在一个地方

## Service Binding vs HTTP API

// ... existing code ... 