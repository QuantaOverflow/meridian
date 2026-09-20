"""
聚类算法模块 - 实现UMAP降维 + HDBSCAN聚类
基于reportV5.md的实现，包含参数网格搜索优化
"""
import numpy as np
from typing import Dict, List, Any, Optional, Tuple
import logging
import warnings
from dataclasses import dataclass

# 抑制sklearn弃用警告
warnings.filterwarnings("ignore", category=FutureWarning, module="sklearn")
warnings.filterwarnings("ignore", category=UserWarning, module="umap")

# 重聚类库(umap→pynndescent/sklearn ~16s)是 uvicorn 冷启动慢的真正大头，改懒加载：
# 启动时只用 find_spec 快速探测可用性(不执行模块/不付 import 成本)，真正 import 推迟到首次聚类。
# 详见 memory: ml-service-cold-start。
import importlib.util
CLUSTERING_AVAILABLE = all(
    importlib.util.find_spec(_m) is not None for _m in ("umap", "hdbscan", "sklearn")
)
if not CLUSTERING_AVAILABLE:
    logging.warning("聚类依赖未安装: umap-learn, hdbscan, scikit-learn")

# 懒加载占位：首次聚类时由 _load_clustering_libs() 填充为真实模块
umap = None
hdbscan = None
validity_index = None


def _load_clustering_libs() -> None:
    """首次聚类时才 import 重库(~16s)并填模块全局；幂等。把成本从 uvicorn 启动挪到首个聚类请求。"""
    global umap, hdbscan, validity_index
    if umap is not None:
        return
    import umap as _umap
    import hdbscan as _hdbscan
    from hdbscan.validity import validity_index as _validity_index
    umap = _umap
    hdbscan = _hdbscan
    validity_index = _validity_index

logger = logging.getLogger(__name__)


