// services/meridian-ai-worker/tests/storyValidate.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
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

// 定义测试所需的数据类型
interface ClusteringResult {
  clusters: Array<{
    clusterId: number
    articleIds: number[]
    size: number
  }>
  parameters: {
    umapParams: {
      n_neighbors: number
      n_components: number
      min_dist: number
      metric: string
    }
    hdbscanParams: {
      min_cluster_size: number
      min_samples: number
      epsilon: number
    }
  }
  statistics: {
    totalClusters: number
    noisePoints: number
    totalArticles: number
  }
}

interface MinimalArticleInfo {
  id: number
  title: string
  url: string
  event_summary_points?: string[]
}

describe('POST /meridian/story/validate Endpoint - 基于新数据契约', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 创建标准的 ClusteringResult 测试数据
  const createClusteringResult = (clusters: Array<{ clusterId: number, articleIds: number[], size: number }>): ClusteringResult => ({
    clusters,
    parameters: {
      umapParams: { n_neighbors: 15, n_components: 10, min_dist: 0.0, metric: "cosine" },
      hdbscanParams: { min_cluster_size: 5, min_samples: 3, epsilon: 0.2 }
    },
    statistics: {
      totalClusters: clusters.length,
      noisePoints: 0,
      totalArticles: clusters.reduce((sum, c) => sum + c.size, 0)
    }
  });

  // 创建测试用的 MinimalArticleInfo 数据
  const createMinimalArticlesData = (articleIds: number[]): MinimalArticleInfo[] => {
    return articleIds.map(id => ({
      id,
      title: `测试文章标题 ${id}`,
      url: `https://example.com/article/${id}`,
      event_summary_points: [`文章 ${id} 的重要事件摘要`, `文章 ${id} 的关键发展`]
    }));
  };

  // --- 输入验证测试 ---
  it('应该在缺少 clusteringResult.clusters 时返回 400 错误', async () => {
    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalidInput: {} }), // clusteringResult.clusters 缺失
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('clusteringResult.clusters array is required');
  });

  it('应该在缺少 articlesData 时返回 400 错误', async () => {
    const clusteringResult = createClusteringResult([
      { clusterId: 1, articleIds: [1, 2, 3], size: 3 }
    ]);
    
    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clusteringResult }), // articlesData 缺失
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('articlesData array is required');
  });

  it('应该在空聚类数组时返回 400 错误', async () => {
    const emptyClusteringResult = createClusteringResult([]);
    const emptyArticlesData = createMinimalArticlesData([]);
    
    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        clusteringResult: emptyClusteringResult,
        articlesData: emptyArticlesData 
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('No clusters to validate');
  });

  // --- 尺寸过滤测试 ---
  it('应该将小聚类标记为 INSUFFICIENT_ARTICLES', async () => {
    const clusteringResult = createClusteringResult([
      { clusterId: 1, articleIds: [1, 2], size: 2 }, // 小于3，应被拒绝
      { clusterId: 2, articleIds: [3], size: 1 }      // 小于3，应被拒绝
    ]);
    const articlesData = createMinimalArticlesData([1, 2, 3]);

    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clusteringResult, articlesData, useAI: false }), // 禁用AI验证
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.stories).toHaveLength(0);
    expect(data.data.rejectedClusters).toHaveLength(2);
    expect(data.data.rejectedClusters[0].rejectionReason).toBe('INSUFFICIENT_ARTICLES');
    expect(data.data.rejectedClusters[1].rejectionReason).toBe('INSUFFICIENT_ARTICLES');
  });

  // --- AI验证测试：单一故事 ---
  it('应该成功验证为单一故事并移除异常点', async () => {
    const clusteringResult = createClusteringResult([
      { clusterId: 100, articleIds: [1, 2, 3, 4], size: 4 }
    ]);
    const articlesData = createMinimalArticlesData([1, 2, 3, 4]);
    
    const mockPrompt = '模拟的故事验证提示词。';
    const mockLlmResponse = {
      capability: 'chat',
      choices: [{ 
        message: { 
          content: '```json\n{"answer": "single_story", "title": "重要政治发展", "importance": 8, "outliers": [3]}\n```' 
        } 
      }],
      model: 'gemini-2.0-flash',
      provider: 'google-ai-studio',
      processingTime: 100,
      cached: false
    };

    (getStoryValidationPrompt as Mock).mockReturnValue(mockPrompt);
    (AIGatewayService as Mock).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue(mockLlmResponse),
    }));

    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clusteringResult, articlesData, useAI: true }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.stories).toHaveLength(1);
    expect(data.data.rejectedClusters).toHaveLength(0);
    
    const story = data.data.stories[0];
    expect(story.title).toBe('重要政治发展');
    expect(story.importance).toBe(8);
    expect(story.articleIds).toEqual([1, 2, 4]); // 文章3被移除
    expect(story.storyType).toBe('SINGLE_STORY');
  });

  // --- AI验证测试：故事集合 ---
  it('应该成功验证为故事集合并分解为多个故事', async () => {
    const clusteringResult = createClusteringResult([
      { clusterId: 200, articleIds: [10, 11, 12, 13, 14, 15], size: 6 }
    ]);
    const articlesData = createMinimalArticlesData([10, 11, 12, 13, 14, 15]);

    const mockLlmResponse = {
      capability: 'chat',
      choices: [{ 
        message: { 
          content: '```json\n{"answer": "collection_of_stories", "stories": [{"title": "科技突破", "importance": 7, "articles": [10, 11, 12]}, {"title": "市场动态", "importance": 5, "articles": [13, 14]}]}\n```' 
        } 
      }],
      model: 'gemini-2.0-flash',
      provider: 'google-ai-studio',
      processingTime: 120,
      cached: false
    };

    (getStoryValidationPrompt as Mock).mockReturnValue('mock prompt');
    (AIGatewayService as Mock).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue(mockLlmResponse),
    }));

    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clusteringResult, articlesData, useAI: true }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.stories).toHaveLength(2);
    expect(data.data.rejectedClusters).toHaveLength(0);
    
    expect(data.data.stories[0].title).toBe('科技突破');
    expect(data.data.stories[0].articleIds).toEqual([10, 11, 12]);
    expect(data.data.stories[0].storyType).toBe('SINGLE_STORY');
    
    expect(data.data.stories[1].title).toBe('市场动态');
    expect(data.data.stories[1].articleIds).toEqual([13, 14]);
    expect(data.data.stories[1].storyType).toBe('SINGLE_STORY');
  });

  // --- AI验证测试：纯噪声 ---
  it('应该成功验证为纯噪声并拒绝聚类', async () => {
    const clusteringResult = createClusteringResult([
      { clusterId: 300, articleIds: [20, 21, 22], size: 3 }
    ]);
    const articlesData = createMinimalArticlesData([20, 21, 22]);

    const mockLlmResponse = {
      capability: 'chat',
      choices: [{ 
        message: { 
          content: '```json\n{"answer": "pure_noise"}\n```' 
        } 
      }],
      model: 'gemini-2.0-flash',
      provider: 'google-ai-studio',
      processingTime: 80,
      cached: false
    };

    (getStoryValidationPrompt as Mock).mockReturnValue('mock prompt');
    (AIGatewayService as Mock).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue(mockLlmResponse),
    }));

    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clusteringResult, articlesData, useAI: true }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.stories).toHaveLength(0);
    expect(data.data.rejectedClusters).toHaveLength(1);
    expect(data.data.rejectedClusters[0].clusterId).toBe(300);
    expect(data.data.rejectedClusters[0].rejectionReason).toBe('PURE_NOISE');
    expect(data.data.rejectedClusters[0].originalArticleIds).toEqual([20, 21, 22]);
  });

  // --- AI验证测试：无故事 ---
  it('应该在无故事时拒绝聚类', async () => {
    const clusteringResult = createClusteringResult([
      { clusterId: 400, articleIds: [30, 31, 32], size: 3 }
    ]);
    const articlesData = createMinimalArticlesData([30, 31, 32]);

    const mockLlmResponse = {
      capability: 'chat',
      choices: [{ 
        message: { 
          content: '```json\n{"answer": "no_stories"}\n```' 
        } 
      }],
      model: 'gemini-2.0-flash',
      provider: 'google-ai-studio',
      processingTime: 70,
      cached: false
    };

    (getStoryValidationPrompt as Mock).mockReturnValue('mock prompt');
    (AIGatewayService as Mock).mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue(mockLlmResponse),
    }));

    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clusteringResult, articlesData, useAI: true }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.stories).toHaveLength(0);
    expect(data.data.rejectedClusters).toHaveLength(1);
    expect(data.data.rejectedClusters[0].rejectionReason).toBe('NO_STORIES');
  });

  // --- 混合场景测试 ---
  it('应该正确处理多个聚类的混合场景', async () => {
    const clusteringResult = createClusteringResult([
      { clusterId: 1, articleIds: [1, 2], size: 2 },           // 太小，拒绝
      { clusterId: 2, articleIds: [3, 4, 5], size: 3 },       // AI验证为单一故事
      { clusterId: 3, articleIds: [6, 7, 8, 9], size: 4 }     // AI验证为纯噪声
    ]);
    const articlesData = createMinimalArticlesData([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const mockResponses = [
      // 第一个AI调用（clusterId: 2）
      {
        capability: 'chat',
        choices: [{ message: { content: '```json\n{"answer": "single_story", "title": "新闻故事", "importance": 6}\n```' } }],
        model: 'gemini-2.0-flash',
        provider: 'google-ai-studio',
        processingTime: 100,
        cached: false
      },
      // 第二个AI调用（clusterId: 3）
      {
        capability: 'chat',
        choices: [{ message: { content: '```json\n{"answer": "pure_noise"}\n```' } }],
        model: 'gemini-2.0-flash',
        provider: 'google-ai-studio',
        processingTime: 80,
        cached: false
      }
    ];

    (getStoryValidationPrompt as Mock).mockReturnValue('mock prompt');
    const mockChat = vi.fn()
      .mockResolvedValueOnce(mockResponses[0])
      .mockResolvedValueOnce(mockResponses[1]);
    
    (AIGatewayService as Mock).mockImplementation(() => ({
      chat: mockChat,
    }));

    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clusteringResult, articlesData, useAI: true }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.stories).toHaveLength(1);
    expect(data.data.rejectedClusters).toHaveLength(2);
    
    // 验证成功的故事
    expect(data.data.stories[0].title).toBe('新闻故事');
    expect(data.data.stories[0].articleIds).toEqual([3, 4, 5]);
    
    // 验证拒绝的聚类
    const rejectedReasons = data.data.rejectedClusters.map(r => r.rejectionReason);
    expect(rejectedReasons).toContain('INSUFFICIENT_ARTICLES');
    expect(rejectedReasons).toContain('PURE_NOISE');
    
    // 验证元数据
    expect(data.metadata.totalClusters).toBe(3);
    expect(data.metadata.validatedStories).toBe(1);
    expect(data.metadata.rejectedClusters).toBe(2);
  });

  // --- 错误处理测试 ---
  it('应该在个别聚类AI验证失败时将其标记为拒绝聚类', async () => {
    const clusteringResult = createClusteringResult([
      { clusterId: 500, articleIds: [50, 51, 52], size: 3 }
    ]);
    const articlesData = createMinimalArticlesData([50, 51, 52]);

    (getStoryValidationPrompt as Mock).mockReturnValue('mock prompt');
    (AIGatewayService as Mock).mockImplementation(() => ({
      chat: vi.fn().mockRejectedValue(new Error('AI Gateway service error')),
    }));

    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clusteringResult, articlesData, useAI: true }),
    });
    const data = await res.json();

    // 个别聚类失败应该被处理，而不是导致整个请求失败
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.stories).toHaveLength(0);
    expect(data.data.rejectedClusters).toHaveLength(1);
    expect(data.data.rejectedClusters[0].clusterId).toBe(500);
    expect(data.data.rejectedClusters[0].rejectionReason).toBe('NO_STORIES');
    expect(data.data.rejectedClusters[0].originalArticleIds).toEqual([50, 51, 52]);
  });

  it('应该在整个请求无效时返回 500 错误', async () => {
    // 模拟环境缺失等导致的整体失败
    const res = await app.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(null), // 无效JSON
    });

    expect(res.status).toBe(500);
  });
});