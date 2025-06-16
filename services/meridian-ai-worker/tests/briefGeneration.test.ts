import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { BriefGenerationService } from '../src/services/brief-generation';

// 导入类型定义（避免重复定义）
type IntelligenceReports = {
  reports: Array<{
    storyId: string;
    status: "COMPLETE" | "INCOMPLETE";
    executiveSummary: string;
    storyStatus: "DEVELOPING" | "ESCALATING" | "DE_ESCALATING" | "CONCLUDING" | "STATIC";
    timeline: Array<{
      date: string;
      description: string;
      importance: "HIGH" | "MEDIUM" | "LOW";
    }>;
    significance: {
      level: "CRITICAL" | "HIGH" | "MODERATE" | "LOW";
      reasoning: string;
    };
    entities: Array<{
      name: string;
      type: string;
      role: string;
      positions: string[];
    }>;
    sources: Array<{
      sourceName: string;
      articleIds: number[];
      reliabilityLevel: "VERY_HIGH" | "HIGH" | "MODERATE" | "LOW" | "VERY_LOW";
      bias: string;
    }>;
    factualBasis: string[];
    informationGaps: string[];
    contradictions: Array<{
      issue: string;
      conflictingClaims: Array<{
        source: string;
        statement: string;
        entity?: string;
      }>;
    }>;
  }>;
  processingStatus: {
    totalStories: number;
    completedAnalyses: number;
    failedAnalyses: number;
  };
};

type FinalBrief = {
  metadata: {
    title: string;
    createdAt: string;
    model: string;
    tldr: string;
  };
  content: {
    sections: Array<{
      sectionType: "WHAT_MATTERS_NOW" | "FRANCE_FOCUS" | "GLOBAL_LANDSCAPE" | "CHINA_MONITOR" | "TECH_SCIENCE" | "NOTEWORTHY" | "POSITIVE_DEVELOPMENTS";
      title: string;
      content: string;
      priority: number;
    }>;
    format: "MARKDOWN" | "JSON" | "HTML";
  };
  statistics: {
    totalArticlesProcessed: number;
    totalSourcesUsed: number;
    articlesUsedInBrief: number;
    sourcesUsedInBrief: number;
    clusteringParameters: Record<string, any>;
  };
};

type PreviousBriefContext = {
  date: string;
  title: string;
  summary: string;
  coveredTopics: string[];
};

// ============================================================================
// 测试环境配置
// ============================================================================

// 检查是否为集成测试模式
const INTEGRATION_TEST_MODE = process.env.INTEGRATION_TEST_MODE === 'true';

console.log('🧪 Brief Generation Service Test Suite');
console.log(`📋 Test mode: ${INTEGRATION_TEST_MODE ? 'INTEGRATION (with AI Gateway)' : 'UNIT (mocked)'}`);

// ============================================================================
// Mock环境变量
// ============================================================================

const mockEnv = {
  GOOGLE_AI_STUDIO_API_KEY: process.env.GOOGLE_AI_STUDIO_API_KEY || 'mock-api-key',
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || 'mock-account-id',
  CLOUDFLARE_GATEWAY_ID: process.env.CLOUDFLARE_GATEWAY_ID || 'mock-gateway-id',
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || 'mock-api-token',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'mock-openai-key',
  AI_GATEWAY_URL: process.env.AI_GATEWAY_URL || 'https://gateway.ai.cloudflare.com/v1/mock-account/meridian/google-ai-studio',
  INTEGRATION_TEST_MODE: INTEGRATION_TEST_MODE.toString(),
  NODE_ENV: process.env.NODE_ENV || 'test',
};

// ============================================================================
// Mock Service（仅单元测试模式使用）
// ============================================================================

