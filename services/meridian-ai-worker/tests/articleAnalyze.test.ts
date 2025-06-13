// services/meridian-ai-worker/tests/articleAnalyze.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../src/index'; // 导入 Hono 应用程序实例

// 模拟 AIGatewayService 及其 chat 方法
// 我们只需要模拟 chat 方法，因为它是在 analyzeArticle 内部调用的主要外部依赖
vi.mock('../src/services/ai-gateway', () => ({
  AIGatewayService: vi.fn(() => ({
    chat: vi.fn(), // 模拟 chat 方法
  })),
}));

// 模拟提示词生成函数
vi.mock('../src/prompts/articleAnalysis', () => ({
  getArticleAnalysisPrompt: vi.fn(), // 模拟 getArticleAnalysisPrompt 函数
}));

// 导入模拟的函数，以便在测试中设置其行为
import { AIGatewayService } from '../src/services/ai-gateway';
import { getArticleAnalysisPrompt } from '../src/prompts/articleAnalysis';

describe('POST /meridian/article/analyze Endpoint', () => {
  // 在每个测试前清除所有模拟函数的调用记录和返回值
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该在缺少标题时返回 400 错误', async () => {
    const res = await app.request('/meridian/article/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '这是一段测试文章内容。' }),
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid request: title and content are required');
  });

  it('应该在缺少内容时返回 400 错误', async () => {
    const res = await app.request('/meridian/article/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '测试文章标题' }),
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid request: title and content are required');
  });

  it('应该成功调用LLM并返回正确的文章分析结果', async () => {
    const mockTitle = '测试文章标题';
    const mockContent = '这是一段测试文章内容。';
    const mockPrompt = '模拟的LLM提示词。';
    const mockLlmRawResponse = {
      language: 'en',
      primary_location: 'USA',
      completeness: 'COMPLETE',
      content_quality: 'OK',
      event_summary_points: ['事件点1', '事件点2'],
      thematic_keywords: ['主题词1', '主题词2'],
      topic_tags: ['标签1', '标签2'],
      key_entities: ['实体1'],
      content_focus: ['Technology'],
    };
    const mockLlmResponse = {
      capability: 'chat',
      choices: [{ message: { content: '```json\n' + JSON.stringify(mockLlmRawResponse) + '\n```' } }],
      model: 'gemini-2.0-flash',
      provider: 'google-ai-studio',
      processingTime: 123,
      cached: false,
      usage: { total_tokens: 500 }
    };

    // 设置模拟函数的返回值
    (getArticleAnalysisPrompt as vi.Mock).mockReturnValue(mockPrompt);
    (AIGatewayService as vi.Mock).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue(mockLlmResponse),
    }));

    const res = await app.request('/meridian/article/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: mockTitle, content: mockContent }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual(mockLlmRawResponse); // 验证返回的数据结构
    expect(data.metadata).toBeDefined();
    expect(data.metadata.model_used).toBe('gemini-2.0-flash');
    expect(data.metadata.provider).toBe('google-ai-studio');
    expect(data.metadata.total_tokens).toBe(500);

    // 验证依赖函数是否被正确调用
    expect(getArticleAnalysisPrompt).toHaveBeenCalledTimes(1);
    expect(getArticleAnalysisPrompt).toHaveBeenCalledWith(mockTitle, mockContent);
    const aiGatewayServiceInstance = (AIGatewayService as vi.Mock).mock.results[0].value;
    expect(aiGatewayServiceInstance.chat).toHaveBeenCalledTimes(1);
    expect(aiGatewayServiceInstance.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'chat',
        messages: [{ role: 'user', content: mockPrompt }],
        model: 'gemini-2.0-flash',
        provider: 'google-ai-studio',
      })
    );
  });

  it('应该在LLM返回无效JSON时使用默认值（workflow format）', async () => {
    const mockTitle = '无效JSON测试';
    const mockContent = '这段内容会使LLM返回非JSON。';
    const mockPrompt = '模拟的LLM提示词。';
    // 模拟LLM返回非JSON字符串
    const mockLlmResponse = {
      capability: 'chat',
      choices: [{ message: { content: '这是一个无效的JSON响应，只是文本。' } }],
      model: 'gemini-2.0-flash',
      provider: 'google-ai-studio',
      processingTime: 150,
      cached: false,
      usage: { total_tokens: 100 }
    };

    (getArticleAnalysisPrompt as vi.Mock).mockReturnValue(mockPrompt);
    (AIGatewayService as vi.Mock).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue(mockLlmResponse),
    }));

    const res = await app.request('/meridian/article/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: mockTitle, content: mockContent }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    // 验证是否返回了预期的默认值
    expect(data.data).toEqual(expect.objectContaining({
      language: 'unknown',
      primary_location: 'unknown',
      completeness: 'PARTIAL_USEFUL',
      content_quality: 'OK',
      event_summary_points: [],
      thematic_keywords: [],
      topic_tags: [],
      key_entities: [],
      content_focus: []
    }));
    expect(data.metadata).toBeDefined();
    expect(data.metadata.total_tokens).toBe(100);
    // 检查是否有错误信息或其他指示，表示使用了fallback
    expect(data.data.error).toBeUndefined(); // workflow format不会返回error字段
  });

  it('应该在LLM服务调用失败时返回 500 错误', async () => {
    const mockTitle = '服务错误测试';
    const mockContent = '这段内容会引发LLM服务错误。';
    const mockPrompt = '模拟的LLM提示词。';

    (getArticleAnalysisPrompt as vi.Mock).mockReturnValue(mockPrompt);
    (AIGatewayService as vi.Mock).mockImplementation(() => ({
      chat: vi.fn().mockRejectedValue(new Error('AI Gateway service error')), // 模拟LLM调用失败
    }));

    const res = await app.request('/meridian/article/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: mockTitle, content: mockContent }),
    });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Failed to analyze article');
    expect(data.details).toBe('AI Gateway service error'); // 验证错误详情
  });
});