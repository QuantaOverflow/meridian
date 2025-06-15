# 聚类服务使用指南

本文档介绍如何使用集成的 Meridian ML Service 聚类功能。

## 概述

聚类服务提供了与 `intelligence-pipeline.test.ts` 完全兼容的数据契约，可以无缝替换测试中的 `MockClusteringService`。

## 基本使用

### 1. 导入服务

```typescript
import { 
  ClusteringService, 
  createClusteringService, 
  analyzeArticleClusters,
  type ArticleDataset,
  type ClusteringResult 
} from '../lib/clustering-service';
import type { AIWorkerEnv } from '../lib/ai-services';
```

### 2. 准备数据

```typescript
const dataset: ArticleDataset = {
  articles: [
    {
      id: 1,
      title: "AI技术发展趋势",
      content: "人工智能技术正在快速发展...",
      publishDate: "2024-01-15T10:00:00.000Z",
      url: "https://example.com/ai-trends",
      summary: "AI技术发展的最新趋势分析"
    },
    {
      id: 2,
      title: "机器学习应用",
      content: "机器学习在各行业的应用...",
      publishDate: "2024-01-15T11:00:00.000Z", 
      url: "https://example.com/ml-applications",
      summary: "机器学习的实际应用案例"
    }
  ],
  embeddings: [
    {
      articleId: 1,
      embedding: [0.1, 0.2, 0.3, ...] // 384维向量
    },
    {
      articleId: 2,
      embedding: [0.4, 0.5, 0.6, ...] // 384维向量
    }
  ]
};
```

### 3. 执行聚类分析

#### 方法一：使用便捷函数

```typescript
async function performClustering(env: AIWorkerEnv, dataset: ArticleDataset) {
  const result = await analyzeArticleClusters(env, dataset);
  
  if (result.success && result.data) {
    console.log(`发现 ${result.data.statistics.totalClusters} 个聚类`);
    console.log(`处理了 ${result.data.statistics.totalArticles} 篇文章`);
    
    result.data.clusters.forEach(cluster => {
      console.log(`聚类 ${cluster.clusterId}: ${cluster.size} 篇文章`);
      console.log(`文章ID: ${cluster.articleIds.join(', ')}`);
    });
  } else {
    console.error('聚类分析失败:', result.error);
  }
}
```

#### 方法二：使用服务类

```typescript
async function performClusteringWithService(env: AIWorkerEnv, dataset: ArticleDataset) {
  const clusteringService = createClusteringService(env);
  
  // 健康检查
  const healthCheck = await clusteringService.healthCheck();
  if (!healthCheck.success) {
    throw new Error(`ML服务不可用: ${healthCheck.error}`);
  }
  
  // 执行聚类分析
  const result = await clusteringService.analyzeClusters(dataset, {
    umapParams: {
      n_neighbors: 20,
      n_components: 15,
      min_dist: 0.1,
      metric: 'cosine'
    },
    hdbscanParams: {
      min_cluster_size: 3,
      min_samples: 2,
      epsilon: 0.3
    }
  });
  
  return result;
}
```

## 在工作流中使用

### 替换 MockClusteringService

在现有的工作流代码中，可以直接替换 Mock 服务：

```typescript
// 之前的代码
// const clusteringService = new MockClusteringService();

// 现在的代码
const clusteringService = createClusteringService(env);

// 接口完全兼容
const result = await clusteringService.analyzeClusters(dataset);
```

### 在 Cloudflare Workers 中使用

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      // 从数据库获取已处理的文章数据
      const articles = await getProcessedArticles(env);
      const embeddings = await getArticleEmbeddings(env);
      
      const dataset: ArticleDataset = {
        articles: articles.map(article => ({
          id: article.id,
          title: article.title,
          content: article.content || '',
          publishDate: article.publishDate?.toISOString() || new Date().toISOString(),
          url: article.url,
          summary: article.event_summary_points?.join('; ') || ''
        })),
        embeddings: embeddings.map(emb => ({
          articleId: emb.articleId,
          embedding: emb.embedding
        }))
      };
      
      // 执行聚类分析
      const clusteringResult = await analyzeArticleClusters(env, dataset);
      
      if (clusteringResult.success) {
        return Response.json({
          success: true,
          data: clusteringResult.data
        });
      } else {
        return Response.json({
          success: false,
          error: clusteringResult.error
        }, { status: 500 });
      }
      
    } catch (error) {
      return Response.json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }
  }
};
```

## 数据契约

### 输入格式 (ArticleDataset)

```typescript
interface ArticleDataset {
  articles: Array<{
    id: number;           // 文章唯一ID
    title: string;        // 文章标题
    content: string;      // 文章内容
    publishDate: string;  // ISO 8601 格式的发布日期
    url: string;          // 文章URL
    summary: string;      // 文章摘要
  }>;
  embeddings: Array<{
    articleId: number;    // 对应文章ID
    embedding: number[];  // 384维嵌入向量
  }>;
}
```

### 输出格式 (ClusteringResult)

```typescript
interface ClusteringResult {
  clusters: Array<{
    clusterId: number;    // 聚类ID
    articleIds: number[]; // 聚类中的文章ID列表
    size: number;         // 聚类大小
  }>;
  parameters: {
    umapParams: {
      n_neighbors: number;
      n_components: number;
      min_dist: number;
      metric: string;
    };
    hdbscanParams: {
      min_cluster_size: number;
      min_samples: number;
      epsilon: number;
    };
  };
  statistics: {
    totalClusters: number;  // 总聚类数
    noisePoints: number;    // 噪声点数量
    totalArticles: number;  // 总文章数
  };
}
```

## 错误处理

服务提供统一的错误处理格式：

```typescript
interface ClusteringServiceResponse {
  success: boolean;
  data?: ClusteringResult;
  error?: string;
}
```

常见错误类型：
- `"Dataset is empty"` - 输入数据为空
- `"Mismatch between articles and embeddings count"` - 文章和嵌入向量数量不匹配
- `"Missing embedding for article {id}"` - 缺少特定文章的嵌入向量
- `"ML service health check failed"` - ML服务不可用

## 配置选项

可以通过环境变量配置ML服务：

```bash
MERIDIAN_ML_SERVICE_URL=https://your-ml-service.com
MERIDIAN_ML_SERVICE_API_KEY=your-api-key
```

## 性能考虑

1. **批量处理**: 建议一次处理多篇文章而不是单篇处理
2. **缓存结果**: 对于相同的数据集，可以缓存聚类结果
3. **异步处理**: 聚类分析可能耗时较长，建议在后台任务中执行
4. **资源限制**: 注意 Cloudflare Workers 的执行时间限制

## 监控和日志

服务会自动记录关键操作：

```typescript
// 启用详细日志
const result = await clusteringService.analyzeClusters(dataset);
console.log('聚类分析完成:', {
  success: result.success,
  clustersFound: result.data?.statistics.totalClusters,
  articlesProcessed: result.data?.statistics.totalArticles
});
``` 