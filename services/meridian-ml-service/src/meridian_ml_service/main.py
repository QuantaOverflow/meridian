import numpy as np
import time
from fastapi import Depends, FastAPI, HTTPException
from typing import List, Dict, Any

from .config import settings
from .dependencies import (
    ModelDep,
    verify_token,
    get_embedding_model,
)  # Import auth dependency
from .embeddings import compute_embeddings
from .clustering import (
    cluster_embeddings, 
    cluster_embeddings_with_optimization,
    analyze_cluster_content,
    ClusteringConfig as ClusteringConfigClass,
    GridSearchConfig as GridSearchConfigClass
)
from .schemas import (
    EmbeddingRequest, 
    EmbeddingResponse,
    ClusteringRequest,
    OptimizedClusteringRequest,
    ClusteringResponse,
    ClusteringStats,
    OptimizationResult,
    EmbeddingsAndClusteringRequest,
    EmbeddingsAndClusteringResponse,
    ClusteringWithEmbeddingsRequest,
    ClusteringWithEmbeddingsResponse,
    ArticleClusteringRequest,
    ArticleClusteringResponse,
    ArticleClusterInfo,
    HybridClusteringRequest
)

app = FastAPI(
    title="Meridian ML Service",
    description="处理ML任务：嵌入生成和文本聚类（UMAP + HDBSCAN）",
    version="0.3.0",
)


# Simple root endpoint for health check
@app.get("/")
async def read_root():
    return {
        "status": "ok", 
        "service": "Meridian ML Service",
        "features": ["embeddings", "clustering", "parameter_optimization"],
        "models": {
            "embedding": settings.embedding_model_name,
            "clustering": "UMAP + HDBSCAN with Grid Search Optimization"
        }
    }


@app.get("/ping")
async def ping():
    return {"pong": True}


@app.get("/health")
async def health_check():
    """详细的健康检查"""
    try:
        # 检查嵌入模型
        from .clustering import CLUSTERING_AVAILABLE
        
        health_status = {
            "status": "healthy",
            "embedding_model": settings.embedding_model_name,
            "clustering_available": CLUSTERING_AVAILABLE,
            "optimization_available": CLUSTERING_AVAILABLE,  # 优化功能依赖聚类
            "timestamp": time.time()
        }
        
        if not CLUSTERING_AVAILABLE:
            health_status["warning"] = "聚类功能不可用，请安装：umap-learn hdbscan scikit-learn"
            
        return health_status
        
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")


@app.post("/embeddings", response_model=EmbeddingResponse)
async def api_compute_embeddings(
    request: EmbeddingRequest,
    model_components: ModelDep,  # ModelDep already includes Depends
    _: None = Depends(verify_token),
):
    """
    为提供的文本列表计算嵌入向量
    """
    print(f"收到嵌入请求：{len(request.texts)} 个文本")
    try:
        embeddings_np: np.ndarray = compute_embeddings(
            texts=request.texts,
            model_components=model_components,
        )

        embeddings_list: list[list[float]] = embeddings_np.tolist()

        return EmbeddingResponse(
            embeddings=embeddings_list, 
            model_name=settings.embedding_model_name
        )
    except Exception as e:
        print(f"嵌入计算错误: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"嵌入计算内部错误: {str(e)}",
        ) from e