def convert_numpy_types(obj: Any) -> Any:
    """递归转换numpy类型为Python原生类型，解决序列化问题"""
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {key: convert_numpy_types(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_types(item) for item in obj]
    elif isinstance(obj, tuple):
        return tuple(convert_numpy_types(item) for item in obj)
    else:
        return obj


def get_safe_n_neighbors(n_samples: int, desired_n_neighbors: int) -> int:
    """为小数据集计算安全的n_neighbors值"""
    # UMAP要求n_neighbors < n_samples
    # 为了稳定性，我们确保至少有足够的间隔
    if n_samples <= 3:
        return max(1, n_samples - 1)
    elif n_samples <= 10:
        return min(desired_n_neighbors, n_samples - 2)
    else:
        return min(desired_n_neighbors, n_samples - 1)


def get_safe_min_cluster_size(n_samples: int, desired_min_cluster_size: int) -> int:
    """为小数据集计算安全的最小簇大小"""
    # 确保最小簇大小不会太大导致无法聚类
    if n_samples <= 5:
        return 2
    elif n_samples <= 10:
        return min(3, desired_min_cluster_size)
    else:
        return desired_min_cluster_size


@dataclass
class ClusteringConfig:
    """聚类算法配置"""
    
    # UMAP参数
    umap_n_components: int = 10  # 参考reportV5.md，使用10维
    umap_n_neighbors: int = 15  # 邻居数量
    umap_min_dist: float = 0.0  # 参考reportV5.md，使用0.0
    umap_metric: str = 'cosine'  # 距离度量
    
    # HDBSCAN参数
    hdbscan_min_cluster_size: int = 5  # 最小簇大小
    hdbscan_min_samples: int = 3  # 最小样本数
    hdbscan_metric: str = 'euclidean'  # 距离度量
    hdbscan_cluster_selection_method: str = 'eom'  # 簇选择方法
    hdbscan_cluster_selection_epsilon: float = 0.0  # epsilon参数
    
    # 聚类算法选择（2026-09-05）
    # 'umap_hdbscan'        原实现：384 维 → UMAP 5 维 → HDBSCAN 密度聚类
    # 'agglomerative_cosine' 现生产：不降维，余弦距离矩阵 + average linkage 阈值聚类
    #
    # 换算法的理由（F1/F2 两窗人读金标实测，产品口径：<3 篇的簇与事件都不计）：
    # 读数不在这里存——这里曾存一份三个多月没人核对、与 ADR 实测对不上的读数表，
    # 就是下一个陷阱。现场跑 scripts/eval/clustering/product-score.ts 拿读数，
    # 权威口径见 docs/adr/0003-cluster-as-brief-block.md。
    #
    # 两处机制各治一个病：
    #  · 去 UMAP —— 它保近邻不保全局距离，把「真成员离簇心 0.027 / 外来篇 0.149」这个
    #    98% 可分的信号打散成 45.5% 重叠。副产品：不过 UMAP 即无随机性，跨种子稳定性问题消失。
    #  · HDBSCAN → 阈值型凝聚 —— HDBSCAN 判局部密度，一堆同题材的孤篇挤在一起也算密度区，
    #    照样成簇；它没有「要多像才算同一件事」这个概念。凝聚认绝对相似度：同事件报道余弦
    #    ≈0.92 以上，同题材不同事 ≈0.85-0.88，阈值卡在中间。
    #  · 用 average 不用 complete：complete 要求组内所有对都达标，一件事里只要有一篇写法特别
    #    （NASA 那件事有篇只写 "$4.3bn cosmic secrets"）就被踢出去，实测跨簇数 1.20 vs 1.08。
    clustering_algorithm: str = 'agglomerative_cosine'

    # 成簇的最小篇数。低于此数的簇整个记为噪声(-1)，不进简报。
    #
    # 3 而不是 2：2 篇的簇**本来就进不了简报**——选择层按 blockScore 排序取前 25，两窗实测
    # 前 25 名里 2 篇的簇一个都没有（第 25 名分数 3.40/3.48，而 2 篇 2 源只有 2.38、
    # 2 篇 1 源 1.79，够不着）。砍掉它们不损失任何实际会被读到的内容，却顺手带走了大部分
    # 题材袋（只有题材没有事的凑堆簇）：
    #
    #            砍前簇数  砍前题材袋   砍后簇数  砍后题材袋
    #   F2         157      32 (20%)      69       5 (7%)
    #   F1         124      15 (12%)      62       0 (0%)
    #
    # 机制：新聚类阈值卡在 0.10，凑不出大杂堆，剩下的题材袋几乎全是 2 篇的边界样本
    # （「两篇报道算不算同一件事」本来就是最没有确定答案的形态）。所以这里是用产品口径
    # 的截断解决它，而不是再加一层判别——后者实测怎么调都在 0.41 召回附近打转。
    agglomerative_min_cluster_size: int = 3

    # average linkage 的合并阈值，作用在余弦距离 (1-cos) 上。
    #
    # 0.10 是「交付优先」的操作点。往左（更严）纯度涨、漏与碎都涨；前沿曲线的具体读数不在
    # 这里存，现场跑 scripts/eval/clustering/product-score.ts，权威口径见
    # docs/adr/0003-cluster-as-brief-block.md。
    # 纯度与交付在这条曲线上死死绑定：试过四种绕法（源特征剥离 / 合并守卫 / 互为近邻 /
    # 核心-挂靠），全部落在前沿上或前沿下，机制见 docs/engineering-notes/。
    #
    # 不取更严阈值的理由是顺序不是优劣：更严的阈值纯度更高但事件被切得更碎（完整率下降），
    # 而「把碎簇合回来」那一层还没建。合并层建好并验过判官后再左移；候选生成已实测：
    # 簇质心余弦 ≥0.90 筛出 60-80 对/期，召回 1.00。
    agglomerative_threshold: float = 0.10

    # 'average' | 'complete'。见 clustering_algorithm 注释里的 complete 实测。
    agglomerative_linkage: str = 'average'

    # 其他配置
    normalize_embeddings: bool = True
    remove_outliers: bool = False


@dataclass
class GridSearchConfig:
    """网格搜索配置 - 基于reportV5.md实现"""
    
    # UMAP参数网格
    umap_n_neighbors: List[int] = None
    umap_n_components: int = 10  # 固定使用10维
    umap_min_dist: float = 0.0  # 固定使用0.0
    umap_metric: str = 'cosine'  # 固定使用cosine
    
    # HDBSCAN参数网格
    hdbscan_min_cluster_size: List[int] = None
    hdbscan_min_samples: List[int] = None
    hdbscan_epsilon: List[float] = None
    hdbscan_metric: str = 'euclidean'  # 固定使用euclidean
    
    def __post_init__(self):
        """设置默认值"""
        if self.umap_n_neighbors is None:
            self.umap_n_neighbors = [10, 15, 20, 30]
        if self.hdbscan_min_cluster_size is None:
            self.hdbscan_min_cluster_size = [5, 8, 10, 15]
        if self.hdbscan_min_samples is None:
            self.hdbscan_min_samples = [2, 3, 5]
        if self.hdbscan_epsilon is None:
            self.hdbscan_epsilon = [0.1, 0.2, 0.3]


def validate_clustering_availability():
    """验证聚类依赖是否可用"""
    if not CLUSTERING_AVAILABLE:
        raise ImportError(
            "聚类功能需要安装: pip install umap-learn hdbscan scikit-learn"
        )


def preprocess_embeddings(
    embeddings: np.ndarray, 
    normalize: bool = True
) -> np.ndarray:
    """预处理嵌入向量"""
    if normalize:
        # L2归一化
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        normalized_embeddings = embeddings / (norms + 1e-8)
        return normalized_embeddings
    return embeddings


def perform_umap_reduction(
    embeddings: np.ndarray,
    config: ClusteringConfig
) -> Tuple[np.ndarray, Any]:
    """使用UMAP进行降维，处理小数据集情况"""
    validate_clustering_availability()
    
    n_samples = embeddings.shape[0]
    
    # 为小数据集调整参数
    safe_n_neighbors = get_safe_n_neighbors(n_samples, config.umap_n_neighbors)
    safe_n_components = min(config.umap_n_components, n_samples - 1, embeddings.shape[1])
    
    logger.info(f"UMAP降维: {embeddings.shape} -> {safe_n_components}维 (n_neighbors={safe_n_neighbors})")
    
    # 特殊处理极小数据集
    if n_samples <= 3:
        logger.warning(f"数据集过小 (n_samples={n_samples})，跳过UMAP降维")
        # 返回原始数据或简单投影
        if embeddings.shape[1] > safe_n_components:
            return embeddings[:, :safe_n_components], None
        else:
            return embeddings, None
    
    try:
        reducer = umap.UMAP(
            n_components=safe_n_components,
            n_neighbors=safe_n_neighbors,
            min_dist=config.umap_min_dist,
            metric=config.umap_metric,
            random_state=42,  # 确保可重现
            verbose=False  # 减少输出
        )
        
        reduced_embeddings = reducer.fit_transform(embeddings)
        
        logger.info(f"UMAP完成: {reduced_embeddings.shape}")
        return reduced_embeddings, reducer
        
    except Exception as e:
        logger.error(f"UMAP降维失败: {e}")
        # 回退策略：返回原始嵌入的前几维
        fallback_dims = min(safe_n_components, embeddings.shape[1])
        logger.warning(f"使用回退策略：返回前{fallback_dims}维")
        return embeddings[:, :fallback_dims], None


def perform_agglomerative_clustering(
    embeddings: np.ndarray,
    config: ClusteringConfig
) -> Tuple[np.ndarray, Any]:
    """余弦距离矩阵 + average linkage 阈值聚类。不降维、无随机性。

    与 HDBSCAN 的口径对齐：**小于 `agglomerative_min_cluster_size` 篇的簇整个记为 -1
    （噪声）**。下游 `clusterId < 0` 直接跳过，所以这就是「不进简报」。
    评估口径同步（product-score.ts 的 `--min`）。

    内存：距离矩阵是 O(n²)。1500 篇约 18 MB，ml-service 跑 standard-1（4 GiB）无压力；
    上到 20000 篇会是 3.2 GB，届时要改分块或换近似近邻。
    """
    from sklearn.cluster import AgglomerativeClustering

    n_samples = embeddings.shape[0]
    if n_samples <= 2:
        logger.warning(f"数据集过小 (n_samples={n_samples})，全部记为噪声")
        return np.full(n_samples, -1, dtype=int), None

    # 余弦距离矩阵。embeddings 已在 preprocess 里 L2 归一化，点积即余弦。
    sim = embeddings @ embeddings.T
    dist = 1.0 - sim
    dist = np.ascontiguousarray(np.clip((dist + dist.T) / 2.0, 0.0, 2.0))
    np.fill_diagonal(dist, 0.0)

    logger.info(
        f"凝聚聚类: {embeddings.shape} (linkage={config.agglomerative_linkage}, "
        f"threshold={config.agglomerative_threshold})"
    )
    model = AgglomerativeClustering(
        n_clusters=None,
        distance_threshold=float(config.agglomerative_threshold),
        metric="precomputed",
        linkage=config.agglomerative_linkage,
    ).fit(dist)

    labels = model.labels_.astype(int)
    sizes = np.bincount(labels)
    too_small = sizes[labels] < max(2, int(config.agglomerative_min_cluster_size))
    labels = np.where(too_small, -1, labels)

    n_clusters = len(set(int(x) for x in labels if x >= 0))
    logger.info(
        f"凝聚聚类完成: {n_clusters}个簇, {int(too_small.sum())}篇落在 "
        f"<{config.agglomerative_min_cluster_size} 篇的簇里（记为噪声，不进简报）"
    )
    return labels, model


def perform_hdbscan_clustering(
    reduced_embeddings: np.ndarray,
    config: ClusteringConfig
) -> Tuple[np.ndarray, Any]:
    """使用HDBSCAN进行聚类，处理小数据集情况"""
    validate_clustering_availability()
    
    n_samples = reduced_embeddings.shape[0]
    
    # 为小数据集调整参数
    safe_min_cluster_size = get_safe_min_cluster_size(n_samples, config.hdbscan_min_cluster_size)
    safe_min_samples = min(config.hdbscan_min_samples, safe_min_cluster_size - 1)
    safe_min_samples = max(1, safe_min_samples)  # 确保至少为1
    
    logger.info(f"HDBSCAN聚类: {reduced_embeddings.shape} (min_cluster_size={safe_min_cluster_size}, min_samples={safe_min_samples})")
    
    # 特殊处理极小数据集
    if n_samples <= 3:
        logger.warning(f"数据集过小 (n_samples={n_samples})，所有点归为一类")
        return np.zeros(n_samples, dtype=int), None
    
    try:
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=safe_min_cluster_size,
            min_samples=safe_min_samples,
            metric=config.hdbscan_metric,
            cluster_selection_method=config.hdbscan_cluster_selection_method,
            cluster_selection_epsilon=config.hdbscan_cluster_selection_epsilon,
            prediction_data=True,  # 启用预测数据
            core_dist_n_jobs=1  # 避免并行问题
        )
        
        cluster_labels = clusterer.fit_predict(reduced_embeddings)
        
        # 统计聚类结果
        unique_labels = np.unique(cluster_labels)
        n_clusters = len(unique_labels) - (1 if -1 in unique_labels else 0)
        n_outliers = np.sum(cluster_labels == -1)
        
        logger.info(f"聚类完成: {n_clusters}个簇, {n_outliers}个异常点")
        
        return cluster_labels, clusterer
        
    except Exception as e:
        logger.error(f"HDBSCAN聚类失败: {e}")
        # 回退策略：所有点归为一类
        logger.warning("使用回退策略：所有点归为一类")
        return np.zeros(n_samples, dtype=int), None


