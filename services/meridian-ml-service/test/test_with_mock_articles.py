#!/usr/bin/env python3
"""
使用模拟文章测试聚类功能
读取生成的模拟文章，测试ML服务的聚类效果
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
    
    # 显示文章统计
    categories = {}
    total_length = 0
    
    for article in articles:
        cat = article.get('category', 'unknown')
        categories[cat] = categories.get(cat, 0) + 1
        content_length = len(article.get('content', ''))
        total_length += content_length
    
    print(f"📊 文章统计:")
    for cat, count in categories.items():
        print(f"   - {cat}: {count} 篇")
    print(f"   - 平均长度: {total_length // len(articles):,} 字符")
    
    return articles

async def test_clustering(articles: List[Dict[str, Any]]):
    """测试聚类功能"""
    
    headers = {'X-API-Token': API_TOKEN}
    
    # 准备测试数据
    test_texts = []
    article_info = []
    
    for article in articles:
        # 使用标题+内容的前500字符作为测试文本
        content = article.get('content', '')
        text = f"{article['title']}\n\n{content[:500]}..."
        test_texts.append(text)
        
        article_info.append({
            'id': article['id'],
            'title': article['title'],
            'category': article['category'],
            'content_length': len(content)
        })
    
    print(f"\n🧪 开始聚类测试 ({len(test_texts)} 篇文章)")
    
    async with httpx.AsyncClient(timeout=120) as client:
        # 1. 测试标准聚类
        print("\n1️⃣ 测试标准聚类...")
        
        payload = {'texts': test_texts}
        
        try:
            response = await client.post(
                f'{ML_SERVICE_BASE_URL}/clustering',
                json=payload,
                headers=headers
            )
            
            if response.status_code == 200:
                result = response.json()
                await analyze_clustering_result(result, article_info, "标准聚类")
            else:
                print(f"❌ 标准聚类失败: {response.status_code} - {response.text}")
                
        except Exception as e:
            print(f"❌ 标准聚类异常: {e}")
        
        # 2. 测试优化聚类
        print("\n2️⃣ 测试优化聚类...")
        
        payload = {
            'texts': test_texts,
            'use_optimization': True
        }
        
        try:
            response = await client.post(
                f'{ML_SERVICE_BASE_URL}/clustering/optimized',
                json=payload,
                headers=headers
            )
            
            if response.status_code == 200:
                result = response.json()
                await analyze_clustering_result(result, article_info, "优化聚类")
            else:
                print(f"❌ 优化聚类失败: {response.status_code} - {response.text}")
                
        except Exception as e:
            print(f"❌ 优化聚类异常: {e}")

async def analyze_clustering_result(result: Dict[str, Any], article_info: List[Dict[str, Any]], method_name: str):
    """分析聚类结果"""
    
    print(f"\n📊 {method_name}结果分析:")
    
    # 基础统计
    stats = result.get('clustering_stats', {})
    
    # 从ml服务响应中获取cluster_labels和cluster_content
    cluster_labels = result.get('cluster_labels', [])
    cluster_content_map = result.get('cluster_content', {}) # 这是个字典，key是cluster_id，value是文章内容列表
    
    # 根据cluster_labels和article_info构建符合原先测试逻辑的clusters列表
    # original_clusters_list 用于存储每个cluster_id对应的文章索引
    original_clusters_list = {}
    for i, label in enumerate(cluster_labels):
        if label not in original_clusters_list:
            original_clusters_list[label] = []
        original_clusters_list[label].append(i)

    # 转换成测试脚本期望的格式
    # clusters = [{'cluster_id': label, 'members': indices} for label, indices in original_clusters_list.items()]
    # 确保噪声点（-1）排在最后
    clusters = sorted(
        [{'cluster_id': label, 'members': indices} for label, indices in original_clusters_list.items()],
        key=lambda x: x['cluster_id'] if x['cluster_id'] != -1 else float('inf')
    )


    print(f"   🔢 基础统计:")
    print(f"      - 总文章数: {stats.get('total_items', len(article_info))}") # 使用article_info的长度作为总文章数
    print(f"      - 聚类数量: {stats.get('n_clusters', len([k for k in original_clusters_list if k != -1]))}") # 统计非噪声点的聚类数量
    print(f"      - 噪声点数: {stats.get('n_noise', len(original_clusters_list.get(-1, [])))}") # 统计噪声点数量
    print(f"      - 聚类率: {stats.get('clustered_ratio', 0):.1%}") # 聚类率可能需要重新计算或从stats中获取
    
    if 'optimization_score' in result:
        print(f"      - 优化分数: {result['optimization_score']:.3f}")
    elif result.get('optimization', {}).get('used') and result.get('optimization', {}).get('best_dbcv_score') is not None:
        print(f"      - 优化分数 (DBCV): {result['optimization']['best_dbcv_score']:.3f}") # 从优化结果中获取DBCV分数
    
    # 聚类详情
    if clusters: # 现在clusters会是正确的格式
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
            
            # 显示前3篇文章标题
            for i, article in enumerate(cluster_articles[:3]):
                print(f"         • {article['title'][:50]}...")
            
            if len(cluster_articles) > 3:
                print(f"         ... 还有 {len(cluster_articles) - 3} 篇")
    
    # 聚类质量评估
    await evaluate_clustering_quality(clusters, article_info) # 这里使用新的clusters

async def evaluate_clustering_quality(clusters: List[Dict[str, Any]], article_info: List[Dict[str, Any]]):
    """评估聚类质量"""
    
    print(f"\n   🎯 聚类质量评估:")
    
    # 计算类别纯度 (同一聚类中相同类别文章的比例)
    total_purity = 0
    valid_clusters = 0
    
    for cluster in clusters:
        if cluster['cluster_id'] == -1:  # 跳过噪声点
            continue
            
        member_indices = cluster['members']
        if len(member_indices) < 2:  # 跳过单文章聚类
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

async def main():
    """主函数"""
    print("🔬 模拟文章聚类测试")
    print("=" * 50)
    
    # 加载模拟文章
    articles = await load_mock_articles('/Users/shiwenjie/Developer/meridian/services/meridian-ml-service/test/mock_articles.json')
    
    if not articles:
        return
    
    # 执行聚类测试
    await test_clustering(articles)
    
    print(f"\n🎉 聚类测试完成!")
    print("💡 可以根据结果调整聚类参数以获得更好的效果")

if __name__ == "__main__":
    asyncio.run(main()) 