import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../src/index'; // 导入 AI Worker 的 Hono 应用程序实例
import { AIGatewayService } from '../src/services/ai-gateway';

// 模拟 AIGatewayService 及其 embed 方法
vi.mock('../src/services/ai-gateway', () => ({
  AIGatewayService: vi.fn(() => ({
    embed: vi.fn(),
    chat: vi.fn(), // 确保chat也被模拟，以防其他测试或依赖
  })),
}));

describe('Embedding Generation Endpoint (/meridian/embeddings/generate)', () => {
  let aiGatewayEmbedMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 每次测试前重置mock，并捕获aiGatewayService.embed的引用
    aiGatewayEmbedMock = vi.fn();
    (AIGatewayService as vi.Mock).mockImplementation(() => ({
      embed: aiGatewayEmbedMock,
      chat: vi.fn(),
    }));
  });

  // 行为: 应该成功为单个字符串文本生成嵌入向量
  it('应该成功为单个字符串文本生成嵌入向量', async () => {
    // 准备模拟数据
    const mockText = '这是一个测试文本。';
    const mockEmbedding = Array.from({ length: 384 }, (_, i) => Math.random());
    const mockResponse = {
      capability: 'embedding',
      data: [{ embedding: mockEmbedding }],
      model: '@cf/baai/bge-small-en-v1.5',
      provider: 'workers-ai',
      processingTime: 50,
      cached: false,
    };

    // 设置模拟行为
    aiGatewayEmbedMock.mockResolvedValueOnce(mockResponse);

    // 执行请求
    const res = await app.request('/meridian/embeddings/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: mockText,
        options: { provider: 'workers-ai', model: '@cf/baai/bge-small-en-v1.5' },
      }),
    });

    // 验证响应
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data[0].embedding).toEqual(mockEmbedding);
    expect(data.model).toBe('@cf/baai/bge-small-en-v1.5');
    expect(data.dimensions).toBe(384);
    expect(data.data_points).toBe(1);
    expect(data.text_length).toBe(mockText.length);
    expect(data.metadata.provider).toBe('workers-ai');
    expect(data.metadata.processingTime).toBe(50);

    // 验证 AI Gateway Service 被正确调用
    expect(aiGatewayEmbedMock).toHaveBeenCalledTimes(1);
    expect(aiGatewayEmbedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'embedding',
        input: mockText,
        provider: 'workers-ai',
        model: '@cf/baai/bge-small-en-v1.5',
      })
    );
  });

  // 行为: 应该成功为文本数组生成嵌入向量
  it('应该成功为文本数组生成嵌入向量', async () => {
    const mockTexts = ['文本一', '文本二', '文本三'];
    const mockEmbeddings = mockTexts.map((_, index) =>
      Array.from({ length: 384 }, (_, i) => Math.random() + index)
    );
    const mockResponse = {
      capability: 'embedding',
      data: mockEmbeddings.map((emb) => ({ embedding: emb })),
      model: '@cf/baai/bge-small-en-v1.5',
      provider: 'workers-ai',
      processingTime: 100,
      cached: false,
    };

    aiGatewayEmbedMock.mockResolvedValueOnce(mockResponse);

    const res = await app.request('/meridian/embeddings/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: mockTexts,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.length).toBe(mockEmbeddings.length);
    expect(data.data[0].embedding).toEqual(mockEmbeddings[0]);
    expect(data.dimensions).toBe(384);
    expect(data.data_points).toBe(mockTexts.length);
    expect(data.text_length).toBe(mockTexts.join(' ').length);

    expect(aiGatewayEmbedMock).toHaveBeenCalledTimes(1);
    expect(aiGatewayEmbedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: mockTexts,
      })
    );
  });

  // 行为: 应该成功为查询和上下文生成嵌入向量
  it('应该成功为查询和上下文生成嵌入向量', async () => {
    const mockQuery = '什么是人工智能？';
    const mockContexts = ['AI是机器学习的一个分支。', '机器学习是人工智能的一种实现方式。'];
    const mockEmbedding = Array.from({ length: 384 }, (_, i) => Math.random());
    const mockResponse = {
      capability: 'embedding',
      data: [{ embedding: mockEmbedding }],
      model: '@cf/baai/bge-small-en-v1.5',
      provider: 'workers-ai',
      processingTime: 60,
      cached: true,
    };

    aiGatewayEmbedMock.mockResolvedValueOnce(mockResponse);

    const res = await app.request('/meridian/embeddings/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: mockQuery,
        contexts: mockContexts,
        truncate_inputs: true,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data[0].embedding).toEqual(mockEmbedding);
    expect(data.dimensions).toBe(384);
    expect(data.data_points).toBe(1); // 对于query+contexts，通常返回一个组合嵌入
    expect(data.metadata.cached).toBe(true);

    expect(aiGatewayEmbedMock).toHaveBeenCalledTimes(1);
    expect(aiGatewayEmbedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: mockQuery,
        contexts: mockContexts,
        truncate_inputs: true,
      })
    );
  });

  // 行为: 应该返回400错误，如果请求体无效（缺少text/query/contexts）
  it('如果请求体无效，应该返回400错误', async () => {
    const res = await app.request('/meridian/embeddings/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // 空请求体
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid request: either text (string or array) or query+contexts is required');
    expect(aiGatewayEmbedMock).not.toHaveBeenCalled(); // 验证未调用AI Gateway
  });

  // 行为: 应该返回500错误，如果嵌入服务失败
  it('如果嵌入服务内部失败，应该返回500错误', async () => {
    const mockError = new Error('AI Gateway embedding service failed');
    aiGatewayEmbedMock.mockRejectedValueOnce(mockError);

    const res = await app.request('/meridian/embeddings/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '失败测试文本' }),
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Failed to generate embedding');
    expect(data.details).toBe(mockError.message);
    expect(aiGatewayEmbedMock).toHaveBeenCalledTimes(1);
  });

  // 行为: 应该返回500错误，如果AI Gateway返回的capability类型不正确
  it('如果AI Gateway返回的capability类型不正确，应该返回500错误', async () => {
    const mockText = '类型错误测试';
    const mockResponse = {
      capability: 'chat', // 错误的capability
      data: [],
      model: 'wrong-model',
      provider: 'wrong-provider',
    };

    aiGatewayEmbedMock.mockResolvedValueOnce(mockResponse);

    const res = await app.request('/meridian/embeddings/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: mockText }),
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Failed to generate embedding');
    expect(data.details).toBe('Unexpected response type from embedding service');
    expect(aiGatewayEmbedMock).toHaveBeenCalledTimes(1);
  });
});