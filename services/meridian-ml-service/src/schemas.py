"""
Meridian ML Service - 精简核心数据模型
专注于核心功能，移除不必要的复杂性
"""

from typing import List, Optional, Dict, Any, Union, Literal
from pydantic import BaseModel, Field

# ============================================================================
# 核心配置模型
# ============================================================================

class BaseClusteringConfig(BaseModel):
    """核心聚类配置"""
    
    # UMAP参数
    umap_n_components: int = Field(default=10, ge=2, le=50, description="UMAP降维目标维度")
    umap_n_neighbors: int = Field(default=15, ge=2, le=100, description="UMAP邻居数量")
    umap_min_dist: float = Field(default=0.0, ge=0.0, le=1.0, description="UMAP最小距离")
    umap_metric: Literal['cosine', 'euclidean', 'manhattan'] = Field(default='cosine', description="UMAP距离度量")
    
    # HDBSCAN参数
    hdbscan_min_cluster_size: int = Field(default=5, ge=2, description="HDBSCAN最小簇大小")
    hdbscan_min_samples: int = Field(default=3, ge=1, description="HDBSCAN最小样本数")
    hdbscan_metric: Literal['euclidean', 'manhattan', 'chebyshev'] = Field(default='euclidean', description="HDBSCAN距离度量")
    hdbscan_cluster_selection_epsilon: float = Field(default=0.0, ge=0.0, description="HDBSCAN epsilon参数")
    
    # 预处理选项
    normalize_embeddings: bool = Field(default=True, description="是否L2归一化嵌入向量")
    remove_outliers: bool = Field(default=False, description="是否移除异常点")

class OptimizationConfig(BaseModel):
    """参数优化配置"""
    enabled: bool = Field(default=False, description="是否启用参数优化")
    
    # 网格搜索范围
    umap_n_neighbors_range: List[int] = Field(default=[10, 15, 20, 30], description="UMAP邻居数量搜索范围")
    hdbscan_min_cluster_size_range: List[int] = Field(default=[3, 5, 8, 10], description="HDBSCAN最小簇大小搜索范围")
    hdbscan_min_samples_range: List[int] = Field(default=[2, 3, 5], description="HDBSCAN最小样本数搜索范围")
    hdbscan_epsilon_range: List[float] = Field(default=[0.1, 0.2, 0.3], description="HDBSCAN epsilon搜索范围")
    
    # 优化控制
    max_combinations: int = Field(default=24, description="最大参数组合数")
    early_stopping_patience: int = Field(default=5, description="早停耐心值")

class ContentAnalysisConfig(BaseModel):
    """内容分析配置"""
    enabled: bool = Field(default=True, description="是否启用内容分析")
    top_n_per_cluster: int = Field(default=5, ge=1, le=20, description="每个簇返回的代表性内容数量")
    include_keywords: bool = Field(default=False, description="是否提取关键词")
    include_summaries: bool = Field(default=False, description="是否生成簇摘要")

# ============================================================================
# 核心数据项模型
# ============================================================================

class TextItem(BaseModel):
    """纯文本项目"""
    id: Union[str, int] = Field(..., description="项目唯一标识")
    text: str = Field(..., description="文本内容")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="可选元数据")

class VectorItem(BaseModel):
    """预生成向量项目"""
    id: Union[str, int] = Field(..., description="项目唯一标识")
    text: str = Field(..., description="文本内容")
    embedding: List[float] = Field(..., description="384维嵌入向量")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="可选元数据")

class ArticleItem(BaseModel):
    """文章数据项目"""
    id: int = Field(..., description="文章ID")
    title: str = Field(..., description="文章标题")
    content: str = Field(..., description="文章内容")
    url: str = Field(..., description="文章URL")
    embedding: List[float] = Field(..., description="384维嵌入向量")
    publishDate: str = Field(..., description="发布日期")
    status: str = Field(..., description="处理状态")

