"""
Meridian ML Pipeline - 统一的ML处理管道
将分散的业务逻辑集中管理，提高代码复用性和维护性
"""

import time
import numpy as np
from typing import List, Dict, Any, Optional, Union, Tuple
from abc import ABC, abstractmethod
from dataclasses import dataclass

from .schemas import (
    TextItem, VectorItem, ArticleItem,
    AIWorkerEmbeddingItem, AIWorkerArticleDataItem, DataFormatConverter,
    BaseClusteringConfig, OptimizationConfig, ContentAnalysisConfig,
    ClusteringStats, OptimizationResult, ClusterInfo,
    convert_to_internal_config, build_optimization_grid
)
from .embeddings import compute_embeddings, validate_embeddings
from .clustering import (
    cluster_embeddings_with_optimization,
    cluster_embeddings,
    analyze_cluster_content,
    ClusteringConfig as InternalClusteringConfig
)

# ============================================================================
# 处理管道抽象基类
# ============================================================================

class ProcessingStage(ABC):
    """处理阶段抽象基类"""
    
    @abstractmethod
    async def process(self, data: Any, context: Dict[str, Any]) -> Any:
        """执行处理阶段"""
        pass
    
    @abstractmethod
    def get_stage_name(self) -> str:
        """获取阶段名称"""
        pass

