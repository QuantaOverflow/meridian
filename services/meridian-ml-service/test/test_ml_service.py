#!/usr/bin/env python3
"""
Meridian ML Service 统一测试套件
"""

import json
import time
import requests
import numpy as np
from typing import List, Dict, Any, Optional

# 配置
DEFAULT_BASE_URL = "http://localhost:8081"
DEFAULT_API_TOKEN = "dev-token-123"

# 测试数据
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


class MLServiceTester:
    """ML服务统一测试器"""
    
    def __init__(self, base_url: str = DEFAULT_BASE_URL, api_token: str = DEFAULT_API_TOKEN):
        self.base_url = base_url
        self.headers = {"X-API-Token": api_token, "Content-Type": "application/json"}
        
    def test_health(self) -> bool:
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
    
    def test_embeddings(self, texts: List[str]) -> Optional[List[List[float]]]:
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

    def test_clustering(self, texts: List[str]) -> Optional[Dict[str, Any]]:
        """测试AI Worker聚类功能"""
        print(f"\n🔗 测试AI Worker聚类功能 ({len(texts)} 个文本)...")
        
        # 首先生成嵌入向量
        embeddings_data = self.test_embeddings(texts)
        if not embeddings_data:
            print("⚠️  无法获取嵌入向量，跳过聚类测试。")
            return None

        # 构建AI Worker格式的数据项
        items = []
        for i, (text, emb) in enumerate(zip(texts, embeddings_data)):
            items.append({
                "id": i,
                "embedding": emb,
                "title": text[:50] + "..." if len(text) > 50 else text,
                "url": f"http://example.com/article/{i}",
                "content": text
            })
        
        # 构建正确的请求payload
        payload = {
            "items": items,
            "config": {
                "umap_n_components": min(8, len(items) - 1),  # 调整维度
                "umap_n_neighbors": min(10, len(items) - 1),  # 调整邻居数
                "umap_min_dist": 0.0,
                "hdbscan_min_cluster_size": max(2, len(items) // 5),  # 更小的最小簇大小
                "hdbscan_min_samples": 2,  # 减少最小样本数
                "normalize_embeddings": True
            },
            "optimization": None,
            "content_analysis": {
                "enabled": True,
                "top_n_per_cluster": 3
            }
        }
        
        try:
            start_time = time.time()
            response = requests.post(
                f"{self.base_url}/ai-worker/clustering",
                json=payload,  # 发送完整的payload
                headers=self.headers,
                timeout=120,
                params={
                    "return_embeddings": False,
                    "return_reduced_embeddings": True
                }
            )
            processing_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                stats = data['clustering_stats']
                print(f"✅ AI Worker聚类成功")
                print(f"   簇数量: {stats['n_clusters']}")
                print(f"   异常点: {stats['n_outliers']} ({stats['outlier_ratio']:.1%})")
                print(f"   簇大小: {stats['cluster_sizes']}")
                if stats.get('dbcv_score') is not None:
                    print(f"   DBCV分数: {stats['dbcv_score']:.4f}")
                print(f"   处理时间: {processing_time:.2f}秒")
                
                # 显示簇内容示例
                if data.get('clusters'):
                    print(f"   簇内容示例:")
                    for cluster in data['clusters'][:3]:  # 只显示前3个簇
                        cluster_id = cluster['cluster_id']
                        items_in_cluster = cluster['items']
                        print(f"     簇{cluster_id}: {len(items_in_cluster)}个文本")
                        for item in items_in_cluster[:2]:  # 只显示前2个
                            # 优先显示text字段，然后是metadata中的title
                            text_content = (item.get('text') or 
                                          item.get('metadata', {}).get('title') or 
                                          item.get('title') or 
                                          'N/A')
                            print(f"       - {text_content[:80]}...")
                
                return data
            else:
                print(f"❌ AI Worker聚类失败: {response.status_code}")
                print(f"   错误: {response.text}")
                return None
        except Exception as e:
            print(f"❌ AI Worker聚类异常: {e}")
            return None

    def test_optimized_clustering(self, texts: List[str]) -> Optional[Dict[str, Any]]:
        """测试参数优化聚类功能"""
        print(f"\n🎯 测试参数优化聚类功能 ({len(texts)} 个文本)...")
        
        # 首先生成嵌入向量
        embeddings_data = self.test_embeddings(texts)
        if not embeddings_data:
            print("⚠️  无法获取嵌入向量，跳过参数优化聚类测试。")
            return None

        # 构建适合智能聚类的数据项
        items = []
        for i, (text, emb) in enumerate(zip(texts, embeddings_data)):
            items.append({
                "id": i,
                "text": text,
                "embedding": emb
            })
        
        payload = {
            "items": items,
            "config": {
                "umap_n_components": min(8, len(items) - 1),  # 调整维度
                "umap_n_neighbors": min(10, len(items) - 1),  # 调整邻居数
                "umap_min_dist": 0.0,
                "hdbscan_min_cluster_size": max(2, len(items) // 5),  # 更小的最小簇大小
                "hdbscan_min_samples": 2,  # 减少最小样本数
                "normalize_embeddings": True
            },
            "optimization": {
                "enabled": True,
                "umap_n_neighbors_range": [min(8, len(items) - 1), min(12, len(items) - 1)],  # 调整搜索范围
                "hdbscan_min_cluster_size_range": [2, max(3, len(items) // 6)],  # 更适合小数据集
                "hdbscan_min_samples_range": [1, 2],  # 减少最小样本数
                "hdbscan_epsilon_range": [0.0, 0.1],  # 调整epsilon范围
                "max_combinations": 8  # 减少组合数
            },
            "return_embeddings": False,
            "return_reduced_embeddings": True
        }
        
        try:
            start_time = time.time()
            response = requests.post(
                f"{self.base_url}/clustering/auto",
                json=payload,
                headers=self.headers,
                timeout=180
            )
            processing_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                stats = data['clustering_stats']
                optimization = data['optimization_result']
                
                print(f"✅ 参数优化聚类成功")
                print(f"   簇数量: {stats['n_clusters']}")
                print(f"   异常点: {stats['n_outliers']} ({stats['outlier_ratio']:.1%})")
                if stats.get('dbcv_score') is not None:
                    print(f"   DBCV分数: {stats['dbcv_score']:.4f}")
                if optimization['used'] and optimization.get('best_params'):
                    best_params = optimization['best_params']
                    print(f"   最佳参数优化: 使用了{optimization.get('evaluated_combinations', 'N/A')}个组合")
                print(f"   处理时间: {processing_time:.2f}秒")
                
                return data
            else:
                print(f"❌ 参数优化聚类失败: {response.status_code}")
                print(f"   错误: {response.text}")
                return None
        except Exception as e:
            print(f"❌ 参数优化聚类异常: {e}")
            return None

    def test_pipeline(self, texts: List[str]) -> Optional[Dict[str, Any]]:
        """测试完整智能聚类流水线"""
        print(f"\n🔄 测试完整智能聚类流水线 ({len(texts)} 个文本)...")
        
        # 构建纯文本项目，让系统自动生成嵌入
        items = []
        for i, text in enumerate(texts):
            items.append({
                "id": i,
                "text": text,
                "metadata": {"source": "test", "index": i}
            })
        
        payload = {
            "items": items,
            "config": {
                "umap_n_components": min(8, len(items) - 1),  # 调整维度
                "umap_n_neighbors": min(10, len(items) - 1),  # 调整邻居数
                "umap_min_dist": 0.0,
                "hdbscan_min_cluster_size": max(2, len(items) // 5),  # 更小的最小簇大小
                "hdbscan_min_samples": 2,  # 减少最小样本数
                "normalize_embeddings": True
            },
            "optimization": {
                "enabled": True,
                "umap_n_neighbors_range": [min(8, len(items) - 1), min(12, len(items) - 1)],  # 调整搜索范围
                "hdbscan_min_cluster_size_range": [2, max(3, len(items) // 6)],  # 更适合小数据集
                "hdbscan_min_samples_range": [1, 2],  # 减少最小样本数
                "max_combinations": 6  # 减少组合数
            },
            "content_analysis": {
                "enabled": True,
                "top_n_per_cluster": 3
            },
            "return_embeddings": True,
            "return_reduced_embeddings": True,
            "preserve_original_format": True,
            "include_ai_worker_metadata": True
        }
        
        try:
            start_time = time.time()
            response = requests.post(
                f"{self.base_url}/clustering/auto",
                json=payload,
                headers=self.headers,
                timeout=180
            )
            processing_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                stats = data['clustering_stats']
                
                print(f"✅ 完整智能流水线成功")
                if data.get('embeddings'):
                    print(f"   嵌入维度: {len(data['embeddings'][0])}维")
                else:
                    print(f"   嵌入维度: 由系统自动生成")
                print(f"   簇数量: {stats['n_clusters']}")
                if stats.get('dbcv_score') is not None:
                    print(f"   DBCV分数: {stats['dbcv_score']:.4f}")
                print(f"   处理时间: {processing_time:.2f}秒")
                
                return data
            else:
                print(f"❌ 完整智能流水线失败: {response.status_code}")
                print(f"   错误: {response.text}")
                return None
        except Exception as e:
            print(f"❌ 完整智能流水线异常: {e}")
            return None

    def generate_test_embeddings(self, n_samples: int = 15) -> List[List[float]]:
        """生成测试用的嵌入向量"""
        print(f"\n🧮 生成测试嵌入向量 ({n_samples} 个)...")
        
        # 使用前n_samples个测试文本
        test_texts = TEST_TEXTS[:n_samples]
        embeddings = self.test_embeddings(test_texts)
        
        if embeddings:
            print(f"✅ 生成了 {len(embeddings)} 个嵌入向量")
            return embeddings
        else:
            print("❌ 嵌入向量生成失败")
            return []

    def test_clustering_with_embeddings(self) -> Optional[Dict[str, Any]]:
        """测试使用预生成嵌入向量的聚类"""
        print(f"\n🎪 测试预生成嵌入向量聚类...")
        
        # 生成测试嵌入
        embeddings = self.generate_test_embeddings(12)
        if not embeddings:
            return None
        
        # 构建向量项目
        items = []
        for i, (text, emb) in enumerate(zip(TEST_TEXTS[:len(embeddings)], embeddings)):
            items.append({
                "id": i,
                "text": text,
                "embedding": emb,
                "metadata": {"category": "test", "index": i}
            })
        
        payload = {
            "items": items,
            "config": {
                "umap_n_components": min(6, len(items) - 1),  # 进一步减少维度
                "umap_n_neighbors": min(8, len(items) - 1),   # 减少邻居数
                "hdbscan_min_cluster_size": max(2, len(items) // 6),  # 更小的最小簇大小
                "hdbscan_min_samples": 1,  # 最小样本数设为1
                "normalize_embeddings": True
            },
            "content_analysis": {
                "enabled": True,
                "top_n_per_cluster": 2
            },
            "return_embeddings": False,
            "return_reduced_embeddings": True
        }
        
        try:
            start_time = time.time()
            response = requests.post(
                f"{self.base_url}/clustering/auto",
                json=payload,
                headers=self.headers,
                timeout=120
            )
            processing_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                stats = data['clustering_stats']
                
                print(f"✅ 预生成嵌入聚类成功")
                print(f"   簇数量: {stats['n_clusters']}")
                print(f"   异常点: {stats['n_outliers']} ({stats['outlier_ratio']:.1%})")
                if stats.get('dbcv_score') is not None:
                    print(f"   DBCV分数: {stats['dbcv_score']:.4f}")
                print(f"   处理时间: {processing_time:.2f}秒")
                
                return data
            else:
                print(f"❌ 预生成嵌入聚类失败: {response.status_code}")
                print(f"   错误: {response.text}")
                return None
        except Exception as e:
            print(f"❌ 预生成嵌入聚类异常: {e}")
            return None


def run_basic_tests(tester: MLServiceTester) -> bool:
    """运行基础功能测试"""
    print("🧪 开始基础功能测试...")
    
    # 1. 健康检查
    if not tester.test_health():
        print("❌ 基础功能测试失败，请检查服务配置")
        return False
    
    # 2. 嵌入生成测试
    embeddings = tester.test_embeddings(TEST_TEXTS[:5])
    if not embeddings:
        print("⚠️  嵌入生成失败，跳过后续测试")
        print("❌ 基础功能测试失败，请检查服务配置")
        return False
    
    # 3. AI Worker聚类测试
    clustering_result = tester.test_clustering(TEST_TEXTS[:15])
    if not clustering_result:
        print("⚠️  聚类测试失败")
        print("❌ 基础功能测试失败，请检查服务配置")
        return False
    
    print("✅ 基础功能测试通过")
    return True


def run_advanced_tests(tester: MLServiceTester) -> bool:
    """运行高级功能测试"""
    print("\n🚀 开始高级功能测试...")
    
    success_count = 0
    total_tests = 3
    
    # 1. 参数优化测试
    if tester.test_optimized_clustering(TEST_TEXTS[:12]):
        print("✅ 参数优化测试通过")
        success_count += 1
    else:
        print("❌ 参数优化测试失败")
    
    # 2. 完整流水线测试
    if tester.test_pipeline(TEST_TEXTS[:10]):
        print("✅ 完整流水线测试通过")
        success_count += 1
    else:
        print("❌ 完整流水线测试失败")
    
    # 3. 预生成嵌入测试
    if tester.test_clustering_with_embeddings():
        print("✅ 预生成嵌入测试通过")
        success_count += 1
    else:
        print("❌ 预生成嵌入测试失败")
    
    success_rate = success_count / total_tests
    print(f"\n📊 高级功能测试结果: {success_count}/{total_tests} 通过 ({success_rate:.1%})")
    
    return success_rate >= 0.6  # 60%通过率认为成功


def main():
    """主测试函数"""
    print("🤖 Meridian ML Service 统一测试套件")
    print("=" * 70)
    
    # 初始化测试器
    tester = MLServiceTester()
    
    # 运行基础测试
    basic_success = run_basic_tests(tester)
    
    if not basic_success:
        print("\n📚 使用说明:")
        print("   - 确保服务在 http://localhost:8081 运行")
        print("   - API_TOKEN 设置为 'dev-token-123'")
        print("   - 已安装聚类依赖: umap-learn hdbscan scikit-learn")
        return
    
    # 运行高级测试
    advanced_success = run_advanced_tests(tester)
    
    # 最终结果
    if basic_success and advanced_success:
        print("\n🎉 统一测试套件通过！")
    elif basic_success:
        print("\n⚠️  基础功能正常，但部分高级功能有问题")
        print("建议检查优化和内容分析相关配置")
    else:
        print("\n❌ 测试套件失败，请检查服务配置")


if __name__ == "__main__":
    main() 