@app.post("/clustering", response_model=ClusteringResponse)
async def api_clustering(
    request: ClusteringRequest,
    model_components: ModelDep,
    _: None = Depends(verify_token),
):
    """
    对文本进行聚类分析（嵌入生成 -> UMAP降维 -> HDBSCAN聚类）
    """
    print(f"收到聚类请求：{len(request.texts)} 个文本")
    
    try:
        start_time = time.time()
        
        # 1. 生成嵌入
        print("步骤1: 生成嵌入向量...")
        embeddings_np = compute_embeddings(
            texts=request.texts,
            model_components=model_components,
        )
        
        # 2. 执行聚类
        print("步骤2: 执行聚类分析...")
        clustering_config = None
        if request.config:
            clustering_config = ClusteringConfigClass(
                umap_n_components=request.config.umap_n_components,
                umap_n_neighbors=request.config.umap_n_neighbors,
                umap_min_dist=request.config.umap_min_dist,
                umap_metric=request.config.umap_metric,
                hdbscan_min_cluster_size=request.config.hdbscan_min_cluster_size,
                hdbscan_min_samples=request.config.hdbscan_min_samples,
                hdbscan_metric=request.config.hdbscan_metric,
                hdbscan_cluster_selection_method=request.config.hdbscan_cluster_selection_method,
                hdbscan_cluster_selection_epsilon=request.config.hdbscan_cluster_selection_epsilon,
                normalize_embeddings=request.config.normalize_embeddings,
                remove_outliers=request.config.remove_outliers,
            )
        
        clustering_result = cluster_embeddings(embeddings_np, clustering_config)
        
        # 3. 分析簇内容
        print("步骤3: 分析簇内容...")
        cluster_labels = np.array(clustering_result['cluster_labels'])
        cluster_content = analyze_cluster_content(request.texts, cluster_labels)
        
        # 构建响应
        stats = ClusteringStats(**clustering_result['clustering_stats'])
        
        response = ClusteringResponse(
            cluster_labels=clustering_result['cluster_labels'],
            clustering_stats=stats,
            config_used=clustering_result['config_used'],
            cluster_content=cluster_content,
            optimization=OptimizationResult(used=False)
        )
        
        # 可选返回嵌入向量
        if request.return_embeddings:
            response.embeddings = embeddings_np.tolist()
            
        if request.return_reduced_embeddings:
            response.reduced_embeddings = clustering_result['reduced_embeddings']
        
        processing_time = time.time() - start_time
        print(f"聚类完成，耗时: {processing_time:.2f}秒")
        
        return response
        
    except Exception as e:
        print(f"聚类分析错误: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"聚类分析内部错误: {str(e)}",
        ) from e


@app.post("/clustering/optimized", response_model=ClusteringResponse)
async def api_optimized_clustering(
    request: OptimizedClusteringRequest,
    model_components: ModelDep,
    _: None = Depends(verify_token),
):
    """
    带参数优化的聚类分析（网格搜索最佳参数）
    """
    print(f"收到优化聚类请求：{len(request.texts)} 个文本")
    
    try:
        start_time = time.time()
        
        # 1. 生成嵌入
        print("步骤1: 生成嵌入向量...")
        embeddings_np = compute_embeddings(
            texts=request.texts,
            model_components=model_components,
        )
        
        # 2. 执行带优化的聚类
        print("步骤2: 执行参数优化聚类分析...")
        grid_config = None
        if request.grid_config:
            grid_config = GridSearchConfigClass(
                umap_n_neighbors=request.grid_config.umap_n_neighbors,
                umap_n_components=request.grid_config.umap_n_components,
                umap_min_dist=request.grid_config.umap_min_dist,
                umap_metric=request.grid_config.umap_metric,
                hdbscan_min_cluster_size=request.grid_config.hdbscan_min_cluster_size,
                hdbscan_min_samples=request.grid_config.hdbscan_min_samples,
                hdbscan_epsilon=request.grid_config.hdbscan_epsilon,
                hdbscan_metric=request.grid_config.hdbscan_metric,
            )
        
        clustering_result = cluster_embeddings_with_optimization(
            embeddings_np, 
            use_optimization=True,
            grid_config=grid_config
        )
        
        # 3. 分析簇内容
        print("步骤3: 分析簇内容...")
        cluster_labels = np.array(clustering_result['cluster_labels'])
        cluster_content = analyze_cluster_content(request.texts, cluster_labels)
        
        # 构建响应
        stats = ClusteringStats(**clustering_result['clustering_stats'])
        
        optimization_result = OptimizationResult(
            used=clustering_result['optimization']['used'],
            best_params=clustering_result['optimization'].get('best_params'),
            best_dbcv_score=clustering_result['optimization'].get('best_dbcv_score')
        )
        
        response = ClusteringResponse(
            cluster_labels=clustering_result['cluster_labels'],
            clustering_stats=stats,
            config_used=clustering_result['config_used'],
            cluster_content=cluster_content,
            optimization=optimization_result
        )
        
        # 可选返回嵌入向量
        if request.return_embeddings:
            response.embeddings = embeddings_np.tolist()
            
        if request.return_reduced_embeddings:
            response.reduced_embeddings = clustering_result['reduced_embeddings']
        
        processing_time = time.time() - start_time
        print(f"优化聚类完成，耗时: {processing_time:.2f}秒")
        
        return response
        
    except Exception as e:
        print(f"优化聚类分析错误: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"优化聚类分析内部错误: {str(e)}",
        ) from e


