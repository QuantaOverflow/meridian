# Meridian 工作流架构文档

## 项目概述

Meridian是一个AI驱动的个性化情报简报系统，基于Cloudflare生态构建。系统采用事件驱动的工作流架构，将新闻处理从文章抓取到简报生成分解为多个独立但协调的阶段。

## 核心工作流架构

### Feature: 端到端新闻情报处理管道

系统由两个主要工作流组成，遵循清晰的数据流转换模式：

1. **文章处理工作流** (ProcessArticles) - 将原始RSS数据转换为结构化的分析数据
2. **情报分析管道** (Intelligence Pipeline) - 将分析数据转换为最终简报

## 工作流1: 文章处理工作流 (ProcessArticles)

### Given: 输入数据结构
```typescript
type ProcessArticlesParams = {
  articles_id: number[]  // 待处理文章ID列表
}

// 数据库中的原始文章记录
interface RawArticle {
  id: number
  url: string
  title: string
  publishDate: Date
  status: null  // 未处理状态
  processedAt: null
}
```

### When: 执行文章处理管道

#### 阶段1: 文章筛选和获取
**行为描述**: 系统根据业务规则筛选需要处理的文章
- **输入**: 文章ID数组
- **过滤条件**:
  - 未处理的文章 (`processedAt` 为空)
  - 48小时内发布的文章
  - 无失败记录的文章
- **输出**: 符合条件的文章记录

#### 阶段2: 智能内容抓取
**行为描述**: 系统使用自适应策略获取文章全文内容

**组件依赖**:
- `DomainRateLimiter` - 域名级别的速率控制
- `getArticleWithBrowser` - 浏览器渲染抓取
- `getArticleWithFetch` - 轻量级HTTP抓取

**业务规则**:
- 特殊域名列表使用浏览器渲染策略
- 常规域名优先使用fetch，失败时降级到浏览器
- PDF文件直接标记为跳过
- 并发控制: 最大8个并发，全局冷却1秒，域名冷却5秒

**数据转换**:
```
RawArticle -> {
  id: number
  title: string
  text: string        // 提取的全文内容
  publishedTime?: string
}
```

#### 阶段3: AI内容分析
**行为描述**: 系统使用AI模型深度分析文章内容和语义

**依赖服务**:
- `AIWorkerService.analyzeArticle()` - 使用Gemini 2.0 Flash模型

**分析维度**:
- 语言识别
- 地理位置标记
- 内容完整性评估 (`COMPLETE` | `PARTIAL_USEFUL` | `PARTIAL_USELESS`)
- 内容质量评级 (`OK` | `LOW_QUALITY` | `JUNK`)
- 事件摘要要点提取
- 主题关键词识别
- 话题标签生成
- 关键实体识别
- 内容焦点分析

#### 阶段4: 语义向量化
**行为描述**: 系统将文章内容转换为384维语义向量

**依赖服务**:
- `AIWorkerService.generateEmbedding()` - 使用BGE-small-en-v1.5模型
- `generateSearchText()` - 文本预处理工具

**数据转换**:
```
AnalyzedContent -> {
  embedding: number[384]  // 384维语义向量
}
```

#### 阶段5: 持久化存储
**行为描述**: 系统将处理结果存储到多个存储层

**存储策略**:
- **数据库存储**: 结构化元数据和分析结果
- **对象存储**: 原始文章全文内容 (R2 Bucket)

### Then: 输出数据结构
```typescript
interface ProcessedArticle {
  // 基础信息
  id: number
  title: string
  language: string
  primary_location: string
  
  // 内容评估
  completeness: 'COMPLETE' | 'PARTIAL_USEFUL' | 'PARTIAL_USELESS'
  content_quality: 'OK' | 'LOW_QUALITY' | 'JUNK'
  
  // 分析结果
  event_summary_points: string[]
  thematic_keywords: string[]
  topic_tags: string[]
  key_entities: string[]
  content_focus: string[]
  
  // 技术数据
  embedding: number[384]
  contentFileKey: string  // R2中的文件路径
  
  // 状态跟踪
  status: 'PROCESSED'
  processedAt: Date
  used_browser: boolean
}
```

