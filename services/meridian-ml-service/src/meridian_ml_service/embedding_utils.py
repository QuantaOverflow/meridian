"""
嵌入向量工具函数
处理嵌入验证、转换和相关操作
"""

import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from .config import settings


def validate_embeddings(embeddings: List[List[float]]) -> np.ndarray:
    """
    验证和转换嵌入向量
    
    Args:
        embeddings: 嵌入向量列表
        
    Returns:
        验证后的numpy数组
        
    Raises:
        ValueError: 当嵌入格式或维度不正确时
    """
    if not embeddings:
        raise ValueError("嵌入向量列表不能为空")
    
    # 转换为numpy数组
    try:
        embeddings_array = np.array(embeddings, dtype=np.float32)
    except (ValueError, TypeError) as e:
        raise ValueError(f"无法将嵌入转换为数值数组: {e}")
    
    # 检查维度
    if embeddings_array.ndim != 2:
        raise ValueError(f"嵌入必须是二维数组，实际维度: {embeddings_array.ndim}")
    
    # 检查嵌入维度
    expected_dim = getattr(settings, 'expected_embedding_dimensions', 384)
    if embeddings_array.shape[1] != expected_dim:
        raise ValueError(f"期望{expected_dim}维嵌入，实际得到{embeddings_array.shape[1]}维")
    
    # 检查数值有效性
    if not np.all(np.isfinite(embeddings_array)):
        raise ValueError("嵌入包含无效数值 (NaN或Inf)")
    
    # 检查嵌入范围（可选的合理性检查）
    if np.any(np.abs(embeddings_array) > 100):
        print("警告: 检测到异常大的嵌入值，可能存在问题")
    
    return embeddings_array


def extract_embeddings_from_items(items: List[Dict[str, Any]]) -> Tuple[np.ndarray, List[str]]:
    """
    从项目列表中提取嵌入向量和文本
    
    Args:
        items: 包含嵌入和文本的项目列表
        
    Returns:
        (embeddings_array, texts_list)
    """
    embeddings = []
    texts = []
    
    for i, item in enumerate(items):
        # 提取嵌入
        if 'embedding' not in item:
            raise ValueError(f"项目 {i} 缺少 'embedding' 字段")
        embeddings.append(item['embedding'])
        
        # 提取文本
        text = item.get('text', '')
        if not text and 'title' in item:
            # 对于文章类型，可以组合标题和内容
            title = item.get('title', '')
            content = item.get('content', '')
            text = f"{title}\n{content}" if content else title
        texts.append(text)
    
    # 验证嵌入
    embeddings_array = validate_embeddings(embeddings)
    
    return embeddings_array, texts


def extract_embeddings_from_articles(articles: List[Dict[str, Any]], 
                                   content_fields: List[str] = None) -> Tuple[np.ndarray, List[str], List[Dict[str, Any]]]:
    """
    从文章列表中提取嵌入向量、文本和元数据
    
    Args:
        articles: 文章列表
        content_fields: 用于组合文本的字段列表
        
    Returns:
        (embeddings_array, texts_list, metadata_list)
    """
    if content_fields is None:
        content_fields = ['title', 'content']
    
    embeddings = []
    texts = []
    metadata = []
    
    for i, article in enumerate(articles):
        # 提取嵌入
        if 'embedding' not in article:
            raise ValueError(f"文章 {i} 缺少 'embedding' 字段")
        embeddings.append(article['embedding'])
        
        # 组合文本内容
        text_parts = []
        for field in content_fields:
            if field in article and article[field]:
                text_parts.append(str(article[field]))
        text = '\n'.join(text_parts)
        texts.append(text)
        
        # 保存元数据
        metadata.append({
            'id': article.get('id'),
            'title': article.get('title', ''),
            'url': article.get('url', ''),
            'publishDate': article.get('publishDate', ''),
            'status': article.get('status', '')
        })
    
    # 验证嵌入
    embeddings_array = validate_embeddings(embeddings)
    
    return embeddings_array, texts, metadata


