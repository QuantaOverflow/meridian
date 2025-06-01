#!/usr/bin/env python3
"""
本地测试脚本 - 测试ML服务的各项功能
"""

import asyncio
import json
import time
from typing import List

import httpx


class MLServiceTester:
    """ML服务测试器"""
    
    def __init__(self, base_url: str = "http://localhost:8081", api_token: str = "dev-token-123"):
        self.base_url = base_url
        self.headers = {"X-API-Token": api_token}
        
    async def test_health(self):
        """测试健康检查"""
        print("🔍 测试健康检查...")
        
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.base_url}/health")
            
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
    
    async def test_embeddings(self, texts: List[str]):
        """测试嵌入生成"""
        print(f"\n🧮 测试嵌入生成 ({len(texts)} 个文本)...")
        
        payload = {"texts": texts}
        
        async with httpx.AsyncClient(timeout=60) as client:
            start_time = time.time()
            response = await client.post(
                f"{self.base_url}/embeddings",
                json=payload,
                headers=self.headers
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
    
    async def test_clustering(self, texts: List[str]):
        """测试标准聚类功能"""
        print(f"\n🔗 测试标准聚类功能 ({len(texts)} 个文本)...")
        
        payload = {
            "texts": texts,
            "config": {
                "umap_n_components": 10,  # 更新为reportV5默认值
                "umap_n_neighbors": min(15, len(texts) - 1),
                "umap_min_dist": 0.0,  # 使用reportV5的值
                "hdbscan_min_cluster_size": min(5, len(texts) // 3),
                "hdbscan_min_samples": 3,
                "hdbscan_cluster_selection_epsilon": 0.0,
                "normalize_embeddings": True
            },
            "return_embeddings": False,
            "return_reduced_embeddings": True
        }
        
        async with httpx.AsyncClient(timeout=120) as client:
            start_time = time.time()
            response = await client.post(
                f"{self.base_url}/clustering",
                json=payload,
                headers=self.headers
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

    async def test_optimized_clustering(self, texts: List[str]):
        """测试优化聚类功能"""
        print(f"\n🎯 测试优化聚类功能 ({len(texts)} 个文本)...")
        
        # 为了测试速度，使用较小的参数网格
        payload = {
            "texts": texts,
            "grid_config": {
                "umap_n_neighbors": [10, 15, 20],  # 减少组合数
                "umap_n_components": 10,
                "umap_min_dist": 0.0,
                "hdbscan_min_cluster_size": [5, 8],  # 减少组合数
                "hdbscan_min_samples": [2, 3],
                "hdbscan_epsilon": [0.1, 0.2]  # 减少组合数
            },
            "return_embeddings": False,
            "return_reduced_embeddings": True
        }
        
        async with httpx.AsyncClient(timeout=300) as client:  # 增加超时时间
            start_time = time.time()
            response = await client.post(
                f"{self.base_url}/clustering/optimized",
                json=payload,
                headers=self.headers
            )
            processing_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                stats = data['clustering_stats']
                optimization = data['optimization']
                
                print(f"✅ 优化聚类成功")
                print(f"   簇数量: {stats['n_clusters']}")
                print(f"   异常点: {stats['n_outliers']} ({stats['outlier_ratio']:.1%})")
                print(f"   簇大小: {stats['cluster_sizes']}")
                if stats['dbcv_score'] is not None:
                    print(f"   DBCV分数: {stats['dbcv_score']:.4f}")
                print(f"   处理时间: {processing_time:.2f}秒")
                
                if optimization['used']:
                    print(f"   ✨ 参数优化结果:")
                    if optimization['best_dbcv_score'] is not None:
                        print(f"     最佳DBCV分数: {optimization['best_dbcv_score']:.4f}")
                    if optimization['best_params']:
                        umap_params = optimization['best_params']['umap']
                        hdbscan_params = optimization['best_params']['hdbscan']
                        print(f"     最佳UMAP参数: n_neighbors={umap_params['n_neighbors']}")
                        print(f"     最佳HDBSCAN参数: min_cluster_size={hdbscan_params['min_cluster_size']}, "
                              f"min_samples={hdbscan_params['min_samples']}, epsilon={hdbscan_params['epsilon']}")
                
                return data
            else:
                print(f"❌ 优化聚类失败: {response.status_code}")
                print(f"   错误: {response.text}")
                return None
    
    async def test_full_pipeline(self, texts: List[str]):
        """测试完整流水线（不带优化）"""
        print(f"\n🚀 测试完整流水线 ({len(texts)} 个文本)...")
        
        payload = {
            "texts": texts,
            "clustering_config": {
                "umap_n_components": 10,
                "umap_n_neighbors": min(15, len(texts) - 1),
                "umap_min_dist": 0.0,
                "hdbscan_min_cluster_size": min(5, len(texts) // 3),
                "hdbscan_min_samples": 3,
                "hdbscan_cluster_selection_epsilon": 0.0
            },
            "include_cluster_content": True,
            "content_top_n": 3,
            "use_optimization": False
        }
        
        async with httpx.AsyncClient(timeout=180) as client:
            start_time = time.time()
            response = await client.post(
                f"{self.base_url}/embeddings-and-clustering",
                json=payload,
                headers=self.headers
            )
            processing_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                clustering_result = data['clustering_result']
                stats = clustering_result['clustering_stats']
                
                print(f"✅ 完整流水线成功")
                print(f"   模型: {data['model_name']}")
                print(f"   嵌入维度: {len(data['embeddings'][0])}维")
                print(f"   簇数量: {stats['n_clusters']}")
                if stats['dbcv_score'] is not None:
                    print(f"   DBCV分数: {stats['dbcv_score']:.4f}")
                print(f"   服务器处理时间: {data.get('processing_time', 0):.2f}秒")
                print(f"   总耗时: {processing_time:.2f}秒")
                
                return data
            else:
                print(f"❌ 完整流水线失败: {response.status_code}")
                print(f"   错误: {response.text}")
                return None

    async def test_optimized_full_pipeline(self, texts: List[str]):
        """测试优化版完整流水线"""
        print(f"\n🎯🚀 测试优化版完整流水线 ({len(texts)} 个文本)...")
        
        payload = {
            "texts": texts,
            "grid_config": {
                "umap_n_neighbors": [10, 15],  # 减少参数组合以加快测试
                "umap_n_components": 10,
                "umap_min_dist": 0.0,
                "hdbscan_min_cluster_size": [5, 8],
                "hdbscan_min_samples": [2, 3],
                "hdbscan_epsilon": [0.1, 0.2]
            },
            "include_cluster_content": True,
            "content_top_n": 3,
            "use_optimization": True
        }
        
        async with httpx.AsyncClient(timeout=300) as client:  # 增加超时时间
            start_time = time.time()
            response = await client.post(
                f"{self.base_url}/embeddings-and-clustering",
                json=payload,
                headers=self.headers
            )
            processing_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                clustering_result = data['clustering_result']
                stats = clustering_result['clustering_stats']
                optimization = clustering_result['optimization']
                
                print(f"✅ 优化版完整流水线成功")
                print(f"   模型: {data['model_name']}")
                print(f"   嵌入维度: {len(data['embeddings'][0])}维")
                print(f"   簇数量: {stats['n_clusters']}")
                if stats['dbcv_score'] is not None:
                    print(f"   DBCV分数: {stats['dbcv_score']:.4f}")
                print(f"   服务器处理时间: {data.get('processing_time', 0):.2f}秒")
                print(f"   总耗时: {processing_time:.2f}秒")
                
                if optimization['used'] and optimization['best_dbcv_score'] is not None:
                    print(f"   🎯 优化结果: DBCV分数={optimization['best_dbcv_score']:.4f}")
                
                return data
            else:
                print(f"❌ 优化版完整流水线失败: {response.status_code}")
                print(f"   错误: {response.text}")
                return None


# 测试数据 - 增加一些文本以便更好地测试聚类
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
    
    # 经济新闻 - 货币政策
    "美联储宣布维持利率不变，市场反应平稳",
    "欧洲央行考虑调整货币政策应对持续通胀",
    "中国央行下调存款准备金率，释放流动性",
    "日本央行维持超宽松货币政策立场",
    "英国央行加息25个基点应对通胀压力",
    
    # 经济新闻 - 市场表现  
    "中国GDP增长超预期，经济复苏势头良好",
    "石油价格因地缘政治紧张局势上涨5%",
    "比特币价格突破65000美元，创历史新高",
    "黄金价格受避险情绪推动持续上涨",
    "美股三大指数集体收涨，科技股领涨",
    
    # 体育新闻
    "2024巴黎奥运会开幕在即，各国代表团陆续抵达",
    "NBA总决赛进入白热化阶段，双方战至抢七",
    "世界杯预选赛激战正酣，多支强队出线形势严峻",
    "网球大满贯赛事精彩纷呈，新星崛起挑战老将",
    "马拉松世界纪录再次被打破，人类极限继续突破",
]


async def main():
    """主测试函数"""
    print("🤖 Meridian ML Service 本地测试 (v0.3.0 - 参数优化版)")
    print("=" * 60)
    
    tester = MLServiceTester()
    
    # 1. 健康检查
    clustering_available = await tester.test_health()
    
    if not clustering_available:
        print("\n⚠️  聚类功能不可用，跳过聚类相关测试")
        print("   安装命令: pip install umap-learn hdbscan scikit-learn")
        return
    
    # 2. 测试嵌入生成
    await tester.test_embeddings(TEST_TEXTS[:5])
    
    # 3. 测试标准聚类功能
    await tester.test_clustering(TEST_TEXTS)
    
    # 4. 测试优化聚类功能
    print(f"\n⏰ 注意：参数优化需要较长时间，请耐心等待...")
    await tester.test_optimized_clustering(TEST_TEXTS)
    
    # 5. 测试标准完整流水线
    await tester.test_full_pipeline(TEST_TEXTS)
    
    # 6. 测试优化版完整流水线
    print(f"\n⏰ 注意：优化版流水线需要更长时间...")
    await tester.test_optimized_full_pipeline(TEST_TEXTS)
    
    print("\n🎉 所有测试完成!")
    print("\n📊 测试总结:")
    print("   ✅ 嵌入生成: 基础功能")
    print("   ✅ 标准聚类: 使用固定参数")
    print("   ✅ 优化聚类: 网格搜索最佳参数")
    print("   ✅ 完整流水线: 端到端处理")
    print("   ✅ 优化流水线: 端到端 + 参数优化")


if __name__ == "__main__":
    asyncio.run(main()) 