# Meridian ML Service 架构重构方案
## 解耦嵌入生成与聚类服务

### 重构目标

将向量嵌入服务从聚类流程中解耦，允许聚类服务接受预生成的嵌入向量，提高系统模块化和灵活性。

### 当前架构问题

1. **紧耦合**: 聚类服务强制依赖内部嵌入生成
2. **重复计算**: AI Worker 已生成嵌入，ML Service 再次生成造成资源浪费
3. **数据流不优化**: 数据在服务间传输时丢失已计算的向量信息

### 新架构设计

#### 1. 数据流重构

```
原有流程:
Text → AI Worker (生成嵌入) → 数据库 → ML Service (重新生成嵌入) → 聚类

新流程:
Text → AI Worker (生成嵌入) → ML Service (直接使用嵌入) → 聚类
```

#### 2. AI Worker 数据接口分析

基于 `meridian-ai-worker` 源码分析，当前数据格式：

**嵌入生成接口** (`/meridian/embeddings/generate`):
```typescript
// 响应格式
{
  success: true,
  data: number[],           // 384维向量
  model: string,           // 模型名称
  dimensions: number,      // 384
  text_length: number,
  metadata: {
    provider: string,
    model: string,
    processingTime: number,
    cached: boolean
  }
}
```

**文章数据接口** (`/meridian/articles/get-processed`):
```typescript
// 响应格式
{
  data: [
    {
      id: number,
      title: string,
      url: string,
      content: string,
      publishDate: string,
      embedding: number[],    // 384维向量
      status: "PROCESSED"
    }
  ]
}
```

#### 3. 新的 ML Service 接口设计

##### 3.1 独立嵌入生成服务 (保持现有)
```python
# 保持现有接口，用于纯嵌入生成需求
POST /embeddings
{
  "texts": List[str]
}

# 响应
{
  "embeddings": List[List[float]],
  "model_name": str
}
```

##### 3.2 新增：接受预生成嵌入的聚类服务
```python
POST /clustering/with-embeddings
{
  "items": [
    {
      "id": str | int,
      "text": str,
      "embedding": List[float]  # 384维向量
    }
  ],
  "config": Optional[ClusteringConfig],
  "return_reduced_embeddings": bool = True
}

# 响应
{
  "cluster_labels": List[int],
  "clustering_stats": ClusteringStats,
  "config_used": Dict[str, Any],
  "reduced_embeddings": Optional[List[List[float]]],
  "cluster_content": Optional[Dict[int, List[Dict]]],
  "optimization": OptimizationResult
}
```

##### 3.3 批量文章聚类接口 (适配 AI Worker 数据)
```python
POST /clustering/articles
{
  "articles": [
    {
      "id": int,
      "title": str,
      "content": str,
      "url": str,
      "embedding": List[float],
      "publishDate": str,
      "status": str
    }
  ],
  "config": Optional[ClusteringConfig],
  "include_cluster_content": bool = True,
  "content_fields": List[str] = ["title", "content"],
  "use_optimization": bool = False
}

# 响应
{
  "clusters": [
    {
      "cluster_id": int,
      "articles": [
        {
          "id": int,
          "title": str,
          "content": str,
          "url": str,
          "cluster_position": List[float]  # 降维坐标
        }
      ],
      "centroid": List[float],
      "summary": str,  # 可选的集群摘要
      "keywords": List[str]
    }
  ],
  "clustering_stats": ClusteringStats,
  "config_used": Dict[str, Any],
  "optimization": OptimizationResult
}
```

##### 3.4 混合模式接口 (向后兼容)
```python
POST /clustering/hybrid
{
  "items": [
    {
      "id": str | int,
      "text": str,
      "embedding": Optional[List[float]]  # 可选预生成嵌入
    }
  ],
  "config": Optional[ClusteringConfig],
  "embedding_model": Optional[str],  # 仅在缺少嵌入时使用
  "return_embeddings": bool = False
}
```

#### 4. 数据模型定义

