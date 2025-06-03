#!/usr/bin/env python3
"""
AI Worker 集成测试
验证 ML Service 与 AI Worker 数据格式的完美集成
"""

import time
import requests
import numpy as np
from typing import List, Dict, Any
import os

class AIWorkerIntegrationTest:
    """AI Worker集成测试套件"""
    
    def __init__(self, base_url: str = "http://localhost:8081"):
        self.base_url = base_url
        # 添加认证header支持
        self.headers = {"Content-Type": "application/json"}
        
        # 检查是否需要API token
        api_token = os.getenv("API_TOKEN")
        if api_token:
            self.headers["X-API-Token"] = api_token
            print(f"🔐 使用API Token认证")
        else:
            print(f"🔓 无API Token，假设认证已禁用")
    
    def run_all_tests(self):
        """运行所有集成测试"""
        print("🧪 开始 AI Worker 集成测试")
        print("=" * 60)
        
        tests = [
            self.test_health_check,
            self.test_ai_worker_simple_format,
            self.test_ai_worker_extended_format,
            self.test_ai_worker_article_format,
            self.test_auto_detect_clustering,
            self.test_backend_compatibility,
            self.test_type_safe_endpoints
        ]
        
        passed = 0
        total = len(tests)
        
        for test in tests:
            try:
                print(f"\n🔍 {test.__name__}")
                result = test()
                if result:
                    print(f"✅ {test.__name__} - 通过")
                    passed += 1
                else:
                    print(f"❌ {test.__name__} - 失败")
            except Exception as e:
                print(f"💥 {test.__name__} - 异常: {e}")
        
        print("\n" + "=" * 60)
        print(f"📊 测试结果: {passed}/{total} 通过")
        if passed == total:
            print("🎉 所有AI Worker集成测试通过！")
            return True
        else:
            print("⚠️  部分测试失败，需要检查集成")
            return False
    
    def test_health_check(self) -> bool:
        """测试健康检查和AI Worker集成状态"""
        try:
            response = requests.get(f"{self.base_url}/")
            data = response.json()
            
            # 验证AI Worker集成信息
            if "ai_worker_integration" not in data:
                print("   ❌ 缺少AI Worker集成信息")
                return False
            
            integration = data["ai_worker_integration"]
            if integration["status"] != "完全兼容":
                print(f"   ❌ 集成状态异常: {integration['status']}")
                return False
            
            print(f"   ✅ AI Worker集成状态: {integration['status']}")
            print(f"   ✅ 支持的格式: {len(integration['supported_formats'])} 种")
            return True
            
        except Exception as e:
            print(f"   ❌ 健康检查失败: {e}")
            return False
    
    def test_ai_worker_simple_format(self) -> bool:
        """测试AI Worker简化嵌入格式"""
        try:
            # 模拟后端传来的简化格式
            ai_worker_data = [
                {"id": 1, "embedding": self._generate_embedding()},
                {"id": 2, "embedding": self._generate_embedding()},
                {"id": 3, "embedding": self._generate_embedding()},
                {"id": 4, "embedding": self._generate_embedding()}
            ]
            
            response = requests.post(
                f"{self.base_url}/ai-worker/clustering",
                json={
                    "items": ai_worker_data,
                    "return_embeddings": False,
                    "return_reduced_embeddings": True
                },
                headers=self.headers
            )
            
            if response.status_code != 200:
                print(f"   ❌ HTTP状态码: {response.status_code}")
                return False
            
            result = response.json()
            
            # 验证响应结构
            if "clusters" not in result:
                print("   ❌ 响应缺少clusters字段")
                return False
            
            if "model_info" not in result or not result["model_info"].get("ai_worker_compatible"):
                print("   ❌ 缺少AI Worker兼容性标记")
                return False
            
            print(f"   ✅ 成功处理 {len(ai_worker_data)} 个简化格式项")
            print(f"   ✅ 发现 {len(result['clusters'])} 个聚类")
            print(f"   ✅ 检测格式: {result['model_info'].get('detected_format')}")
            return True
            
        except Exception as e:
            print(f"   ❌ 简化格式测试失败: {e}")
            return False
    
    def test_ai_worker_extended_format(self) -> bool:
        """测试AI Worker扩展嵌入格式"""
        try:
            # 模拟后端传来的扩展格式
            ai_worker_data = [
                {
                    "id": 1,
                    "embedding": self._generate_embedding(),
                    "title": "AI Technology Breakthrough",
                    "url": "https://example.com/ai-breakthrough"
                },
                {
                    "id": 2,
                    "embedding": self._generate_embedding(offset=0.3),
                    "title": "Economic Market Analysis",
                    "url": "https://example.com/market-analysis"
                },
                {
                    "id": 3,
                    "embedding": self._generate_embedding(offset=0.6),
                    "title": "Climate Change Research",
                    "url": "https://example.com/climate-research"
                }
            ]
            
            response = requests.post(
                f"{self.base_url}/ai-worker/clustering",
                json={
                    "items": ai_worker_data,
                    "config": {
                        "umap_n_neighbors": 10,
                        "hdbscan_min_cluster_size": 2
                    },
                    "content_analysis": {
                        "enabled": True,
                        "top_n_per_cluster": 3
                    }
                },
                headers=self.headers
            )
            
            if response.status_code != 200:
                print(f"   ❌ HTTP状态码: {response.status_code}")
                return False
            
            result = response.json()
            
            # 验证扩展功能
            if not result.get("clustering_stats"):
                print("   ❌ 缺少聚类统计信息")
                return False
            
            print(f"   ✅ 成功处理 {len(ai_worker_data)} 个扩展格式项")
            print(f"   ✅ 聚类统计: {result['clustering_stats']['n_clusters']} 个聚类")
            print(f"   ✅ 检测格式: {result['model_info'].get('detected_format')}")
            return True
            
        except Exception as e:
            print(f"   ❌ 扩展格式测试失败: {e}")
            return False
    
    def test_ai_worker_article_format(self) -> bool:
        """测试AI Worker完整文章格式"""
        try:
            # 模拟后端传来的完整文章格式
            ai_worker_data = [
                {
                    "id": 1,
                    "title": "AI Breakthrough in Machine Learning",
                    "content": "Researchers have announced a significant breakthrough...",
                    "url": "https://example.com/ai-breakthrough",
                    "embedding": self._generate_embedding(),
                    "publishDate": "2025-05-30T10:00:00Z",
                    "status": "PROCESSED"
                },
                {
                    "id": 2,
                    "title": "Economic Trends Analysis",
                    "content": "Economic analysts report shifting trends in global markets...",
                    "url": "https://example.com/economic-trends",
                    "embedding": self._generate_embedding(offset=0.5),
                    "publishDate": "2025-05-30T10:30:00Z",
                    "status": "PROCESSED"
                }
            ]
            
            response = requests.post(
                f"{self.base_url}/ai-worker/clustering/article-format",
                json={
                    "items": ai_worker_data,
                    "optimization": {
                        "enabled": True,
                        "max_combinations": 12
                    },
                    "include_story_analysis": True
                },
                headers=self.headers
            )
            
            if response.status_code != 200:
                print(f"   ❌ HTTP状态码: {response.status_code}")
                return False
            
            result = response.json()
            
            # 验证完整文章处理
            if not result.get("optimization_result"):
                print("   ❌ 缺少优化结果")
                return False
            
            print(f"   ✅ 成功处理 {len(ai_worker_data)} 个完整文章")
            print(f"   ✅ 优化状态: {result['optimization_result']['used']}")
            print(f"   ✅ 格式类型: {result['model_info'].get('format')}")
            return True
            
        except Exception as e:
            print(f"   ❌ 完整文章格式测试失败: {e}")
            return False
    
    def test_auto_detect_clustering(self) -> bool:
        """测试自动格式检测"""
        try:
            # 混合格式数据
            mixed_data = [
                {"id": 1, "embedding": self._generate_embedding()},  # 简化格式
                {  # 扩展格式
                    "id": 2,
                    "embedding": self._generate_embedding(offset=0.3),
                    "title": "Test Article"
                }
            ]
            
            response = requests.post(
                f"{self.base_url}/clustering/auto",
                json={
                    "items": mixed_data,
                    "preserve_original_format": True,
                    "include_ai_worker_metadata": True
                },
                headers=self.headers
            )
            
            if response.status_code != 200:
                print(f"   ❌ HTTP状态码: {response.status_code}")
                return False
            
            result = response.json()
            
            # 验证自动检测
            if not result["model_info"].get("auto_detected"):
                print("   ❌ 未标记为自动检测")
                return False
            
            detected_format = result["model_info"].get("detected_format")
            if not detected_format or not detected_format.startswith("ai_worker"):
                print(f"   ❌ 格式检测错误: {detected_format}")
                return False
            
            print(f"   ✅ 自动检测成功: {detected_format}")
            print(f"   ✅ AI Worker兼容: {result['model_info'].get('ai_worker_compatible')}")
            return True
            
        except Exception as e:
            print(f"   ❌ 自动检测测试失败: {e}")
            return False
    
    def test_backend_compatibility(self) -> bool:
        """测试与后端系统的兼容性"""
        try:
            # 模拟 auto-brief-generation.ts 的调用格式
            backend_format_data = [
                {"id": 1, "embedding": self._generate_embedding()},
                {"id": 2, "embedding": self._generate_embedding(offset=0.4)},
                {"id": 3, "embedding": self._generate_embedding(offset=0.8)}
            ]
            
            # 模拟后端的请求参数
            response = requests.post(
                f"{self.base_url}/ai-worker/clustering",
                json={
                    "items": backend_format_data,
                    "config": {
                        "umap_n_neighbors": 15,
                        "hdbscan_min_cluster_size": 2,
                        "normalize_embeddings": True
                    },
                    "optimization": {
                        "enabled": True,
                        "max_combinations": 24
                    },
                    "return_reduced_embeddings": True
                },
                headers=self.headers
            )
            
            if response.status_code != 200:
                print(f"   ❌ 后端兼容性测试HTTP错误: {response.status_code}")
                return False
            
            result = response.json()
            
            # 验证后端期望的响应格式
            required_fields = ["clusters", "clustering_stats", "optimization_result"]
            for field in required_fields:
                if field not in result:
                    print(f"   ❌ 缺少后端期望的字段: {field}")
                    return False
            
            # 验证后端兼容性标记
            backend_workflows = result["model_info"].get("supported_workflows", [])
            if "auto-brief-generation" not in backend_workflows:
                print("   ❌ 缺少auto-brief-generation支持标记")
                return False
            
            print(f"   ✅ 后端兼容性验证通过")
            print(f"   ✅ 支持的工作流: {backend_workflows}")
            return True
            
        except Exception as e:
            print(f"   ❌ 后端兼容性测试失败: {e}")
            return False
    
    def test_type_safe_endpoints(self) -> bool:
        """测试类型安全的端点"""
        try:
            # 测试类型安全的嵌入端点
            response = requests.post(
                f"{self.base_url}/ai-worker/clustering/embedding-format",
                json={
                    "items": [
                        {
                            "id": 1,
                            "embedding": self._generate_embedding(),
                            "title": "Test Article 1"
                        },
                        {
                            "id": 2,
                            "embedding": self._generate_embedding(offset=0.5),
                            "title": "Test Article 2"
                        }
                    ],
                    "return_embeddings": True
                },
                headers=self.headers
            )
            
            if response.status_code != 200:
                print(f"   ❌ 类型安全端点HTTP错误: {response.status_code}")
                return False
            
            result = response.json()
            
            # 验证类型安全标记
            if not result["model_info"].get("type_safe"):
                print("   ❌ 缺少类型安全标记")
                return False
            
            if result["model_info"].get("validation") != "强类型验证":
                print("   ❌ 验证标记错误")
                return False
            
            print(f"   ✅ 类型安全端点验证通过")
            print(f"   ✅ 验证类型: {result['model_info'].get('validation')}")
            return True
            
        except Exception as e:
            print(f"   ❌ 类型安全测试失败: {e}")
            return False
    
    def _generate_embedding(self, dimensions: int = 384, offset: float = 0.0) -> List[float]:
        """生成测试用的嵌入向量"""
        np.random.seed(42 + int(offset * 100))
        embedding = np.random.normal(offset, 0.1, dimensions)
        # L2归一化
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        return embedding.tolist()

def main():
    """主测试函数"""
    import sys
    
    # 从命令行参数获取服务URL
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8081"
    
    tester = AIWorkerIntegrationTest(base_url)
    success = tester.run_all_tests()
    
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main() 