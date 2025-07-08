#!/usr/bin/env python3
"""
模型加载诊断脚本
测试不同的模型加载方式以诊断问题
"""

import os
import sys
from pathlib import Path

def print_environment():
    """打印环境变量和路径信息"""
    print("=== 环境变量信息 ===")
    print(f"HF_HOME: {os.getenv('HF_HOME', 'Not set')}")
    print(f"HF_HUB_CACHE: {os.getenv('HF_HUB_CACHE', 'Not set')}")
    print(f"TRANSFORMERS_CACHE: {os.getenv('TRANSFORMERS_CACHE', 'Not set')}")
    print(f"HF_HUB_OFFLINE: {os.getenv('HF_HUB_OFFLINE', 'Not set')}")
    print(f"TRANSFORMERS_OFFLINE: {os.getenv('TRANSFORMERS_OFFLINE', 'Not set')}")
    print(f"EMBEDDING_MODEL_NAME: {os.getenv('EMBEDDING_MODEL_NAME', 'Not set')}")
    print()

def check_cache_directories():
    """检查缓存目录结构"""
    print("=== 缓存目录检查 ===")
    
    hf_home = os.getenv('HF_HOME', '/home/appuser/.cache/huggingface')
    cache_path = Path(hf_home)
    
    print(f"检查路径: {cache_path}")
    print(f"路径存在: {cache_path.exists()}")
    
    if cache_path.exists():
        print("子目录:")
        for item in cache_path.iterdir():
            if item.is_dir():
                print(f"  📁 {item.name}")
                # 检查模型目录
                if "multilingual-e5-small" in item.name:
                    print(f"     -> 找到目标模型目录")
                    # 检查blob文件
                    blobs_dir = item / "blobs"
                    if blobs_dir.exists():
                        blob_count = len(list(blobs_dir.glob("*")))
                        print(f"     -> Blobs: {blob_count} 个文件")
            else:
                print(f"  📄 {item.name}")
    
    # 检查hub目录
    hub_path = cache_path / "hub"
    print(f"\nHub目录 ({hub_path}):")
    print(f"存在: {hub_path.exists()}")
    
    if hub_path.exists():
        for item in hub_path.iterdir():
            if item.is_dir():
                print(f"  📁 {item.name}")
                if "multilingual-e5-small" in item.name:
                    print(f"     -> 找到目标模型目录")
                    # 检查详细结构
                    refs_dir = item / "refs"
                    blobs_dir = item / "blobs"
                    snapshots_dir = item / "snapshots"
                    
                    print(f"     -> refs: {refs_dir.exists()}")
                    print(f"     -> blobs: {blobs_dir.exists()}")
                    print(f"     -> snapshots: {snapshots_dir.exists()}")
                    
                    if blobs_dir.exists():
                        blob_count = len(list(blobs_dir.glob("*")))
                        print(f"     -> Blobs: {blob_count} 个文件")
    print()

def test_model_loading():
    """测试不同的模型加载方式"""
    print("=== 模型加载测试 ===")
    
    model_name = os.getenv("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-small")
    print(f"模型名称: {model_name}")
    
    try:
        from transformers import AutoModel, AutoTokenizer
        print("✅ Transformers库导入成功")
    except Exception as e:
        print(f"❌ Transformers库导入失败: {e}")
        return
    
    # 测试1: 默认加载
    print("\n--- 测试1: 默认加载 ---")
    try:
        tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
        model = AutoModel.from_pretrained(model_name, trust_remote_code=True)
        print("✅ 默认加载成功")
    except Exception as e:
        print(f"❌ 默认加载失败: {e}")
    
    # 测试2: 离线模式
    print("\n--- 测试2: 离线模式 ---")
    try:
        tokenizer = AutoTokenizer.from_pretrained(
            model_name, 
            trust_remote_code=True,
            local_files_only=True
        )
        model = AutoModel.from_pretrained(
            model_name, 
            trust_remote_code=True,
            local_files_only=True
        )
        print("✅ 离线模式加载成功")
    except Exception as e:
        print(f"❌ 离线模式加载失败: {e}")
    
    # 测试3: 指定缓存目录
    print("\n--- 测试3: 指定缓存目录 ---")
    try:
        cache_dir = os.getenv('HF_HOME', '/home/appuser/.cache/huggingface')
        tokenizer = AutoTokenizer.from_pretrained(
            model_name, 
            trust_remote_code=True,
            cache_dir=cache_dir
        )
        model = AutoModel.from_pretrained(
            model_name, 
            trust_remote_code=True,
            cache_dir=cache_dir
        )
        print("✅ 指定缓存目录加载成功")
    except Exception as e:
        print(f"❌ 指定缓存目录加载失败: {e}")

def main():
    """主函数"""
    print("🔍 Meridian ML Service - 模型加载诊断")
    print("=" * 50)
    
    print_environment()
    check_cache_directories()
    test_model_loading()
    
    print("\n🏁 诊断完成")

if __name__ == "__main__":
    main() 