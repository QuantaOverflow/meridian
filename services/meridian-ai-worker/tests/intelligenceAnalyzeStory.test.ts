// services/meridian-ai-worker/tests/intelligenceAnalyzeStory.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../src/index'; // 导入 Hono 应用程序实例

// 模拟 IntelligenceService 及其 analyzeStory 方法
vi.mock('../src/services/intelligence', () => ({
  IntelligenceService: vi.fn(() => ({
    analyzeStory: vi.fn(), // 模拟 analyzeStory 方法
  })),
}));

// 导入模拟的函数，以便在测试中设置其行为
import { IntelligenceService } from '../src/services/intelligence';

describe('POST /meridian/intelligence/analyze-story Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- 测试新工作流格式 ---

  it('应该在缺少 cluster.articles 时返回 400 错误', async () => {
    const res = await app.request('/meridian/intelligence/analyze-story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        story: { storyId: 'test-story-1' },
        cluster: {}, // cluster.articles 缺失
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('聚类中没有有效的文章数据');
  });

  it('应该成功分析故事并返回结构化数据 (新工作流格式)', async () => {
    const mockStoryInput = {
      storyId: 'story-abc',
      analysis: { summary: '初步故事分析摘要' },
    };
    const mockClusterInput = {
      articles: [
        { id: 1, title: '文章一', url: 'http://url1.com', content: '文章内容1', publish_date: new Date().toISOString() },
        { id: 2, title: '文章二', url: 'http://url2.com', content: '文章内容2', publish_date: new Date().toISOString() },
      ],
    };

    // 模拟 IntelligenceService.analyzeStory 的成功返回
    // 模拟LLM返回的完整分析结果，其中 executiveSummary 是关键
    const mockIntelligenceAnalysisResult = {
      analysis: {
        status: 'complete',
        executiveSummary: '这是LLM生成的执行摘要，概括了故事的核心发展。',
        storyStatus: 'Developing',
        timeline: [{ date: '2024-01-01', description: '事件发生', importance: 'High' }],
        signalStrength: { assessment: 'High', reasoning: '多源证实。' },
        undisputedKeyFacts: ['事实一', '事实二'],
        keyEntities: { list: [{ name: '实体A', type: '组织', involvement: '参与' }], perspectives: [] },
        keySources: { provided_articles_sources: [], contradictions: [] },
        context: ['背景信息'],
        informationGaps: ['信息缺口'],
        significance: { assessment: 'Critical', reasoning: '具有重大影响。' },
      },
      metadata: {
        model_used: 'gemini-2.0-pro-exp-03-25',
        provider: 'google-ai-studio',
        total_tokens: 1500,
        processingTime: 300,
        cached: false,
      },
    };

    (IntelligenceService as vi.Mock).mockImplementation(() => ({
      analyzeStory: vi.fn().mockResolvedValue(mockIntelligenceAnalysisResult),
    }));

    const res = await app.request('/meridian/intelligence/analyze-story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        story: mockStoryInput,
        cluster: mockClusterInput,
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    // 验证返回的 data.data 结构是否符合 endpoint 转换后的预期
    expect(data.data).toEqual({
      overview: mockIntelligenceAnalysisResult.analysis.executiveSummary,
      key_developments: [mockIntelligenceAnalysisResult.analysis.executiveSummary],
      stakeholders: ['AI分析系统'], // 默认值
      implications: ['需要进一步深入分析'], // 默认值
      outlook: mockIntelligenceAnalysisResult.analysis.storyStatus,
    });
    expect(data.metadata).toBeDefined();
    expect(data.metadata.model_used).toBe('gemini-2.0-pro-exp-03-25');
    expect(data.metadata.total_tokens).toBe(1500);

    // 验证 IntelligenceService.analyzeStory 是否被正确调用
    const intelligenceServiceInstance = (IntelligenceService as vi.Mock).mock.results[0].value;
    expect(intelligenceServiceInstance.analyzeStory).toHaveBeenCalledTimes(1);
    expect(intelligenceServiceInstance.analyzeStory).toHaveBeenCalledWith(
      expect.objectContaining({
        title: mockStoryInput.analysis.summary,
        articles_ids: [1, 2],
        articles_data: expect.any(Array), // 检查articles_data是数组即可，具体内容已在endpoint内部转换
      })
    );
  });

  it('应该在 IntelligenceService 返回 parsing_failed 状态时使用 fallback_analysis', async () => {
    const mockStoryInput = {
      storyId: 'test-story-fallback',
      analysis: { summary: '初步分析' },
    };
    const mockClusterInput = {
      articles: [{ id: 3, title: '文章三', content: '内容3', url: 'http://url3.com' }],
    };

    // 模拟 IntelligenceService 返回 parsing_failed 和 fallback_analysis
    const mockParsingFailedResult = {
      analysis: {
        status: 'parsing_failed',
        fallback_analysis: {
          overview: '回退摘要：无法解析原始AI响应',
          key_developments: ['回退关键发展点'],
          stakeholders: ['回退利益相关者'],
          implications: ['回退影响'],
          outlook: '回退状态',
        },
      },
      metadata: {
        model_used: 'gemini-2.0-flash',
        provider: 'google-ai-studio',
        total_tokens: 100,
      },
    };

    (IntelligenceService as vi.Mock).mockImplementation(() => ({
      analyzeStory: vi.fn().mockResolvedValue(mockParsingFailedResult),
    }));

    const res = await app.request('/meridian/intelligence/analyze-story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        story: mockStoryInput,
        cluster: mockClusterInput,
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual(mockParsingFailedResult.analysis.fallback_analysis);
    expect(data.metadata.fallback_used).toBe(true);
    expect(data.metadata.model_used).toBe('gemini-2.0-flash');
  });

  it('应该在 IntelligenceService 返回非对象或空分析结果时使用默认 fallback', async () => {
    const mockStoryInput = {
      storyId: 'test-story-default-fallback',
      analysis: { summary: '初步分析' },
    };
    const mockClusterInput = {
      articles: [{ id: 4, title: '文章四', content: '内容4', url: 'http://url4.com' }],
    };

    // 模拟 IntelligenceService 返回一个没有 analysis 字段的结果
    const mockEmptyAnalysisResult = {
      metadata: {
        model_used: 'gemini-2.0-flash',
        provider: 'google-ai-studio',
        total_tokens: 50,
      },
    };

    (IntelligenceService as vi.Mock).mockImplementation(() => ({
      analyzeStory: vi.fn().mockResolvedValue(mockEmptyAnalysisResult),
    }));

    const res = await app.request('/meridian/intelligence/analyze-story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        story: mockStoryInput,
        cluster: mockClusterInput,
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual({
      overview: mockStoryInput.analysis.summary,
      key_developments: ['分析处理中'], // 默认值
      stakeholders: ['AI分析系统'], // 默认值
      implications: ['需要进一步分析'], // 默认值
      outlook: '处理中', // 默认值
    });
    expect(data.metadata.fallback_used).toBe(true);
    expect(data.metadata.total_tokens).toBe(50);
  });


  it('应该在 IntelligenceService 调用失败时返回 500 错误', async () => {
    const mockStoryInput = {
      storyId: 'test-error-story',
      analysis: { summary: '错误测试' },
    };
    const mockClusterInput = {
      articles: [{ id: 5, title: '错误文章', content: '错误内容', url: 'http://error.com' }],
    };

    (IntelligenceService as vi.Mock).mockImplementation(() => ({
      analyzeStory: vi.fn().mockRejectedValue(new Error('IntelligenceService 内部错误')), // 模拟服务调用失败
    }));

    const res = await app.request('/meridian/intelligence/analyze-story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        story: mockStoryInput,
        cluster: mockClusterInput,
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe('IntelligenceService 内部错误');
    expect(data.details).toBeDefined(); // 堆栈信息
  });

  // --- 测试旧格式（如果仍在使用或需要维护）---
  it('应该支持旧的通用请求体格式', async () => {
    const mockOldFormatBody = {
      title: "旧格式测试文章",
      articles_ids: [100, 101],
      articles_data: [
        { id: 100, title: "旧文一", content: "旧内容一", url: "http://old1.com" },
        { id: 101, title: "旧文二", content: "旧内容二", url: "http://old2.com" }
      ]
    };

    const mockOldFormatResult = {
      analysis: {
        executiveSummary: "旧格式分析摘要",
        storyStatus: "Static"
      },
      metadata: { total_tokens: 200 }
    };

    (IntelligenceService as vi.Mock).mockImplementation(() => ({
      analyzeStory: vi.fn().mockResolvedValue(mockOldFormatResult),
    }));

    const res = await app.request('/meridian/intelligence/analyze-story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockOldFormatBody),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.analysis.executiveSummary).toBe("旧格式分析摘要");
    expect(data.metadata.total_tokens).toBe(200);
    // 验证旧格式是直接返回 IntelligenceService 的结果
    expect(data).toEqual(mockOldFormatResult);
  });
});