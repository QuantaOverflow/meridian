#!/usr/bin/env python3
"""
本地测试脚本 - 测试ML服务的各项功能 (修复版 - 使用requests)
"""

import json
import time
from typing import List

import requests


class MLServiceTester:
    """ML服务测试器"""
    
    def __init__(self, base_url: str = "http://localhost:8081", api_token: str = "dev-token-123"):
        self.base_url = base_url
        self.headers = {"X-API-Token": api_token}
        
    def test_health(self):
        """测试健康检查"""
        print("🔍 测试健康检查...")
        
        try:
            response = requests.get(f"{self.base_url}/health", timeout=10)
            
            if response.status_code == 200:
                health_data = response.json()
                print("✅ 健康检查通过")
                print(f"   状态: {health_data['status']}")
                print(f"   嵌入模型: {health_data['embedding_model']}")
                print(f"   聚类可用: {health_data['clustering_available']}")
                print(f"   优化可用: {health_data['optimization_available']}")
                
                if not health_data['clustering_available']:
                    print("⚠️  警告: 聚类功能不可用")
                    
                return health_data['clustering_available']
            else:
                print(f"❌ 健康检查失败: {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ 健康检查异常: {e}")
            return False
    
    def test_embeddings(self, texts: List[str]):
        """测试嵌入生成"""
        print(f"\n🧮 测试嵌入生成 ({len(texts)} 个文本)...")
        
        payload = {"texts": texts}
        
        try:
            start_time = time.time()
            response = requests.post(
                f"{self.base_url}/embeddings",
                json=payload,
                headers=self.headers,
                timeout=60
            )
            processing_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                embeddings = data['embeddings']
                print(f"✅ 嵌入生成成功")
                print(f"   模型: {data['model_name']}")
                print(f"   嵌入维度: {len(embeddings[0])}维")
                print(f"   处理时间: {processing_time:.2f}秒")
                return embeddings
            else:
                print(f"❌ 嵌入生成失败: {response.status_code}")
                print(f"   错误: {response.text}")
                return None
        except Exception as e:
            print(f"❌ 嵌入生成异常: {e}")
            return None

    def test_clustering(self, texts: List[str]):
        """测试标准聚类功能"""
        print(f"\n🔗 测试标准聚类功能 ({len(texts)} 个文本)...")
        
        payload = {
            "texts": texts,
            "config": {
                "umap_n_components": 10,
                "umap_n_neighbors": min(15, len(texts) - 1),
                "umap_min_dist": 0.0,
                "hdbscan_min_cluster_size": min(5, len(texts) // 3),
                "hdbscan_min_samples": 3,
                "hdbscan_cluster_selection_epsilon": 0.0,
                "normalize_embeddings": True
            },
            "return_embeddings": False,
            "return_reduced_embeddings": True
        }
        
        try:
            start_time = time.time()
            response = requests.post(
                f"{self.base_url}/clustering",
                json=payload,
                headers=self.headers,
                timeout=120
            )
            processing_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                stats = data['clustering_stats']
                print(f"✅ 标准聚类成功")
                print(f"   簇数量: {stats['n_clusters']}")
                print(f"   异常点: {stats['n_outliers']} ({stats['outlier_ratio']:.1%})")
                print(f"   簇大小: {stats['cluster_sizes']}")
                if stats['dbcv_score'] is not None:
                    print(f"   DBCV分数: {stats['dbcv_score']:.4f}")
                print(f"   处理时间: {processing_time:.2f}秒")
                
                # 显示簇内容示例
                if 'cluster_content' in data and data['cluster_content']:
                    print(f"   簇内容示例:")
                    for cluster_id, content in data['cluster_content'].items():
                        print(f"     簇{cluster_id}: {len(content)}个文本")
                        for text in content[:2]:  # 只显示前2个
                            print(f"       - {text[:80]}...")
                
                return data
            else:
                print(f"❌ 标准聚类失败: {response.status_code}")
                print(f"   错误: {response.text}")
                return None
        except Exception as e:
            print(f"❌ 标准聚类异常: {e}")
            return None


# 测试数据 - 简化版本
TEST_TEXTS = [
    # 科技新闻 - AI/ML
    "OpenAI发布了新的GPT-4模型，具有更强大的多模态能力",
    "Google推出新的AI搜索算法，大幅提升搜索准确性",
    "Meta发布VR头显新品，支持先进的AI混合现实功能",
    "百度发布文心一言大模型，挑战ChatGPT在中文市场的地位",
    "英伟达发布新一代AI芯片，性能提升300%",
    
    # 科技新闻 - 消费电子
    "苹果公司发布最新iPhone 15，搭载先进的A17芯片",
    "特斯拉发布自动驾驶软件更新，提升安全性能",
    "华为发布Mate 60系列，搭载自研5G芯片",
    "小米发布新款智能手机，售价仅999元",
    "三星展示折叠屏技术新突破，屏幕可折叠万次",
    
    # 经济新闻
    "美联储宣布维持利率不变，市场反应平稳",
    "欧洲央行考虑调整货币政策应对持续通胀",
    "中国央行下调存款准备金率，释放流动性",
    "石油价格因地缘政治紧张局势上涨5%",
    "比特币价格突破65000美元，创历史新高",
]


def main():
    """主测试函数"""
    print("🤖 Meridian ML Service 本地测试 (修复版 - 使用requests)")
    print("=" * 70)
    
    tester = MLServiceTester()
    
    # 1. 健康检查
    clustering_available = tester.test_health()
    
    if not clustering_available:
        print("\n⚠️  聚类功能不可用，跳过聚类相关测试")
        print("   安装命令: pip install umap-learn hdbscan scikit-learn")
        return
    
    # 2. 测试嵌入生成
    embeddings = tester.test_embeddings(TEST_TEXTS[:5])
    
    # 3. 测试标准聚类功能  
    if embeddings:
        clustering_result = tester.test_clustering(TEST_TEXTS)
        
        if clustering_result:
            print(f"\n🎉 基础功能测试完成!")
            print("   ✅ 健康检查通过")
            print("   ✅ 嵌入生成成功")
            print("   ✅ 聚类分析成功")
        else:
            print(f"\n⚠️  聚类测试失败")
    else:
        print(f"\n⚠️  嵌入生成失败，跳过后续测试")
    
    print("\n📊 测试总结:")
    print("   🔧 修复方案: 使用requests库替代httpx")
    print("   🎯 根因: Surge代理对httpx请求的拦截")
    print("   ✅ 解决: 该版本应该能正常工作")


if __name__ == "__main__":
    main() 