"""
Meridian ML Service - 精简核心数据模型
专注于核心功能，移除不必要的复杂性
"""

from typing import List, Dict, Any, Literal
from pydantic import BaseModel, Field

# ============================================================================
# 核心配置模型
# ============================================================================

class BaseClusteringConfig(BaseModel):
    """核心聚类配置。算法与各参数的实测依据见 clustering.py 的 ClusteringConfig 注释。"""
    agglomerative_threshold: float = Field(default=0.10, gt=0.0, le=1.0, description="凝聚聚类合并阈值(余弦距离 1-cos)")
    agglomerative_linkage: Literal['average', 'complete'] = Field(default='average', description="凝聚聚类链接方式")
    agglomerative_min_cluster_size: int = Field(default=3, ge=2, description="成簇最小篇数，低于此数整簇记为噪声(不进简报)")

# ============================================================================
# 核心数据项模型
# ============================================================================

class AIWorkerEmbeddingItem(BaseModel):
    """backend 发来的聚类输入项（apps/backend/src/lib/services/clustering.ts）"""
    id: int = Field(..., description="文章ID")
    embedding: List[float] = Field(..., description="384维嵌入向量")
    

# ============================================================================
# 请求/响应模型
# ============================================================================

class EmbeddingRequest(BaseModel):
    """嵌入生成请求"""
    texts: List[str] = Field(..., description="文本列表")

class EmbeddingResponse(BaseModel):
    """嵌入生成响应"""
    embeddings: List[List[float]] = Field(..., description="生成的嵌入向量")
    model_name: str = Field(..., description="使用的模型名称")
    dimensions: int = Field(..., description="嵌入维度")

# ============================================================================
# 响应模型
# ============================================================================

class ClusteringStats(BaseModel):
    """聚类统计信息"""
    n_samples: int = Field(..., description="样本总数")
    n_clusters: int = Field(..., description="聚类簇数量")
    n_outliers: int = Field(..., description="异常点数量")

class ClusterInfo(BaseModel):
    """聚类信息"""
    cluster_id: int = Field(..., description="聚类ID (-1表示异常点)")
    size: int = Field(..., description="聚类大小")
    items: List[Dict[str, Any]] = Field(..., description="聚类中的项目")

class BaseClusteringResponse(BaseModel):
    """统一聚类响应"""
    clusters: List[ClusterInfo] = Field(..., description="聚类结果")
    clustering_stats: ClusteringStats = Field(..., description="聚类统计信息")
    config_used: Dict[str, Any] = Field(..., description="实际使用的配置参数")
