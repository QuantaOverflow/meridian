"""
聚类算法模块 - 不降维，余弦距离 + average linkage 阈值凝聚聚类
（2026-09-05 取代 UMAP+HDBSCAN；旧实现 2026-09-24 删除，见 git 历史与 docs/adr/0003-cluster-as-brief-block.md）
"""
import numpy as np
from typing import Dict, Any, Tuple
import logging
import warnings
from dataclasses import dataclass

# 抑制sklearn弃用警告
warnings.filterwarnings("ignore", category=FutureWarning, module="sklearn")

# sklearn 懒加载：启动时只用 find_spec 快速探测可用性(不执行模块/不付 import 成本)，
# 真正 import 推迟到首次聚类（perform_agglomerative_clustering 内）。
import importlib.util
CLUSTERING_AVAILABLE = importlib.util.find_spec("sklearn") is not None
if not CLUSTERING_AVAILABLE:
    logging.warning("聚类依赖未安装: scikit-learn")


def _load_clustering_libs() -> None:
    """后台预热：提前付 sklearn 的 import 成本，免得落到首个聚类请求上。幂等。"""
    import sklearn.cluster  # noqa: F401

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


@dataclass
class ClusteringConfig:
    """聚类算法配置"""
    
    # 算法（2026-09-05 起）：不降维，余弦距离矩阵 + average linkage 阈值聚类，取代 UMAP+HDBSCAN。
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

    # 'average' | 'complete'。见上方算法注释里的 complete 实测。
    agglomerative_linkage: str = 'average'


def preprocess_embeddings(embeddings: np.ndarray) -> np.ndarray:
    """L2 归一化，之后点积即余弦"""
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    return embeddings / (norms + 1e-8)


def perform_agglomerative_clustering(
    embeddings: np.ndarray,
    config: ClusteringConfig
) -> Tuple[np.ndarray, Any]:
    """余弦距离矩阵 + average linkage 阈值聚类。不降维、无随机性。

    **小于 `agglomerative_min_cluster_size` 篇的簇整个记为 -1（噪声）**。下游 `clusterId < 0` 直接跳过，所以这就是「不进简报」。
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


def cluster_embeddings(
    embeddings: np.ndarray,
    config: ClusteringConfig
) -> Dict[str, Any]:
    """完整的聚类流程：L2 归一化 -> 凝聚聚类 -> 统计"""
    logger.info(f"开始聚类流程: {embeddings.shape}")

    processed_embeddings = preprocess_embeddings(embeddings)
    cluster_labels, _ = perform_agglomerative_clustering(processed_embeddings, config)

    unique_labels = np.unique(cluster_labels)
    n_clusters = len(unique_labels) - (1 if -1 in unique_labels else 0)
    n_outliers = np.sum(cluster_labels == -1)

    # 计算每个簇的大小
    cluster_sizes = {}
    for label in unique_labels:
        if label != -1:  # 排除异常点
            cluster_sizes[int(label)] = int(np.sum(cluster_labels == label))

    total_samples = int(len(embeddings))
    clustering_stats = {
        "n_samples": total_samples,
        "n_clusters": n_clusters,
        "n_outliers": n_outliers,
        "outlier_ratio": float(n_outliers / total_samples),
        "cluster_sizes": convert_numpy_types(cluster_sizes),
    }

    result = {
        'cluster_labels': [int(label) for label in cluster_labels],
        'clustering_stats': clustering_stats,
        'config_used': {
            'agglomerative_threshold': float(config.agglomerative_threshold),
            'agglomerative_linkage': config.agglomerative_linkage,
            'agglomerative_min_cluster_size': int(config.agglomerative_min_cluster_size),
        }
    }

    # 使用convert_numpy_types确保没有遗漏的numpy类型
    return convert_numpy_types(result)