class MLPipeline:
    """ML处理管道 - 组合不同的处理阶段"""
    
    def __init__(self):
        self.stages: List[ProcessingStage] = []
        self.metrics: Dict[str, Any] = {}
    
    def add_stage(self, stage: ProcessingStage) -> 'MLPipeline':
        """添加处理阶段"""
        self.stages.append(stage)
        return self
    
    async def execute(self, input_data: Any, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """执行完整管道"""
        if context is None:
            context = {}
        
        context['pipeline_start_time'] = time.time()
        context['stage_metrics'] = {}
        
        data = input_data
        
        for stage in self.stages:
            stage_start = time.time()
            stage_name = stage.get_stage_name()
            
            print(f"[Pipeline] 执行阶段: {stage_name}")
            data = await stage.process(data, context)
            
            stage_time = time.time() - stage_start
            context['stage_metrics'][stage_name] = {
                'duration': stage_time,
                'timestamp': stage_start
            }
            print(f"[Pipeline] 阶段 {stage_name} 完成，耗时: {stage_time:.2f}秒")
        
        context['total_processing_time'] = time.time() - context['pipeline_start_time']
        return {
            'result': data,
            'context': context,
            'metrics': context['stage_metrics']
        }

# ============================================================================
# 具体处理阶段实现
# ============================================================================

@dataclass
class DataExtractionResult:
    """数据提取结果"""
    embeddings: np.ndarray
    texts: List[str]
    metadata: List[Dict[str, Any]]
    items_info: Dict[str, Any]

class DataExtractionStage(ProcessingStage):
    """数据提取和验证阶段"""
    
    def __init__(self, model_components=None):
        self.model_components = model_components
    
    async def process(self, data: Any, context: Dict[str, Any]) -> DataExtractionResult:
        """从各种数据格式中提取嵌入向量和文本"""
        items = data['items']
        data_type = data.get('data_type', 'auto')
        
        embeddings = []
        texts = []
        metadata = []
        
        # 检测数据类型
        if data_type == 'auto':
            if isinstance(items[0], dict):
                # 使用格式检测器自动识别AI Worker格式
                detected_format = DataFormatConverter.detect_format(items)
                context['detected_format'] = detected_format
                
                if detected_format.startswith('ai_worker'):
                    data_type = detected_format
                elif 'embedding' in items[0]:
                    data_type = 'vectors'
                else:
                    data_type = 'texts'
            else:
                # Pydantic模型，检查类型
                first_item = items[0] if items else {}
                if hasattr(first_item, 'embedding'):
                    data_type = 'vectors'
                else:
                    data_type = 'texts'
        
        context['detected_data_type'] = data_type
        print(f"[DataExtraction] 检测到数据类型: {data_type}")
        
        # AI Worker 格式处理
        if data_type == 'ai_worker_embedding' or data_type == 'ai_worker_embedding_extended':
            print("[DataExtraction] 处理AI Worker嵌入格式")
            for i, item in enumerate(items):
                # 转换为标准格式进行处理
                if isinstance(item, dict):
                    ai_item = AIWorkerEmbeddingItem(**item)
                else:
                    ai_item = item
                
                embeddings.append(ai_item.embedding)
                texts.append(ai_item.title or f"Article {ai_item.id}")
                metadata.append({
                    'id': ai_item.id,
                    'source': 'ai_worker',
                    'original_format': 'ai_worker_embedding',
                    'title': ai_item.title,
                    'url': ai_item.url,
                    'publish_date': ai_item.publish_date,
                    'status': ai_item.status
                })
            
            # 验证嵌入向量
            embeddings_array = validate_embeddings(embeddings)
            
        elif data_type == 'ai_worker_article':
            print("[DataExtraction] 处理AI Worker完整文章格式")
            for i, item in enumerate(items):
                # 转换为标准格式进行处理
                if isinstance(item, dict):
                    ai_article = AIWorkerArticleDataItem(**item)
                else:
                    ai_article = item
                
                embeddings.append(ai_article.embedding)
                # 组合标题和内容作为文本
                text_content = f"{ai_article.title}\n\n{ai_article.content[:500]}..."
                texts.append(text_content)
                metadata.append({
                    'id': ai_article.id,
                    'source': 'ai_worker',
                    'original_format': 'ai_worker_article',
                    'title': ai_article.title,
                    'url': ai_article.url,
                    'publishDate': ai_article.publishDate,
                    'status': ai_article.status,
                    'contentFileKey': ai_article.contentFileKey,
                    'processedAt': ai_article.processedAt
                })
            
            # 验证嵌入向量
            embeddings_array = validate_embeddings(embeddings)
            
        elif data_type == 'vectors':
            # 预生成向量模式（原有逻辑）
            for i, item in enumerate(items):
                if isinstance(item, dict):
                    embeddings.append(item['embedding'])
                    texts.append(item.get('text', item.get('title', f'Item {i}')))
                    metadata.append({
                        'id': item.get('id', i),
                        'source': 'pre_generated',
                        **{k: v for k, v in item.items() if k not in ['embedding', 'text']}
                    })
                else:
                    # Pydantic模型
                    embeddings.append(item.embedding)
                    texts.append(getattr(item, 'text', getattr(item, 'title', f'Item {i}')))
                    metadata.append({
                        'id': getattr(item, 'id', i),
                        'source': 'pre_generated',
                        **{k: v for k, v in item.dict().items() if k not in ['embedding', 'text']}
                    })
            
            # 验证嵌入向量
            embeddings_array = validate_embeddings(embeddings)
            
        elif data_type == 'texts':
            # 文本生成嵌入模式（原有逻辑）
            if not self.model_components:
                raise ValueError("文本模式需要提供model_components")
            
            for i, item in enumerate(items):
                if isinstance(item, dict):
                    text = item.get('text', item.get('title', ''))
                    texts.append(text)
                    metadata.append({
                        'id': item.get('id', i),
                        'source': 'generated',
                        **{k: v for k, v in item.items() if k != 'text'}
                    })
                else:
                    # Pydantic模型
                    text = getattr(item, 'text', getattr(item, 'title', ''))
                    texts.append(text)
                    metadata.append({
                        'id': getattr(item, 'id', i),
                        'source': 'generated',
                        **{k: v for k, v in item.dict().items() if k != 'text'}
                    })
            
            # 生成嵌入向量
            embeddings_array = compute_embeddings(texts, self.model_components)
            
        elif data_type == 'text_item':
            # text_item 格式处理 - 与 texts 相同的逻辑
            print("[DataExtraction] 处理纯文本格式")
            if not self.model_components:
                raise ValueError("文本模式需要提供model_components")
            
            for i, item in enumerate(items):
                if isinstance(item, dict):
                    text = item.get('text', item.get('title', ''))
                    texts.append(text)
                    metadata.append({
                        'id': item.get('id', i),
                        'source': 'generated',
                        'original_format': 'text_item',
                        **{k: v for k, v in item.items() if k != 'text'}
                    })
                else:
                    # Pydantic模型
                    text = getattr(item, 'text', getattr(item, 'title', ''))
                    texts.append(text)
                    metadata.append({
                        'id': getattr(item, 'id', i),
                        'source': 'generated',
                        'original_format': 'text_item',
                        **{k: v for k, v in item.dict().items() if k != 'text'}
                    })
            
            # 生成嵌入向量
            embeddings_array = compute_embeddings(texts, self.model_components)
            
        else:
            raise ValueError(f"不支持的数据类型: {data_type}")
        
        print(f"[DataExtraction] 处理完成: {len(embeddings_array)} 个嵌入向量, 维度: {embeddings_array.shape[1]}")
        
        return DataExtractionResult(
            embeddings=embeddings_array,
            texts=texts,
            metadata=metadata,
            items_info={
                'total_items': len(items),
                'data_type': data_type,
                'detected_format': context.get('detected_format', 'auto'),
                'embedding_dimensions': embeddings_array.shape[1],
                'has_metadata': bool(metadata[0]) if metadata else False,
                'ai_worker_compatible': data_type.startswith('ai_worker')
            }
        )
    
    def get_stage_name(self) -> str:
        return "data_extraction"

class ClusteringStage(ProcessingStage):
    """聚类分析阶段"""
    
    def __init__(self, 
                 config: Optional[BaseClusteringConfig] = None,
                 optimization: Optional[OptimizationConfig] = None):
        self.config = config
        self.optimization = optimization
    
    async def process(self, data: DataExtractionResult, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行聚类分析"""
        embeddings = data.embeddings
        texts = data.texts
        
        # 转换配置
        internal_config = convert_to_internal_config(self.config)
        
        # 决定是否使用优化
        use_optimization = self.optimization and self.optimization.enabled
        
        if use_optimization:
            print("使用参数优化聚类...")
            grid_config = build_optimization_grid(self.optimization)
            
            # 将优化配置转换为内部格式
            from .clustering import GridSearchConfig
            internal_grid = GridSearchConfig(
                umap_n_neighbors=grid_config.get('umap_n_neighbors', [10, 15, 20]),
                hdbscan_min_cluster_size=grid_config.get('hdbscan_min_cluster_size', [3, 5, 8]),
                hdbscan_min_samples=grid_config.get('hdbscan_min_samples', [2, 3]),
                hdbscan_epsilon=grid_config.get('hdbscan_epsilon', [0.1, 0.2]),
            )
            
            clustering_result = cluster_embeddings_with_optimization(
                embeddings,
                use_optimization=True,
                grid_config=internal_grid
            )
        else:
            print("使用标准聚类...")
            internal_config_obj = InternalClusteringConfig(**internal_config) if internal_config else None
            clustering_result = cluster_embeddings(embeddings, internal_config_obj)
            clustering_result['optimization'] = {'used': False}
        
        # 分析簇内容
        cluster_labels = np.array(clustering_result['cluster_labels'])
        cluster_content = analyze_cluster_content(texts, cluster_labels)
        
        # 构建增强的结果
        enhanced_result = {
            **clustering_result,
            'cluster_content': cluster_content,
            'texts': texts,
            'metadata': data.metadata,
            'items_info': data.items_info
        }
        
        return enhanced_result
    
    def get_stage_name(self) -> str:
        return "clustering_analysis"

class ContentAnalysisStage(ProcessingStage):
    """内容分析和结果构建阶段"""
    
    def __init__(self, config: Optional[ContentAnalysisConfig] = None):
        self.config = config or ContentAnalysisConfig()
    
    async def process(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """分析内容并构建最终结果"""
        if not self.config.enabled:
            # 跳过内容分析，直接构建基础结果
            return self._build_basic_result(data, context)
        
        print("执行内容分析...")
        
        # 构建聚类信息
        clusters = self._build_cluster_info(data)
        
        # 构建统计信息
        stats = ClusteringStats(**data['clustering_stats'])
        
        # 构建优化结果
        opt_result = OptimizationResult(
            used=data['optimization']['used'],
            best_params=data['optimization'].get('best_params'),
            best_score=data['optimization'].get('best_dbcv_score'),
            search_space_size=None,  # 可以从优化过程中获取
            evaluated_combinations=None
        )
        
        # 构建最终响应
        result = {
            'clusters': clusters,
            'clustering_stats': stats,
            'optimization_result': opt_result,
            'config_used': data['config_used'],
            'reduced_embeddings': data.get('reduced_embeddings'),
            'processing_time': context.get('total_processing_time'),
            'model_info': data.get('items_info')
        }
        
        return result
    
    def _build_cluster_info(self, data: Dict[str, Any]) -> List[ClusterInfo]:
        """构建聚类信息列表"""
        cluster_labels = data['cluster_labels']
        texts = data['texts']
        metadata = data['metadata']
        cluster_content = data.get('cluster_content', {})
        reduced_embeddings = data.get('reduced_embeddings', [])
        
        clusters = []
        unique_labels = set(cluster_labels)
        
        for cluster_id in unique_labels:
            # 获取属于此聚类的项目索引
            indices = [i for i, label in enumerate(cluster_labels) if label == cluster_id]
            
            # 构建项目列表
            cluster_items = []
            for idx in indices:
                item = {
                    'index': idx,
                    'text': texts[idx] if idx < len(texts) else '',
                    'metadata': metadata[idx] if idx < len(metadata) else {}
                }
                cluster_items.append(item)
            
            # 计算中心点（如果有降维数据）
            centroid = None
            if reduced_embeddings and indices:
                cluster_points = np.array([reduced_embeddings[i] for i in indices])
                centroid = np.mean(cluster_points, axis=0).tolist()
            
            # 获取代表性内容
            representative_content = cluster_content.get(cluster_id, [])[:self.config.top_n_per_cluster]
            
            cluster_info = ClusterInfo(
                cluster_id=cluster_id,
                size=len(indices),
                items=cluster_items,
                centroid=centroid,
                representative_content=representative_content,
                keywords=[],  # 可以扩展为关键词提取
                summary=None  # 可以扩展为AI生成摘要
            )
            
            clusters.append(cluster_info)
        
        return sorted(clusters, key=lambda x: x.size, reverse=True)
    
    def _build_basic_result(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """构建基础结果（跳过详细内容分析）"""
        # 简化版本，适用于高性能场景
        return {
            'clustering_stats': ClusteringStats(**data['clustering_stats']),
            'optimization_result': OptimizationResult(
                used=data['optimization']['used'],
                best_params=data['optimization'].get('best_params'),
                best_score=data['optimization'].get('best_dbcv_score')
            ),
            'config_used': data['config_used'],
            'processing_time': context.get('total_processing_time')
        }
    
    def get_stage_name(self) -> str:
        return "content_analysis"

# ============================================================================
# 预定义的管道组合
# ============================================================================

class MLPipelineFactory:
    """ML管道工厂 - 提供常用的管道组合"""
    
    @staticmethod
    def create_text_clustering_pipeline(
        model_components,
        config: Optional[BaseClusteringConfig] = None,
        optimization: Optional[OptimizationConfig] = None,
        content_analysis: Optional[ContentAnalysisConfig] = None
    ) -> MLPipeline:
        """创建文本聚类管道"""
        return (MLPipeline()
                .add_stage(DataExtractionStage(model_components))
                .add_stage(ClusteringStage(config, optimization))
                .add_stage(ContentAnalysisStage(content_analysis)))
    
    @staticmethod
    def create_vector_clustering_pipeline(
        config: Optional[BaseClusteringConfig] = None,
        optimization: Optional[OptimizationConfig] = None,
        content_analysis: Optional[ContentAnalysisConfig] = None
    ) -> MLPipeline:
        """创建向量聚类管道"""
        return (MLPipeline()
                .add_stage(DataExtractionStage())  # 不需要model_components
                .add_stage(ClusteringStage(config, optimization))
                .add_stage(ContentAnalysisStage(content_analysis)))
    
    @staticmethod
    def create_fast_clustering_pipeline(
        config: Optional[BaseClusteringConfig] = None
    ) -> MLPipeline:
        """创建快速聚类管道（跳过内容分析）"""
        content_config = ContentAnalysisConfig(enabled=False)
        return (MLPipeline()
                .add_stage(DataExtractionStage())
                .add_stage(ClusteringStage(config, None))
                .add_stage(ContentAnalysisStage(content_config)))

# ============================================================================
# 统一的处理函数 - 替代原有的分散逻辑
# ============================================================================

async def process_clustering_request(
    items: List[Any],
    config: Optional[BaseClusteringConfig] = None,
    optimization: Optional[OptimizationConfig] = None,
    content_analysis: Optional[ContentAnalysisConfig] = None,
    model_components=None,
    data_type: str = 'auto'
) -> Dict[str, Any]:
    """统一的聚类处理函数 - 替代所有端点中的重复逻辑"""
    
    # 选择合适的管道
    if data_type in ['texts', 'text_item', 'auto'] and model_components:
        pipeline = MLPipelineFactory.create_text_clustering_pipeline(
            model_components, config, optimization, content_analysis
        )
    else:
        pipeline = MLPipelineFactory.create_vector_clustering_pipeline(
            config, optimization, content_analysis
        )
    
    # 准备输入数据
    input_data = {
        'items': items,
        'data_type': data_type
    }
    
    # 执行管道
    result = await pipeline.execute(input_data)
    
    return result['result'] 