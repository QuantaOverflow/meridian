"""
嵌入向量生成和验证模块
合并了原embeddings.py和embedding_utils.py的核心功能
"""

from functools import lru_cache
from typing import Any, List, Tuple
import numpy as np
import torch
import torch.nn.functional as F
from tqdm import tqdm
from transformers import AutoModel, AutoTokenizer

from .config import settings

# 类型别名
ModelComponents = tuple[Any, Any, torch.device]

@lru_cache(maxsize=1)
def load_embedding_model() -> ModelComponents:
    """加载嵌入模型组件（带缓存）"""
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
    normalize: bool = True,
    e5_prefix: str | None = None,
) -> np.ndarray:
    """计算文本嵌入向量"""
    tokenizer, model, device = model_components
    all_embeddings: list[np.ndarray] = []

    if e5_prefix:
        texts_to_embed = [f"{e5_prefix}{text}" for text in texts]
        print(f"添加前缀 '{e5_prefix}' 到文本")
    else:
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

        if normalize:
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

def extract_embeddings_from_items(items: List[dict]) -> Tuple[np.ndarray, List[str]]:
    """从数据项中提取嵌入向量和文本"""
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
            # 对于文章类型，组合标题和内容
            title = item.get('title', '')
            content = item.get('content', '')
            text = f"{title}\n{content}" if content else title
        texts.append(text)
    
    # 验证嵌入
    embeddings_array = validate_embeddings(embeddings)
    
    return embeddings_array, texts
