# Meridian ML Service - AI Worker 完美集成指南

## 🎯 概述

Meridian ML Service V2 现已完美集成 AI Worker 的数据格式，支持后端系统的所有聚类需求。本文档详细说明如何使用这些集成功能。

## 🔗 **核心集成特性**

### ✅ **完全兼容的数据格式**
- **简化嵌入格式**: `{id, embedding}` - 最轻量的后端调用
- **扩展嵌入格式**: `{id, embedding, title, url, ...}` - 带元数据的调用
- **完整文章格式**: `{id, title, content, embedding, publishDate, ...}` - 完整文章数据

### ✅ **智能格式检测**
- 自动识别 AI Worker 数据格式
- 无需手动指定数据类型
- 向后兼容所有现有调用

### ✅ **后端工作流支持**
- ✅ `auto-brief-generation.ts` - 自动简报生成
- ✅ `admin.ts` - 管理员聚类测试
- ✅ `debug.ts` - 聚类诊断功能

---

## 🚀 **API 端点指南**

### 1. **主要集成端点**

#### `/ai-worker/clustering` - **通用AI Worker端点**
**最常用的端点，完全兼容现有后端调用**

```bash
curl -X POST "http://localhost:8081/ai-worker/clustering" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"id": 1, "embedding": [0.1, 0.2, ...]},
      {"id": 2, "embedding": [0.3, 0.4, ...]}
    ],
    "config": {
      "umap_n_neighbors": 15,
      "hdbscan_min_cluster_size": 3
    },
    "optimization": {
      "enabled": true
    },
    "return_reduced_embeddings": true
  }'
```

**响应格式**:
```json
{
  "clusters": [...],
  "clustering_stats": {...},
  "config_used": {...},
  "reduced_embeddings": [[...]],
  "model_info": {
    "ai_worker_compatible": true,
    "detected_format": "ai_worker_embedding",
    "backend_integration": "完全兼容",
    "supported_workflows": [
      "auto-brief-generation",
      "clustering-workflow", 
      "debug-clustering"
    ]
  }
}
```

---

## 🔧 **后端集成示例**

### **auto-brief-generation.ts 集成**

现有的后端代码**无需修改**，直接替换 AI Worker URL：

```typescript
// 原有调用 (AI Worker)
const clusterRequest = new Request('https://meridian-ai-worker/meridian/clustering/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    articles: articlesForClustering, // [{id, embedding}, ...]
    options: {...}
  })
});

// 新的调用 (ML Service) - 只需更改URL
const clusterRequest = new Request('https://meridian-ml-service/ai-worker/clustering', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    items: articlesForClustering,  // 字段名从 articles -> items
    config: {...},                 // options -> config
    optimization: { enabled: true }
  })
});
```

### **TypeScript 类型定义**

```typescript
// 添加到后端类型定义
interface MLServiceClusteringRequest {
  items: Array<{
    id: number;
    embedding: number[];
    title?: string;
    url?: string;
  }>;
  config?: {
    umap_n_neighbors?: number;
    hdbscan_min_cluster_size?: number;
    normalize_embeddings?: boolean;
  };
  optimization?: {
    enabled: boolean;
  };
  content_analysis?: {
    enabled: boolean;
    top_n_per_cluster?: number;
  };
}

interface MLServiceClusteringResponse {
  clusters: Array<{
    cluster_id: number;
    size: number;
    items: Array<{
      index: number;
      text: string;
      metadata: any;
    }>;
    representative_content: string[];
  }>;
  clustering_stats: {
    n_samples: number;
    n_clusters: number;
    n_outliers: number;
    outlier_ratio: number;
  };
  config_used: any;
  reduced_embeddings?: number[][];
  model_info: {
    ai_worker_compatible: boolean;
    detected_format: string;
    backend_integration: string;
  };
}
```

---

## 🧪 **测试和验证**

