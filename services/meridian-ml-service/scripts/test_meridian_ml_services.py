import requests
import json
import time

# --- 配置 ---
BASE_URL = "http://107.174.196.203:8080"
API_TOKEN = "f10c0976a3e273a7829666c3c5af658e5d9aee790187617b98e8c6e5d35d6336" # 替换为您的实际API令牌

HEADERS = {
    "Content-Type": "application/json",
    "X-API-Token": API_TOKEN
}

# 384维的零向量示例（实际项目中应使用真实的嵌入向量）
# 为了简洁，这里只展示部分，实际需要384个浮点数
ZERO_EMBEDDING_384D = [0.0] * 384
# 稍微不同的向量用于聚类测试
SAMPLE_EMBEDDING_1 = [x * 0.01 for x in range(384)]
SAMPLE_EMBEDDING_2 = [x * 0.02 for x in range(384)]
SAMPLE_EMBEDDING_3 = [x * 1.0 for x in range(384)]
SAMPLE_EMBEDDING_4 = [x * 1.01 for x in range(384)]
SAMPLE_EMBEDDING_5 = [x * 1.02 for x in range(384)]


def test_endpoint(name, url, method="GET", data=None):
    """通用端点测试函数"""
    print(f"\n--- 测试: {name} ({url}) ---")
    try:
        if method == "GET":
            response = requests.get(url)
        elif method == "POST":
            response = requests.post(url, headers=HEADERS, data=json.dumps(data))
        else:
            print("❌ 不支持的HTTP方法")
            return False

        response.raise_for_status()  # 如果状态码不是2xx，则抛出HTTPError

        json_response = response.json()
        print("✅ 请求成功")
        print("响应:")
        print(json.dumps(json_response, indent=2, ensure_ascii=False))
        return True
    except requests.exceptions.RequestException as e:
        print(f"❌ 请求失败: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"状态码: {e.response.status_code}")
            print(f"响应内容: {e.response.text}")
        return False
    except json.JSONDecodeError:
        print("❌ 响应不是有效的JSON")
        print(f"响应内容: {response.text}")
        return False

def run_all_tests():
    """运行所有端点测试"""
    print(f"开始测试 Meridian ML Service (URL: {BASE_URL})")

    # 1. 测试服务根端点
    test_endpoint("服务根端点", f"{BASE_URL}/")

    # 2. 测试健康检查
    test_endpoint("健康检查", f"{BASE_URL}/health")

    # 3. 测试获取系统指标
    test_endpoint("获取系统指标", f"{BASE_URL}/metrics")

    # 4. 测试获取当前配置
    test_endpoint("获取当前配置", f"{BASE_URL}/config")

    # 5. 测试嵌入生成
    embedding_data = {
        "texts": ["测试文本", "Meridian ML Service", "AI驱动的智能聚类分析"],
        "normalize": True
    }
    test_endpoint("嵌入生成", f"{BASE_URL}/embeddings", method="POST", data=embedding_data)

    # 6. 测试 AI Worker 集成聚类端点
    ai_worker_clustering_data = {
        "items": [
            {"id": 1, "embedding": ZERO_EMBEDDING_384D},
            {"id": 2, "embedding": SAMPLE_EMBEDDING_1},
            {"id": 3, "embedding": SAMPLE_EMBEDDING_2},
            {"id": 4, "embedding": SAMPLE_EMBEDDING_3},
            {"id": 5, "embedding": SAMPLE_EMBEDDING_4},
            {"id": 6, "embedding": SAMPLE_EMBEDDING_5}
        ],
        "config": {
            "umap_n_components": 2,
            "umap_n_neighbors": 3,
            "hdbscan_min_cluster_size": 2
        },
        "return_embeddings": True,
        "return_reduced_embeddings": True
    }
    test_endpoint("AI Worker 聚类", f"{BASE_URL}/ai-worker/clustering", method="POST", data=ai_worker_clustering_data)

    # 7. 测试智能自动检测聚类端点 (纯文本输入)
    auto_clustering_text_data = {
        "items": [
            {"id": "text_1", "text": "苹果手机的最新款 iPhone 15 功能强大，价格不菲。"},
            {"id": "text_2", "text": "华为新发布的 Mate 60 Pro 搭载了先进的芯片技术，备受关注。"},
            {"id": "text_3", "text": "三星 Galaxy S24 Ultra 以其卓越的拍照能力和屏幕显示效果脱颖而出。"},
            {"id": "text_4", "text": "智能手表市场持续增长，Apple Watch 和 Samsung Galaxy Watch 是主要竞争者。"},
            {"id": "text_5", "text": "AirPods Pro 2 提供了出色的音质和降噪功能，受到用户喜爱。"},
            {"id": "text_6", "text": "各类耳机产品层出不穷，消费者选择多样。"}
        ],
        "config": {
            "umap_n_components": 2,
            "umap_n_neighbors": 3,
            "hdbscan_min_cluster_size": 2
        },
        "content_analysis": {
            "enabled": True,
            "include_keywords": True,
            "include_summaries": False,
            "top_n_per_cluster": 2
        },
        "return_embeddings": False,
        "return_reduced_embeddings": True
    }
    test_endpoint("智能自动检测聚类 (纯文本)", f"{BASE_URL}/clustering/auto", method="POST", data=auto_clustering_text_data)

    print("\n--- 所有测试完成 ---")

if __name__ == "__main__":
    run_all_tests()