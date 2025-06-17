import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";

/**
 * 导入故事验证相关的类型定义
 */
import type { 
  ClusteringResult as AIWorkerClusteringResult, 
  ValidatedStories as AIWorkerValidatedStories, 
  Story as AIWorkerStory, 
  RejectedCluster as AIWorkerRejectedCluster,
  ClusterItem as AIWorkerClusterItem,
  ClusteringParameters as AIWorkerClusteringParameters,
  ClusteringStatistics as AIWorkerClusteringStatistics,
  MinimalArticleInfo as AIWorkerMinimalArticleInfo
} from "../../../../services/meridian-ai-worker/src/types/story-validation";

/**
 * 数据结构定义 - 基于 news-intelligence-pipeline.feature 和新的故事验证契约
 */

// 文章数据结构             
const ArticleSchema = z.object({
  id: z.number(),
  title: z.string(),
  content: z.string(),
  publishDate: z.string().datetime(),
  url: z.string().url(),
  summary: z.string(),
});

const VectorSchema = z.object({
  articleId: z.number(),
  embedding: z.array(z.number()).length(384),
});

const ArticleDatasetSchema = z.object({
  articles: z.array(ArticleSchema),
  embeddings: z.array(VectorSchema),
});

// 聚类结果数据结构 - 使用新的接口契约
const ClusterItemSchema = z.object({
  clusterId: z.number(),
  articleIds: z.array(z.number()),
  size: z.number(),
});

const ClusteringParametersSchema = z.object({
  umapParams: z.object({
    n_neighbors: z.number(),
    n_components: z.number(),
    min_dist: z.number(),
    metric: z.string(),
  }),
  hdbscanParams: z.object({
    min_cluster_size: z.number(),
    min_samples: z.number(),
    epsilon: z.number(),
  }),
});

const ClusteringStatisticsSchema = z.object({
  totalClusters: z.number(),
  noisePoints: z.number(),
  totalArticles: z.number(),
});

const ClusteringResultSchema = z.object({
  clusters: z.array(ClusterItemSchema),
  parameters: ClusteringParametersSchema,
  statistics: ClusteringStatisticsSchema,
});

// 故事验证数据结构 - 使用新的接口契约
const StorySchema = z.object({
  title: z.string(),
  importance: z.number().min(1).max(10),
  articleIds: z.array(z.number()),
  storyType: z.enum(["SINGLE_STORY", "COLLECTION_OF_STORIES"]),
});

const RejectedClusterSchema = z.object({
  clusterId: z.number(),
  rejectionReason: z.enum(["PURE_NOISE", "NO_STORIES", "INSUFFICIENT_ARTICLES"]),
  originalArticleIds: z.array(z.number()),
});

const ValidatedStoriesSchema = z.object({
  stories: z.array(StorySchema),
  rejectedClusters: z.array(RejectedClusterSchema),
});

// 最小文章信息数据结构 - 新增
const MinimalArticleInfoSchema = z.object({
  id: z.number(),
  title: z.string(),
  url: z.string(),
  event_summary_points: z.array(z.string()).optional(),
});

// 情报分析数据结构
const TimelineEventSchema = z.object({
  date: z.string().datetime(),
  description: z.string(),
  importance: z.enum(["HIGH", "MEDIUM", "LOW"]),
});

const SignificanceAssessmentSchema = z.object({
  level: z.enum(["CRITICAL", "HIGH", "MODERATE", "LOW"]),
  reasoning: z.string(),
});

const EntitySchema = z.object({
  name: z.string(),
  type: z.string(),
  role: z.string(),
  positions: z.array(z.string()),
});

const SourceAnalysisSchema = z.object({
  sourceName: z.string(),
  articleIds: z.array(z.number()),
  reliabilityLevel: z.enum(["VERY_HIGH", "HIGH", "MODERATE", "LOW", "VERY_LOW"]),
  bias: z.string(),
});

const ClaimSchema = z.object({
  source: z.string(),
  statement: z.string(),
  entity: z.string().optional(),
});