class AIWorkerEmbeddingItem(BaseModel):
    """AI Worker标准嵌入格式"""
    id: int = Field(..., description="文章ID")
    embedding: List[float] = Field(..., description="384维嵌入向量")
    
    # 可选的扩展字段
    title: Optional[str] = Field(default=None, description="文章标题")
    url: Optional[str] = Field(default=None, description="文章URL")
    publish_date: Optional[str] = Field(default=None, description="发布日期")
    content: Optional[str] = Field(default=None, description="文章内容")
    status: Optional[str] = Field(default=None, description="处理状态")

class AIWorkerArticleDataItem(BaseModel):
    """AI Worker完整文章数据格式"""
    id: int = Field(..., description="文章ID")
    title: str = Field(..., description="文章标题")
    content: str = Field(..., description="文章内容")
    url: str = Field(..., description="文章URL")
    embedding: List[float] = Field(..., description="384维嵌入向量")
    publishDate: str = Field(..., description="发布日期")
    status: str = Field(..., description="处理状态")
    
    # 扩展元数据字段
    contentFileKey: Optional[str] = Field(default=None, description="内容文件键")
    processedAt: Optional[str] = Field(default=None, description="处理时间")

# ============================================================================
# 数据格式转换器
# ============================================================================

class DataFormatConverter:
    """数据格式检测和转换工具"""
    
    @staticmethod
    def detect_format(data: List[Dict[str, Any]]) -> str:
        """自动检测数据格式类型"""
        if not data:
            return "unknown"
        
        first_item = data[0]
        
        # AI Worker 嵌入格式：只有 id 和 embedding
        if set(first_item.keys()) == {"id", "embedding"}:
            return "ai_worker_embedding"
        
        # AI Worker 扩展嵌入格式：有可选字段
        if "id" in first_item and "embedding" in first_item and len(first_item.keys()) <= 7:
            return "ai_worker_embedding_extended"
            
        # AI Worker 完整文章格式
        if all(field in first_item for field in ["id", "title", "content", "embedding", "publishDate"]):
            return "ai_worker_article"
        
        # 标准向量格式
        if "text" in first_item and "embedding" in first_item:
            return "vector_item"
            
        # 纯文本格式
        if "text" in first_item and "embedding" not in first_item:
            return "text_item"
        
        return "unknown"

# ============================================================================
# 请求/响应模型
# ============================================================================

class EmbeddingRequest(BaseModel):
    """嵌入生成请求"""
    texts: List[str] = Field(..., description="文本列表")
    model_name: Optional[str] = Field(default=None, description="指定嵌入模型")
    normalize: bool = Field(default=True, description="是否归一化")

class EmbeddingResponse(BaseModel):
    """嵌入生成响应"""
    embeddings: List[List[float]] = Field(..., description="生成的嵌入向量")
    model_name: str = Field(..., description="使用的模型名称")
    dimensions: int = Field(..., description="嵌入维度")
    processing_time: Optional[float] = Field(default=None, description="处理时间")

class AIWorkerEmbeddingClusteringRequest(BaseModel):
    """AI Worker嵌入聚类请求"""
    items: List[AIWorkerEmbeddingItem] = Field(..., description="AI Worker嵌入数据项")
    config: Optional[BaseClusteringConfig] = Field(default=None, description="聚类算法配置")
    optimization: Optional[OptimizationConfig] = Field(default=None, description="参数优化配置") 
    content_analysis: Optional[ContentAnalysisConfig] = Field(default=None, description="内容分析配置")
    
    # 输出控制
    return_embeddings: bool = Field(default=False, description="是否返回原始嵌入向量")
    return_reduced_embeddings: bool = Field(default=True, description="是否返回降维后向量")

class FlexibleClusteringRequest(BaseModel):
    """灵活的聚类请求 - 自动检测数据格式"""
    items: List[Dict[str, Any]] = Field(..., description="数据项目列表（自动检测格式）")
    config: Optional[BaseClusteringConfig] = Field(default=None, description="聚类算法配置")
    optimization: Optional[OptimizationConfig] = Field(default=None, description="参数优化配置") 
    content_analysis: Optional[ContentAnalysisConfig] = Field(default=None, description="内容分析配置")
    
    # 输出控制
    return_embeddings: bool = Field(default=False, description="是否返回原始嵌入向量")
    return_reduced_embeddings: bool = Field(default=True, description="是否返回降维后向量")
    
    # AI Worker 兼容选项
    preserve_original_format: bool = Field(default=True, description="保持原始数据格式在响应中")
    include_ai_worker_metadata: bool = Field(default=True, description="包含AI Worker兼容的元数据")

