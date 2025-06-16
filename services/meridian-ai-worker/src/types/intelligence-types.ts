import { z } from 'zod';

// ============================================================================
// 数据结构定义 - 基于 intelligence-pipeline.test.ts 的契约
// ============================================================================

// 文章数据结构
export const ArticleSchema = z.object({
  id: z.number(),
  title: z.string(),
  content: z.string(),
  publishDate: z.string().datetime(),
  url: z.string().url(),
  summary: z.string(),
});

export const VectorSchema = z.object({
  articleId: z.number(),
  embedding: z.array(z.number()).length(384),
});

export const ArticleDatasetSchema = z.object({
  articles: z.array(ArticleSchema),
  embeddings: z.array(VectorSchema),
});

// 故事验证数据结构
export const StorySchema = z.object({
  title: z.string(),
  importance: z.number().min(1).max(10),
  articleIds: z.array(z.number()),
  storyType: z.enum(["SINGLE_STORY", "COLLECTION_OF_STORIES"]),
});

export const RejectedClusterSchema = z.object({
  clusterId: z.number(),
  rejectionReason: z.enum(["PURE_NOISE", "NO_STORIES", "INSUFFICIENT_ARTICLES"]),
  originalArticleIds: z.array(z.number()),
});

export const ValidatedStoriesSchema = z.object({
  stories: z.array(StorySchema),
  rejectedClusters: z.array(RejectedClusterSchema),
});

// 情报分析数据结构
export const TimelineEventSchema = z.object({
  date: z.string().datetime(),
  description: z.string(),
  importance: z.enum(["HIGH", "MEDIUM", "LOW"]),
});

export const SignificanceAssessmentSchema = z.object({
  level: z.enum(["CRITICAL", "HIGH", "MODERATE", "LOW"]),
  reasoning: z.string(),
});

export const EntitySchema = z.object({
  name: z.string(),
  type: z.string(),
  role: z.string(),
  positions: z.array(z.string()),
});

export const SourceAnalysisSchema = z.object({
  sourceName: z.string(),
  articleIds: z.array(z.number()),
  reliabilityLevel: z.enum(["VERY_HIGH", "HIGH", "MODERATE", "LOW", "VERY_LOW"]),
  bias: z.string(),
});

export const ClaimSchema = z.object({
  source: z.string(),
  statement: z.string(),
  entity: z.string().optional(),
});

export const ContradictionSchema = z.object({
  issue: z.string(),
  conflictingClaims: z.array(ClaimSchema),
});

export const IntelligenceReportSchema = z.object({
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

export const ProcessingStatusSchema = z.object({
  totalStories: z.number(),
  completedAnalyses: z.number(),
  failedAnalyses: z.number(),
});

export const IntelligenceReportsSchema = z.object({
  reports: z.array(IntelligenceReportSchema),
  processingStatus: ProcessingStatusSchema,
});

// 兼容性类型 - 支持旧接口
export const LegacyIntelligenceAnalysisRequestSchema = z.object({
  title: z.string(),
  articles_ids: z.array(z.number()),
  articles_data: z.array(z.object({
    id: z.number(),
    title: z.string(),
    url: z.string(),
    content: z.string(),
    publishDate: z.string()
  }))
});

// 导出类型定义
export type ArticleDataset = z.infer<typeof ArticleDatasetSchema>;
export type ValidatedStories = z.infer<typeof ValidatedStoriesSchema>;
export type IntelligenceReports = z.infer<typeof IntelligenceReportsSchema>;
export type IntelligenceReport = z.infer<typeof IntelligenceReportSchema>;
export type Story = z.infer<typeof StorySchema>;
export type Article = z.infer<typeof ArticleSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type SignificanceAssessment = z.infer<typeof SignificanceAssessmentSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type SourceAnalysis = z.infer<typeof SourceAnalysisSchema>;
export type Contradiction = z.infer<typeof ContradictionSchema>; 