@app.post("/embeddings-and-clustering", response_model=EmbeddingsAndClusteringResponse)
async def api_embeddings_and_clustering(
    request: EmbeddingsAndClusteringRequest,
    model_components: ModelDep,
    _: None = Depends(verify_token),
):
    """
    一站式服务：生成嵌入 + 聚类分析 + 内容分析（可选参数优化）
    """
    print(f"收到完整处理请求：{len(request.texts)} 个文本，优化模式: {request.use_optimization}")
    
    try:
        start_time = time.time()
        
        # 1. 生成嵌入
        print("生成嵌入向量...")
        embeddings_np = compute_embeddings(
            texts=request.texts,
            model_components=model_components,
        )
        
        # 2. 执行聚类（带或不带优化）
        if request.use_optimization:
            print("执行参数优化聚类分析...")
            grid_config = None
            if request.grid_config:
                grid_config = GridSearchConfigClass(
                    umap_n_neighbors=request.grid_config.umap_n_neighbors,
                    umap_n_components=request.grid_config.umap_n_components,
                    umap_min_dist=request.grid_config.umap_min_dist,
                    umap_metric=request.grid_config.umap_metric,
                    hdbscan_min_cluster_size=request.grid_config.hdbscan_min_cluster_size,
                    hdbscan_min_samples=request.grid_config.hdbscan_min_samples,
                    hdbscan_epsilon=request.grid_config.hdbscan_epsilon,
                    hdbscan_metric=request.grid_config.hdbscan_metric,
                )
            
            clustering_result = cluster_embeddings_with_optimization(
                embeddings_np,
                use_optimization=True,
                grid_config=grid_config
            )
        else:
            print("执行标准聚类分析...")
            clustering_config = None
            if request.clustering_config:
                clustering_config = ClusteringConfigClass(
                    umap_n_components=request.clustering_config.umap_n_components,
                    umap_n_neighbors=request.clustering_config.umap_n_neighbors,
                    umap_min_dist=request.clustering_config.umap_min_dist,
                    umap_metric=request.clustering_config.umap_metric,
                    hdbscan_min_cluster_size=request.clustering_config.hdbscan_min_cluster_size,
                    hdbscan_min_samples=request.clustering_config.hdbscan_min_samples,
                    hdbscan_metric=request.clustering_config.hdbscan_metric,
                    hdbscan_cluster_selection_method=request.clustering_config.hdbscan_cluster_selection_method,
                    hdbscan_cluster_selection_epsilon=request.clustering_config.hdbscan_cluster_selection_epsilon,
                    normalize_embeddings=request.clustering_config.normalize_embeddings,
                    remove_outliers=request.clustering_config.remove_outliers,
                )
            
            clustering_result = cluster_embeddings(embeddings_np, clustering_config)
            clustering_result['optimization'] = {'used': False}
        
        # 3. 分析簇内容
        if request.include_cluster_content:
            print("分析簇内容...")
            cluster_labels = np.array(clustering_result['cluster_labels'])
            cluster_content = analyze_cluster_content(
                request.texts, 
                cluster_labels, 
                top_n=request.content_top_n
            )
            clustering_result['cluster_content'] = cluster_content
        
        # 构建响应
        stats = ClusteringStats(**clustering_result['clustering_stats'])
        
        optimization_result = OptimizationResult(
            used=clustering_result['optimization']['used'],
            best_params=clustering_result['optimization'].get('best_params'),
            best_dbcv_score=clustering_result['optimization'].get('best_dbcv_score')
        )
        
        clustering_response = ClusteringResponse(
            cluster_labels=clustering_result['cluster_labels'],
            clustering_stats=stats,
            config_used=clustering_result['config_used'],
            reduced_embeddings=clustering_result['reduced_embeddings'],
            cluster_content=clustering_result.get('cluster_content'),
            optimization=optimization_result
        )
        
        processing_time = time.time() - start_time
        
        return EmbeddingsAndClusteringResponse(
            embeddings=embeddings_np.tolist(),
            clustering_result=clustering_response,
            model_name=settings.embedding_model_name,
            processing_time=processing_time
        )
        
    except Exception as e:
        print(f"完整处理错误: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"处理内部错误: {str(e)}",
        ) from e