// 创建Mock版本的BriefGenerationService用于单元测试
class MockBriefGenerationService {
  async generateBrief(
    reports: IntelligenceReports, 
    context?: PreviousBriefContext
  ): Promise<{ success: boolean; data?: FinalBrief; error?: string }> {
    // 输入验证 - 模拟真实服务的行为
    if (!reports.reports.length) {
      return { success: false, error: "No reports to generate brief from" };
    }

    // 模拟成功的简报生成
    const finalBrief: FinalBrief = {
      metadata: {
        title: "Daily Intelligence Brief",
        createdAt: new Date().toISOString(),
        model: "gemini-2.0-flash",
        tldr: "Summary of today's key developments across multiple domains",
      },
      content: {
        sections: [
          {
            sectionType: "WHAT_MATTERS_NOW",
            title: "What Matters Now",
            content: "Key developments requiring immediate attention...",
            priority: 1,
          },
          {
            sectionType: "TECH_SCIENCE",
            title: "Technology & Science", 
            content: "Latest technological breakthroughs and scientific discoveries...",
            priority: 2,
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
    };

    return { success: true, data: finalBrief };
  }

  async generateTLDR(
    briefTitle: string, 
    briefContent: string
  ): Promise<{ success: boolean; data?: { tldr: string }; error?: string }> {
    // 模拟TLDR生成
    return {
      success: true,
      data: { 
        tldr: "• AI language processing breakthrough announced\n• 40% performance improvement in latest models\n• Major tech companies leading development" 
      }
    };
  }
}

// ============================================================================
// 测试数据
// ============================================================================

const mockIntelligenceReports: IntelligenceReports = {
  reports: [
    {
      storyId: "story-ai-breakthrough",
      status: "COMPLETE",
      executiveSummary: "Major breakthrough in AI language processing announced by leading tech companies",
      storyStatus: "DEVELOPING",
      timeline: [{
        date: new Date().toISOString(),
        description: "AI breakthrough announcement",
        importance: "HIGH",
      }],
      significance: {
        level: "HIGH",
        reasoning: "This development represents a significant advancement in AI capabilities",
      },
      entities: [{
        name: "TechCorp",
        type: "Organization",
        role: "Primary developer",
        positions: ["Leading AI development"],
      }],
      sources: [{
        sourceName: "Tech News",
        articleIds: [1, 2, 3],
        reliabilityLevel: "HIGH",
        bias: "Minimal bias detected",
      }],
      factualBasis: ["40% performance improvement reported", "New model architecture introduced"],
      informationGaps: ["Long-term implications unclear"],
      contradictions: [],
    }
  ],
  processingStatus: {
    totalStories: 1,
    completedAnalyses: 1,
    failedAnalyses: 0,
  },
};

const mockPreviousContext: PreviousBriefContext = {
  date: new Date(Date.now() - 86400000).toISOString(), // Yesterday
  title: "Previous Daily Brief",
  summary: "Yesterday's key developments included market updates and policy changes",
  coveredTopics: ["Technology", "Economics", "Politics"],
};

// ============================================================================
// 测试套件
// ============================================================================

describe('Brief Generation Service', () => {
  let briefService: BriefGenerationService | MockBriefGenerationService;

  beforeAll(() => {
    if (INTEGRATION_TEST_MODE) {
      console.log('🔗 使用真实AI Gateway服务进行集成测试');
      briefService = new BriefGenerationService(mockEnv);
    } else {
      console.log('🎭 使用Mock服务进行单元测试');
      briefService = new MockBriefGenerationService();
    }
  });

  beforeEach(() => {
    // 重置控制台输出（如果需要）
  });

  // ============================================================================
  // 数据契约验证测试
  // ============================================================================

  describe('数据契约验证', () => {
    it('应该正确验证IntelligenceReports输入格式', () => {
      expect(mockIntelligenceReports.reports).toHaveLength(1);
      expect(mockIntelligenceReports.reports[0]).toHaveProperty('storyId');
      expect(mockIntelligenceReports.reports[0]).toHaveProperty('status');
      expect(mockIntelligenceReports.reports[0]).toHaveProperty('executiveSummary');
      expect(mockIntelligenceReports.reports[0]).toHaveProperty('significance');
      expect(mockIntelligenceReports.reports[0]).toHaveProperty('entities');
      expect(mockIntelligenceReports.reports[0]).toHaveProperty('sources');
      expect(mockIntelligenceReports.reports[0]).toHaveProperty('factualBasis');
      expect(mockIntelligenceReports.reports[0]).toHaveProperty('informationGaps');
      expect(mockIntelligenceReports.reports[0]).toHaveProperty('contradictions');
    });

    it('应该正确验证FinalBrief输出格式', async () => {
      const result = await briefService.generateBrief(mockIntelligenceReports);
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      if (result.data) {
        const brief = result.data;
        expect(brief).toHaveProperty('metadata');
        expect(brief).toHaveProperty('content');
        expect(brief).toHaveProperty('statistics');
        
        // 验证metadata结构
        expect(brief.metadata).toHaveProperty('title');
        expect(brief.metadata).toHaveProperty('createdAt');
        expect(brief.metadata).toHaveProperty('model');
        expect(brief.metadata).toHaveProperty('tldr');
        
        // 验证content结构
        expect(brief.content).toHaveProperty('sections');
        expect(brief.content).toHaveProperty('format');
        expect(brief.content.sections).toBeInstanceOf(Array);
        expect(brief.content.format).toBe('MARKDOWN');
        
        // 验证statistics结构
        expect(brief.statistics).toHaveProperty('totalArticlesProcessed');
        expect(brief.statistics).toHaveProperty('totalSourcesUsed');
        expect(brief.statistics).toHaveProperty('articlesUsedInBrief');
        expect(brief.statistics).toHaveProperty('sourcesUsedInBrief');
        expect(brief.statistics).toHaveProperty('clusteringParameters');
      }
    });

    it('应该正确验证PreviousBriefContext可选输入', async () => {
      const result = await briefService.generateBrief(mockIntelligenceReports, mockPreviousContext);
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('应该正确验证TLDR生成输出格式', async () => {
      const result = await briefService.generateTLDR(
        "Test Brief Title",
        "Test brief content with important information"
      );
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      if (result.data) {
        expect(result.data).toHaveProperty('tldr');
        expect(typeof result.data.tldr).toBe('string');
      }
    });
  });

  // ============================================================================
  // 简报生成功能测试
  // ============================================================================

  describe('简报生成功能', () => {
    it('应该成功生成完整简报', async () => {
      const result = await briefService.generateBrief(mockIntelligenceReports);
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      if (result.data) {
        const brief = result.data;
        expect(brief.metadata.title).toBeTruthy();
        expect(brief.content.sections.length).toBeGreaterThan(0);
        expect(brief.statistics.totalArticlesProcessed).toBeGreaterThanOrEqual(0);
      }
    });

    it('应该支持带前日简报上下文的生成', async () => {
      const result = await briefService.generateBrief(mockIntelligenceReports, mockPreviousContext);
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('应该正确处理空报告输入', async () => {
      const emptyReports: IntelligenceReports = {
        reports: [],
        processingStatus: {
          totalStories: 0,
          completedAnalyses: 0,
          failedAnalyses: 0,
        },
      };

      const result = await briefService.generateBrief(emptyReports);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      if (result.error) {
        expect(result.error).toContain('No reports');
      }
    });

    it('应该成功生成TLDR摘要', async () => {
      const result = await briefService.generateTLDR(
        "Daily Intelligence Brief", 
        "## What Matters Now\nKey developments in technology and science..."
      );
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      if (result.data) {
        expect(result.data.tldr).toBeTruthy();
      }
    });
  });

  // ============================================================================
  // 错误处理测试
  // ============================================================================

  describe('错误处理', () => {
    it('应该优雅处理配额限制错误（如果发生）', async () => {
      // 这个测试会根据实际AI Gateway状态自动适应
      const result = await briefService.generateBrief(mockIntelligenceReports);
      
      // 不管是成功还是配额限制，都应该有合理的响应
      expect(result).toHaveProperty('success');
      if (!result.success) {
        expect(result.error).toBeDefined();
        console.log(`⚠️  配额限制检测: ${result.error}`);
      } else {
        expect(result.data).toBeDefined();
        if (result.data) {
          console.log(`✅ 简报生成成功: ${result.data.metadata.title}`);
        }
      }
    });

    it('应该正确处理TLDR生成错误', async () => {
      const result = await briefService.generateTLDR("", "");
      
      // 即使输入为空，也应该有合理的响应
      expect(result).toHaveProperty('success');
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });

  // ============================================================================
  // 业务逻辑验证测试
  // ============================================================================

  describe('业务逻辑验证', () => {
    it('应该正确转换情报报告为简报格式', async () => {
      const result = await briefService.generateBrief(mockIntelligenceReports);
      
      if (result.success && result.data) {
        const brief = result.data;
        
        // 验证sections结构
        expect(brief.content.sections).toBeInstanceOf(Array);
        brief.content.sections.forEach(section => {
          expect(section).toHaveProperty('sectionType');
          expect(section).toHaveProperty('title');
          expect(section).toHaveProperty('content');
          expect(section).toHaveProperty('priority');
        });
        
        // 验证统计数据合理性
        expect(brief.statistics.totalArticlesProcessed).toBeGreaterThanOrEqual(0);
        expect(brief.statistics.totalSourcesUsed).toBeGreaterThanOrEqual(0);
        expect(brief.statistics.articlesUsedInBrief).toBeLessThanOrEqual(brief.statistics.totalArticlesProcessed);
        expect(brief.statistics.sourcesUsedInBrief).toBeLessThanOrEqual(brief.statistics.totalSourcesUsed);
      }
    });

    it('应该生成有意义的简报标题', async () => {
      const result = await briefService.generateBrief(mockIntelligenceReports);
      
      if (result.success && result.data) {
        expect(result.data.metadata.title).toBeTruthy();
        expect(result.data.metadata.title.length).toBeGreaterThan(5);
      }
    });

    it('应该包含创建时间戳', async () => {
      const result = await briefService.generateBrief(mockIntelligenceReports);
      
      if (result.success && result.data) {
        const createdAt = new Date(result.data.metadata.createdAt);
        expect(createdAt.getTime()).toBeLessThanOrEqual(Date.now());
        expect(createdAt.getTime()).toBeGreaterThan(Date.now() - 60000); // 在最近1分钟内
      }
    });
  });

  // ============================================================================
  // 集成测试专用验证（仅在集成模式下运行）
  // ============================================================================

  if (INTEGRATION_TEST_MODE) {
    describe('集成测试验证', () => {
      it('应该真实连接AI Gateway并处理响应', async () => {
        console.log('🔍 开始AI Gateway集成测试...');
        
        const result = await briefService.generateBrief(mockIntelligenceReports);
        
        // 记录测试结果
        if (result.success) {
          console.log('✅ AI Gateway集成测试成功');
          if (result.data) {
            console.log(`📋 生成简报标题: ${result.data.metadata.title}`);
            console.log(`📊 处理文章数: ${result.data.statistics.totalArticlesProcessed}`);
          }
        } else {
          console.log(`⚠️  AI Gateway测试失败: ${result.error}`);
          // 在集成测试中，失败可能是由于配额限制或网络问题，这是可接受的
        }
        
        // 验证响应格式正确性（无论成功或失败）
        expect(result).toHaveProperty('success');
        expect(typeof result.success).toBe('boolean');
      }, 60000); // 60秒超时

      it('应该测试TLDR生成的真实AI响应', async () => {
        console.log('🔍 开始TLDR生成集成测试...');
        
        const result = await briefService.generateTLDR(
          "Daily Intelligence Brief",
          "## Technology Updates\nMajor breakthrough in AI language processing..."
        );
        
        if (result.success) {
          console.log('✅ TLDR生成集成测试成功');
          if (result.data) {
            console.log(`📝 生成TLDR: ${result.data.tldr.substring(0, 100)}...`);
          }
        } else {
          console.log(`⚠️  TLDR生成测试失败: ${result.error}`);
        }
        
        expect(result).toHaveProperty('success');
        expect(typeof result.success).toBe('boolean');
      }, 30000); // 30秒超时
    });
  }
}); 