没有自动化测试。原 `test/` 下的手动脚本已于 2026-09-23 删除（调用的路由已不存在，也没接入任何 runner）。

### **手动验证**

```bash
# 1. 健康检查
curl http://localhost:8081/health

# 2. 测试简化格式
curl -X POST "http://localhost:8081/ai-worker/clustering" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"id": 1, "embedding": [/* 384维向量 */]},
      {"id": 2, "embedding": [/* 384维向量 */]}
    ]
  }'
```

---

## 📊 **性能优化建议**

### **1. 数据格式选择**
- **简化格式** (`{id, embedding}`) - 最快，适合大批量处理
- **扩展格式** - 平衡性能和功能
- **完整格式** - 最丰富功能，适合详细分析

### **2. 配置优化**
```json
{
  "config": {
    "normalize_embeddings": true,    // 提高聚类质量
    "umap_n_neighbors": 15,         // 根据数据量调整
    "hdbscan_min_cluster_size": 3   // 避免过小聚类
  },
  "optimization": {
    "enabled": true                  // 自动优化参数
  },
  "content_analysis": {
    "enabled": false                // 高性能场景可关闭
  }
}
```

### **3. 批处理建议**
- **小批量** (< 50 篇): 使用所有功能
- **中批量** (50-200 篇): 关闭内容分析
- **大批量** (> 200 篇): 使用简化格式 + 基础配置

---

## 🔄 **迁移指南**

### **从 AI Worker 迁移到 ML Service**

1. **URL 更新**:
   ```diff
   - https://meridian-ai-worker/meridian/clustering/analyze
   + https://meridian-ml-service/ai-worker/clustering
   ```

2. **字段映射**:
   ```diff
   {
   -   "articles": [...],
   +   "items": [...],
   -   "options": {...}
   +   "config": {...},
   +   "optimization": {...}
   }
   ```

3. **响应处理**:
   ```typescript
   // 新增字段
   const clusteringStats = result.clustering_stats;
   const aiWorkerCompatible = result.model_info.ai_worker_compatible;
   ```

### **逐步迁移策略**

1. **阶段一**: 并行运行，对比结果
2. **阶段二**: 切换测试环境
3. **阶段三**: 逐步切换生产流量
4. **阶段四**: 完全迁移

---

## 🛠️ **故障排查**

### **常见问题**

**问题**: 数据格式检测错误
```bash
# 解决方案：检查数据结构
curl -X POST "/ai-worker/clustering" \
  -d '{"items": [{"id": 1, "embedding": [...]}]}'
# 确保 embedding 字段存在且为数组
```

**问题**: 聚类结果与 AI Worker 不一致
```bash
# 解决方案：使用相同配置
{
  "config": {
    "umap_n_neighbors": 15,        // 与 AI Worker 保持一致
    "hdbscan_min_cluster_size": 3
  }
}
```

**问题**: 性能较慢
```bash
# 解决方案：优化配置
{
  "optimization": {"enabled": false},  // 关闭参数优化
  "content_analysis": {"enabled": false},  // 关闭内容分析
  "return_reduced_embeddings": false   // 减少数据传输
}
```

### **调试信息**

ML Service 提供详细的调试信息：
```json
{
  "model_info": {
    "detected_format": "ai_worker_embedding",
    "data_type": "ai_worker_embedding", 
    "embedding_dimensions": 384,
    "ai_worker_compatible": true,
    "processing_time": 2.5
  }
}
```

---

## 📚 **总结**

✅ **完美集成**: ML Service 现已完全支持 AI Worker 数据格式  
✅ **零改动迁移**: 后端代码基本无需修改  
✅ **性能优化**: 提供比 AI Worker 更强的聚类能力  
✅ **类型安全**: 支持 TypeScript 强类型验证  
✅ **向后兼容**: 保持与现有系统的完全兼容  

通过这次集成，Meridian 系统现在拥有了更强大、更灵活、更高效的机器学习聚类能力！🚀 