# =============================================================================
# 新增：解耦嵌入和聚类的接口端点
# =============================================================================

@app.post("/clustering/with-embeddings", response_model=ClusteringWithEmbeddingsResponse)
async def api_clustering_with_embeddings(
    request: ClusteringWithEmbeddingsRequest,
    _: None = Depends(verify_token),
):
    """
    使用预生成嵌入进行聚类分析（无需重新生成嵌入）
    """
    from .embedding_utils import (
        extract_embeddings_from_items, 
        cluster_embeddings_only,
        build_cluster_info_list,
        format_embedding_validation_error
    )
    
    print(f"收到带嵌入的聚类请求：{len(request.items)} 个项目")
    
    try:
        start_time = time.time()
        
        # 1. 提取和验证嵌入向量
        print("步骤1: 提取和验证嵌入向量...")
        try:
            embeddings_np, texts = extract_embeddings_from_items([item.dict() for item in request.items])
        except ValueError as e:
            error_msg = format_embedding_validation_error(e)
            raise HTTPException(status_code=400, detail=error_msg)
        
        # 2. 执行聚类
        print("步骤2: 执行聚类分析...")
        config_dict = request.config.dict() if request.config else None
        clustering_result = cluster_embeddings_only(
            embeddings_np, 
            texts if request.include_cluster_content else None,
            config_dict
        )
        
        # 3. 构建响应
        print("步骤3: 构建响应...")
        cluster_info_list = build_cluster_info_list(
            clustering_result,
            [item.dict() for item in request.items],
            request.include_cluster_content,
            request.content_top_n
        )
        
        processing_time = time.time() - start_time
        
        response = ClusteringWithEmbeddingsResponse(
            clusters=cluster_info_list,
            clustering_stats=ClusteringStats(**clustering_result['clustering_stats']),
            config_used=clustering_result['config_used'],
            reduced_embeddings=clustering_result['reduced_embeddings'] if request.return_reduced_embeddings else None,
            processing_time=processing_time
        )
        
        print(f"聚类完成，耗时: {processing_time:.2f}秒")
        return response
        
    except HTTPException:
        raise  # 重新抛出HTTP异常
    except Exception as e:
        print(f"聚类分析错误: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"聚类分析内部错误: {str(e)}",
        ) from e


