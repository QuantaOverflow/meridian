// services/meridian-ai-worker/tests/storyValidate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../src/index'; // 导入 Hono 应用程序实例

// 模拟 AIGatewayService 及其 chat 方法
vi.mock('../src/services/ai-gateway', () => ({
  AIGatewayService: vi.fn(() => ({
    chat: vi.fn(), // 模拟 chat 方法
  })),
}));

// 模拟提示词生成函数
vi.mock('../src/prompts/storyValidation', () => ({
  getStoryValidationPrompt: vi.fn(), // 模拟 getStoryValidationPrompt 函数
}));

// 导入模拟的函数，以便在测试中设置其行为
import { AIGatewayService } from '../src/services/ai-gateway';
import { getStoryValidationPrompt } from '../src/prompts/storyValidation';

describe('POST /meridian/story/validate Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- 输入验证测试 ---
  it('应该在缺少 cluster.articles 时返回 400 错误', async () => {
    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cluster: {} }), // cluster.articles 缺失
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid request: cluster with articles array is required');
  });

  // --- 成功场景测试：单一故事 ---
  it('应该成功验证为单一故事并过滤异常点', async () => {
    const mockClusterInput = {
      id: 100,
      articles: [
        { id: 1, title: '文章1', url: 'http://url1.com' },
        { id: 2, title: '文章2', url: 'http://url2.com' },
        { id: 3, title: '异常点文章', url: 'http://url3.com' },
      ],
    };
    const mockPrompt = '模拟的故事验证提示词。';
    const mockLlmResponse = {
      capability: 'chat',
      choices: [{ message: { content: '```json\n{"answer": "single_story", "title": "单一故事标题", "importance": 8, "outliers": [3]}\n```' } }],
      model: 'gemini-2.0-flash',
      provider: 'google-ai-studio',
      processingTime: 100,
      cached: false
    };

    (getStoryValidationPrompt as vi.Mock).mockReturnValue(mockPrompt);
    (AIGatewayService as vi.Mock).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue(mockLlmResponse),
    }));

    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cluster: mockClusterInput }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.validation_result).toBe('single_story');
    expect(data.data.cleaned_stories).toHaveLength(1);
    expect(data.data.cleaned_stories[0]).toEqual({
      id: mockClusterInput.id, // 单一故事使用原始cluster ID
      title: '单一故事标题',
      importance: 8,
      articles: [1, 2], // 文章3被过滤掉了
    });
    expect(data.metadata.model).toBe('gemini-2.0-flash');
    expect(data.metadata.provider).toBe('google-ai-studio');
    expect(getStoryValidationPrompt).toHaveBeenCalledWith(
      expect.stringContaining('- (#1) [文章1](http://url1.com)') // 验证提示词内容
    );
  });

  // --- 成功场景测试：故事集合 ---
  it('应该成功验证为故事集合并过滤小故事', async () => {
    const mockClusterInput = {
      id: 200,
      articles: [
        { id: 10, title: '大故事1', url: 'http://url10.com' },
        { id: 11, title: '大故事2', url: 'http://url11.com' },
        { id: 12, title: '大故事3', url: 'http://url12.com' },
        { id: 13, title: '小故事1', url: 'http://url13.com' },
        { id: 14, title: '小故事2', url: 'http://url14.com' }, // 只有2篇文章，会被过滤
      ],
    };
    const mockLlmResponse = {
      capability: 'chat',
      choices: [{ message: { content: '```json\n{"answer": "collection_of_stories", "stories": [{"title": "大故事集A", "importance": 7, "articles": [10, 11, 12]}, {"title": "小故事集B", "importance": 3, "articles": [13, 14]}]}\n```' } }],
      model: 'gemini-2.0-flash',
      provider: 'google-ai-studio',
      processingTime: 120,
      cached: false
    };

    (getStoryValidationPrompt as vi.Mock).mockReturnValue('mock prompt');
    (AIGatewayService as vi.Mock).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue(mockLlmResponse),
    }));

    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cluster: mockClusterInput }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.validation_result).toBe('collection_of_stories');
    expect(data.data.cleaned_stories).toHaveLength(1); // 只有大故事集A被包含
    expect(data.data.cleaned_stories[0].title).toBe('大故事集A');
    expect(data.data.cleaned_stories[0].articles).toEqual([10, 11, 12]);
    expect(data.metadata.model).toBe('gemini-2.0-flash');
    expect(data.metadata.provider).toBe('google-ai-studio');
  });

  // --- 成功场景测试：纯噪声 ---
  it('应该成功验证为纯噪声并返回空列表', async () => {
    const mockClusterInput = {
      id: 300,
      articles: [
        { id: 20, title: '噪音1', url: 'http://noise1.com' },
        { id: 21, title: '噪音2', url: 'http://noise2.com' },
      ],
    };
    const mockLlmResponse = {
      capability: 'chat',
      choices: [{ message: { content: '```json\n{"answer": "pure_noise"}\n```' } }],
      model: 'gemini-2.0-flash',
      provider: 'google-ai-studio',
      processingTime: 80,
      cached: false
    };

    (getStoryValidationPrompt as vi.Mock).mockReturnValue('mock prompt');
    (AIGatewayService as vi.Mock).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue(mockLlmResponse),
    }));

    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cluster: mockClusterInput }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.validation_result).toBe('pure_noise');
    expect(data.data.cleaned_stories).toHaveLength(0);
    expect(data.metadata.model).toBe('gemini-2.0-flash');
    expect(data.metadata.provider).toBe('google-ai-studio');
  });

  // --- 成功场景测试：无故事（文章数太少，隐式过滤） ---
  it('应该在所有故事文章数不足时返回空列表 (no_stories或collection_of_stories)', async () => {
    const mockClusterInput = {
      id: 400,
      articles: [
        { id: 30, title: '文章A', url: 'http://a.com' },
        { id: 31, title: '文章B', url: 'http://b.com' },
      ],
    };
    // 模拟 LLM 返回 no_stories
    const mockLlmNoStoriesResponse = {
      capability: 'chat',
      choices: [{ message: { content: '```json\n{"answer": "no_stories"}\n```' } }],
      model: 'gemini-2.0-flash',
      provider: 'google-ai-studio',
      processingTime: 70,
      cached: false
    };

    (getStoryValidationPrompt as vi.Mock).mockReturnValue('mock prompt');
    (AIGatewayService as vi.Mock).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue(mockLlmNoStoriesResponse),
    }));

    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cluster: mockClusterInput }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.validation_result).toBe('no_stories');
    expect(data.data.cleaned_stories).toHaveLength(0);
  });

  // --- 错误处理测试：LLM 响应解析失败 ---
  it('应该在LLM返回无效JSON时使用回退逻辑', async () => {
    const mockClusterInput = {
      id: 500,
      articles: [
        { id: 40, title: '文章X', url: 'http://x.com' },
        { id: 41, title: '文章Y', url: 'http://y.com' },
      ],
    };
    const mockLlmInvalidJsonResponse = {
      capability: 'chat',
      choices: [{ message: { content: '这是一个无效的JSON响应，只是文本。' } }],
      model: 'gemini-2.0-flash',
      provider: 'google-ai-studio',
      processingTime: 90,
      cached: false
    };

    (getStoryValidationPrompt as vi.Mock).mockReturnValue('mock prompt');
    (AIGatewayService as vi.Mock).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue(mockLlmInvalidJsonResponse),
    }));

    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cluster: mockClusterInput }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.validation_result).toBe('fallback_processing');
    expect(data.data.cleaned_stories).toHaveLength(1); // 至少2篇文章，所以会有一个回退故事
    expect(data.data.cleaned_stories[0].title).toBe('文章X'); // 使用第一篇文章的标题作为回退标题
    expect(data.data.cleaned_stories[0].importance).toBe(5);
    expect(data.data.cleaned_stories[0].articles).toEqual([40, 41]);
    expect(data.data.fallback_used).toBe(true);
    expect(data.metadata.fallback_applied).toBe(true);
  });

  // --- 错误处理测试：LLM 服务调用失败 ---
  it('应该在LLM服务调用失败时返回 500 错误', async () => {
    const mockClusterInput = {
      id: 600,
      articles: [
        { id: 50, title: '错误文章', url: 'http://error.com' },
      ],
    };

    (getStoryValidationPrompt as vi.Mock).mockReturnValue('mock prompt');
    (AIGatewayService as vi.Mock).mockImplementation(() => ({
      chat: vi.fn().mockRejectedValue(new Error('AI Gateway chat error')), // 模拟LLM服务调用失败
    }));

    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cluster: mockClusterInput }),
    });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Failed to validate story');
    expect(data.details).toBe('AI Gateway chat error');
  });
});