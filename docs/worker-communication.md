# Meridian Workers 间通信架构

## 📋 概述

Meridian 项目采用多 Worker 架构，`meridian-backend` 和 `meridian-ai-worker` 之间通过 **Cloudflare Service Bindings** 进行通信。这种架构实现了功能分离、独立部署和服务复用。

## 🏗️ 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    Meridian 系统架构                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    Service Binding    ┌──────────────────┐ │
│  │                 │   ──────────────────> │                  │ │
│  │ meridian-backend│                       │ meridian-ai-     │ │
│  │                 │   <────────────────── │ worker           │ │
│  │                 │    Direct Method Call │                  │ │
│  └─────────────────┘                       └──────────────────┘ │
│         │                                            │          │
│         │                                            │          │
│  ┌──────▼──────┐                              ┌──────▼──────┐    │
│  │ - RSS 抓取   │                              │ - AI 分析    │    │
│  │ - 工作流管理 │                              │ - 多模型支持 │    │
│  │ - 数据存储   │                              │ - 智能路由   │    │
│  │ - 队列处理   │                              │ - 成本优化   │    │
│  └─────────────┘                              └─────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 🔗 Service Binding 配置

### Backend Worker (meridian-backend)

**wrangler.jsonc 配置:**
```json
{
  "services": [
    {
      "binding": "AI_WORKER",
      "service": "meridian-ai-worker"
    }
  ]
}
```

**类型定义:**
```typescript
export type Env = {
  // AI Worker Service Binding
  AI_WORKER: {
    analyzeArticle(params: {
      title: string
      content: string
      options?: {
        provider?: string
        model?: string
      }
    }): Promise<{
      success: boolean
      data?: any
      error?: string
      metadata?: any
    }>
    
    generateEmbedding(params: {
      text: string
      options?: {
        provider?: string
        model?: string
      }
    }): Promise<{
      success: boolean
      data?: number[]
      error?: string
      metadata?: any
    }>
    
    healthCheck(): Promise<{
      status: string
      service: string
      version: string
      providers?: any
    }>
  }
}
```

### AI Worker (meridian-ai-worker)

**导出的服务类:**
```typescript
export class MeridianAIWorkerService {
  constructor(private env: CloudflareEnv) {
    this.aiGateway = new AIGatewayService(env)
  }

  // 文章分析方法
  async analyzeArticle(params) { /* ... */ }
  
  // 嵌入生成方法  
  async generateEmbedding(params) { /* ... */ }
  
  // 健康检查方法
  async healthCheck() { /* ... */ }
}

// 导出供其他 Worker 绑定使用
export { MeridianAIWorkerService }
```

## 🚀 通信方式详解

### 1. Service Binding - 直接方法调用

Service Binding 是 **最高效的 Worker 间通信方式**：

#### 特点：
- ✅ **零延迟** - 直接内存调用，无网络开销
- ✅ **类型安全** - TypeScript 完全支持
- ✅ **异常处理** - 原生 Promise/async-await 支持
- ✅ **自动重试** - Cloudflare 平台级别保障
- ✅ **无序列化成本** - 直接传递 JavaScript 对象

#### 使用示例：
```typescript
// Backend 调用 AI Worker
const response = await env.AI_WORKER.analyzeArticle({
  title: "新闻标题",
  content: "新闻内容...",
  options: {
    provider: 'google-ai-studio',
    model: 'gemini-1.5-flash-8b-001'
  }
});

if (response.success) {
  const analysisData = response.data; // 结构化分析结果
  console.log('分析完成:', analysisData.topic_tags);
} else {
  console.error('分析失败:', response.error);
}
```

### 2. HTTP API - 外部访问

AI Worker 同时提供 HTTP 端点用于外部系统访问：

```typescript
// 外部系统或测试
const response = await fetch('https://meridian-ai-worker.swj299792458.workers.dev/meridian/article/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: "新闻标题",
    content: "新闻内容...",
    options: { provider: 'google-ai-studio' }
  })
});

const result = await response.json();
```

## 📊 通信流程详解

### 文章处理工作流

```mermaid
sequenceDiagram
    participant RSS as RSS源
    participant Backend as Backend Worker
    participant AI as AI Worker
    participant DB as 数据库
    participant R2 as R2 存储

    RSS->>Backend: 新文章触发
    Backend->>Backend: 提取文章内容
    
    Note over Backend,AI: Service Binding 调用
    Backend->>AI: analyzeArticle(title, content)
    AI->>AI: 使用专业 Prompt 分析
    AI->>Backend: 返回结构化数据
    
    Backend->>AI: generateEmbedding(searchText)
    AI->>Backend: 返回向量嵌入
    
    parallel
        Backend->>DB: 保存分析结果
    and
        Backend->>R2: 上传原文内容
    end
    
    Backend->>Backend: 标记处理完成
```

### 具体代码实现

