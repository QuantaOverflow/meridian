"""
Meridian ML Service - 精简核心版本
专注于AI Worker集成和聚类分析的核心功能
"""

import os
import time
import asyncio
from contextlib import asynccontextmanager
from typing import List, Dict, Any
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .dependencies import ModelDep, verify_token
from .schemas import (
    # 核心请求/响应模型
    EmbeddingRequest, EmbeddingResponse,
    AIWorkerEmbeddingClusteringRequest, 
    FlexibleClusteringRequest,
    BaseClusteringResponse,
    
    # 配置模型
    BaseClusteringConfig, OptimizationConfig, ContentAnalysisConfig
)
from .pipeline import process_clustering_request
from .embeddings import compute_embeddings

# ============================================================================
# FastAPI应用配置
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 后台预热：fire-and-forget 触发模型加载(含 torch/transformers 的重 import 与权重加载)，
    # 用 to_thread 不阻塞 uvicorn 绑定/就绪检查。配合 embeddings.py 的懒 import，容器秒监听，
    # 模型在后台并行加载，首个聚类请求来时多半已就绪——既治"不监听"又不把成本转嫁给首请求。
    async def _warmup():
        try:
            from .embeddings import load_embedding_model
            from .clustering import _load_clustering_libs
            # 两个重头(模型权重 + umap/hdbscan 的 ~16s import)都在后台线程预热，
            # 等首个聚类请求来时多半已就绪。
            await asyncio.to_thread(_load_clustering_libs)
            await asyncio.to_thread(load_embedding_model)
            print("[warmup] 聚类库 + 嵌入模型后台预热完成", flush=True)
        except Exception as e:
            print(f"[warmup] 预热失败(首请求会按需重试加载): {e}", flush=True)
    asyncio.create_task(_warmup())
    yield

app = FastAPI(
    title="Meridian ML Service",
    description="AI驱动的智能聚类分析服务",
    version="3.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 跨服务追踪：把上游传过来的 x-trace-id 在请求入口打一行结构化日志，便于关联三个 service 的日志
@app.middleware("http")
async def trace_id_logger(request: Request, call_next):
    trace_id = request.headers.get("x-trace-id") or request.headers.get("X-Trace-ID")
    if trace_id:
        print(f"[trace] svc=meridian-ml-service trace_id={trace_id} path={request.url.path} method={request.method}", flush=True)
    return await call_next(request)

# ============================================================================
# 构建身份（build identity）
# ============================================================================
# 独立于请求参数的镜像身份。
#
# 为什么不能靠 config_used：clustering.py 的 config_used 只是把请求方传进来的
# config 原样回显，旧镜像只要还认识字段名就会回显出一模一样的值，所以 backend 拿
# configSent / configUsed 比对永远相等。2026-09-15 至 09-19 连续五天生产跑的是旧
# 聚类算法（镜像没推成功，源码却是新的），全程 brief_runs.status = COMPLETED。
#
# 为什么不能是代码里的字面量（如 version="3.0.0"）：字面量跟着源码走，而故障的形状
# 恰恰是"源码是对的、镜像是旧的"。所以值只从构建时注入的环境变量读
# （Dockerfile 的 ARG → ENV），代码里只有"没注入"的占位值。
BUILD_IDENTITY_FIELD = "build_identity"
BUILD_NOT_INJECTED = "not-injected"


def _read_build_stamp() -> str:
    """读镜像里 Dockerfile 那层写下的构建时刻（兜底，见 Dockerfile）。读不到返回空串。"""
    path = (os.getenv("MERIDIAN_ML_BUILD_STAMP_FILE") or "").strip()
    if not path:
        return ""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def get_build_identity() -> Dict[str, Any]:
    """返回当前运行镜像的构建身份。缺环境变量不报错，返回可判别的占位值。"""
    sha = (os.getenv("MERIDIAN_ML_BUILD_SHA") or "").strip()
    built_at = (os.getenv("MERIDIAN_ML_BUILD_TIME") or "").strip()
    stamp = _read_build_stamp()
    if built_at:
        time_source = "build_arg"
    elif stamp:
        time_source = "image_layer"
    else:
        time_source = BUILD_NOT_INJECTED
    return {
        "build_sha": sha or BUILD_NOT_INJECTED,
        "build_time": built_at or stamp or BUILD_NOT_INJECTED,
        "build_time_source": time_source,
        # injected=False 只剩一种来源：本地 `uv run` 直起服务（镜像里至少有 .build_stamp）。
        # 调用方据此区分"没注入"与"注入了但不是本次部署的那个"。
        "injected": bool(sha or built_at or stamp),
    }


# ============================================================================
# 健康检查和基础端点
# ============================================================================

@app.get("/")
async def read_root():
    """服务根端点"""
    return {
        "service": "Meridian ML Service",
        # version 是源码字面量，**不能**当作镜像身份用；镜像身份看 build_identity。
        "version": "3.0.0",
        BUILD_IDENTITY_FIELD: get_build_identity(),
        "status": "running",
        "features": {
            "embeddings": "生成文本嵌入向量",
            "clustering": "智能聚类分析",
            "ai_worker_integration": "完美集成AI Worker数据格式"
        },
        "endpoints": {
            "embeddings": "/embeddings",
            "ai_worker_clustering": "/ai-worker/clustering",
            "auto_detect_clustering": "/clustering/auto"
        },
        "models": {
            "embedding": settings.embedding_model_name,
            "clustering": "UMAP + HDBSCAN"
        }
    }

@app.get("/health")
async def health_check():
    """健康检查端点"""
    try:
        from .clustering import CLUSTERING_AVAILABLE
        
        health_status = {
            "status": "healthy",
            "timestamp": time.time(),
            BUILD_IDENTITY_FIELD: get_build_identity(),
            "embedding_model": settings.embedding_model_name,
            "clustering_available": CLUSTERING_AVAILABLE,
            "optimization_available": CLUSTERING_AVAILABLE
        }
        
        if not CLUSTERING_AVAILABLE:
            health_status["warnings"] = [
                "聚类功能不可用",
                "安装命令: pip install umap-learn hdbscan scikit-learn"
            ]
            
        return health_status
        
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"服务健康检查失败: {str(e)}")

