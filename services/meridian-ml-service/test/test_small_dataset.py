#!/usr/bin/env python3
"""
小数据集测试 - 验证修复效果
测试3个文本的极小数据集，这在修复前会导致UMAP错误
"""

import asyncio
import httpx

async def test_small_dataset():
    base_url = 'http://localhost:8081'
    headers = {'X-API-Token': 'dev-token-123'}
    
    # 只有3个文本的小数据集（之前会导致错误）
    small_texts = [
        '人工智能最新进展',
        '机器学习算法优化', 
        '深度学习模型训练'
    ]
    
    payload = {'texts': small_texts}
    
    async with httpx.AsyncClient(timeout=60) as client:
        print('🧪 测试小数据集聚类（3个文本）...')
        print('   这在修复前会导致UMAP错误')
        
        # 测试标准聚类
        print('\n1. 测试标准聚类...')
        try:
            response = await client.post(f'{base_url}/clustering', json=payload, headers=headers)
            if response.status_code == 200:
                result = response.json()
                stats = result['clustering_stats']
                print(f'   ✅ 标准聚类成功: {len(result["cluster_labels"])} 个标签')
                print(f'   📊 簇数量: {stats["n_clusters"]}, 异常点: {stats["n_outliers"]}')
                
                # 验证数据类型（这是我们修复的关键问题）
                assert isinstance(stats['n_clusters'], int), "n_clusters 应该是 int 类型"
                assert isinstance(stats['n_outliers'], int), "n_outliers 应该是 int 类型"
                print('   ✅ 数据类型验证通过（numpy类型已正确转换）')
            else:
                print(f'   ❌ 标准聚类失败: {response.status_code}')
                print(f'   错误详情: {response.text}')
        except Exception as e:
            print(f'   ❌ 标准聚类异常: {e}')
            
        # 测试优化聚类
        print('\n2. 测试优化聚类...')
        try:
            response = await client.post(f'{base_url}/clustering/optimized', json=payload, headers=headers)
            if response.status_code == 200:
                result = response.json()
                stats = result['clustering_stats']
                print(f'   ✅ 优化聚类成功: {len(result["cluster_labels"])} 个标签')
                print(f'   📊 簇数量: {stats["n_clusters"]}, 异常点: {stats["n_outliers"]}')
                
                # 检查优化是否被跳过（小数据集会自动跳过优化）
                optimization = result.get('optimization', {})
                if optimization.get('used'):
                    dbcv_score = optimization.get('best_dbcv_score')
                    print(f'   🎯 参数优化已执行，DBCV分数: {dbcv_score}')
                else:
                    print('   ⏭️  参数优化被跳过（数据集过小）')
            else:
                print(f'   ❌ 优化聚类失败: {response.status_code}')
                print(f'   错误详情: {response.text}')
        except Exception as e:
            print(f'   ❌ 优化聚类异常: {e}')
            
        # 测试完整处理（优化模式）
        print('\n3. 测试完整处理（优化模式）...')
        try:
            data_with_optimization = {
                "texts": small_texts,
                "use_optimization": True
            }
            response = await client.post(f'{base_url}/embeddings-and-clustering', 
                                       json=data_with_optimization, headers=headers)
            if response.status_code == 200:
                result = response.json()
                clustering_result = result['clustering_result']
                stats = clustering_result['clustering_stats']
                print(f'   ✅ 完整处理成功: {len(clustering_result["cluster_labels"])} 个标签')
                print(f'   📊 簇数量: {stats["n_clusters"]}, 异常点: {stats["n_outliers"]}')
                print(f'   ⏱️  处理时间: {result.get("processing_time", "N/A"):.3f}秒')
            else:
                print(f'   ❌ 完整处理失败: {response.status_code}')
                print(f'   错误详情: {response.text}')
        except Exception as e:
            print(f'   ❌ 完整处理异常: {e}')

print('🚀 开始小数据集修复验证测试...')
asyncio.run(test_small_dataset())
print('\n✨ 小数据集测试完成！') 