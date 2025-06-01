import numpy as np
import time
from fastapi import Depends, FastAPI, HTTPException

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
    EmbeddingsAndClusteringResponse
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