# ============================================================================
# 核心端点 1: 嵌入生成
# ============================================================================

@app.post("/embeddings", response_model=EmbeddingResponse)
async def generate_embeddings(
    request: EmbeddingRequest,
    model_components: ModelDep,
    _: None = Depends(verify_token),
):
    """生成文本嵌入向量"""
    print(f"[Embeddings] 收到请求：{len(request.texts)} 个文本")
    
    try:
        start_time = time.time()
        
        # 生成嵌入向量
        embeddings_np = compute_embeddings(
            texts=request.texts,
            model_components=model_components,
        )
        
        # 可选归一化
        if request.normalize:
            import numpy as np
            norms = np.linalg.norm(embeddings_np, axis=1, keepdims=True)
            embeddings_np = embeddings_np / (norms + 1e-8)
        
        processing_time = time.time() - start_time
        
        print(f"[Embeddings] 处理完成，耗时: {processing_time:.2f}秒")
        
        return EmbeddingResponse(
            embeddings=embeddings_np.tolist(),
            model_name=request.model_name or settings.embedding_model_name,
            dimensions=embeddings_np.shape[1],
            processing_time=processing_time
        )
        
    except Exception as e:
        print(f"[Embeddings] 处理错误: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"嵌入生成失败: {str(e)}"
        )

# ============================================================================
# 核心端点 2: AI Worker集成聚类
# ============================================================================

# response_model 去掉的原因：BaseClusteringResponse 里没有 build_identity 字段，
# FastAPI 会按 response_model 过滤掉它。响应仍然先构造 BaseClusteringResponse（形状校验
# 不变），再 model_dump + 挂上顶层 build_identity 返回。schemas.py 本轮不动。
@app.post("/ai-worker/clustering")
async def ai_worker_clustering(
    items: List[Dict[str, Any]],
    config: BaseClusteringConfig = None,
    optimization: OptimizationConfig = None,
    content_analysis: ContentAnalysisConfig = None,
    return_embeddings: bool = Query(False, description="是否返回原始嵌入向量"),
    return_reduced_embeddings: bool = Query(True, description="是否返回降维后向量"),
    _: None = Depends(verify_token),
):
    """
    AI Worker专用聚类端点 - 与后端系统完美集成
    
    自动检测并处理以下AI Worker数据格式：
    - 简化格式: [{"id": 1, "embedding": [...]}]
    - 扩展格式: [{"id": 1, "embedding": [...], "title": "...", "url": "..."}]
    - 完整格式: [{"id": 1, "title": "...", "content": "...", "embedding": [...], ...}]
    """
    print(f"[AIWorkerClustering] 收到请求：{len(items)} 个AI Worker数据项")
    
    try:
        from .schemas import DataFormatConverter
        
        # 自动检测AI Worker数据格式
        detected_format = DataFormatConverter.detect_format(items)
        print(f"[AIWorkerClustering] 检测到格式: {detected_format}")
        
        if not detected_format.startswith('ai_worker') and 'embedding' not in items[0]:
            raise ValueError("输入数据必须包含嵌入向量字段")
        
        # 使用统一管道处理
        result = await process_clustering_request(
            items=items,
            config=config,
            optimization=optimization,
            content_analysis=content_analysis,
            model_components=None,
            data_type=detected_format if detected_format.startswith('ai_worker') else 'vectors'
        )
        
        # 构建AI Worker兼容响应
        response = BaseClusteringResponse(**result)
        
        # 添加AI Worker特定的元数据
        response.model_info = {
            **(response.model_info or {}),
            "ai_worker_compatible": True,
            "detected_format": detected_format,
            "backend_integration": "完全兼容"
        }
        
        # 处理可选数据
        if return_embeddings:
            response.embeddings = [item['embedding'] for item in items]
        
        if not return_reduced_embeddings:
            response.reduced_embeddings = None
        
        print(f"[AIWorkerClustering] 处理完成，发现 {len(response.clusters)} 个聚类")

        # build_identity 挂在响应顶层，与 config_used 明确分开：config_used 是"配置"，
        # 它是"镜像身份"。旧镜像不会有这个字段，调用方据此识别"镜像没推成功"。
        # mode="json" 出来的就是 JSON 安全类型（与原先 response_model 的序列化口径一致），
        # 不再多过一遍 jsonable_encoder。
        payload = response.model_dump(mode="json")
        payload[BUILD_IDENTITY_FIELD] = get_build_identity()
        return JSONResponse(content=payload)
        
    except Exception as e:
        print(f"[AIWorkerClustering] 处理错误: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"AI Worker聚类失败: {str(e)}"
        )

