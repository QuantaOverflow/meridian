Feature: 新闻情报分析数据流管道
  作为情报分析系统
  我需要将文章聚类数据转换为结构化情报简报
  以便实现从原始数据到最终输出的数据转换

  Background:
    Given 系统处理新闻情报分析的四个核心阶段
    And 每个阶段都有明确的输入输出数据结构
    And 数据在阶段间按规定格式传递

  Scenario: 聚类分析阶段
    Given 输入数据结构为ArticleDataset:
      ```
      ArticleDataset {
        articles: Array<Article>
        embeddings: Array<Vector>
      }
      
      Article {
        id: Integer
        title: String
        content: String
        publishDate: DateTime
        url: String
        summary: String
      }
      
      Vector {
        articleId: Integer
        embedding: Float[512]
      }
      ```
    When 执行聚类分析处理
    Then 输出数据结构为ClusteringResult:
      ```
      ClusteringResult {
        clusters: Array<Cluster>
        parameters: ClusteringParameters
        statistics: ClusteringStatistics
      }
      
      Cluster {
        clusterId: Integer
        articleIds: Array<Integer>
        size: Integer
      }
      
      ClusteringParameters {
        umapParams: Object
        hdbscanParams: Object
      }
      
      ClusteringStatistics {
        totalClusters: Integer
        noisePoints: Integer
        totalArticles: Integer
      }
      ```

  Scenario: 故事验证阶段
    Given 输入数据结构为ClusteringResult
    When 执行故事验证处理
    Then 输出数据结构为ValidatedStories:
      ```
      ValidatedStories {
        stories: Array<Story>
        rejectedClusters: Array<RejectedCluster>
      }
      
      Story {
        title: String
        importance: Integer[1-10]
        articleIds: Array<Integer>
        storyType: Enum[SINGLE_STORY, COLLECTION_OF_STORIES]
      }
      
      RejectedCluster {
        clusterId: Integer
        rejectionReason: Enum[PURE_NOISE, NO_STORIES, INSUFFICIENT_ARTICLES]
        originalArticleIds: Array<Integer>
      }
      ```

  Scenario: 情报分析阶段
    Given 输入数据结构为ValidatedStories + ArticleDataset
    When 执行深度情报分析处理
    Then 输出数据结构为IntelligenceReports:
      ```
      IntelligenceReports {
        reports: Array<IntelligenceReport>
        processingStatus: ProcessingStatus
      }
      
      IntelligenceReport {
        storyId: String
        status: Enum[COMPLETE, INCOMPLETE]
        executiveSummary: String
        storyStatus: Enum[DEVELOPING, ESCALATING, DE_ESCALATING, CONCLUDING, STATIC]
        timeline: Array<TimelineEvent>
        significance: SignificanceAssessment
        entities: Array<Entity>
        sources: Array<SourceAnalysis>
        factualBasis: Array<String>
        informationGaps: Array<String>
        contradictions: Array<Contradiction>
      }
      
      TimelineEvent {
        date: DateTime
        description: String
        importance: Enum[HIGH, MEDIUM, LOW]
      }
      
      SignificanceAssessment {
        level: Enum[CRITICAL, HIGH, MODERATE, LOW]
        reasoning: String
      }
      
      Entity {
        name: String
        type: String
        role: String
        positions: Array<String>
      }
      
      SourceAnalysis {
        sourceName: String
        articleIds: Array<Integer>
        reliabilityLevel: Enum[VERY_HIGH, HIGH, MODERATE, LOW, VERY_LOW]
        bias: String
      }
      
      Contradiction {
        issue: String
        conflictingClaims: Array<Claim>
      }
      
      Claim {
        source: String
        statement: String
        entity: String?
      }
      
      ProcessingStatus {
        totalStories: Integer
        completedAnalyses: Integer
        failedAnalyses: Integer
      }
      ```

  Scenario: 简报生成阶段
    Given 输入数据结构为IntelligenceReports + PreviousBriefContext
    When 执行简报生成处理
    Then 输出数据结构为FinalBrief:
      ```
      FinalBrief {
        metadata: BriefMetadata
        content: BriefContent
        statistics: BriefStatistics
      }
      
      BriefMetadata {
        title: String
        createdAt: DateTime
        model: String
        tldr: String
      }
      
      BriefContent {
        sections: Array<BriefSection>
        format: Enum[MARKDOWN, JSON, HTML]
      }
      
      BriefSection {
        sectionType: Enum[WHAT_MATTERS_NOW, FRANCE_FOCUS, GLOBAL_LANDSCAPE, 
                         CHINA_MONITOR, TECH_SCIENCE, NOTEWORTHY, POSITIVE_DEVELOPMENTS]
        title: String
        content: String
        priority: Integer
      }
      
      BriefStatistics {
        totalArticlesProcessed: Integer
        totalSourcesUsed: Integer
        articlesUsedInBrief: Integer
        sourcesUsedInBrief: Integer
        clusteringParameters: Object
      }
      
      PreviousBriefContext {
        date: DateTime
        title: String
        summary: String
        coveredTopics: Array<String>
      }
      ```

  # 数据流转换契约
  Rule: 阶段间数据传递
    聚类分析: ArticleDataset → ClusteringResult
    故事验证: ClusteringResult → ValidatedStories  
    情报分析: ValidatedStories + ArticleDataset → IntelligenceReports
    简报生成: IntelligenceReports + PreviousBriefContext → FinalBrief

  Rule: 数据完整性约束
    - 所有Integer类型的ID字段必须保持引用完整性
    - Array类型字段可以为空但不能为null
    - Enum类型必须使用预定义值
    - DateTime字段必须符合ISO 8601格式

  Rule: 错误处理接口
    - 每个阶段输出必须包含处理状态信息
    - 失败的处理不应中断整个管道
    - 错误信息应包含足够的上下文用于调试 