#!/usr/bin/env python3
"""
测试新的解耦API接口
验证预生成嵌入的聚类功能
"""

import requests
import json
import numpy as np
from typing import List, Dict, Any

# 配置
BASE_URL = "http://localhost:8081"
API_TOKEN = "dev-token-123"  # 替换为实际的测试token

headers = {
    "Content-Type": "application/json",
    "X-API-Token": API_TOKEN
}


def generate_test_embeddings(n_samples: int = 20) -> List[List[float]]:
    """生成测试用的384维嵌入向量"""
    np.random.seed(42)  # 确保可重现性
    
    # 生成不同的嵌入集群
    embeddings = []
    
    # 集群1: 科技相关 (基准向量 + 小噪声)
    tech_base = np.random.randn(384) * 0.1
    for i in range(n_samples // 3):
        embedding = tech_base + np.random.randn(384) * 0.05
        embeddings.append(embedding.tolist())
    
    # 集群2: 经济相关
    econ_base = np.random.randn(384) * 0.1 + 0.5
    for i in range(n_samples // 3):
        embedding = econ_base + np.random.randn(384) * 0.05
        embeddings.append(embedding.tolist())
    
    # 集群3: 健康相关
    health_base = np.random.randn(384) * 0.1 - 0.3
    for i in range(n_samples - 2 * (n_samples // 3)):
        embedding = health_base + np.random.randn(384) * 0.05
        embeddings.append(embedding.tolist())
    
    return embeddings


def test_clustering_with_embeddings():
    """测试使用预生成嵌入的聚类接口"""
    print("🧪 测试 /clustering/with-embeddings 接口...")
    
    # 准备测试数据
    embeddings = generate_test_embeddings(15)
    test_items = []
    
    topics = [
        "AI breakthrough in machine learning",
        "New algorithm improves efficiency", 
        "Deep learning advances",
        "Tech startup funding round",
        "Software development trends",
        "Global economic indicators",
        "Market analysis report",
        "Investment strategies",
        "Financial technology growth",
        "Cryptocurrency market update",
        "Healthcare innovation",
        "Medical research findings",
        "Drug development progress",
        "Digital health solutions",
        "Patient care improvements"
    ]
    
    for i, (embedding, topic) in enumerate(zip(embeddings, topics)):
        test_items.append({
            "id": f"item_{i}",
            "text": topic,
            "embedding": embedding
        })
    
    request_data = {
        "items": test_items,
        "config": {
            "umap_n_components": 5,
            "umap_n_neighbors": 10,
            "hdbscan_min_cluster_size": 3
        },
        "return_reduced_embeddings": True,
        "include_cluster_content": True,
        "content_top_n": 5
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/clustering/with-embeddings",
            headers=headers,
            json=request_data,
            timeout=60
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ 聚类成功!")
            print(f"   发现 {len(result['clusters'])} 个聚类")
            print(f"   处理时间: {result.get('processing_time', 'N/A'):.2f}秒")
            
            for cluster in result['clusters']:
                print(f"   聚类 {cluster['cluster_id']}: {cluster['size']} 个项目")
            
            return True
        else:
            print(f"❌ 聚类失败: {response.status_code}")
            print(f"   错误信息: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ 请求异常: {e}")
        return False


def test_article_clustering():
    """测试文章聚类接口"""
    print("\n🧪 测试 /clustering/articles 接口...")
    
    # 准备测试文章数据
    embeddings = generate_test_embeddings(12)
    
    test_articles = [
        {
            "id": 1,
            "title": "AI Revolution in Healthcare",
            "content": "Artificial intelligence is transforming healthcare with new diagnostic tools and treatment methods.",
            "url": "https://example.com/ai-healthcare",
            "embedding": embeddings[0],
            "publishDate": "2025-05-30T10:00:00Z",
            "status": "PROCESSED"
        },
        {
            "id": 2,
            "title": "Machine Learning Breakthrough",
            "content": "Researchers develop new ML algorithms that improve accuracy by 20%.",
            "url": "https://example.com/ml-breakthrough",
            "embedding": embeddings[1],
            "publishDate": "2025-05-30T11:00:00Z",
            "status": "PROCESSED"
        },
        {
            "id": 3,
            "title": "Economic Market Analysis",
            "content": "Global markets show signs of recovery with strong Q4 performance.",
            "url": "https://example.com/market-analysis",
            "embedding": embeddings[6],
            "publishDate": "2025-05-30T09:00:00Z",
            "status": "PROCESSED"
        },
        {
            "id": 4,
            "title": "Investment Trends 2025",
            "content": "New investment opportunities emerge in sustainable technology sector.",
            "url": "https://example.com/investment-trends",
            "embedding": embeddings[7],
            "publishDate": "2025-05-30T08:00:00Z",
            "status": "PROCESSED"
        }
    ]
    
    request_data = {
        "articles": test_articles,
        "config": {
            "umap_n_components": 3,
            "hdbscan_min_cluster_size": 2
        },
        "include_cluster_content": True,
        "content_fields": ["title", "content"],
        "use_optimization": False
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/clustering/articles",
            headers=headers,
            json=request_data,
            timeout=60
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ 文章聚类成功!")
            print(f"   发现 {len(result['clusters'])} 个主题聚类")
            print(f"   处理时间: {result.get('processing_time', 'N/A'):.2f}秒")
            
            for cluster in result['clusters']:
                print(f"   聚类 {cluster['cluster_id']}: {cluster['size']} 篇文章")
                if cluster['time_range']:
                    print(f"     时间范围: {cluster['time_range']['earliest']} - {cluster['time_range']['latest']}")
            
            return True
        else:
            print(f"❌ 文章聚类失败: {response.status_code}")
            print(f"   错误信息: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ 请求异常: {e}")
        return False


def test_hybrid_clustering():
    """测试混合模式聚类"""
    print("\n🧪 测试 /clustering/hybrid 接口...")
    
    embeddings = generate_test_embeddings(6)
    
    # 混合数据：一些有嵌入，一些没有嵌入
    test_items = [
        {
            "id": "with_emb_1",
            "text": "Technology innovation drives progress",
            "embedding": embeddings[0]
        },
        {
            "id": "with_emb_2", 
            "text": "Economic growth indicators show positive trends",
            "embedding": embeddings[3]
        },
        {
            "id": "without_emb_1",
            "text": "New software development methodologies"
            # 没有embedding字段
        },
        {
            "id": "without_emb_2",
            "text": "Financial market volatility analysis"
            # 没有embedding字段
        }
    ]
    
    request_data = {
        "items": test_items,
        "config": {
            "umap_n_components": 2,
            "hdbscan_min_cluster_size": 2
        },
        "embedding_model": "intfloat/multilingual-e5-small",
        "return_embeddings": True,
        "return_reduced_embeddings": True
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/clustering/hybrid",
            headers=headers,
            json=request_data,
            timeout=60
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ 混合聚类成功!")
            print(f"   发现 {len(set(result['cluster_labels']))} 个聚类")
            print("   成功处理有嵌入和无嵌入的混合数据")
            
            return True
        else:
            print(f"❌ 混合聚类失败: {response.status_code}")
            print(f"   错误信息: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ 请求异常: {e}")
        return False


def test_health_check():
    """测试健康检查"""
    print("🏥 测试健康检查...")
    
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=10)
        if response.status_code == 200:
            health = response.json()
            print("✅ 服务健康")
            print(f"   嵌入模型: {health.get('embedding_model')}")
            print(f"   聚类功能: {'可用' if health.get('clustering_available') else '不可用'}")
            return True
        else:
            print(f"❌ 健康检查失败: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ 健康检查异常: {e}")
        return False


def main():
    """运行所有测试"""
    print("🚀 开始测试新的解耦API接口")
    print("=" * 60)
    
    # 测试健康检查
    if not test_health_check():
        print("❌ 服务不可用，停止测试")
        return
    
    print("\n" + "=" * 60)
    
    # 运行所有API测试
    tests = [
        test_clustering_with_embeddings,
        test_article_clustering,
        test_hybrid_clustering
    ]
    
    passed = 0
    total = len(tests)
    
    for test_func in tests:
        if test_func():
            passed += 1
    
    print("\n" + "=" * 60)
    print(f"📊 测试结果: {passed}/{total} 通过")
    
    if passed == total:
        print("🎉 所有测试通过！新的解耦架构工作正常。")
    else:
        print("⚠️  部分测试失败，请检查服务状态和配置。")


if __name__ == "__main__":
    main() 