# ============================================================================
# 核心端点 3: 智能自动检测聚类
# ============================================================================

# response_model 去掉的原因同 /ai-worker/clustering（要能带上顶层 build_identity）。
# 这个端点 backend 侧当前零调用，但归属另一次决策，本轮只给它补上同样的标识字段。
@app.post("/clustering/auto")
async def auto_detect_clustering(
    request: FlexibleClusteringRequest,
    _: None = Depends(verify_token),
):
    """
    智能聚类端点 - 自动检测数据格式
    
    支持所有数据格式的自动检测和处理：
    - AI Worker格式（简化、扩展、完整）
    - 标准向量格式
    - 纯文本格式
    """
    print(f"[AutoClustering] 收到智能检测请求：{len(request.items)} 个数据项")
    
    try:
        from .schemas import DataFormatConverter
        
        # 自动检测数据格式
        detected_format = DataFormatConverter.detect_format(request.items)
        print(f"[AutoClustering] 自动检测到格式: {detected_format}")
        
        # 选择适当的模型组件
        model_components = None
        if detected_format == 'text_item':
            # 只有纯文本需要生成嵌入
            from .dependencies import get_embedding_model
            model_components = await get_embedding_model()
        
        # 使用统一管道处理
        result = await process_clustering_request(
            items=request.items,
            config=request.config,
            optimization=request.optimization,
            content_analysis=request.content_analysis,
            model_components=model_components,
            data_type=detected_format
        )
        
        # 构建响应
        response = BaseClusteringResponse(**result)
        
        # 添加自动检测的元数据
        if request.include_ai_worker_metadata:
            response.model_info = {
                **(response.model_info or {}),
                "auto_detected_format": detected_format,
                "intelligent_processing": True,
                "original_format_preserved": request.preserve_original_format
            }
        
        # 处理可选数据
        if not request.return_embeddings:
            response.embeddings = None
        
        if not request.return_reduced_embeddings:
            response.reduced_embeddings = None
        
        print(f"[AutoClustering] 智能处理完成，发现 {len(response.clusters)} 个聚类")

        payload = response.model_dump(mode="json")
        payload[BUILD_IDENTITY_FIELD] = get_build_identity()
        return JSONResponse(content=payload)

    except Exception as e:
        print(f"[AutoClustering] 处理错误: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"智能聚类失败: {str(e)}"
        )

# ============================================================================
# 监控和配置端点
# ============================================================================

@app.get("/metrics")
async def get_metrics():
    """获取系统指标"""
    return {
        "embedding_model": settings.embedding_model_name,
        "clustering_algorithm": "UMAP + HDBSCAN",
        "supported_formats": [
            "ai_worker_embedding",
            "ai_worker_embedding_extended", 
            "ai_worker_article",
            "vector_item",
            "text_item"
        ],
        "optimization_available": True,
        "content_analysis_available": True
    }

@app.get("/config")
async def get_config():
    """获取当前配置"""
    return {
        "embedding_model": settings.embedding_model_name,
        "expected_embedding_dimensions": getattr(settings, 'expected_embedding_dimensions', 384),
        "default_clustering_config": {
            "umap_n_components": 10,
            "umap_n_neighbors": 15,
            "umap_min_dist": 0.0,
            "umap_metric": "cosine",
            "hdbscan_min_cluster_size": 5,
            "hdbscan_min_samples": 3,
            "hdbscan_metric": "euclidean"
        }
    } 