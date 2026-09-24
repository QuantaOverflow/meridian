"""
聚类请求处理：校验输入 → 凝聚聚类 → 按簇组装响应。
唯一调用方是 apps/backend/src/lib/services/clustering.ts（它只读 cluster_id、size、items[].id）。
"""

from typing import List, Dict, Any, Optional

from .schemas import AIWorkerEmbeddingItem, BaseClusteringConfig, ClusteringStats, ClusterInfo
from .embeddings import validate_embeddings
from .clustering import cluster_embeddings, ClusteringConfig as InternalClusteringConfig


def process_clustering_request(
    items: List[Dict[str, Any]],
    config: Optional[BaseClusteringConfig] = None,
) -> Dict[str, Any]:
    """items: [{id, embedding, ...}]，多余字段忽略。"""
    parsed = [AIWorkerEmbeddingItem(**item) for item in items]
    embeddings = validate_embeddings([p.embedding for p in parsed])
    print(f"[Clustering] 输入 {len(embeddings)} 个嵌入向量, 维度: {embeddings.shape[1]}")

    internal_config = InternalClusteringConfig(**config.model_dump()) if config else InternalClusteringConfig()
    result = cluster_embeddings(embeddings, internal_config)

    labels = result['cluster_labels']
    clusters = []
    for cluster_id in set(labels):
        ids = [parsed[i].id for i, label in enumerate(labels) if label == cluster_id]
        clusters.append(ClusterInfo(cluster_id=cluster_id, size=len(ids), items=[{'id': i} for i in ids]))

    return {
        'clusters': sorted(clusters, key=lambda x: x.size, reverse=True),
        'clustering_stats': ClusteringStats(**result['clustering_stats']),
        'config_used': result['config_used'],
    }