@app.post("/clustering/articles", response_model=ArticleClusteringResponse)
async def api_clustering_articles(
    request: ArticleClusteringRequest,
    _: None = Depends(verify_token),
):
    """
    文章聚类分析（适配AI Worker数据格式）
    """
    from .embedding_utils import (
        extract_embeddings_from_articles,
        cluster_embeddings_only,
        format_embedding_validation_error
    )
    from .clustering import cluster_embeddings_with_optimization, ClusteringConfig, GridSearchConfig
    
    print(f"收到文章聚类请求：{len(request.articles)} 篇文章")
    
    try:
        start_time = time.time()
        
        # 1. 提取嵌入向量和元数据
        print("步骤1: 提取嵌入向量和元数据...")
        try:
            embeddings_np, texts, metadata = extract_embeddings_from_articles(
                [article.dict() for article in request.articles],
                request.content_fields
            )
        except ValueError as e:
            error_msg = format_embedding_validation_error(e)
            raise HTTPException(status_code=400, detail=error_msg)
        
        # 2. 执行聚类（带或不带优化）
        if request.use_optimization:
            print("步骤2: 执行优化聚类分析...")
            
            # 准备网格搜索配置
            grid_config = None
            if request.grid_config:
                grid_config = GridSearchConfig(**request.grid_config.dict())
            
            clustering_result = cluster_embeddings_with_optimization(
                embeddings_np,
                use_optimization=True,
                grid_config=grid_config
            )
        else:
            print("步骤2: 执行标准聚类分析...")
            config_dict = request.config.dict() if request.config else None
            clustering_result = cluster_embeddings_only(
                embeddings_np,
                texts if request.include_cluster_content else None,
                config_dict,
                metadata
            )
            clustering_result['optimization'] = {'used': False}
        
        # 3. 构建文章聚类响应
        print("步骤3: 构建文章聚类响应...")
        clusters = build_article_clusters(
            clustering_result,
            [article.dict() for article in request.articles],
            request.include_cluster_content
        )
        
        processing_time = time.time() - start_time
        
        # 构建优化结果
        optimization_result = OptimizationResult(
            used=clustering_result['optimization']['used'],
            best_params=clustering_result['optimization'].get('best_params'),
            best_dbcv_score=clustering_result['optimization'].get('best_dbcv_score')
        )
        
        response = ArticleClusteringResponse(
            clusters=clusters,
            clustering_stats=ClusteringStats(**clustering_result['clustering_stats']),
            config_used=clustering_result['config_used'],
            optimization=optimization_result,
            processing_time=processing_time,
            model_info={
                "embedding_dimensions": embeddings_np.shape[1],
                "embedding_source": "pre_generated"
            }
        )
        
        print(f"文章聚类完成，耗时: {processing_time:.2f}秒")
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"文章聚类分析错误: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"文章聚类分析内部错误: {str(e)}",
        ) from e


@app.post("/clustering/hybrid", response_model=ClusteringResponse)
async def api_hybrid_clustering(
    request: HybridClusteringRequest,
    model_components: ModelDep,
    _: None = Depends(verify_token),
):
    """
    混合模式聚类（支持预生成嵌入或现场生成）
    """
    from .embedding_utils import validate_embeddings, format_embedding_validation_error
    from .embeddings import compute_embeddings
    from .clustering import cluster_embeddings, ClusteringConfig
    
    print(f"收到混合聚类请求：{len(request.items)} 个项目")
    
    try:
        start_time = time.time()
        
        # 分离有嵌入和没有嵌入的项目
        items_with_embedding = []
        items_without_embedding = []
        all_embeddings = []
        all_texts = []
        
        for item in request.items:
            if 'embedding' in item and item['embedding']:
                items_with_embedding.append(item)
                all_embeddings.append(item['embedding'])
                all_texts.append(item.get('text', ''))
            else:
                items_without_embedding.append(item)
                all_texts.append(item.get('text', ''))
        
        print(f"项目分类：{len(items_with_embedding)} 个有嵌入，{len(items_without_embedding)} 个需生成嵌入")
        
        # 为没有嵌入的项目生成嵌入
        if items_without_embedding:
            print("为部分项目生成嵌入...")
            texts_to_embed = [item.get('text', '') for item in items_without_embedding]
            generated_embeddings = compute_embeddings(texts_to_embed, model_components)
            
            # 合并嵌入
            for embedding in generated_embeddings:
                all_embeddings.append(embedding.tolist())
        
        # 验证所有嵌入
        try:
            embeddings_np = validate_embeddings(all_embeddings)
        except ValueError as e:
            error_msg = format_embedding_validation_error(e)
            raise HTTPException(status_code=400, detail=error_msg)
        
        # 执行聚类
        print("执行混合聚类分析...")
        clustering_config = None
        if request.config:
            clustering_config = ClusteringConfig(**request.config.dict())
        
        clustering_result = cluster_embeddings(embeddings_np, clustering_config)
        
        # 分析簇内容
        cluster_labels = np.array(clustering_result['cluster_labels'])
        cluster_content = analyze_cluster_content(all_texts, cluster_labels)
        
        # 构建响应
        stats = ClusteringStats(**clustering_result['clustering_stats'])
        
        response = ClusteringResponse(
            cluster_labels=clustering_result['cluster_labels'],
            clustering_stats=stats,
            config_used=clustering_result['config_used'],
            cluster_content=cluster_content,
            optimization=OptimizationResult(used=False)
        )
        
        # 可选返回嵌入向量
        if request.return_embeddings:
            response.embeddings = embeddings_np.tolist()
            
        if request.return_reduced_embeddings:
            response.reduced_embeddings = clustering_result['reduced_embeddings']
        
        processing_time = time.time() - start_time
        print(f"混合聚类完成，耗时: {processing_time:.2f}秒")
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"混合聚类分析错误: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"混合聚类分析内部错误: {str(e)}",
        ) from e