const ContradictionSchema = z.object({
  issue: z.string(),
  conflictingClaims: z.array(ClaimSchema),
});

const IntelligenceReportSchema = z.object({
  storyId: z.string(),
  status: z.enum(["COMPLETE", "INCOMPLETE"]),
  executiveSummary: z.string(),
  storyStatus: z.enum(["DEVELOPING", "ESCALATING", "DE_ESCALATING", "CONCLUDING", "STATIC"]),
  timeline: z.array(TimelineEventSchema),
  significance: SignificanceAssessmentSchema,
  entities: z.array(EntitySchema),
  sources: z.array(SourceAnalysisSchema),
  factualBasis: z.array(z.string()),
  informationGaps: z.array(z.string()),
  contradictions: z.array(ContradictionSchema),
});

const ProcessingStatusSchema = z.object({
  totalStories: z.number(),
  completedAnalyses: z.number(),
  failedAnalyses: z.number(),
});

const IntelligenceReportsSchema = z.object({
  reports: z.array(IntelligenceReportSchema),
  processingStatus: ProcessingStatusSchema,
});

// 简报生成数据结构
const BriefMetadataSchema = z.object({
  title: z.string(),
  createdAt: z.string().datetime(),
  model: z.string(),
  tldr: z.string(),
});

const BriefSectionSchema = z.object({
  sectionType: z.enum([
    "WHAT_MATTERS_NOW", 
    "FRANCE_FOCUS", 
    "GLOBAL_LANDSCAPE",
    "CHINA_MONITOR", 
    "TECH_SCIENCE", 
    "NOTEWORTHY", 
    "POSITIVE_DEVELOPMENTS"
  ]),
  title: z.string(),
  content: z.string(),
  priority: z.number(),
});

const BriefContentSchema = z.object({
  sections: z.array(BriefSectionSchema),
  format: z.enum(["MARKDOWN", "JSON", "HTML"]),
});

const BriefStatisticsSchema = z.object({
  totalArticlesProcessed: z.number(),
  totalSourcesUsed: z.number(),
  articlesUsedInBrief: z.number(),
  sourcesUsedInBrief: z.number(),
  clusteringParameters: z.object({}),
});

const PreviousBriefContextSchema = z.object({
  date: z.string().datetime(),
  title: z.string(),
  summary: z.string(),
  coveredTopics: z.array(z.string()),
});

const FinalBriefSchema = z.object({
  metadata: BriefMetadataSchema,
  content: BriefContentSchema,
  statistics: BriefStatisticsSchema,
});

// 类型定义
type ArticleDataset = z.infer<typeof ArticleDatasetSchema>;
type ClusteringResult = z.infer<typeof ClusteringResultSchema>;
type ValidatedStories = z.infer<typeof ValidatedStoriesSchema>;
type IntelligenceReports = z.infer<typeof IntelligenceReportsSchema>;
type FinalBrief = z.infer<typeof FinalBriefSchema>;
type PreviousBriefContext = z.infer<typeof PreviousBriefContextSchema>;

/**
 * Mock服务类 - 模拟实际的服务实现
 */
class MockClusteringService {
  async analyzeClusters(dataset: ArticleDataset): Promise<{ success: boolean; data?: ClusteringResult; error?: string }> {
    // 模拟聚类分析逻辑
    if (!dataset.articles.length || !dataset.embeddings.length) {
      return { success: false, error: "Dataset is empty" };
    }

    const clusters = dataset.articles.map((article, index) => ({
      clusterId: index,
      articleIds: [article.id],
      size: 1,
    }));

    return {
      success: true,
      data: {
        clusters,
        parameters: {
          umapParams: { n_neighbors: 15, n_components: 10, min_dist: 0.0, metric: "cosine" },
          hdbscanParams: { min_cluster_size: 5, min_samples: 3, epsilon: 0.2 },
        },
        statistics: {
          totalClusters: clusters.length,
          noisePoints: 0,
          totalArticles: dataset.articles.length,
        },
      },
    };
  }
}

