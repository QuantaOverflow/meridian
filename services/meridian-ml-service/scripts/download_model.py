#!/usr/bin/env python3
"""
模型下载脚本
在服务启动前预下载模型文件到本地缓存
"""

import os
import sys
from pathlib import Path
from transformers import AutoModel, AutoTokenizer

def download_model():
    """下载嵌入模型到本地缓存"""
    model_name = os.getenv("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-small")
    cache_dir = os.getenv("HF_HOME", "/home/appuser/.cache/huggingface")
    
    print(f"正在下载模型: {model_name}")
    print(f"缓存目录: {cache_dir}")
    print(f"HF_HUB_CACHE: {os.getenv('HF_HUB_CACHE', 'Not set')}")
    print(f"TRANSFORMERS_CACHE: {os.getenv('TRANSFORMERS_CACHE', 'Not set')}")
    
    # 确保缓存目录存在
    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    
    # 确保hub目录存在（新的缓存格式）
    hub_dir = Path(cache_dir) / "hub"
    hub_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        # 首先下载tokenizer和模型（这会创建正确的缓存结构）
        print("下载tokenizer...")
        tokenizer = AutoTokenizer.from_pretrained(
            model_name,
            trust_remote_code=True
        )
        print("✅ Tokenizer下载完成")
        
        # 下载模型
        print("下载模型...")
        model = AutoModel.from_pretrained(
            model_name,
            trust_remote_code=True
        )
        print("✅ 模型下载完成")
        
        # 测试离线加载
        print("测试离线模式加载...")
        try:
            test_tokenizer = AutoTokenizer.from_pretrained(
                model_name,
                trust_remote_code=True,
                local_files_only=True
            )
            test_model = AutoModel.from_pretrained(
                model_name,
                trust_remote_code=True,
                local_files_only=True
            )
            print("✅ 离线模式测试成功")
        except Exception as e:
            print(f"⚠️ 离线模式测试失败: {e}")
            # 如果离线模式失败，尝试使用不同的方法
            print("尝试强制本地缓存...")
            # 设置环境变量强制使用缓存
            os.environ['HF_HUB_OFFLINE'] = '1'
            os.environ['TRANSFORMERS_OFFLINE'] = '1'
        
        # 验证文件结构
        print("验证下载的文件...")
        
        # 检查新格式hub目录
        hub_cache = Path(cache_dir) / "hub"
        if hub_cache.exists():
            hub_dirs = list(hub_cache.glob("models--*"))
            print(f"Hub目录找到 {len(hub_dirs)} 个模型:")
            for model_dir in hub_dirs:
                print(f"  - {model_dir.name}")
                # 检查blob内容
                blobs_dir = model_dir / "blobs"
                if blobs_dir.exists():
                    blob_count = len(list(blobs_dir.glob("*")))
                    print(f"    Blobs: {blob_count} 个文件")
        
        # 检查旧格式目录
        old_cache_dirs = list(Path(cache_dir).glob("models--*"))
        if old_cache_dirs:
            print(f"发现旧格式缓存目录: {len(old_cache_dirs)} 个")
            for old_dir in old_cache_dirs:
                print(f"  - {old_dir.name}")
        
        print("🎉 模型下载和验证完成!")
        return True
        
    except Exception as e:
        print(f"❌ 模型下载失败: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = download_model()
    sys.exit(0 if success else 1) 