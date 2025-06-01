from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class EmbeddingRequest(BaseModel):
    texts: List[str] = Field(..., description="文本列表用于生成嵌入")


class EmbeddingResponse(BaseModel):
    embeddings: List[List[float]] = Field(..., description="生成的嵌入向量")
    model_name: str = Field(..., description="使用的模型名称")


class ClusteringConfig(BaseModel):
    """聚类配置参数"""
    
    # UMAP参数
    umap_n_components: int = Field(default=10, description="UMAP降维目标维度")
    umap_n_neighbors: int = Field(default=15, description="UMAP邻居数量")
    umap_min_dist: float = Field(default=0.0, description="UMAP最小距离")
    umap_metric: str = Field(default='cosine', description="UMAP距离度量")
    
    # HDBSCAN参数
    hdbscan_min_cluster_size: int = Field(default=5, description="HDBSCAN最小簇大小")
    hdbscan_min_samples: int = Field(default=3, description="HDBSCAN最小样本数")
    hdbscan_metric: str = Field(default='euclidean', description="HDBSCAN距离度量")
    hdbscan_cluster_selection_method: str = Field(default='eom', description="HDBSCAN簇选择方法")
    hdbscan_cluster_selection_epsilon: float = Field(default=0.0, description="HDBSCAN epsilon参数")
    
    # 其他配置
    normalize_embeddings: bool = Field(default=True, description="是否归一化嵌入向量")
    remove_outliers: bool = Field(default=False, description="是否移除异常点")


class GridSearchConfig(BaseModel):
    """网格搜索配置参数"""
    
    # UMAP参数网格
    umap_n_neighbors: List[int] = Field(default=[10, 15, 20, 30], description="UMAP邻居数量候选值")
    umap_n_components: int = Field(default=10, description="UMAP降维目标维度")
    umap_min_dist: float = Field(default=0.0, description="UMAP最小距离")
    umap_metric: str = Field(default='cosine', description="UMAP距离度量")
    
    # HDBSCAN参数网格
    hdbscan_min_cluster_size: List[int] = Field(default=[5, 8, 10, 15], description="HDBSCAN最小簇大小候选值")
    hdbscan_min_samples: List[int] = Field(default=[2, 3, 5], description="HDBSCAN最小样本数候选值")
    hdbscan_epsilon: List[float] = Field(default=[0.1, 0.2, 0.3], description="HDBSCAN epsilon候选值")
    hdbscan_metric: str = Field(default='euclidean', description="HDBSCAN距离度量")


class ClusteringRequest(BaseModel):
    texts: List[str] = Field(..., description="需要聚类的文本列表")
    config: Optional[ClusteringConfig] = Field(default=None, description="聚类配置参数")
    return_embeddings: bool = Field(default=False, description="是否返回嵌入向量")
    return_reduced_embeddings: bool = Field(default=True, description="是否返回降维后的嵌入向量")


class OptimizedClusteringRequest(BaseModel):
    """带参数优化的聚类请求"""
    texts: List[str] = Field(..., description="需要聚类的文本列表")
    grid_config: Optional[GridSearchConfig] = Field(default=None, description="网格搜索配置")
    return_embeddings: bool = Field(default=False, description="是否返回嵌入向量")
    return_reduced_embeddings: bool = Field(default=True, description="是否返回降维后的嵌入向量")


class ClusteringStats(BaseModel):
    """聚类统计信息"""
    n_samples: int = Field(..., description="样本总数")
    n_clusters: int = Field(..., description="聚类簇数量")
    n_outliers: int = Field(..., description="异常点数量")
    outlier_ratio: float = Field(..., description="异常点比例")
    cluster_sizes: Dict[int, int] = Field(..., description="每个簇的大小")
    dbcv_score: Optional[float] = Field(default=None, description="DBCV质量分数")


class OptimizationResult(BaseModel):
    """参数优化结果"""
    used: bool = Field(..., description="是否使用了参数优化")
    best_params: Optional[Dict[str, Any]] = Field(default=None, description="最佳参数配置")
    best_dbcv_score: Optional[float] = Field(default=None, description="最佳DBCV分数")


class ClusteringResponse(BaseModel):
    cluster_labels: List[int] = Field(..., description="聚类标签")
    clustering_stats: ClusteringStats = Field(..., description="聚类统计信息")
    config_used: Dict[str, Any] = Field(..., description="使用的配置参数")
    embeddings: Optional[List[List[float]]] = Field(default=None, description="原始嵌入向量")
    reduced_embeddings: Optional[List[List[float]]] = Field(default=None, description="降维后的嵌入向量")
    cluster_content: Optional[Dict[int, List[str]]] = Field(default=None, description="每个簇的代表性内容")
    optimization: Optional[OptimizationResult] = Field(default=None, description="参数优化结果")


class EmbeddingsAndClusteringRequest(BaseModel):
    """同时生成嵌入和聚类的请求"""
    texts: List[str] = Field(..., description="需要处理的文本列表")
    clustering_config: Optional[ClusteringConfig] = Field(default=None, description="聚类配置参数")
    include_cluster_content: bool = Field(default=True, description="是否包含簇内容分析")
    content_top_n: int = Field(default=5, description="每个簇返回的文本数量")
    use_optimization: bool = Field(default=False, description="是否使用参数优化")
    grid_config: Optional[GridSearchConfig] = Field(default=None, description="网格搜索配置（仅在use_optimization=True时使用）")


class EmbeddingsAndClusteringResponse(BaseModel):
    """嵌入生成和聚类的完整响应"""
    embeddings: List[List[float]] = Field(..., description="原始嵌入向量")
    clustering_result: ClusteringResponse = Field(..., description="聚类结果")
    model_name: str = Field(..., description="使用的嵌入模型名称")
    processing_time: Optional[float] = Field(default=None, description="处理时间（秒）")
