# Meridian ML Service - 新接口使用示例

## 概述

本文档展示如何使用新的解耦接口，这些接口允许直接使用预生成的嵌入向量进行聚类，无需重复生成嵌入。

## 接口端点

### 1. `/clustering/with-embeddings` - 预生成嵌入聚类

适用于已有嵌入向量的通用文本聚类。

```python
import requests

# 请求示例
request_data = {
    "items": [
        {
            "id": "item_1",
            "text": "AI breakthrough in machine learning",
            "embedding": [0.1, 0.2, ..., 0.3]  # 384维向量
        },
        {
            "id": "item_2", 
            "text": "New algorithm improves efficiency",
            "embedding": [0.2, 0.1, ..., 0.4]  # 384维向量
        }
    ],
    "config": {
        "umap_n_components": 5,
        "umap_n_neighbors": 10,
        "hdbscan_min_cluster_size": 3
    },
    "return_reduced_embeddings": True,
    "include_cluster_content": True,
    "content_top_n": 5
}

response = requests.post(
    "http://localhost:8080/clustering/with-embeddings",
    headers={"Authorization": "Bearer your-token"},
    json=request_data
)

result = response.json()
print(f"发现 {len(result['clusters'])} 个聚类")
```

### 2. `/clustering/articles` - 文章聚类

专门为文章数据设计，兼容AI Worker的数据格式。

```python
request_data = {
    "articles": [
        {
            "id": 1,
            "title": "AI Revolution in Healthcare",
            "content": "Artificial intelligence is transforming healthcare...",
            "url": "https://example.com/ai-healthcare",
            "embedding": [0.1, 0.2, ..., 0.3],  # 384维向量
            "publishDate": "2025-05-30T10:00:00Z",
            "status": "PROCESSED"
        }
    ],
    "config": {
        "umap_n_components": 3,
        "hdbscan_min_cluster_size": 2
    },
    "include_cluster_content": True,
    "content_fields": ["title", "content"],
    "use_optimization": False
}

response = requests.post(
    "http://localhost:8080/clustering/articles",
    headers={"Authorization": "Bearer your-token"},
    json=request_data
)

result = response.json()
for cluster in result['clusters']:
    print(f"聚类 {cluster['cluster_id']}: {cluster['size']} 篇文章")
    if cluster['time_range']:
        print(f"时间范围: {cluster['time_range']['earliest']} - {cluster['time_range']['latest']}")
```

### 3. `/clustering/hybrid` - 混合模式聚类

支持部分数据有嵌入，部分数据需要现场生成嵌入。

```python
request_data = {
    "items": [
        {
            "id": "with_emb_1",
            "text": "Technology innovation drives progress",
            "embedding": [0.1, 0.2, ..., 0.3]  # 有预生成嵌入
        },
        {
            "id": "without_emb_1",
            "text": "New software development methodologies"
            # 没有嵌入，会自动生成
        }
    ],
    "config": {
        "umap_n_components": 2,
        "hdbscan_min_cluster_size": 2
    },
    "embedding_model": "intfloat/multilingual-e5-small",
    "return_embeddings": True
}

response = requests.post(
    "http://localhost:8080/clustering/hybrid",
    headers={"Authorization": "Bearer your-token"},
    json=request_data
)
```

## 与AI Worker集成示例

### 从AI Worker获取处理过的文章并聚类

```python
import requests

# 1. 从AI Worker获取已处理的文章
ai_worker_response = requests.post(
    "http://ai-worker-url/meridian/articles/get-processed",
    json={
        "dateFrom": "2025-05-29",
        "dateTo": "2025-05-30",
        "limit": 100,
        "onlyWithEmbeddings": True
    }
)

articles_data = ai_worker_response.json()['data']

# 2. 直接使用这些数据进行聚类
clustering_request = {
    "articles": articles_data,  # 直接使用AI Worker的数据格式
    "config": {
        "umap_n_components": 5,
        "hdbscan_min_cluster_size": 3
    },
    "include_cluster_content": True,
    "use_optimization": True  # 使用参数优化
}

clustering_response = requests.post(
    "http://localhost:8080/clustering/articles",
    headers={"Authorization": "Bearer your-token"},
    json=clustering_request
)

clusters = clustering_response.json()['clusters']
print(f"发现 {len(clusters)} 个新闻主题聚类")
```

## 错误处理

### 嵌入维度验证错误

```python
try:
    response = requests.post(url, json=data)
    response.raise_for_status()
except requests.exceptions.HTTPError as e:
    if response.status_code == 400:
        error_detail = response.json().get('detail', '')
        if '维嵌入' in error_detail:
            print("嵌入维度错误，请确保使用384维向量")
        elif '无效数值' in error_detail:
            print("嵌入包含无效数值，请检查数据")
```

### 服务健康检查

```python
def check_service_health():
    """检查ML服务状态"""
    try:
        response = requests.get("http://localhost:8080/health", timeout=10)
        if response.status_code == 200:
            health = response.json()
            return {
                'healthy': health.get('status') == 'healthy',
                'clustering_available': health.get('clustering_available', False),
                'embedding_model': health.get('embedding_model')
            }
    except Exception as e:
        return {'healthy': False, 'error': str(e)}
```

## 性能优化建议

### 1. 批量处理

```python
# 推荐：批量处理多个项目
large_batch = {
    "items": items_list,  # 100-1000个项目
    "config": optimized_config
}

# 避免：频繁的小批量请求
for item in items_list:  # 不推荐
    single_request = {"items": [item]}
```

### 2. 配置优化

```python
# 快速聚类配置（适合预览）
fast_config = {
    "umap_n_components": 2,
    "umap_n_neighbors": 5,
    "hdbscan_min_cluster_size": 5
}

# 精确聚类配置（适合生产）
precise_config = {
    "umap_n_components": 10,
    "umap_n_neighbors": 15,
    "hdbscan_min_cluster_size": 3,
    "use_optimization": True  # 自动优化参数
}
```

### 3. 响应数据控制

```python
# 减少网络传输的配置
minimal_response = {
    "items": items,
    "return_reduced_embeddings": False,  # 不返回降维向量
    "include_cluster_content": False,    # 不包含内容分析
    "content_top_n": 3                   # 减少返回的内容数量
}
```

## 数据格式说明

### 嵌入向量要求

- **维度**: 必须是384维（使用bge-small-en-v1.5模型）
- **数据类型**: List[float] 或 numpy array
- **数值范围**: 建议进行L2归一化，避免极值
- **有效性**: 不能包含NaN或无穷大值

### 文章数据格式

```typescript
interface ArticleItem {
  id: number;
  title: string;
  content: string;
  url: string;
  embedding: number[];        // 384维向量
  publishDate: string;        // ISO 8601格式
  status: string;             // 处理状态
}
```

### 响应格式

```typescript
interface ClusteringResponse {
  clusters: ClusterInfo[];
  clustering_stats: {
    n_clusters: number;
    n_outliers: number;
    dbcv_score?: number;
    cluster_sizes: Record<string, number>;
  };
  config_used: Record<string, any>;
  processing_time?: number;
}
```

## 最佳实践

1. **数据验证**: 发送请求前验证嵌入向量的维度和有效性
2. **错误处理**: 实现完整的错误处理和重试机制
3. **批量处理**: 合理组织数据批次，平衡性能和内存使用
4. **配置调优**: 根据数据特点调整聚类参数
5. **监控日志**: 关注处理时间和聚类质量指标 