def postprocess_labels(
    embeddings: np.ndarray,
    labels: np.ndarray,
    prune_threshold: Optional[float] = None,
    dissolve_threshold: Optional[float] = None,
) -> np.ndarray:
    """确定性后处理:在原始嵌入空间用余弦相似度清理 HDBSCAN 结果。

    - 低内聚解散(治噪音巨团 B):簇内成员到质心的平均余弦 < dissolve_threshold,整簇打回噪音(-1)。
    - 质心剪枝(治污染 A):成员到本簇质心余弦 < prune_threshold,该成员打回噪音(-1)。

    两阈值均为 None 时原样返回。被清理的成员标 -1(不重新归类)。
    """
    if prune_threshold is None and dissolve_threshold is None:
        return labels
    labels = labels.copy()
    # L2 归一化 → 余弦相似度=点积
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    units = embeddings / np.clip(norms, 1e-12, None)
    for cid in np.unique(labels):
        if cid == -1:
            continue
        idx = np.where(labels == cid)[0]
        if idx.size == 0:
            continue
        centroid = units[idx].mean(axis=0)
        cnorm = np.linalg.norm(centroid)
        if cnorm < 1e-12:
            continue
        centroid = centroid / cnorm
        sims = units[idx] @ centroid  # 每个成员到质心的余弦
        # 解散:整簇内聚过低(用剪枝前的内聚判,巨团 93% 单例→内聚极低→整簇消失)
        if dissolve_threshold is not None and float(sims.mean()) < dissolve_threshold:
            labels[idx] = -1
            continue
        # 剪枝:踢掉离群成员
        if prune_threshold is not None:
            labels[idx[sims < prune_threshold]] = -1
    return labels


