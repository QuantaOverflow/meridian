# Meridian Backend API 使用指南

Meridian是一个AI驱动的个性化情报简报系统，本文档提供API的快速使用指南。

## 🚀 快速开始

### 基础信息
- **开发环境**: `http://localhost:8787`
- **认证方式**: Bearer Token
- **响应格式**: JSON

### 认证
大部分管理端点需要在请求头中包含API Token：
```bash
Authorization: Bearer {YOUR_API_TOKEN}
```

## 📋 核心功能

### 1. 健康检查
```bash
# 检查API服务状态
GET /ping
```

### 2. RSS源管理
```bash
# 获取所有RSS源
GET /admin/sources

# 创建新RSS源
POST /admin/sources
Content-Type: application/json
Authorization: Bearer {API_TOKEN}

{
  "name": "Example News",
  "url": "https://example.com/feed.xml",
  "category": "news",
  "scrape_frequency": 4
}

# 更新RSS源
PUT /admin/sources/{id}
Content-Type: application/json
Authorization: Bearer {API_TOKEN}

{
  "name": "Updated Name",
  "category": "tech"
}

# 删除RSS源
DELETE /admin/sources/{id}
Authorization: Bearer {API_TOKEN}
```

### 3. 文章管理
```bash
# 获取文章列表（支持分页和过滤）
GET /admin/articles?page=1&limit=20&status=PROCESSED
Authorization: Bearer {API_TOKEN}

# 按状态过滤
GET /admin/articles?status=PENDING_FETCH
GET /admin/articles?status=PROCESSED
```

### 4. 系统概览
```bash
# 获取系统运行状态
GET /admin/overview
Authorization: Bearer {API_TOKEN}
```

### 5. 简报管理
```bash
# 获取最新简报
GET /reports/last-report
Authorization: Bearer {API_TOKEN}

# 创建新简报
POST /reports/report
Content-Type: application/json
Authorization: Bearer {API_TOKEN}

{
  "title": "Daily Brief",
  "content": "Brief content...",
  "totalArticles": 50,
  "totalSources": 5,
  "usedArticles": 30,
  "usedSources": 3,
  "tldr": "Summary...",
  "createdAt": "2025-01-01T12:00:00Z",
  "model_author": "gemini-2.0-flash",
  "clustering_params": {
    "umap": { "n_neighbors": 15 },
    "hdbscan": { "min_cluster_size": 3, "min_samples": 2, "epsilon": 0.1 }
  }
}

# 触发简报生成
POST /admin/briefs/generate
Content-Type: application/json
Authorization: Bearer {API_TOKEN}

{
  "dateFrom": "2025-01-01T00:00:00Z",
  "dateTo": "2025-01-01T23:59:59Z",
  "minImportance": 5,
  "triggeredBy": "manual"
}
```

### 6. 事件数据查询
```bash
# 获取所有事件
GET /events
Authorization: Bearer {API_TOKEN}

# 按日期过滤
GET /events?date=2025-01-01
Authorization: Bearer {API_TOKEN}

# 分页查询
GET /events?pagination=true&page=1&limit=10
Authorization: Bearer {API_TOKEN}

# 组合查询
GET /events?date=2025-01-01&pagination=true&limit=5
Authorization: Bearer {API_TOKEN}
```

### 7. 系统监控
```bash
# 工作流状态监控
GET /observability/workflows

# 简报统计信息
GET /observability/briefs/stats
```

### 8. Durable Objects管理
```bash
# 初始化所有DO
POST /do/admin/initialize-dos
Authorization: Bearer {API_TOKEN}

# 获取特定源的DO状态
GET /do/source/{sourceId}/status
Authorization: Bearer {API_TOKEN}
```

## 📊 响应格式

### 成功响应
```json
{
  "success": true,
  "data": { /* 响应数据 */ },
  "message": "操作成功",
  "timestamp": "2025-01-01T12:00:00Z",
  "pagination": { /* 可选分页信息 */ }
}
```

### 错误响应
```json
{
  "success": false,
  "error": "错误描述",
  "timestamp": "2025-01-01T12:00:00Z"
}
```

## 🏷️ 文章状态枚举

| 状态 | 描述 |
|------|------|
| `PENDING_FETCH` | 等待抓取 |
| `CONTENT_FETCHED` | 内容已抓取 |
| `PROCESSED` | 已处理完成 |
| `SKIPPED_PDF` | 跳过PDF文件 |
| `FETCH_FAILED` | 抓取失败 |
| `RENDER_FAILED` | 渲染失败 |
| `AI_ANALYSIS_FAILED` | AI分析失败 |
| `EMBEDDING_FAILED` | 向量化失败 |
| `R2_UPLOAD_FAILED` | 上传失败 |
| `SKIPPED_TOO_OLD` | 跳过过旧文章 |

## 🔧 抓取频率设置

| 值 | 描述 |
|----|------|
| 1 | 每小时 |
| 2 | 每4小时 |
| 3 | 每6小时 |
| 4 | 每天 |

## 🚦 HTTP状态码

- `200` - 成功
- `201` - 创建成功
- `202` - 请求已接受（异步处理）
- `400` - 请求参数错误
- `401` - 未授权
- `404` - 资源未找到
- `409` - 资源冲突
- `500` - 服务器内部错误

## 💡 使用建议

### 1. 批量操作
对于大量数据操作，建议使用分页参数：
```bash
GET /admin/articles?limit=50&page=1
```

### 2. 错误处理
始终检查响应中的 `success` 字段：
```javascript
if (response.success) {
  // 处理成功响应
  console.log(response.data);
} else {
  // 处理错误
  console.error(response.error);
}
```

### 3. 认证管理
保护好API Token，避免在客户端代码中硬编码。

### 4. 性能优化
- 使用适当的分页大小（建议20-50条记录）
- 对于频繁查询，考虑客户端缓存
- 避免不必要的轮询，使用合适的查询间隔

## 🔗 相关链接

- [完整API文档 (Swagger)](./meridian-api-docs.yaml)
- [API测试脚本](../api-endpoint-test.js)
- [项目README](./README.MD)

## 📞 支持

如有问题，请查看：
1. API文档中的错误响应说明
2. 测试脚本的使用示例
3. 项目Issues页面 