## 工作流2: 情报分析管道 (Intelligence Pipeline)

### Given: 输入数据结构 - ArticleDataset
```typescript
interface ArticleDataset {
  articles: Array<{
    id: number
    title: string
    content: string
    publishDate: string
    url: string
    summary: string
  }>
  embeddings: Array<{
    articleId: number
    embedding: number[384]
  }>
}
```

### When: 执行情报分析管道

#### 阶段1: 聚类分析 (Clustering Analysis)
**行为描述**: 系统将相似文章聚合成有意义的故事集群

**依赖服务**:
- ML服务 (UMAP + HDBSCAN算法)

**业务参数**:
- UMAP参数: n_neighbors, n_components, min_dist, metric
- HDBSCAN参数: min_cluster_size, min_samples, epsilon

**数据转换**:
```
ArticleDataset -> ClusteringResult {
  clusters: Array<{
    clusterId: number
    articleIds: number[]
    size: number
  }>
  parameters: ClusteringParameters
  statistics: {
    totalClusters: number
    noisePoints: number
    totalArticles: number
  }
}
```

#### 阶段2: 故事验证 (Story Validation)
**行为描述**: 系统验证聚类是否构成有效新闻故事

**依赖服务**:
- `AIWorkerService.validateStory()` - Gemini模型验证

**验证规则**:
- 尺寸过滤: 聚类大小 < 3 标记为 `INSUFFICIENT_ARTICLES`
- AI验证: 识别故事类型 (`SINGLE_STORY` | `COLLECTION_OF_STORIES` | `PURE_NOISE` | `NO_STORIES`)
- 重要性评分: 1-10分制

**数据转换**:
```
ClusteringResult -> ValidatedStories {
  stories: Array<{
    title: string
    importance: number  // 1-10
    articleIds: number[]
    storyType: 'SINGLE_STORY' | 'COLLECTION_OF_STORIES'
  }>
  rejectedClusters: Array<{
    clusterId: number
    rejectionReason: 'PURE_NOISE' | 'NO_STORIES' | 'INSUFFICIENT_ARTICLES'
    originalArticleIds: number[]
  }>
}
```

#### 阶段3: 情报深度分析 (Intelligence Analysis)
**行为描述**: 系统对验证的故事进行深度情报分析

**依赖服务**:
- `AIWorkerService.analyzeStoryIntelligence()` - Gemini Pro深度分析

**分析维度**:
- **执行摘要**: 故事的简明概述
- **发展状态**: `DEVELOPING` | `ESCALATING` | `DE_ESCALATING` | `CONCLUDING` | `STATIC`
- **时间线重建**: 关键事件的时序排列
- **重要性评估**: `CRITICAL` | `HIGH` | `MODERATE` | `LOW`
- **实体分析**: 关键参与者、角色和立场
- **信源分析**: 来源可靠性和偏见评估
- **事实基础**: 不争的关键事实
- **信息缺口**: 需要补充的信息
- **矛盾检测**: 冲突声明和立场

**数据转换**:
```
ValidatedStories + ArticleDataset -> IntelligenceReports {
  reports: Array<{
    storyId: string
    status: 'COMPLETE' | 'INCOMPLETE'
    executiveSummary: string
    storyStatus: StoryStatusEnum
    timeline: TimelineEvent[]
    significance: SignificanceAssessment
    entities: Entity[]
    sources: SourceAnalysis[]
    factualBasis: string[]
    informationGaps: string[]
    contradictions: Contradiction[]
  }>
  processingStatus: {
    totalStories: number
    completedAnalyses: number
    failedAnalyses: number
  }
}
```

#### 阶段4: 简报生成 (Brief Generation)
**行为描述**: 系统将情报分析结果合成为结构化简报