def optimize_clusters(
    embeddings: np.ndarray,
    grid_config: Optional[GridSearchConfig] = None
) -> Tuple[Dict[str, Any], float]:
    """
    网格搜索优化聚类参数 - 基于reportV5.md实现
    
    Args:
        embeddings: 输入的嵌入向量
        grid_config: 网格搜索配置
        
    Returns:
        最佳参数配置和对应的DBCV分数
    """
    validate_clustering_availability()
    
    n_samples = embeddings.shape[0]
    
    # 检查数据集大小，小数据集直接返回默认配置
    if n_samples <= 5:
        logger.warning(f"数据集过小 (n_samples={n_samples})，跳过参数优化，使用默认配置")
        default_config = ClusteringConfig()
        
        # 为小数据集调整默认参数
        safe_n_neighbors = get_safe_n_neighbors(n_samples, default_config.umap_n_neighbors)
        safe_min_cluster_size = get_safe_min_cluster_size(n_samples, default_config.hdbscan_min_cluster_size)
        
        best_params = {
            "umap": {
                "n_neighbors": safe_n_neighbors,
                "n_components": min(default_config.umap_n_components, n_samples - 1),
                "min_dist": default_config.umap_min_dist,
                "metric": default_config.umap_metric
            },
            "hdbscan": {
                "min_cluster_size": safe_min_cluster_size,
                "min_samples": min(default_config.hdbscan_min_samples, safe_min_cluster_size - 1),
                "epsilon": default_config.hdbscan_cluster_selection_epsilon,
                "metric": default_config.hdbscan_metric
            }
        }
        return best_params, -1.0
    
    if grid_config is None:
        grid_config = GridSearchConfig()
    
    # 为当前数据集大小调整搜索网格
    safe_n_neighbors_list = [
        get_safe_n_neighbors(n_samples, n) for n in grid_config.umap_n_neighbors
    ]
    safe_n_neighbors_list = list(set(safe_n_neighbors_list))  # 去重
    
    safe_min_cluster_sizes = [
        get_safe_min_cluster_size(n_samples, size) for size in grid_config.hdbscan_min_cluster_size
    ]
    safe_min_cluster_sizes = list(set(safe_min_cluster_sizes))  # 去重
    
    best_score = -1
    best_params = None
    
    logger.info(f"开始网格搜索参数优化 (数据集大小: {n_samples})...")
    logger.info(f"调整后的搜索空间: n_neighbors={safe_n_neighbors_list}, min_cluster_sizes={safe_min_cluster_sizes}")
    
    # 预处理嵌入
    processed_embeddings = preprocess_embeddings(embeddings, normalize=True)
    
    total_combinations = (
        len(safe_n_neighbors_list) * 
        len(safe_min_cluster_sizes) * 
        len(grid_config.hdbscan_min_samples) * 
        len(grid_config.hdbscan_epsilon)
    )
    
    current_combination = 0
    
    # 网格搜索UMAP和HDBSCAN参数
    for n_neighbors in safe_n_neighbors_list:
        # 对每个n_neighbors配置拟合UMAP一次
        logger.info(f"测试UMAP n_neighbors={n_neighbors}")
        
        safe_n_components = min(grid_config.umap_n_components, n_samples - 1, embeddings.shape[1])
        
        try:
            reducer = umap.UMAP(
                n_neighbors=n_neighbors,
                n_components=safe_n_components,
                min_dist=grid_config.umap_min_dist,
                metric=grid_config.umap_metric,
                random_state=42,
                verbose=False
            )
            reduced_data = reducer.fit_transform(processed_embeddings)
        except Exception as e:
            logger.warning(f"UMAP降维失败 (n_neighbors={n_neighbors}): {e}")
            continue
        
        for min_cluster_size in safe_min_cluster_sizes:
            for min_samples in grid_config.hdbscan_min_samples:
                # 确保 min_samples 不会太大
                safe_min_samples = min(min_samples, min_cluster_size - 1, n_samples - 1)
                safe_min_samples = max(1, safe_min_samples)
                
                for epsilon in grid_config.hdbscan_epsilon:
                    current_combination += 1
                    
                    logger.debug(f"测试组合 {current_combination}/{total_combinations}: "
                               f"n_neighbors={n_neighbors}, min_cluster_size={min_cluster_size}, "
                               f"min_samples={safe_min_samples}, epsilon={epsilon}")
                    
                    try:
                        # 使用HDBSCAN进行聚类
                        clusterer = hdbscan.HDBSCAN(
                            min_cluster_size=min_cluster_size,
                            min_samples=safe_min_samples,
                            cluster_selection_epsilon=epsilon,
                            metric=grid_config.hdbscan_metric,
                            prediction_data=True,
                            core_dist_n_jobs=1  # 避免并行问题
                        )
                        
                        cluster_labels = clusterer.fit_predict(reduced_data)
                        
                        # 跳过全是噪声的结果
                        if np.all(cluster_labels == -1):
                            logger.debug("跳过：所有点都是噪声")
                            continue
                        
                        # 使用DBCV评估聚类质量
                        valid_points = cluster_labels != -1
                        if (valid_points.sum() > 1 and 
                            len(set(cluster_labels[valid_points])) > 1):
                            try:
                                # 转换为float64以避免精度问题
                                reduced_data_64 = reduced_data[valid_points].astype(np.float64)
                                score = validity_index(
                                    reduced_data_64, 
                                    cluster_labels[valid_points]
                                )
                                
                                if score > best_score:
                                    best_score = score
                                    best_params = {
                                        "umap": {
                                            "n_neighbors": n_neighbors,
                                            "n_components": safe_n_components,
                                            "min_dist": grid_config.umap_min_dist,
                                            "metric": grid_config.umap_metric
                                        },
                                        "hdbscan": {
                                            "min_cluster_size": min_cluster_size,
                                            "min_samples": safe_min_samples,
                                            "epsilon": epsilon,
                                            "metric": grid_config.hdbscan_metric
                                        },
                                        "clustering_stats": {
                                            "n_clusters": len(set(cluster_labels[valid_points])),
                                            "n_outliers": int(np.sum(cluster_labels == -1)),
                                            "dbcv_score": float(score)
                                        }
                                    }
                                    logger.info(f"新的最佳配置: DBCV={score:.4f}")
                                    
                            except Exception as e:
                                # DBCV有时会在奇怪的簇形状上失败
                                logger.debug(f"DBCV计算失败: {e}")
                                continue
                                
                    except Exception as e:
                        logger.debug(f"聚类失败: {e}")
                        continue
    
    if best_params is None:
        logger.warning("未找到有效的聚类参数组合，使用默认配置")
        # 返回安全的默认配置
        default_config = ClusteringConfig()
        safe_n_neighbors = get_safe_n_neighbors(n_samples, default_config.umap_n_neighbors)
        safe_min_cluster_size = get_safe_min_cluster_size(n_samples, default_config.hdbscan_min_cluster_size)
        
        best_params = {
            "umap": {
                "n_neighbors": safe_n_neighbors,
                "n_components": min(default_config.umap_n_components, n_samples - 1),
                "min_dist": default_config.umap_min_dist,
                "metric": default_config.umap_metric
            },
            "hdbscan": {
                "min_cluster_size": safe_min_cluster_size,
                "min_samples": min(default_config.hdbscan_min_samples, safe_min_cluster_size - 1),
                "epsilon": default_config.hdbscan_cluster_selection_epsilon,
                "metric": default_config.hdbscan_metric
            }
        }
        best_score = -1.0
    
    logger.info(f"参数优化完成: 最佳DBCV分数={best_score:.4f}")
    return best_params, float(best_score)


