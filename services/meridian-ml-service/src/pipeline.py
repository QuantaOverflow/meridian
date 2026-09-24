"""
Meridian ML Pipeline - 统一的ML处理管道
将分散的业务逻辑集中管理，提高代码复用性和维护性
"""

import time
import numpy as np
from typing import List, Dict, Any, Optional
from abc import ABC, abstractmethod
from dataclasses import dataclass

from .schemas import (
    AIWorkerEmbeddingItem,
    BaseClusteringConfig,
    ClusteringStats, ClusterInfo,
)
from .embeddings import validate_embeddings
from .clustering import (
    cluster_embeddings,
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
    
    async def process(self, data: Any, context: Dict[str, Any]) -> DataExtractionResult:
        """从各种数据格式中提取嵌入向量和文本"""
        items = data['items']
        data_type = data.get('data_type', 'auto')
        
        embeddings = []
        texts = []
        metadata = []
        
        context['detected_data_type'] = data_type
        print(f"[DataExtraction] 检测到数据类型: {data_type}")
        
        # backend 只发一种形状：{id, embedding, title, url, publishDate, summary}，
        # detect_format 判为 ai_worker_embedding_extended（见 main.py）
        if data_type not in ('ai_worker_embedding', 'ai_worker_embedding_extended'):
            raise ValueError(f"不支持的数据类型: {data_type}")

        for item in items:
            ai_item = AIWorkerEmbeddingItem(**item)
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
                 config: Optional[BaseClusteringConfig] = None):
        self.config = config
    
    async def process(self, data: DataExtractionResult, context: Dict[str, Any]) -> Dict[str, Any]:
        """执行聚类分析"""
        embeddings = data.embeddings
        texts = data.texts
        
        internal_config = InternalClusteringConfig(**self.config.model_dump()) if self.config else InternalClusteringConfig()
        clustering_result = cluster_embeddings(embeddings, internal_config)

        return {
            **clustering_result,
            'texts': texts,
            'metadata': data.metadata,
            'items_info': data.items_info
        }
    
    def get_stage_name(self) -> str:
        return "clustering_analysis"

class ContentAnalysisStage(ProcessingStage):
    """内容分析和结果构建阶段"""
    
    async def process(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """分析内容并构建最终结果"""
        print("执行内容分析...")
        
        # 构建聚类信息
        clusters = self._build_cluster_info(data)
        
        # 构建统计信息
        stats = ClusteringStats(**data['clustering_stats'])
        
        # 构建最终响应
        result = {
            'clusters': clusters,
            'clustering_stats': stats,
            'config_used': data['config_used'],
            'processing_time': context.get('total_processing_time'),
            'model_info': data.get('items_info')
        }
        
        return result
    
    def _build_cluster_info(self, data: Dict[str, Any]) -> List[ClusterInfo]:
        """构建聚类信息列表"""
        cluster_labels = data['cluster_labels']
        texts = data['texts']
        metadata = data['metadata']
        
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
            
            cluster_info = ClusterInfo(
                cluster_id=cluster_id,
                size=len(indices),
                items=cluster_items
            )
            
            clusters.append(cluster_info)
        
        return sorted(clusters, key=lambda x: x.size, reverse=True)
    
    def get_stage_name(self) -> str:
        return "content_analysis"

# ============================================================================
# 预定义的管道组合
# ============================================================================

class MLPipelineFactory:
    """ML管道工厂 - 提供常用的管道组合"""
    
    @staticmethod
    def create_vector_clustering_pipeline(
        config: Optional[BaseClusteringConfig] = None
    ) -> MLPipeline:
        """创建向量聚类管道"""
        return (MLPipeline()
                .add_stage(DataExtractionStage())  # 不需要model_components
                .add_stage(ClusteringStage(config))
                .add_stage(ContentAnalysisStage()))

# ============================================================================
# 统一的处理函数 - 替代原有的分散逻辑
# ============================================================================

async def process_clustering_request(
    items: List[Any],
    config: Optional[BaseClusteringConfig] = None,
    data_type: str = 'auto'
) -> Dict[str, Any]:
    """统一的聚类处理函数 - 替代所有端点中的重复逻辑"""
    
    pipeline = MLPipelineFactory.create_vector_clustering_pipeline(config)
    
    # 准备输入数据
    input_data = {
        'items': items,
        'data_type': data_type
    }
    
    # 执行管道
    result = await pipeline.execute(input_data)
    
    return result['result'] 