class MockStoryValidationService {
  async validateStories(clusteringResult: ClusteringResult, articlesData: AIWorkerMinimalArticleInfo[]): Promise<{ success: boolean; data?: ValidatedStories; error?: string }> {
    if (!clusteringResult.clusters.length) {
      return { success: false, error: "No clusters to validate" };
    }

    if (!articlesData.length) {
      return { success: false, error: "No articles data provided" };
    }

    const stories = clusteringResult.clusters
      .filter(cluster => cluster.size >= 3)
      .map((cluster, index) => ({
        title: `Story ${index + 1}`,
        importance: Math.floor(Math.random() * 10) + 1,
        articleIds: cluster.articleIds,
        storyType: "SINGLE_STORY" as const,
      }));

    const rejectedClusters = clusteringResult.clusters
      .filter(cluster => cluster.size < 3)
      .map(cluster => ({
        clusterId: cluster.clusterId,
        rejectionReason: "INSUFFICIENT_ARTICLES" as const,
        originalArticleIds: cluster.articleIds,
      }));

    return {
      success: true,
      data: {
        stories,
        rejectedClusters,
      },
    };
  }
}

class MockIntelligenceAnalysisService {
  async analyzeStories(stories: ValidatedStories, dataset: ArticleDataset): Promise<{ success: boolean; data?: IntelligenceReports; error?: string }> {
    if (!stories.stories.length) {
      return { success: false, error: "No stories to analyze" };
    }

    const reports = stories.stories.map(story => ({
      storyId: `story-${story.title.toLowerCase().replace(/\s+/g, "-")}`,
      status: "COMPLETE" as const,
      executiveSummary: `Executive summary for ${story.title}`,
      storyStatus: "DEVELOPING" as const,
      timeline: [
        {
          date: new Date().toISOString(),
          description: "Initial event",
          importance: "HIGH" as const,
        },
      ],
      significance: {
        level: "MODERATE" as const,
        reasoning: "Moderate impact on regional affairs",
      },
      entities: [
        {
          name: "Entity 1",
          type: "Organization",
          role: "Primary actor",
          positions: ["Position 1"],
        },
      ],
      sources: [
        {
          sourceName: "Test Source",
          articleIds: story.articleIds,
          reliabilityLevel: "HIGH" as const,
          bias: "Minimal bias detected",
        },
      ],
      factualBasis: ["Fact 1", "Fact 2"],
      informationGaps: ["Gap 1"],
      contradictions: [],
    }));

    return {
      success: true,
      data: {
        reports,
        processingStatus: {
          totalStories: stories.stories.length,
          completedAnalyses: reports.length,
          failedAnalyses: 0,
        },
      },
    };
  }
}

class MockBriefGenerationService {
  async generateBrief(reports: IntelligenceReports, context?: PreviousBriefContext): Promise<{ success: boolean; data?: FinalBrief; error?: string }> {
    if (!reports.reports.length) {
      return { success: false, error: "No reports to generate brief from" };
    }

    return {
      success: true,
      data: {
        metadata: {
          title: "Daily Intelligence Brief",
          createdAt: new Date().toISOString(),
          model: "gemini-2.5-pro",
          tldr: "Summary of today's key developments",
        },
        content: {
          sections: [
            {
              sectionType: "WHAT_MATTERS_NOW",
              title: "What Matters Now",
              content: "Key developments...",
              priority: 1,
            },
          ],
          format: "MARKDOWN",
        },
        statistics: {
          totalArticlesProcessed: 100,
          totalSourcesUsed: 50,
          articlesUsedInBrief: 75,
          sourcesUsedInBrief: 40,
          clusteringParameters: {},
        },
      },
    };
  }
}

/**
 * BDD测试套件
 */