# ============================================================================
# 响应模型
# ============================================================================

class ClusteringStats(BaseModel):
    """聚类统计信息"""
    n_samples: int = Field(..., description="样本总数")
    n_clusters: int = Field(..., description="聚类簇数量")
    n_outliers: int = Field(..., description="异常点数量")
    outlier_ratio: float = Field(..., description="异常点比例")
    cluster_sizes: Dict[int, int] = Field(..., description="每个簇的大小")
    dbcv_score: Optional[float] = Field(default=None, description="DBCV质量分数")
    silhouette_score: Optional[float] = Field(default=None, description="轮廓系数")

class OptimizationResult(BaseModel):
    """参数优化结果"""
    used: bool = Field(..., description="是否使用了参数优化")
    best_params: Optional[Dict[str, Any]] = Field(default=None, description="最佳参数配置")
    best_score: Optional[float] = Field(default=None, description="最佳质量分数")
    search_space_size: Optional[int] = Field(default=None, description="搜索空间大小")
    evaluated_combinations: Optional[int] = Field(default=None, description="实际评估的组合数")

class ClusterInfo(BaseModel):
    """聚类信息"""
    cluster_id: int = Field(..., description="聚类ID (-1表示异常点)")
    size: int = Field(..., description="聚类大小")
    items: List[Dict[str, Any]] = Field(..., description="聚类中的项目")
    centroid: Optional[List[float]] = Field(default=None, description="聚类中心点")
    representative_content: List[str] = Field(default_factory=list, description="代表性内容")
    keywords: List[str] = Field(default_factory=list, description="关键词")
    summary: Optional[str] = Field(default=None, description="聚类摘要")

class BaseClusteringResponse(BaseModel):
    """统一聚类响应"""
    clusters: List[ClusterInfo] = Field(..., description="聚类结果")
    clustering_stats: ClusteringStats = Field(..., description="聚类统计信息")
    optimization_result: OptimizationResult = Field(..., description="优化结果")
    config_used: Dict[str, Any] = Field(..., description="实际使用的配置参数")
    
    # 可选数据
    embeddings: Optional[List[List[float]]] = Field(default=None, description="原始嵌入向量")
    reduced_embeddings: Optional[List[List[float]]] = Field(default=None, description="降维后向量")
    processing_time: Optional[float] = Field(default=None, description="处理时间（秒）")
    model_info: Optional[Dict[str, Any]] = Field(default=None, description="模型信息")

# ============================================================================
# 配置转换工具函数
# ============================================================================

def convert_to_internal_config(api_config: Optional[BaseClusteringConfig]) -> Dict[str, Any]:
    """将API配置转换为内部聚类算法配置"""
    if api_config is None:
        return {}
    
    return {
        # UMAP配置
        "umap_n_components": api_config.umap_n_components,
        "umap_n_neighbors": api_config.umap_n_neighbors,
        "umap_min_dist": api_config.umap_min_dist,
        "umap_metric": api_config.umap_metric,
        
        # HDBSCAN配置
        "hdbscan_min_cluster_size": api_config.hdbscan_min_cluster_size,
        "hdbscan_min_samples": api_config.hdbscan_min_samples,
        "hdbscan_metric": api_config.hdbscan_metric,
        "hdbscan_cluster_selection_epsilon": api_config.hdbscan_cluster_selection_epsilon,
        
        # 预处理配置
        "normalize_embeddings": api_config.normalize_embeddings,
        "remove_outliers": api_config.remove_outliers,
    }

def build_optimization_grid(config: OptimizationConfig) -> Dict[str, List[Any]]:
    """构建参数优化网格"""
    if not config.enabled:
        return {}
    
    return {
        "umap_n_neighbors": config.umap_n_neighbors_range,
        "hdbscan_min_cluster_size": config.hdbscan_min_cluster_size_range,
        "hdbscan_min_samples": config.hdbscan_min_samples_range,
        "hdbscan_epsilon": config.hdbscan_epsilon_range,
    } 