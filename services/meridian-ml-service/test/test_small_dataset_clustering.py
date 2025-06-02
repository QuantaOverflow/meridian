#!/usr/bin/env python3
"""
小数据集聚类优化测试
针对12篇文章这种小规模数据集，测试不同的参数配置
"""

import asyncio
import httpx
import json
from typing import List, Dict, Any
import os

# ML服务配置
ML_SERVICE_BASE_URL = 'http://localhost:8081'
API_TOKEN = 'dev-token-123'

async def load_mock_articles(filename: str = "mock_articles.json") -> List[Dict[str, Any]]:
    """加载生成的模拟文章"""
    
    if not os.path.exists(filename):
        print(f"❌ 文件 {filename} 不存在")
        print("💡 请先运行 generate_mock_articles.py 生成模拟文章")
        return []
    
    with open(filename, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    articles = data.get('articles', [])
    print(f"📚 加载了 {len(articles)} 篇模拟文章")
    
    return articles

async def test_optimized_small_dataset_clustering(articles: List[Dict[str, Any]]):
    """测试针对小数据集优化的聚类参数"""
    
    headers = {'X-API-Token': API_TOKEN}
    
    # 准备测试数据
    test_texts = []
    article_info = []
    
    for article in articles:
        # 使用标题+内容的前300字符
        content = article.get('content', '')
        text = f"{article['title']}\n\n{content[:300]}..."
        test_texts.append(text)
        
        article_info.append({
            'id': article['id'],
            'title': article['title'],
            'category': article['category'],
            'content_length': len(content)
        })
    
    print(f"\n🧪 开始小数据集优化聚类测试 ({len(test_texts)} 篇文章)")
    
    async with httpx.AsyncClient(timeout=120) as client:
        
        # 测试配置1: 宽松的HDBSCAN参数
        print("\n1️⃣ 测试配置1: 宽松HDBSCAN参数...")
        
        config1 = {
            'texts': test_texts,
            'clustering_config': {
                'umap_n_components': 5,  # 降低维度
                'umap_n_neighbors': 8,   # 减少邻居数
                'umap_min_dist': 0.1,    # 增加最小距离
                'umap_metric': 'cosine',
                'hdbscan_min_cluster_size': 2,  # 最小簇大小改为2
                'hdbscan_min_samples': 1,       # 最小样本数改为1
                'hdbscan_cluster_selection_epsilon': 0.1,  # 允许一定密度波动
                'hdbscan_metric': 'euclidean',
                'normalize_embeddings': True
            }
        }
        
        try:
            response = await client.post(
                f'{ML_SERVICE_BASE_URL}/embeddings-and-clustering',
                json=config1,
                headers=headers
            )
            
            if response.status_code == 200:
                result = response.json()
                await analyze_clustering_result(result['clustering_result'], article_info, "宽松HDBSCAN")
            else:
                print(f"❌ 配置1失败: {response.status_code} - {response.text}")
                
        except Exception as e:
            print(f"❌ 配置1异常: {e}")
        
        # 测试配置2: 极简参数
        print("\n2️⃣ 测试配置2: 极简参数...")
        
        config2 = {
            'texts': test_texts,
            'clustering_config': {
                'umap_n_components': 3,  # 进一步降低维度
                'umap_n_neighbors': 5,   # 更少邻居
                'umap_min_dist': 0.2,    # 更大最小距离
                'umap_metric': 'cosine',
                'hdbscan_min_cluster_size': 2,  # 最小簇大小
                'hdbscan_min_samples': 1,       # 最小样本数
                'hdbscan_cluster_selection_epsilon': 0.2,  # 更宽松的密度要求
                'hdbscan_metric': 'euclidean',
                'normalize_embeddings': True
            }
        }
        
        try:
            response = await client.post(
                f'{ML_SERVICE_BASE_URL}/embeddings-and-clustering',
                json=config2,
                headers=headers
            )
            
            if response.status_code == 200:
                result = response.json()
                await analyze_clustering_result(result['clustering_result'], article_info, "极简参数")
            else:
                print(f"❌ 配置2失败: {response.status_code} - {response.text}")
                
        except Exception as e:
            print(f"❌ 配置2异常: {e}")
        
        # 测试配置3: 优化的网格搜索
        print("\n3️⃣ 测试配置3: 小数据集专用网格搜索...")
        
        config3 = {
            'texts': test_texts,
            'use_optimization': True,
            'grid_config': {
                'umap_n_neighbors': [3, 5, 8],         # 小数据集适用的邻居数
                'umap_n_components': 3,                 # 固定低维度
                'umap_min_dist': 0.1,                   # 固定中等距离
                'umap_metric': 'cosine',                # 固定cosine
                'hdbscan_min_cluster_size': [2, 3],     # 小簇大小
                'hdbscan_min_samples': [1, 2],          # 小样本数
                'hdbscan_epsilon': [0.1, 0.2, 0.3],     # 宽松密度
                'hdbscan_metric': 'euclidean'           # 固定euclidean
            }
        }
        
        try:
            response = await client.post(
                f'{ML_SERVICE_BASE_URL}/clustering/optimized',
                json=config3,
                headers=headers
            )
            
            if response.status_code == 200:
                result = response.json()
                await analyze_clustering_result(result, article_info, "小数据集网格搜索")
            else:
                print(f"❌ 配置3失败: {response.status_code} - {response.text}")
                
        except Exception as e:
            print(f"❌ 配置3异常: {e}")

async def analyze_clustering_result(result: Dict[str, Any], article_info: List[Dict[str, Any]], method_name: str):
    """分析聚类结果"""
    
    print(f"\n📊 {method_name}结果分析:")
    
    # 基础统计
    stats = result.get('clustering_stats', {})
    cluster_labels = result.get('cluster_labels', [])
    
    # 构建cluster结构用于分析
    original_clusters_list = {}
    for i, label in enumerate(cluster_labels):
        if label not in original_clusters_list:
            original_clusters_list[label] = []
        original_clusters_list[label].append(i)

    clusters = sorted(
        [{'cluster_id': label, 'members': indices} for label, indices in original_clusters_list.items()],
        key=lambda x: x['cluster_id'] if x['cluster_id'] != -1 else float('inf')
    )

    print(f"   🔢 基础统计:")
    print(f"      - 总文章数: {stats.get('n_samples', len(article_info))}")
    print(f"      - 聚类数量: {stats.get('n_clusters', len([k for k in original_clusters_list if k != -1]))}")
    print(f"      - 噪声点数: {stats.get('n_outliers', len(original_clusters_list.get(-1, [])))}")
    clustered_count = len(cluster_labels) - len(original_clusters_list.get(-1, []))
    clustering_rate = clustered_count / len(cluster_labels) if cluster_labels else 0
    print(f"      - 聚类率: {clustering_rate:.1%}")
    
    if result.get('optimization', {}).get('used'):
        dbcv_score = result.get('optimization', {}).get('best_dbcv_score')
        if dbcv_score is not None:
            print(f"      - 优化分数 (DBCV): {dbcv_score:.3f}")
    
    # 聚类详情
    if clusters:
        print(f"\n   📝 聚类详情:")
        
        for cluster in clusters:
            cluster_id = cluster['cluster_id']
            member_indices = cluster['members']
            
            if cluster_id == -1:
                print(f"      🔸 噪声点 ({len(member_indices)} 篇):")
            else:
                print(f"      📁 聚类 {cluster_id} ({len(member_indices)} 篇):")
            
            # 显示该聚类中的文章
            cluster_articles = [article_info[i] for i in member_indices if i < len(article_info)]
            
            # 按类别统计
            category_count = {}
            for article in cluster_articles:
                cat = article['category']
                category_count[cat] = category_count.get(cat, 0) + 1
            
            print(f"         类别分布: {dict(category_count)}")
            
            # 显示文章标题
            for i, article in enumerate(cluster_articles[:2]):  # 只显示前2篇
                print(f"         • {article['title'][:40]}...")
            
            if len(cluster_articles) > 2:
                print(f"         ... 还有 {len(cluster_articles) - 2} 篇")
    
    # 聚类质量评估
    await evaluate_clustering_quality(clusters, article_info)

async def evaluate_clustering_quality(clusters: List[Dict[str, Any]], article_info: List[Dict[str, Any]]):
    """评估聚类质量"""
    
    print(f"\n   🎯 聚类质量评估:")
    
    # 计算类别纯度
    total_purity = 0
    valid_clusters = 0
    
    for cluster in clusters:
        if cluster['cluster_id'] == -1:  # 跳过噪声点
            continue
            
        member_indices = cluster['members']
        if len(member_indices) < 1:  # 调整为至少1篇文章
            continue
            
        # 获取该聚类的所有文章类别
        categories = []
        for idx in member_indices:
            if idx < len(article_info):
                categories.append(article_info[idx]['category'])
        
        if categories:
            # 计算主要类别的纯度
            category_count = {}
            for cat in categories:
                category_count[cat] = category_count.get(cat, 0) + 1
            
            max_count = max(category_count.values())
            purity = max_count / len(categories)
            total_purity += purity
            valid_clusters += 1
            
            main_category = max(category_count, key=category_count.get)
            print(f"      聚类 {cluster['cluster_id']}: 纯度 {purity:.1%} (主要类别: {main_category})")
    
    if valid_clusters > 0:
        avg_purity = total_purity / valid_clusters
        print(f"      📈 平均纯度: {avg_purity:.1%}")
        
        if avg_purity >= 0.8:
            print(f"      ✅ 聚类质量: 优秀")
        elif avg_purity >= 0.6:
            print(f"      🔶 聚类质量: 良好")
        else:
            print(f"      ⚠️ 聚类质量: 需要改进")
    else:
        print(f"      ❌ 没有有效聚类生成")

async def main():
    """主函数"""
    print("🔬 小数据集聚类优化测试")
    print("=" * 60)
    
    # 加载模拟文章
    articles = await load_mock_articles('/Users/shiwenjie/Developer/meridian/services/meridian-ml-service/test/mock_articles.json')
    
    if not articles:
        return
    
    # 执行优化聚类测试
    await test_optimized_small_dataset_clustering(articles)
    
    print(f"\n🎉 小数据集聚类优化测试完成!")
    print("💡 建议:")
    print("   1. 对于小数据集，使用min_cluster_size=2")
    print("   2. 适当增加epsilon参数允许密度波动")
    print("   3. 降低UMAP的维度和邻居数")
    print("   4. 考虑使用不同的嵌入模型或预处理策略")

if __name__ == "__main__":
    asyncio.run(main()) 