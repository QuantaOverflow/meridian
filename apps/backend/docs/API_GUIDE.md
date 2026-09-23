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
```

### 3. 简报管理
```bash
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

### 4. 事件数据查询
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

### 5. 系统监控
```bash
# 近 24h 健康摘要
GET /observability/health/summary

# 按天的运行趋势
GET /observability/trends
```

### 6. Durable Objects管理
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

### 1. 错误处理
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

### 2. 认证管理
保护好API Token，避免在客户端代码中硬编码。

### 3. 性能优化
- 使用适当的分页大小（建议20-50条记录）
- 对于频繁查询，考虑客户端缓存
- 避免不必要的轮询，使用合适的查询间隔

## 🔗 相关链接

- [完整API文档 (Swagger)](./meridian-api-docs.yaml)
- [项目README](./README.MD)

## 📞 支持

如有问题，请查看：
1. API文档中的错误响应说明
2. 项目Issues页面 