describe("Feature: 新闻情报分析数据流管道", () => {
  let clusteringService: MockClusteringService;
  let storyValidationService: MockStoryValidationService;
  let intelligenceAnalysisService: MockIntelligenceAnalysisService;
  let briefGenerationService: MockBriefGenerationService;

  let sampleArticleDataset: ArticleDataset;
  let sampleArticlesData: AIWorkerMinimalArticleInfo[];

  beforeEach(() => {
    clusteringService = new MockClusteringService();
    storyValidationService = new MockStoryValidationService();
    intelligenceAnalysisService = new MockIntelligenceAnalysisService();
    briefGenerationService = new MockBriefGenerationService();

    // 准备测试数据
    sampleArticleDataset = {
      articles: [
        {
          id: 1,
          title: "Test Article 1",
          content: "Content of article 1",
          publishDate: new Date().toISOString(),
          url: "https://example.com/article1",
          summary: "Summary of article 1",
        },
        {
          id: 2,
          title: "Test Article 2", 
          content: "Content of article 2",
          publishDate: new Date().toISOString(),
          url: "https://example.com/article2",
          summary: "Summary of article 2",
        },
      ],
      embeddings: [
        {
          articleId: 1,
          embedding: new Array(384).fill(0.1),
        },
        {
          articleId: 2,
          embedding: new Array(384).fill(0.2),
        },
      ],
    };

    // 准备最小文章信息数据
    sampleArticlesData = sampleArticleDataset.articles.map(article => ({
      id: article.id,
      title: article.title,
      url: article.url,
      event_summary_points: [`Summary point for article ${article.id}`],
    }));
  });

  describe("Scenario: 聚类分析阶段", () => {
    describe("Given 输入数据结构为ArticleDataset", () => {
      it("should validate ArticleDataset schema", () => {
        const result = ArticleDatasetSchema.safeParse(sampleArticleDataset);
        expect(result.success).toBe(true);
      });

      it("should have articles with required fields", () => {
        expect(sampleArticleDataset.articles).toBeDefined();
        expect(sampleArticleDataset.articles.length).toBeGreaterThan(0);
        
        sampleArticleDataset.articles.forEach(article => {
          expect(article.id).toBeTypeOf("number");
          expect(article.title).toBeTypeOf("string");
          expect(article.content).toBeTypeOf("string");
          expect(article.url).toMatch(/^https?:\/\//);
        });
      });

      it("should have embeddings with 384 dimensions", () => {
        expect(sampleArticleDataset.embeddings).toBeDefined();
        expect(sampleArticleDataset.embeddings.length).toBeGreaterThan(0);
        
        sampleArticleDataset.embeddings.forEach(embedding => {
          expect(embedding.embedding).toHaveLength(384);
          expect(embedding.articleId).toBeTypeOf("number");
        });
      });
    });

    describe("When 执行聚类分析处理", () => {
      it("should process ArticleDataset and return ClusteringResult", async () => {
        const response = await clusteringService.analyzeClusters(sampleArticleDataset);
        
        expect(response.success).toBe(true);
        expect(response.data).toBeDefined();
        
        if (response.data) {
          const validationResult = ClusteringResultSchema.safeParse(response.data);
          expect(validationResult.success).toBe(true);
        }
      });

      it("should handle empty dataset gracefully", async () => {
        const emptyDataset: ArticleDataset = { articles: [], embeddings: [] };
        const response = await clusteringService.analyzeClusters(emptyDataset);
        
        expect(response.success).toBe(false);
        expect(response.error).toBeDefined();
      });
    });

    describe("Then 输出数据结构为ClusteringResult", () => {
      it("should have valid clustering statistics", async () => {
        const response = await clusteringService.analyzeClusters(sampleArticleDataset);
        
        expect(response.success).toBe(true);
        if (response.data) {
          expect(response.data.statistics.totalArticles).toBe(sampleArticleDataset.articles.length);
          expect(response.data.statistics.totalClusters).toBeGreaterThanOrEqual(0);
          expect(response.data.statistics.noisePoints).toBeGreaterThanOrEqual(0);
        }
      });

      it("should have valid clustering parameters", async () => {
        const response = await clusteringService.analyzeClusters(sampleArticleDataset);
        
        expect(response.success).toBe(true);
        if (response.data) {
          expect(response.data.parameters.umapParams.n_neighbors).toBeGreaterThan(0);
          expect(response.data.parameters.hdbscanParams.min_cluster_size).toBeGreaterThan(0);
        }
      });
    });
  });

  describe("Scenario: 故事验证阶段", () => {
    let clusteringResult: ClusteringResult;

    beforeEach(async () => {
      const response = await clusteringService.analyzeClusters(sampleArticleDataset);
      clusteringResult = response.data!;
    });

    describe("Given 输入数据结构为ClusteringResult", () => {
      it("should validate ClusteringResult schema", () => {
        const result = ClusteringResultSchema.safeParse(clusteringResult);
        expect(result.success).toBe(true);
      });
    });

    describe("When 执行故事验证处理", () => {
      it("should validate stories and filter clusters", async () => {
        const response = await storyValidationService.validateStories(clusteringResult, sampleArticlesData);
        
        expect(response.success).toBe(true);
        expect(response.data).toBeDefined();
        
        if (response.data) {
          const validationResult = ValidatedStoriesSchema.safeParse(response.data);
          expect(validationResult.success).toBe(true);
        }
      });

      it("should handle empty clustering result", async () => {
        const emptyClustering: ClusteringResult = {
          clusters: [],
          parameters: clusteringResult.parameters,
          statistics: { totalClusters: 0, noisePoints: 0, totalArticles: 0 },
        };
        
        const response = await storyValidationService.validateStories(emptyClustering, sampleArticlesData);
        expect(response.success).toBe(false);
      });
    });

    describe("Then 输出数据结构为ValidatedStories", () => {
      it("should have stories with importance scores", async () => {
        const response = await storyValidationService.validateStories(clusteringResult, sampleArticlesData);
        
        expect(response.success).toBe(true);
        if (response.data) {
          response.data.stories.forEach(story => {
            expect(story.importance).toBeGreaterThanOrEqual(1);
            expect(story.importance).toBeLessThanOrEqual(10);
            expect(story.title).toBeTypeOf("string");
            expect(story.articleIds.length).toBeGreaterThan(0);
          });
        }
      });

      it("should categorize rejected clusters with reasons", async () => {
        const response = await storyValidationService.validateStories(clusteringResult, sampleArticlesData);
        
        expect(response.success).toBe(true);
        if (response.data) {
          response.data.rejectedClusters.forEach(rejected => {
            expect(["PURE_NOISE", "NO_STORIES", "INSUFFICIENT_ARTICLES"]).toContain(rejected.rejectionReason);
            expect(rejected.originalArticleIds.length).toBeGreaterThan(0);
          });
        }
      });
    });
  });

  describe("Scenario: 情报分析阶段", () => {
    let validatedStories: ValidatedStories;

    beforeEach(async () => {
      const clusteringResponse = await clusteringService.analyzeClusters(sampleArticleDataset);
      const validationResponse = await storyValidationService.validateStories(clusteringResponse.data!, sampleArticlesData);
      validatedStories = validationResponse.data!;
    });

    describe("Given 输入数据结构为ValidatedStories + ArticleDataset", () => {
      it("should validate input data structures", () => {
        const storiesResult = ValidatedStoriesSchema.safeParse(validatedStories);
        const datasetResult = ArticleDatasetSchema.safeParse(sampleArticleDataset);
        
        expect(storiesResult.success).toBe(true);
        expect(datasetResult.success).toBe(true);
      });
    });

    describe("When 执行深度情报分析处理", () => {
      it("should analyze stories and generate intelligence reports", async () => {
        const response = await intelligenceAnalysisService.analyzeStories(validatedStories, sampleArticleDataset);
        
        expect(response.success).toBe(true);
        expect(response.data).toBeDefined();
        
        if (response.data) {
          const validationResult = IntelligenceReportsSchema.safeParse(response.data);
          expect(validationResult.success).toBe(true);
        }
      });

      it("should handle empty validated stories", async () => {
        const emptyStories: ValidatedStories = { stories: [], rejectedClusters: [] };
        const response = await intelligenceAnalysisService.analyzeStories(emptyStories, sampleArticleDataset);
        
        expect(response.success).toBe(false);
        expect(response.error).toBeDefined();
      });
    });

    describe("Then 输出数据结构为IntelligenceReports", () => {
      it("should have complete intelligence reports", async () => {
        const response = await intelligenceAnalysisService.analyzeStories(validatedStories, sampleArticleDataset);
        
        expect(response.success).toBe(true);
        if (response.data) {
          response.data.reports.forEach(report => {
            expect(report.storyId).toBeTypeOf("string");
            expect(report.status).toBe("COMPLETE");
            expect(report.executiveSummary).toBeTypeOf("string");
            expect(["DEVELOPING", "ESCALATING", "DE_ESCALATING", "CONCLUDING", "STATIC"]).toContain(report.storyStatus);
          });
        }
      });

      it("should have valid processing statistics", async () => {
        const response = await intelligenceAnalysisService.analyzeStories(validatedStories, sampleArticleDataset);
        
        expect(response.success).toBe(true);
        if (response.data) {
          const status = response.data.processingStatus;
          expect(status.totalStories).toBeGreaterThan(0);
          expect(status.completedAnalyses + status.failedAnalyses).toBe(status.totalStories);
        }
      });
    });
  });

  describe("Scenario: 简报生成阶段", () => {
    let intelligenceReports: IntelligenceReports;
    let previousContext: PreviousBriefContext;

    beforeEach(async () => {
      const clusteringResponse = await clusteringService.analyzeClusters(sampleArticleDataset);
      const validationResponse = await storyValidationService.validateStories(clusteringResponse.data!, sampleArticlesData);
      const analysisResponse = await intelligenceAnalysisService.analyzeStories(validationResponse.data!, sampleArticleDataset);
      intelligenceReports = analysisResponse.data!;

      previousContext = {
        date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        title: "Previous Brief",
        summary: "Previous day summary",
        coveredTopics: ["topic1", "topic2"],
      };
    });

    describe("Given 输入数据结构为IntelligenceReports + PreviousBriefContext", () => {
      it("should validate input data structures", () => {
        const reportsResult = IntelligenceReportsSchema.safeParse(intelligenceReports);
        const contextResult = PreviousBriefContextSchema.safeParse(previousContext);
        
        expect(reportsResult.success).toBe(true);
        expect(contextResult.success).toBe(true);
      });
    });

    describe("When 执行简报生成处理", () => {
      it("should generate final brief", async () => {
        const response = await briefGenerationService.generateBrief(intelligenceReports, previousContext);
        
        expect(response.success).toBe(true);
        expect(response.data).toBeDefined();
        
        if (response.data) {
          const validationResult = FinalBriefSchema.safeParse(response.data);
          expect(validationResult.success).toBe(true);
        }
      });

      it("should handle empty intelligence reports", async () => {
        const emptyReports: IntelligenceReports = {
          reports: [],
          processingStatus: { totalStories: 0, completedAnalyses: 0, failedAnalyses: 0 },
        };
        
        const response = await briefGenerationService.generateBrief(emptyReports);
        expect(response.success).toBe(false);
      });
    });

    describe("Then 输出数据结构为FinalBrief", () => {
      it("should have complete brief metadata", async () => {
        const response = await briefGenerationService.generateBrief(intelligenceReports, previousContext);
        
        expect(response.success).toBe(true);
        if (response.data) {
          expect(response.data.metadata.title).toBeTypeOf("string");
          expect(response.data.metadata.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
          expect(response.data.metadata.model).toBeTypeOf("string");
          expect(response.data.metadata.tldr).toBeTypeOf("string");
        }
      });

      it("should have valid brief sections", async () => {
        const response = await briefGenerationService.generateBrief(intelligenceReports, previousContext);
        
        expect(response.success).toBe(true);
        if (response.data) {
          expect(response.data.content.sections.length).toBeGreaterThan(0);
          response.data.content.sections.forEach(section => {
            expect([
              "WHAT_MATTERS_NOW", "FRANCE_FOCUS", "GLOBAL_LANDSCAPE",
              "CHINA_MONITOR", "TECH_SCIENCE", "NOTEWORTHY", "POSITIVE_DEVELOPMENTS"
            ]).toContain(section.sectionType);
            expect(section.title).toBeTypeOf("string");
            expect(section.content).toBeTypeOf("string");
          });
        }
      });

      it("should have accurate processing statistics", async () => {
        const response = await briefGenerationService.generateBrief(intelligenceReports, previousContext);
        
        expect(response.success).toBe(true);
        if (response.data) {
          const stats = response.data.statistics;
          expect(stats.totalArticlesProcessed).toBeGreaterThan(0);
          expect(stats.articlesUsedInBrief).toBeLessThanOrEqual(stats.totalArticlesProcessed);
          expect(stats.sourcesUsedInBrief).toBeLessThanOrEqual(stats.totalSourcesUsed);
        }
      });
    });
  });

  describe("Rule: 阶段间数据传递", () => {
    it("should maintain data integrity across all pipeline stages", async () => {
      // 执行完整管道
      const stage1 = await clusteringService.analyzeClusters(sampleArticleDataset);
      expect(stage1.success).toBe(true);

      const stage2 = await storyValidationService.validateStories(stage1.data!, sampleArticlesData);
      expect(stage2.success).toBe(true);

      const stage3 = await intelligenceAnalysisService.analyzeStories(stage2.data!, sampleArticleDataset);
      expect(stage3.success).toBe(true);

      const stage4 = await briefGenerationService.generateBrief(stage3.data!);
      expect(stage4.success).toBe(true);

      // 验证数据引用完整性
      const originalArticleIds = sampleArticleDataset.articles.map(a => a.id);
      const finalUsedArticles = stage4.data!.statistics.articlesUsedInBrief;
      
      expect(finalUsedArticles).toBeLessThanOrEqual(originalArticleIds.length);
    });
  });

  describe("Rule: 数据完整性约束", () => {
    it("should enforce Integer ID field integrity", () => {
      sampleArticleDataset.articles.forEach(article => {
        expect(Number.isInteger(article.id)).toBe(true);
      });
    });

    it("should handle empty arrays without null values", () => {
      const emptyDataset: ArticleDataset = {
        articles: [],
        embeddings: [],
      };
      
      const result = ArticleDatasetSchema.safeParse(emptyDataset);
      expect(result.success).toBe(true);
    });

    it("should validate DateTime fields in ISO 8601 format", () => {
      sampleArticleDataset.articles.forEach(article => {
        expect(article.publishDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
      });
    });
  });

  describe("Rule: 错误处理接口", () => {
    it("should include processing status in outputs", async () => {
      const clusteringResponse = await clusteringService.analyzeClusters(sampleArticleDataset);
      const validationResponse = await storyValidationService.validateStories(clusteringResponse.data!, sampleArticlesData);
      const analysisResponse = await intelligenceAnalysisService.analyzeStories(validationResponse.data!, sampleArticleDataset);
      
      expect(analysisResponse.data!.processingStatus).toBeDefined();
      expect(analysisResponse.data!.processingStatus.totalStories).toBeTypeOf("number");
      expect(analysisResponse.data!.processingStatus.completedAnalyses).toBeTypeOf("number");
      expect(analysisResponse.data!.processingStatus.failedAnalyses).toBeTypeOf("number");
    });

    it("should provide meaningful error context", async () => {
      const emptyDataset: ArticleDataset = { articles: [], embeddings: [] };
      const response = await clusteringService.analyzeClusters(emptyDataset);
      
      expect(response.success).toBe(false);
      expect(response.error).toContain("empty");
    });

    it("should continue processing when individual stages fail", async () => {
      // 这个测试模拟部分失败但不中断整个管道的情况
      const clusteringResponse = await clusteringService.analyzeClusters(sampleArticleDataset);
      expect(clusteringResponse.success).toBe(true);
      
      // 即使后续阶段失败，系统应该有合适的降级处理
      const emptyStories: ValidatedStories = { stories: [], rejectedClusters: [] };
      const analysisResponse = await intelligenceAnalysisService.analyzeStories(emptyStories, sampleArticleDataset);
      expect(analysisResponse.success).toBe(false);
      expect(analysisResponse.error).toBeDefined();
    });
  });
}); 