```python
# 新增数据模型
from pydantic import BaseModel, Field
from typing import List, Optional, Union, Dict, Any

class EmbeddingItem(BaseModel):
    id: Union[str, int] = Field(..., description="项目唯一标识")
    text: str = Field(..., description="文本内容")
    embedding: List[float] = Field(..., description="384维嵌入向量")

class ArticleItem(BaseModel):
    id: int = Field(..., description="文章ID")
    title: str = Field(..., description="文章标题")
    content: str = Field(..., description="文章内容")
    url: str = Field(..., description="文章URL")
    embedding: List[float] = Field(..., description="384维嵌入向量")
    publishDate: str = Field(..., description="发布日期")
    status: str = Field(..., description="处理状态")

class ClusteringWithEmbeddingsRequest(BaseModel):
    items: List[EmbeddingItem] = Field(..., description="带嵌入的文本项目")
    config: Optional[ClusteringConfig] = Field(default=None)
    return_reduced_embeddings: bool = Field(default=True)

class ArticleClusteringRequest(BaseModel):
    articles: List[ArticleItem] = Field(..., description="文章列表")
    config: Optional[ClusteringConfig] = Field(default=None)
    include_cluster_content: bool = Field(default=True)
    content_fields: List[str] = Field(default=["title", "content"])
    use_optimization: bool = Field(default=False)

class ClusterInfo(BaseModel):
    cluster_id: int = Field(..., description="聚类ID")
    articles: List[Dict[str, Any]] = Field(..., description="聚类中的文章")
    centroid: List[float] = Field(..., description="聚类中心点")
    summary: Optional[str] = Field(default=None, description="聚类摘要")
    keywords: List[str] = Field(default_factory=list, description="关键词")

class ArticleClusteringResponse(BaseModel):
    clusters: List[ClusterInfo] = Field(..., description="聚类结果")
    clustering_stats: ClusteringStats = Field(..., description="聚类统计")
    config_used: Dict[str, Any] = Field(..., description="使用的配置")
    optimization: OptimizationResult = Field(..., description="优化结果")
```

#### 5. 实现方案

##### 5.1 核心聚类函数重构
```python
def cluster_embeddings_only(
    embeddings: np.ndarray,
    texts: Optional[List[str]] = None,
    config: Optional[ClusteringConfig] = None
) -> Dict[str, Any]:
    """
    仅使用预生成的嵌入进行聚类
    
    Args:
        embeddings: 预生成的嵌入向量 [n_samples, 384]
        texts: 可选的文本内容，用于内容分析
        config: 聚类配置
        
    Returns:
        聚类结果字典
    """
    # 验证嵌入维度
    if embeddings.shape[1] != 384:
        raise ValueError(f"期望384维嵌入，实际得到{embeddings.shape[1]}维")
    
    # 直接进入聚类流程，跳过嵌入生成
    return cluster_embeddings_from_vectors(embeddings, texts, config)
```

##### 5.2 嵌入验证中间件
```python
def validate_embeddings(embeddings: List[List[float]]) -> np.ndarray:
    """验证和转换嵌入向量"""
    if not embeddings:
        raise ValueError("嵌入向量列表不能为空")
    
    embeddings_array = np.array(embeddings, dtype=np.float32)
    
    if embeddings_array.ndim != 2:
        raise ValueError("嵌入必须是二维数组")
    
    if embeddings_array.shape[1] != 384:
        raise ValueError(f"期望384维嵌入，实际{embeddings_array.shape[1]}维")
    
    # 检查数值有效性
    if not np.all(np.isfinite(embeddings_array)):
        raise ValueError("嵌入包含无效数值 (NaN或Inf)")
    
    return embeddings_array
```

#### 6. 迁移策略

##### 阶段 1: 新接口实现
1. 实现新的接口端点
2. 保持现有接口向后兼容
3. 添加嵌入验证逻辑

##### 阶段 2: 数据流优化
1. 修改 AI Worker 调用方式
2. 更新数据传输格式
3. 性能测试和优化

##### 阶段 3: 逐步迁移
1. 新功能使用新接口
2. 现有功能渐进式迁移
3. 删除冗余代码

#### 7. 性能优化

1. **减少内存使用**: 避免重复的嵌入生成
2. **提升处理速度**: 直接使用预计算向量
3. **降低GPU占用**: 嵌入生成在AI Worker统一处理
4. **缓存优化**: 利用AI Worker的嵌入缓存机制

#### 8. 测试策略

1. **单元测试**: 新接口的输入输出验证
2. **集成测试**: 与AI Worker的数据传输测试
3. **性能测试**: 对比新旧架构的性能差异
4. **向后兼容测试**: 确保现有功能正常

#### 9. 配置变更

```python
# config.py 新增配置
class Settings(BaseModel):
    # 现有配置...
    embedding_model_name: str = "intfloat/multilingual-e5-small"
    
    # 新增配置
    validate_embedding_dimensions: bool = True
    expected_embedding_dimensions: int = 384
    enable_embedding_generation: bool = True  # 控制是否启用内部嵌入生成
    ai_worker_base_url: Optional[str] = None  # AI Worker服务地址
```

### 总结

此重构方案将：

1. **解耦服务**: 分离嵌入生成和聚类功能
2. **提升效率**: 避免重复计算，优化数据流
3. **增强灵活性**: 支持多种数据输入模式
4. **保持兼容**: 向后兼容现有接口
5. **面向未来**: 为更复杂的ML工作流奠定基础

通过这种设计，ML Service 将成为更专业的聚类分析服务，而嵌入生成将由AI Worker统一管理，形成更清晰的服务边界和职责划分。 