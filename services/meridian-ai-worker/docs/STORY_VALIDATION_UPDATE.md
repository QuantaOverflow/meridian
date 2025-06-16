# Story Validation 端点更新文档

## 概述

更新了 `/meridian/story/validate` 端点，增加了对文章详细信息的支持，使 AI 能够基于文章标题、URL 和摘要要点进行更准确的故事验证。

## 主要变更

### 1. 新增 MinimalArticleInfo 接口

```typescript
interface MinimalArticleInfo {
  id: number
  title: string
  url: string
  event_summary_points?: string[]
}
```

### 2. 更新请求体格式

**之前（仅需要聚类信息）：**
```json
{
  "clusteringResult": {
    "clusters": [...],
    "parameters": {...},
    "statistics": {...}
  },
  "useAI": true
}
```

**现在（需要聚类信息 + 文章数据）：**
```json
{
  "clusteringResult": {
    "clusters": [...],
    "parameters": {...},
    "statistics": {...}
  },
  "articlesData": [
    {
      "id": 101,
      "title": "文章标题",
      "url": "https://example.com/article",
      "event_summary_points": ["摘要要点1", "摘要要点2"]
    }
  ],
  "useAI": true
}
```

### 3. 增强的 AI 分析

现在 AI 能够获得：
- 文章的实际标题（而非仅ID）
- 文章的来源URL
- 文章的关键摘要要点

这使得故事验证更加准确和智能。

### 4. 更新的元数据

响应中新增了 `totalArticlesProvided` 字段：
```json
{
  "success": true,
  "data": {...},
  "metadata": {
    "totalClusters": 2,
    "totalArticlesProvided": 7,  // 新增字段
    "validatedStories": 2,
    "rejectedClusters": 0
  }
}
```

## 数据转换工具

创建了 `convertArticleDatasetToMinimalArticleInfo` 函数来将完整的 `ArticleDataset` 转换为精简的 `MinimalArticleInfo[]`：

```typescript
function convertArticleDatasetToMinimalArticleInfo(dataset: ArticleDataset): MinimalArticleInfo[] {
  return dataset.articles.map(article => ({
    id: article.id,
    title: article.title,
    url: article.url,
    event_summary_points: (article.summary && article.summary.trim() !== '') 
      ? [article.summary] 
      : undefined,
  }));
}
```

## 更新的文件

### 测试文件
- `tests/storyValidate.test.ts` - 11个测试用例全部更新并通过
- `tests/workflow.integration.test.ts` - 端到端工作流测试更新并通过

### 核心文件
- `src/index.ts` - 主要的端点实现和接口定义
- `src/prompts/storyValidation.ts` - 更新提示词说明

## 向后兼容性

该更新是**破坏性变更**，所有调用方必须：

1. 在请求体中添加 `articlesData` 参数
2. 确保 `articlesData` 包含所有聚类中引用的文章信息

## 性能优化

- 移除了文章的 `content` 字段，显著减少了数据传输量
- 只保留故事验证所需的核心信息
- 提升了 AI 分析的准确性和效率

## 测试结果

✅ 所有 11 个故事验证测试通过  
✅ 端到端工作流集成测试通过  
✅ 数据完整性验证通过  
✅ 新接口契约验证通过  

## 下一步

需要更新其他调用该端点的服务：
- `apps/backend/src/lib/ai-services.ts`
- `apps/backend/test/workflows/auto-brief-generation.integration.test.ts`

这些文件不在当前更新范围内，但需要在后续工作中进行相应更新。 