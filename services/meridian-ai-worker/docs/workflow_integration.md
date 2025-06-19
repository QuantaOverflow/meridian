好的，根据 `workflow.integration.test.ts` 测试的成功运行结果，我为您整理了一份集成报告，其中包含了所需的数据接口定义以及集成工作流所需的初始数据准备。

---

# Meridian AI Worker 工作流集成报告

## 概述

本报告旨在总结 Meridian AI Worker 端到端集成工作流所需的数据接口定义，并提供集成该工作流所需的初始数据准备指南。该工作流涵盖了从模拟文章数据到最终简报生成的整个流程，包括故事验证、情报分析和简报生成等关键步骤。值得注意的是，当前聚类步骤在测试中是模拟的，因此其结果作为初始输入数据的一部分。

## 数据接口定义

以下是集成工作流中各关键环节的数据接口定义：

### 1. `ArticleDataset` (初始输入)

该接口定义了原始文章数据及其对应的嵌入向量，是整个工作流的起始数据。

```typescript
interface ArticleDataset {
  articles: Array<{
    id: number;
    title: string;
    content: string;
    publishDate: string;
    url: string;
    summary: string;
  }>;
  embeddings: Array<{
    articleId: number;
    embedding: number[]; // 384维向量
  }>;
}
```

### 2. `ClusteringResult` (模拟聚类结果，作为初始输入)

由于聚类步骤在测试中是模拟的，此接口代表了需要提供给故事验证步骤的聚类结果数据结构。

```typescript
interface ClusteringResult {
  clusters: Array<{
    clusterId: number;
    articleIds: number[];
    size: number;
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
    totalClusters: number;
    noisePoints: number;
    totalArticles: number;
  };
}
```

### 3. `MinimalArticleInfo` (从 `ArticleDataset` 转换，用于故事验证)

这是 `ArticleDataset` 的一个精简版本，包含了故事验证所需的最小文章信息。

```typescript
interface MinimalArticleInfo {
  id: number;
  title: string;
  url: string;
  event_summary_points?: string[]; // 可选，如果存在摘要则包含
}
```

### 4. `ValidatedStories` (故事验证输出)

这是故事验证步骤的输出，包含有效的故事列表和被拒绝的聚类列表。

```typescript
interface ValidatedStories {
    stories: Array<{
        title: string;
        importance: number; // 故事的重要性评分，范围 1-10
        articleIds: number[]; // 构成该故事的文章 ID 列表
        storyType: 'SINGLE_STORY' | 'COLLECTION_OF_STORIES'; // 故事类型
        // 实际类型定义可能包含更多字段，例如摘要、关键实体等
    }>;
    rejectedClusters: Array<{
        clusterId: number;
        articleIds: number[];
        rejectionReason: string; // 聚类被拒绝的原因
        // 实际类型定义可能包含更多字段
    }>;
}
```

### 5. `IntelligenceReports` (情报分析输出)

这是情报分析步骤的输出，包含了每个故事的详细情报报告。

```typescript
interface IntelligenceReports {
    reports: Array<{
        storyId: number;
        status: 'COMPLETE' | 'INCOMPLETE'; // 报告处理状态
        executiveSummary: string; // 故事的执行摘要
        storyStatus: 'DEVELOPING' | 'ESCALATING' | 'DE_ESCALATING' | 'CONCLUDING' | 'STATIC'; // 故事发展状态
        // 实际类型定义可能包含更多详细分析字段，例如关键实体、时间线、矛盾点、信源可靠性等
    }>;
    processingStatus: {
        totalStories: number; // 总故事数
        completedAnalyses: number; // 完成分析的故事数
        failedAnalyses: number; // 失败分析的故事数
    };
}
```

### 6. `FinalBrief` (最终简报输出)

这是简报生成步骤的最终输出。

```typescript
interface FinalBrief {
    title: string; // 最终简报的标题
    content: string; // 最终简报的 Markdown 格式内容
    // 实际类型定义可能包含更多元数据字段，例如生成时间、涵盖主题等
}
```

### 7. `TLDR` (简报摘要输出)

这是简报摘要生成步骤的输出。

```typescript
interface TLDR {
    tldr: string; // 简报的摘要内容
    // 实际类型定义可能包含更多元数据字段
}
```

## 集成工作流初始数据准备

为了成功运行 `workflow.integration.test.ts` 中定义的集成工作流（或在实际应用中集成类似流程），您需要准备以下初始数据：

1.  **`ArticleDataset` 数据准备：**
    您需要提供一批包含文章内容和对应嵌入向量的数据。这些数据将作为工作流的起点。在 `workflow.integration.test.ts` 中，`sampleArticleDataset` 变量用于模拟这部分数据。
    *   **示例数据结构：**
        ```typescript
        const sampleArticleDataset = {
          articles: [
            // 包含文章 ID, 标题, 内容, 发布日期, URL, 摘要等字段
            { id: 101, title: '...', content: '...', publishDate: '...', url: '...', summary: '...' },
            // ...更多文章
          ],
          embeddings: [
            // 每个文章 ID 对应一个嵌入向量 (384维数组)
            { articleId: 101, embedding: [/* ...384个数字... */] },
            // ...更多嵌入
          ]
        };
        ```
    *   **如何获取：** 在实际应用中，`articles` 数据通常来源于 RSS 抓取或数据库，`embeddings` 则需要通过机器学习服务（例如 `services/meridian-ml-service`）对文章内容进行向量化生成。

2.  **`ClusteringResult` 数据准备（模拟聚类阶段）：**
    由于当前测试中聚类是模拟的，您需要提供符合 `ClusteringResult` 接口的聚类结果数据。这个数据将直接输入到故事验证步骤。在 `workflow.integration.test.ts` 中，`mockClusteringResult` 变量用于模拟这部分数据。
    *   **示例数据结构：**
        ```typescript
        const mockClusteringResult = {
          clusters: [
            // 包含 clusterId, articleIds (属于该聚类的文章ID列表), size (聚类大小)
            { clusterId: 0, articleIds: [101, 102, 103, 104], size: 4 },
            { clusterId: 1, articleIds: [105, 106, 107], size: 3 }
          ],
          parameters: { /* UMAP 和 HDBSCAN 参数 */ },
          statistics: { /* 聚类统计信息 */ }
        };
        ```
    *   **如何获取：** 在实际应用中，`ClusteringResult` 应该由实际的聚类服务（例如 `services/meridian-ml-service`）根据 `ArticleDataset` 中的 `embeddings` 生成。在当前集成测试阶段，此部分需手动构造或从预设的模拟数据中加载。

### 初始数据转换

在将 `ArticleDataset` 传递给故事验证端点之前，通常需要将其转换为 `MinimalArticleInfo` 格式。`workflow.integration.test.ts` 中提供了一个 `convertArticleDatasetToMinimalArticleInfo` 工具函数来完成此转换。

```typescript
function convertArticleDatasetToMinimalArticleInfo(dataset: ArticleDataset): MinimalArticleInfo[] {
  if (!dataset || !dataset.articles) {
    return [];
  }
  return dataset.articles.map(article => ({
    id: article.id,
    title: article.title,
    url: article.url,
    event_summary_points: (article.summary && article.summary.trim() !== '') ? [article.summary] : undefined,
  }));
}
```

## 总结

这份报告详细列出了 Meridian AI Worker 工作流中各主要阶段的数据接口契约，并说明了在集成该工作流时所需的初始数据准备。通过遵循这些接口定义和数据准备指南，可以确保数据在不同服务和步骤之间正确流动，从而实现端到端的成功集成。