**依赖服务**:
- AI Worker简报生成服务 - Gemini 2.5 Pro

**可选输入**:
```typescript
interface PreviousBriefContext {
  date: string
  title: string
  summary: string
  coveredTopics: string[]
}
```

**简报结构**:
- **元数据**: 标题、创建时间、使用模型、TLDR
- **内容章节**: 7个预定义章节类型
  - `WHAT_MATTERS_NOW` - 当前重点
  - `FRANCE_FOCUS` - 法国焦点
  - `GLOBAL_LANDSCAPE` - 全球态势
  - `CHINA_MONITOR` - 中国观察
  - `TECH_SCIENCE` - 科技科学
  - `NOTEWORTHY` - 值得关注
  - `POSITIVE_DEVELOPMENTS` - 积极发展
- **统计数据**: 处理文章数、使用源数、聚类参数

### Then: 输出数据结构 - FinalBrief
```typescript
interface FinalBrief {
  metadata: {
    title: string
    createdAt: string
    model: string
    tldr: string
  }
  content: {
    sections: Array<{
      sectionType: BriefSectionType
      title: string
      content: string
      priority: number
    }>
    format: 'MARKDOWN' | 'JSON' | 'HTML'
  }
  statistics: {
    totalArticlesProcessed: number
    totalSourcesUsed: number
    articlesUsedInBrief: number
    sourcesUsedInBrief: number
    clusteringParameters: object
  }
}
```

## 系统架构特性

### 组件依赖关系

#### 核心服务组件
- **AIWorkerService**: AI模型调用协调器
- **DomainRateLimiter**: 智能速率控制
- **WorkflowObservability**: 全流程监控
- **DataFlowObserver**: 数据流追踪

#### 外部服务依赖
- **Cloudflare Workers AI**: 嵌入向量生成
- **Google AI Studio**: Gemini模型服务
- **Meridian ML Service**: 聚类算法服务
- **Hyperdrive**: PostgreSQL数据库
- **R2 Object Storage**: 文件存储

### 错误处理策略

#### 重试机制
- **指数退避**: 对AI服务调用失败
- **线性退避**: 对数据库操作失败
- **熔断模式**: 对外部服务不可用

#### 降级处理
- **内容抓取失败**: 标记文章状态，继续处理其他文章
- **AI分析失败**: 保留基础元数据，标记分析状态
- **聚类失败**: 使用简化聚类或单文章处理
- **简报生成失败**: 生成基础版本简报

### 数据一致性保证

#### 状态跟踪
每个处理阶段都有明确的状态标记:
- `CONTENT_FETCHED` - 内容已获取
- `PROCESSED` - 完全处理完成
- `FETCH_FAILED` - 抓取失败
- `AI_ANALYSIS_FAILED` - AI分析失败
- `SKIPPED_PDF` - PDF文件跳过

#### 幂等性设计
- 工作流可以安全重试
- 重复处理同一文章会被过滤
- 状态机确保数据一致性

### 性能优化策略

#### 并发控制
- 文章抓取: 8个并发连接
- 域名冷却: 5秒间隔
- 全局冷却: 1秒间隔

#### 批处理优化
- AI分析使用批量调用
- 数据库操作合并执行
- 缓存机制减少重复计算

#### 存储策略
- 热数据存储在数据库
- 大文件存储在对象存储
- 语义向量支持快速相似性搜索

## 监控和可观测性

### 数据流监控
系统在每个关键节点记录数据流变化:
- 文章数量变化
- 聚类数量变化
- 故事数量变化
- 质量指标变化

### 性能监控
- 各阶段处理时间
- 成功/失败比率
- 资源使用情况
- AI服务调用成本

### 业务监控
- 简报生成频率
- 内容质量分布
- 故事类型分布
- 关键实体识别准确性

这个架构确保了Meridian系统能够可靠地将原始RSS feeds转换为高质量的个性化情报简报，同时保持良好的性能、可维护性和可扩展性。 