# =============================================================================
# 辅助函数
# =============================================================================

def build_article_clusters(clustering_result: Dict[str, Any], 
                          articles: List[Dict[str, Any]], 
                          include_content: bool = True) -> List[ArticleClusterInfo]:
    """构建文章聚类信息"""
    from datetime import datetime
    import numpy as np
    
    cluster_labels = clustering_result['cluster_labels']
    reduced_embeddings = clustering_result.get('reduced_embeddings', [])
    cluster_content = clustering_result.get('cluster_content', {})
    
    # 按聚类组织文章
    clusters_data = {}
    for i, (label, article) in enumerate(zip(cluster_labels, articles)):
        if label not in clusters_data:
            clusters_data[label] = []
        
        article_data = article.copy()
        if i < len(reduced_embeddings):
            article_data['cluster_position'] = reduced_embeddings[i]
        clusters_data[label].append(article_data)
    
    # 构建聚类信息
    cluster_info_list = []
    for cluster_id, cluster_articles in clusters_data.items():
        # 计算聚类中心点
        centroid = None
        if reduced_embeddings:
            positions = [article.get('cluster_position') for article in cluster_articles if article.get('cluster_position')]
            if positions:
                centroid = np.mean(positions, axis=0).tolist()
        
        # 选择代表性文章（按发布时间排序，选择最新的几篇）
        representative_articles = []
        if cluster_articles:
            # 尝试按时间排序
            try:
                sorted_articles = sorted(
                    cluster_articles, 
                    key=lambda x: datetime.fromisoformat(x.get('publishDate', '1970-01-01').replace('Z', '+00:00')),
                    reverse=True
                )
                representative_articles = sorted_articles[:3]
            except:
                # 如果时间解析失败，就取前3个
                representative_articles = cluster_articles[:3]
        
        # 获取共同主题
        common_themes = []
        if include_content and str(cluster_id) in cluster_content:
            common_themes = cluster_content[str(cluster_id)][:5]
        
        # 计算时间范围
        time_range = None
        if cluster_articles:
            try:
                dates = []
                for article in cluster_articles:
                    if article.get('publishDate'):
                        date_str = article['publishDate'].replace('Z', '+00:00')
                        dates.append(datetime.fromisoformat(date_str))
                
                if dates:
                    min_date = min(dates)
                    max_date = max(dates)
                    time_range = {
                        'earliest': min_date.isoformat(),
                        'latest': max_date.isoformat()
                    }
            except:
                pass  # 忽略时间解析错误
        
        cluster_info = ArticleClusterInfo(
            cluster_id=cluster_id,
            size=len(cluster_articles),
            articles=cluster_articles,
            centroid=centroid,
            representative_articles=representative_articles,
            common_themes=common_themes,
            time_range=time_range
        )
        
        cluster_info_list.append(cluster_info)
    
    # 按聚类ID排序
    cluster_info_list.sort(key=lambda x: x.cluster_id)
    
    return cluster_info_list