def cluster_embeddings_only(
    embeddings: np.ndarray,
    texts: Optional[List[str]] = None,
    config: Optional[Dict[str, Any]] = None,
    metadata: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    仅使用预生成的嵌入进行聚类
    
    Args:
        embeddings: 预生成的嵌入向量 [n_samples, 384]
        texts: 可选的文本内容，用于内容分析
        config: 聚类配置
        metadata: 可选的元数据列表
        
    Returns:
        聚类结果字典
    """
    from .clustering import cluster_embeddings, ClusteringConfig
    
    # 验证嵌入维度
    expected_dim = getattr(settings, 'expected_embedding_dimensions', 384)
    if embeddings.shape[1] != expected_dim:
        raise ValueError(f"期望{expected_dim}维嵌入，实际得到{embeddings.shape[1]}维")
    
    # 转换配置
    clustering_config = None
    if config:
        clustering_config = ClusteringConfig(**config)
    
    # 执行聚类（跳过嵌入生成步骤）
    result = cluster_embeddings_from_vectors(embeddings, texts, clustering_config, metadata)
    
    return result


def cluster_embeddings_from_vectors(
    embeddings: np.ndarray,
    texts: Optional[List[str]] = None,
    config: Optional[object] = None,
    metadata: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    从嵌入向量直接执行聚类，跳过嵌入生成步骤
    
    这是对原有cluster_embeddings函数的修改版本
    """
    from .clustering import (
        preprocess_embeddings, 
        perform_umap_reduction, 
        perform_hdbscan_clustering,
        analyze_cluster_content,
        convert_numpy_types,
        ClusteringConfig
    )
    
    if config is None:
        config = ClusteringConfig()
    
    print(f"开始聚类流程（跳过嵌入生成）: {embeddings.shape}")
    
    # 1. 预处理（对预生成的嵌入）
    processed_embeddings = preprocess_embeddings(
        embeddings, 
        normalize=config.normalize_embeddings
    )
    
    # 2. UMAP降维
    reduced_embeddings, reducer = perform_umap_reduction(
        processed_embeddings, 
        config
    )
    
    # 3. HDBSCAN聚类
    cluster_labels, clusterer = perform_hdbscan_clustering(
        reduced_embeddings, 
        config
    )
    
    # 4. 分析结果
    unique_labels = np.unique(cluster_labels)
    n_clusters = len(unique_labels) - (1 if -1 in unique_labels else 0)
    n_outliers = np.sum(cluster_labels == -1)
    
    # 计算每个簇的大小
    cluster_sizes = {}
    for label in unique_labels:
        if label != -1:
            cluster_sizes[int(label)] = int(np.sum(cluster_labels == label))
    
    # 计算DBCV分数（如果可能）
    dbcv_score = None
    valid_points = cluster_labels != -1
    if valid_points.sum() > 1 and len(set(cluster_labels[valid_points])) > 1:
        try:
            from hdbscan.validity import validity_index
            reduced_data_64 = reduced_embeddings[valid_points].astype(np.float64)
            dbcv_score = float(validity_index(reduced_data_64, cluster_labels[valid_points]))
        except Exception as e:
            print(f"DBCV计算失败: {e}")
    
    # 计算聚类质量指标
    total_samples = len(cluster_labels)
    outlier_ratio = float(n_outliers / total_samples) if total_samples > 0 else 0.0
    
    # 构建结果
    result = {
        'cluster_labels': cluster_labels.tolist(),
        'reduced_embeddings': reduced_embeddings.tolist(),
        'clustering_stats': {
            'n_samples': total_samples,
            'n_clusters': n_clusters,
            'n_outliers': n_outliers,
            'outlier_ratio': outlier_ratio,
            'cluster_sizes': cluster_sizes,
            'dbcv_score': dbcv_score,
        },
        'config_used': {
            'umap_n_components': config.umap_n_components,
            'umap_n_neighbors': config.umap_n_neighbors,
            'umap_min_dist': config.umap_min_dist,
            'umap_metric': config.umap_metric,
            'hdbscan_min_cluster_size': config.hdbscan_min_cluster_size,
            'hdbscan_min_samples': config.hdbscan_min_samples,
            'hdbscan_metric': config.hdbscan_metric,
            'hdbscan_cluster_selection_method': config.hdbscan_cluster_selection_method,
            'normalize_embeddings': config.normalize_embeddings,
            'remove_outliers': config.remove_outliers,
        }
    }
    
    # 5. 内容分析（如果提供了文本）
    if texts:
        cluster_content = analyze_cluster_content(texts, cluster_labels)
        result['cluster_content'] = cluster_content
    
    # 6. 添加元数据（如果提供）
    if metadata:
        result['metadata'] = metadata
    
    return convert_numpy_types(result)


def build_cluster_info_list(clustering_result: Dict[str, Any], 
                          items: List[Dict[str, Any]],
                          include_content: bool = True,
                          top_n: int = 5) -> List[Dict[str, Any]]:
    """
    构建聚类信息列表
    
    Args:
        clustering_result: 聚类结果
        items: 原始项目列表
        include_content: 是否包含内容分析
        top_n: 每个聚类返回的代表性内容数量
        
    Returns:
        聚类信息列表
    """
    cluster_labels = clustering_result['cluster_labels']
    reduced_embeddings = clustering_result.get('reduced_embeddings', [])
    cluster_content = clustering_result.get('cluster_content', {})
    
    # 按聚类组织数据
    clusters_data = {}
    for i, (label, item) in enumerate(zip(cluster_labels, items)):
        if label not in clusters_data:
            clusters_data[label] = []
        
        item_data = item.copy()
        if i < len(reduced_embeddings):
            item_data['cluster_position'] = reduced_embeddings[i]
        clusters_data[label].append(item_data)
    
    # 构建聚类信息
    cluster_info_list = []
    for cluster_id, cluster_items in clusters_data.items():
        # 计算聚类中心点
        centroid = None
        if reduced_embeddings:
            positions = [item.get('cluster_position') for item in cluster_items if item.get('cluster_position')]
            if positions:
                centroid = np.mean(positions, axis=0).tolist()
        
        # 获取代表性文本
        representative_texts = []
        if include_content and str(cluster_id) in cluster_content:
            representative_texts = cluster_content[str(cluster_id)][:top_n]
        
        cluster_info = {
            'cluster_id': cluster_id,
            'size': len(cluster_items),
            'items': cluster_items[:top_n] if top_n > 0 else cluster_items,
            'centroid': centroid,
            'representative_texts': representative_texts,
            'keywords': []  # 可以后续添加关键词提取
        }
        
        cluster_info_list.append(cluster_info)
    
    # 按聚类ID排序
    cluster_info_list.sort(key=lambda x: x['cluster_id'])
    
    return cluster_info_list


def format_embedding_validation_error(error: ValueError) -> str:
    """
    格式化嵌入验证错误信息
    """
    error_msg = str(error)
    
    # 添加更友好的错误提示
    if "维嵌入" in error_msg:
        return f"嵌入维度错误: {error_msg}。请确保使用的是384维的嵌入向量。"
    elif "无效数值" in error_msg:
        return f"嵌入数据无效: {error_msg}。请检查嵌入向量是否包含NaN或无穷大值。"
    elif "二维数组" in error_msg:
        return f"嵌入格式错误: {error_msg}。请提供形状为[n_samples, 384]的二维数组。"
    else:
        return f"嵌入验证失败: {error_msg}" 