#!/usr/bin/env python3
"""
测试脚本 - 验证ML服务的修复
测试numpy序列化和小数据集处理
"""

import json
import requests
import numpy as np

# API端点
BASE_URL = "http://localhost:8081"
API_TOKEN = "dev-token-123"

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {API_TOKEN}"
}


def test_small_dataset_clustering():
    """测试小数据集聚类（之前会导致UMAP错误）"""
    print("🧪 测试小数据集聚类...")
    
    # 只有3个文本的小数据集
    small_texts = [
        "人工智能最新进展",
        "机器学习算法优化", 
        "深度学习模型训练"
    ]
    
    data = {
        "texts": small_texts
    }
    
    try:
        # 测试标准聚类
        print("  - 测试标准聚类...")
        response = requests.post(f"{BASE_URL}/clustering", json=data, headers=headers)
        if response.status_code == 200:
            result = response.json()
            print(f"    ✅ 标准聚类成功: {len(result['cluster_labels'])} 个标签")
        else:
            print(f"    ❌ 标准聚类失败: {response.status_code} - {response.text}")
            
        # 测试优化聚类
        print("  - 测试优化聚类...")
        response = requests.post(f"{BASE_URL}/clustering/optimized", json=data, headers=headers)
        if response.status_code == 200:
            result = response.json()
            print(f"    ✅ 优化聚类成功: {len(result['cluster_labels'])} 个标签")
        else:
            print(f"    ❌ 优化聚类失败: {response.status_code} - {response.text}")
            
        # 测试完整处理（优化模式）
        print("  - 测试完整处理（优化模式）...")
        data_with_optimization = {
            "texts": small_texts,
            "use_optimization": True
        }
        response = requests.post(f"{BASE_URL}/embeddings-and-clustering", json=data_with_optimization, headers=headers)
        if response.status_code == 200:
            result = response.json()
            print(f"    ✅ 完整处理（优化）成功: {len(result['clustering_result']['cluster_labels'])} 个标签")
        else:
            print(f"    ❌ 完整处理（优化）失败: {response.status_code} - {response.text}")
            
    except Exception as e:
        print(f"    ❌ 测试异常: {e}")


def test_normal_dataset_clustering():
    """测试正常大小数据集"""
    print("\n🧪 测试正常数据集聚类...")
    
    # 25个文本的正常数据集
    normal_texts = [
        "人工智能技术发展趋势分析",
        "机器学习在医疗领域的应用",
        "深度学习模型优化策略研究",
        "自然语言处理最新突破",
        "计算机视觉技术进展",
        "区块链技术创新应用",
        "加密货币市场分析",
        "数字金融发展前景", 
        "去中心化应用开发",
        "智能合约安全研究",
        "新能源汽车技术发展",
        "电动汽车充电基础设施",
        "太阳能发电效率提升",
        "风能发电技术创新",
        "储能技术研究进展",
        "气候变化应对措施",
        "碳中和目标实现路径",
        "环保政策影响分析",
        "可持续发展战略规划",
        "绿色经济转型升级",
        "5G网络部署进展",
        "物联网应用场景扩展",
        "边缘计算技术发展",
        "云计算服务优化",
        "网络安全防护技术"
    ]
    
    data = {
        "texts": normal_texts,
        "return_embeddings": False,
        "return_reduced_embeddings": True
    }
    
    try:
        # 测试标准聚类
        print("  - 测试标准聚类...")
        response = requests.post(f"{BASE_URL}/clustering", json=data, headers=headers)
        if response.status_code == 200:
            result = response.json()
            stats = result['clustering_stats']
            print(f"    ✅ 标准聚类成功: {stats['n_clusters']} 个簇, {stats['n_outliers']} 个异常点")
            
            # 验证数据类型（这是关键修复）
            assert isinstance(stats['n_clusters'], int), "n_clusters 应该是 int 类型"
            assert isinstance(stats['n_outliers'], int), "n_outliers 应该是 int 类型"
            assert isinstance(stats['outlier_ratio'], float), "outlier_ratio 应该是 float 类型"
            print("    ✅ 数据类型验证通过")
        else:
            print(f"    ❌ 标准聚类失败: {response.status_code} - {response.text}")
            
        # 测试优化聚类
        print("  - 测试优化聚类...")
        response = requests.post(f"{BASE_URL}/clustering/optimized", json=data, headers=headers)
        if response.status_code == 200:
            result = response.json()
            stats = result['clustering_stats']
            print(f"    ✅ 优化聚类成功: {stats['n_clusters']} 个簇, {stats['n_outliers']} 个异常点")
            if result.get('optimization', {}).get('used'):
                print(f"    📊 DBCV分数: {result['optimization'].get('best_dbcv_score', 'N/A')}")
        else:
            print(f"    ❌ 优化聚类失败: {response.status_code} - {response.text}")
            
    except Exception as e:
        print(f"    ❌ 测试异常: {e}")


def test_json_serialization():
    """测试JSON序列化（验证numpy类型转换）"""
    print("\n🧪 测试JSON序列化...")
    
    data = {
        "texts": ["测试文本1", "测试文本2", "测试文本3", "测试文本4", "测试文本5"]
    }
    
    try:
        response = requests.post(f"{BASE_URL}/clustering", json=data, headers=headers)
        if response.status_code == 200:
            result = response.json()
            
            # 尝试重新序列化以验证没有numpy类型
            json_str = json.dumps(result)
            print("    ✅ JSON序列化成功，没有numpy类型问题")
            
            # 验证关键字段存在且类型正确
            assert 'cluster_labels' in result
            assert 'clustering_stats' in result
            assert isinstance(result['cluster_labels'], list)
            assert all(isinstance(label, int) for label in result['cluster_labels'])
            print("    ✅ 所有字段类型验证通过")
        else:
            print(f"    ❌ 请求失败: {response.status_code} - {response.text}")
            
    except json.JSONDecodeError as e:
        print(f"    ❌ JSON序列化失败: {e}")
    except Exception as e:
        print(f"    ❌ 测试异常: {e}")


def test_health_check():
    """测试健康检查"""
    print("\n🧪 测试健康检查...")
    
    try:
        response = requests.get(f"{BASE_URL}/health")
        if response.status_code == 200:
            result = response.json()
            print(f"    ✅ 服务健康: {result.get('status')}")
            print(f"    📦 聚类可用: {result.get('clustering_available')}")
        else:
            print(f"    ❌ 健康检查失败: {response.status_code}")
    except Exception as e:
        print(f"    ❌ 健康检查异常: {e}")


if __name__ == "__main__":
    print("🚀 开始测试ML服务修复...")
    
    test_health_check()
    test_small_dataset_clustering()
    test_normal_dataset_clustering() 
    test_json_serialization()
    
    print("\n✨ 测试完成！") 