def cluster_embeddings_with_optimization(
    embeddings: np.ndarray,
    use_optimization: bool = False,
    grid_config: Optional[GridSearchConfig] = None
) -> Dict[str, Any]:
    """
    带参数优化的聚类流程
    
    Args:
        embeddings: 输入的嵌入向量
        use_optimization: 是否使用参数优化
        grid_config: 网格搜索配置
        
    Returns:
        包含聚类结果的字典
    """
    _load_clustering_libs()  # 首次调用付重库 import 成本(~16s),之后幂等返回
    logger.info(f"开始{'优化'if use_optimization else '标准'}聚类流程: {embeddings.shape}")
    
    if use_optimization:
        # 使用网格搜索找到最佳参数
        best_params, best_score = optimize_clusters(embeddings, grid_config)
        
        # 使用最佳参数进行最终聚类
        config = ClusteringConfig()
        config.umap_n_neighbors = best_params["umap"]["n_neighbors"]
        config.umap_n_components = best_params["umap"]["n_components"]
        config.umap_min_dist = best_params["umap"]["min_dist"]
        config.umap_metric = best_params["umap"]["metric"]
        config.hdbscan_min_cluster_size = best_params["hdbscan"]["min_cluster_size"]
        config.hdbscan_min_samples = best_params["hdbscan"]["min_samples"]
        config.hdbscan_cluster_selection_epsilon = best_params["hdbscan"]["epsilon"]
        config.hdbscan_metric = best_params["hdbscan"]["metric"]
        
        result = cluster_embeddings(embeddings, config)
        result['optimization'] = {
            'used': True,
            'best_params': convert_numpy_types(best_params),
            'best_dbcv_score': float(best_score) if best_score is not None else None
        }
        
    else:
        # 使用默认参数
        result = cluster_embeddings(embeddings, None)
        result['optimization'] = {'used': False}
    
    # 确保整个结果都经过类型转换
    return convert_numpy_types(result)