**Backend Workflow 中的调用:**
```typescript
// 分析文章内容
const articleAnalysis = await step.do(
  `analyze article ${article.id}`,
  { retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' }, timeout: '1 minute' },
  async () => {
    // 使用 AI_WORKER service binding
    const response = await env.AI_WORKER.analyzeArticle({
      title: article.title,
      content: article.text,
      options: {
        provider: 'google-ai-studio',
        model: 'gemini-1.5-flash-8b-001'
      }
    });
    
    if (!response.success) {
      throw new Error(response.error || 'AI analysis failed');
    }
    
    return response.data; // 直接获得结构化数据
  }
);

// 生成向量嵌入
const embeddingResult = await step.do(`generate embeddings for article ${article.id}`, async () => {
  const searchText = generateSearchText({ title: article.title, ...articleAnalysis });
  
  const embeddingResponse = await env.AI_WORKER.generateEmbedding({
    text: searchText,
    options: {
      provider: 'workers-ai',
      model: '@cf/baai/bge-small-en-v1.5'
    }
  });
  
  if (!embeddingResponse.success) {
    throw new Error(embeddingResponse.error || 'Embedding generation failed');
  }
  
  return embeddingResponse.data; // 直接获得数组
});
```

## 🔄 通信特性

### 1. 是否双向通信？

**答案：理论上支持，实际上单向**

- ✅ **技术上双向**: AI Worker 可以配置 Service Binding 调用 Backend
- 🚫 **架构上单向**: 当前设计为 Backend → AI Worker 的单向调用
- 🎯 **设计原则**: 保持清晰的依赖关系，避免循环依赖

### 2. 为什么选择单向架构？

#### 优势：
- **清晰的职责分离**: Backend 负责业务逻辑，AI Worker 负责AI服务
- **独立部署**: 两个 Worker 可以独立更新和扩展
- **避免循环依赖**: 简化调试和故障排除
- **更好的可测试性**: 每个服务都有明确的输入输出

#### 职责划分：

| Worker | 主要职责 | 依赖关系 |
|--------|----------|----------|
| **Backend** | RSS抓取、数据存储、工作流管理、业务逻辑 | 调用 → AI Worker |
| **AI Worker** | AI模型调用、智能路由、成本优化、多提供商支持 | 独立服务 |

## 🚀 性能特征

### Service Binding 性能优势

```typescript
// 性能对比
async function performanceComparison() {
  // Service Binding (推荐)
  const startBinding = Date.now();
  const result1 = await env.AI_WORKER.analyzeArticle(params);
  const bindingTime = Date.now() - startBinding;
  console.log(`Service Binding: ${bindingTime}ms`); // ~5-10ms

  // HTTP 调用 (备选)
  const startHTTP = Date.now();
  const response = await fetch('https://meridian-ai-worker.swj299792458.workers.dev/meridian/article/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const result2 = await response.json();
  const httpTime = Date.now() - startHTTP;
  console.log(`HTTP Call: ${httpTime}ms`); // ~100-300ms
}
```

### 性能优势对比

| 特性 | Service Binding | HTTP 调用 |
|------|----------------|-----------|
| **延迟** | < 10ms | 100-300ms |
| **序列化** | 无需序列化 | JSON 序列化/反序列化 |
| **网络开销** | 零 | TCP/HTTP 开销 |
| **错误处理** | 原生异常 | HTTP 状态码 |
| **类型安全** | 完全支持 | 需要运行时验证 |

## 🛠️ 开发和部署

### 本地开发

```bash
# 启动 AI Worker
cd services/meridian-ai-worker
npm run dev

# 启动 Backend (会自动连接到本地 AI Worker)
cd apps/backend  
npm run dev
```

### 生产部署

```bash
# 先部署 AI Worker
cd services/meridian-ai-worker
npm run deploy

# 再部署 Backend (使用生产 AI Worker)
cd apps/backend
npm run deploy
```

## 🔧 故障排除

### 常见问题

1. **Service Binding 失败**
   ```
   Error: Service binding 'AI_WORKER' not found
   ```
   **解决方案**: 检查 wrangler.jsonc 中的 services 配置

2. **类型错误**
   ```
   Property 'analyzeArticle' does not exist on type...
   ```
   **解决方案**: 运行 `wrangler types` 重新生成类型定义

3. **方法调用失败**
   ```
   TypeError: env.AI_WORKER.analyzeArticle is not a function
   ```
   **解决方案**: 确保 AI Worker 已正确部署并导出 MeridianAIWorkerService

### 调试技巧

```typescript
// 添加调试日志
const response = await env.AI_WORKER.analyzeArticle(params);
console.log('AI Worker Response:', {
  success: response.success,
  dataType: typeof response.data,
  provider: response.metadata?.provider,
  processingTime: response.metadata?.processingTime
});
```

## 📈 扩展性考虑

### 未来可能的双向通信场景

1. **AI Worker 主动通知 Backend**
   - 模型训练完成通知
   - 成本阈值警告
   - 服务状态变更

2. **实现方式**
   ```typescript
   // AI Worker 配置 Backend binding (如果需要)
   "services": [
     {
       "binding": "BACKEND_WORKER", 
       "service": "meridian-backend"
     }
   ]
   ```

3. **替代方案**
   - 使用 Queue 进行异步通信
   - 通过 Durable Objects 实现状态共享
   - 事件驱动架构

## 📚 总结

Meridian 的 Worker 间通信架构具有以下特点：

✅ **高性能**: Service Binding 提供零延迟的直接调用  
✅ **类型安全**: 完整的 TypeScript 支持  
✅ **清晰架构**: 单向依赖，职责明确  
✅ **易于维护**: 独立部署，版本管理简单  
✅ **可扩展**: 支持添加更多 Worker 和服务  

这种架构为 Meridian 提供了强大的基础，支持高效的 AI 驱动新闻分析和处理流程。 