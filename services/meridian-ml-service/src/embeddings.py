"""
嵌入向量生成和验证模块
合并了原embeddings.py和embedding_utils.py的核心功能
"""

# 惰性标注：让 torch.Tensor/torch.device 等标注变字符串、不在 import 时求值，
# 配合下方把 torch/transformers 移进函数体，使 import 本模块从 ~25s 降到 ~0s
# （uvicorn 才能秒绑 8080，不再撞 CF Container 就绪窗口）。详见 memory: ml-service-cold-start。
from __future__ import annotations

import threading
from functools import lru_cache
from typing import Any, List
import numpy as np
from tqdm import tqdm

from .config import settings

# 类型别名（torch.device 退化成 Any：这是赋值非标注，__future__ 不惰性化它，
# 必须避免模块级引用 torch，否则照样触发 eager import）
ModelComponents = tuple[Any, Any, Any]

# 后台预热线程（main.py lifespan）与首个请求可能同时进来加载：lru_cache 不防并发首调，
# 两个线程同时 import transformers 时后到的一方会拿到半初始化的模块，报
# "cannot import name 'AutoModel'"、首个 /embeddings 回 500（2026-09-25 容器实测复现）。
# 加锁让后到的一方等先到的加载完，再从缓存取。
_load_lock = threading.Lock()


def load_embedding_model() -> ModelComponents:
    """加载嵌入模型组件（带缓存、线程安全）"""
    with _load_lock:
        return _load_embedding_model()


@lru_cache(maxsize=1)
def _load_embedding_model() -> ModelComponents:
    # 重库懒加载：仅在真正加载模型时才 import（首请求或后台预热触发），不拖慢 uvicorn 启动
    import torch
    from transformers import AutoModel, AutoTokenizer

    model_name = settings.embedding_model_name
    print(f"正在加载嵌入模型: {model_name}")
    
    try:
        # 让transformers库自动处理缓存，不强制local_files_only
        # 这样可以先尝试缓存，如果失败再尝试在线下载
        tokenizer = AutoTokenizer.from_pretrained(
            model_name, 
            trust_remote_code=True
        )
        model = AutoModel.from_pretrained(
            model_name, 
            trust_remote_code=True
        )

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model.to(device)
        model.eval()
        
        print(f"嵌入模型 '{model_name}' 加载成功，设备: {device}")
        return tokenizer, model, device
        
    except Exception as e:
        print(f"错误: 模型加载失败: {e}")
        print(f"请确保模型已下载到缓存目录")
        # 打印调试信息
        import os
        print(f"环境变量 HF_HOME: {os.getenv('HF_HOME', 'Not set')}")
        print(f"环境变量 HF_HUB_CACHE: {os.getenv('HF_HUB_CACHE', 'Not set')}")
        print(f"环境变量 TRANSFORMERS_CACHE: {os.getenv('TRANSFORMERS_CACHE', 'Not set')}")
        raise Exception(f"Could not provide embedding model: {e}")

def _average_pool(last_hidden_states: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
    """平均池化辅助函数"""
    last_hidden = last_hidden_states.masked_fill(~attention_mask[..., None].bool(), 0.0)
    return last_hidden.sum(dim=1) / attention_mask.sum(dim=1)[..., None]

def compute_embeddings(
    texts: list[str],
    model_components: ModelComponents,
    batch_size: int = 32,
) -> np.ndarray:
    """计算文本嵌入向量"""
    import torch
    import torch.nn.functional as F

    tokenizer, model, device = model_components
    all_embeddings: list[np.ndarray] = []

    texts_to_embed = texts

    print(f"正在计算 {len(texts_to_embed)} 个文本的嵌入向量...")
    
    for i in tqdm(
        range(0, len(texts_to_embed), batch_size),
        desc="计算嵌入向量",
        leave=False,
    ):
        batch_texts = texts_to_embed[i : i + batch_size]
        
        try:
            batch_dict = tokenizer(
                batch_texts,
                max_length=512,
                padding=True,
                truncation=True,
                return_tensors="pt",
            ).to(device)
        except Exception as e:
            print(f"错误: 批次 {i} 分词失败: {e}")
            raise

        with torch.no_grad():
            try:
                outputs = model(**batch_dict)
                embeddings = _average_pool(
                    outputs.last_hidden_state, batch_dict["attention_mask"]
                )
            except Exception as e:
                print(f"错误: 批次 {i} 模型推理失败: {e}")
                raise

        embeddings = F.normalize(embeddings, p=2, dim=1)

        all_embeddings.append(embeddings.cpu().numpy())

    if not all_embeddings:
        print("警告: 没有生成嵌入向量")
        return np.empty((0, 0), dtype=np.float32)

    final_embeddings = np.vstack(all_embeddings)
    print(f"嵌入向量计算完成。形状: {final_embeddings.shape}")
    return final_embeddings

def validate_embeddings(embeddings: List[List[float]]) -> np.ndarray:
    """验证和转换嵌入向量"""
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
    
    # 检查嵌入范围（合理性检查）
    if np.any(np.abs(embeddings_array) > 100):
        print("警告: 检测到异常大的嵌入值，可能存在问题")
    
    return embeddings_array