def cluster_embeddings(
    embeddings: np.ndarray,
    config: Optional[ClusteringConfig] = None
) -> Dict[str, Any]:
    """
    完整的聚类流程：预处理 -> UMAP降维 -> HDBSCAN聚类
    
    Args:
        embeddings: 输入的嵌入向量 [n_samples, n_features]
        config: 聚类配置
        
    Returns:
        包含聚类结果的字典
    """
    _load_clustering_libs()  # 首次调用付重库 import 成本(~16s),之后幂等返回
    if config is None:
        config = ClusteringConfig()
    
    logger.info(f"开始聚类流程: {embeddings.shape}")
    
    # 1. 预处理
    processed_embeddings = preprocess_embeddings(
        embeddings, 
        normalize=config.normalize_embeddings
    )
    
    # 2-3. 聚类。两条路互斥：
    #   agglomerative_cosine（现生产）不降维，直接在原始余弦距离上做阈值聚类
    #   umap_hdbscan（旧实现）保留，供对照与回滚
    if config.clustering_algorithm == 'agglomerative_cosine':
        reduced_embeddings = processed_embeddings  # 未降维；字段名沿用，避免改下游契约
        cluster_labels, clusterer = perform_agglomerative_clustering(
            processed_embeddings,
            config
        )
    else:
        reduced_embeddings, reducer = perform_umap_reduction(
            processed_embeddings,
            config
        )
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
        if label != -1:  # 排除异常点
            cluster_sizes[int(label)] = int(np.sum(cluster_labels == label))
    
    # 计算DBCV分数（如果可能）
    # 只在 umap_hdbscan 下算：validity_index 假定欧氏空间且是密度聚类的内部指标，
    # 拿到 384 维余弦空间上既慢又无可比性。它只是诊断输出，不进任何决策。
    dbcv_score = None
    valid_points = cluster_labels != -1
    if (config.clustering_algorithm != 'agglomerative_cosine'
            and valid_points.sum() > 1 and len(set(cluster_labels[valid_points])) > 1):
        try:
            reduced_data_64 = reduced_embeddings[valid_points].astype(np.float64)
            dbcv_score = float(validity_index(reduced_data_64, cluster_labels[valid_points]))
        except Exception as e:
            logger.warning(f"DBCV计算失败: {e}")
    
    # 计算聚类质量指标 - 确保所有值都是Python原生类型
    total_samples = int(len(embeddings))
    outlier_ratio = float(n_outliers / total_samples)
    clustering_stats = {
        "n_samples": total_samples,
        "n_clusters": n_clusters,
        "n_outliers": n_outliers,
        "outlier_ratio": outlier_ratio,
        "cluster_sizes": convert_numpy_types(cluster_sizes),
        "dbcv_score": dbcv_score,
    }
    
    if config.remove_outliers:
        # 移除异常点
        non_outlier_mask = cluster_labels != -1
        cluster_labels = cluster_labels[non_outlier_mask]
        reduced_embeddings = reduced_embeddings[non_outlier_mask]
        logger.info(f"移除{n_outliers}个异常点")
    
    # 确保返回的所有数据都是Python原生类型
    result = {
        'cluster_labels': [int(label) for label in cluster_labels],
        'reduced_embeddings': reduced_embeddings.tolist(),
        'clustering_stats': clustering_stats,
        'config_used': {
            'umap_n_components': int(config.umap_n_components),
            'umap_n_neighbors': int(config.umap_n_neighbors),
            'umap_min_dist': float(config.umap_min_dist),
            'umap_metric': config.umap_metric,
            'hdbscan_min_cluster_size': int(config.hdbscan_min_cluster_size),
            'hdbscan_min_samples': int(config.hdbscan_min_samples),
            'hdbscan_epsilon': float(config.hdbscan_cluster_selection_epsilon),
            'hdbscan_metric': config.hdbscan_metric,
            'clustering_algorithm': config.clustering_algorithm,
            'agglomerative_threshold': float(config.agglomerative_threshold),
            'agglomerative_linkage': config.agglomerative_linkage,
            'agglomerative_min_cluster_size': int(config.agglomerative_min_cluster_size),
        }
    }
    
    # 使用convert_numpy_types确保没有遗漏的numpy类型
    return convert_numpy_types(result)


def analyze_cluster_content(
    texts: List[str],
    cluster_labels: np.ndarray,
    top_n: int = 5
) -> Dict[int, List[str]]:
    """
    分析每个簇的代表性内容
    
    Args:
        texts: 原始文本列表
        cluster_labels: 聚类标签
        top_n: 每个簇返回的文本数量
        
    Returns:
        每个簇的代表性文本
    """
    cluster_content = {}
    
    unique_labels = np.unique(cluster_labels)
    for label in unique_labels:
        if label == -1:  # 跳过异常点
            continue
            
        cluster_mask = cluster_labels == label
        cluster_texts = [texts[i] for i in np.where(cluster_mask)[0]]
        
        # 取前top_n个文本（简单策略，可以后续优化）
        cluster_content[int(label)] = cluster_texts[:top_n]
    
    return cluster_content 