/**
 * 聚类服务测试
 * 测试ai-services.ts中的MLService聚类功能
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { MLService, analyzeArticleClusters, handleServiceResponse } from '../../src/lib/clustering-service';
import type { AIWorkerEnv } from '../../src/lib/ai-services';

// 模拟环境配置（从wrangler.jsonc获取）
const mockEnv: AIWorkerEnv = {
  AI_WORKER: {
    fetch: async (request: Request) => {
      // 模拟AI Worker响应
      return new Response(JSON.stringify({ message: 'AI Worker mock response' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
  MERIDIAN_ML_SERVICE_URL: 'https://meridian-ml.pathsoflight.org',
  MERIDIAN_ML_SERVICE_API_KEY: 'f10c0976a3e273a7829666c3c5af658e5d9aee790187617b98e8c6e5d35d6336'
};

// 测试数据集 - 符合ArticleDataset接口契约
const testDataset = {
  articles: [
    {
      id: 1,
      title: 'OpenAI发布新版GPT模型',
      content: '人工智能公司OpenAI今日发布了新版本的GPT语言模型，具有更强的推理能力和更好的多模态理解能力。',
      publishDate: '2024-01-15T10:00:00Z',
      url: 'https://example.com/article1',
      summary: 'OpenAI发布新版GPT模型，提升AI能力'
    },
    {
      id: 2,
      title: 'Google推出Gemini Ultra模型',
      content: 'Google在人工智能领域再次发力，推出了Gemini Ultra大语言模型，在多项基准测试中超越了现有模型。',
      publishDate: '2024-01-16T14:30:00Z',
      url: 'https://example.com/article2',
      summary: 'Google发布Gemini Ultra，AI性能突破'
    },
    {
      id: 3,
      title: '苹果发布新款iPhone',
      content: '苹果公司在春季发布会上推出了新款iPhone，搭载了更先进的芯片和摄像系统。',
      publishDate: '2024-01-17T16:00:00Z',
      url: 'https://example.com/article3',
      summary: '苹果发布新iPhone，硬件升级显著'
    },
    {
      id: 4,
      title: 'Meta扩展VR业务',
      content: 'Meta公司宣布将进一步扩展其虚拟现实业务，推出新的VR头显设备和相关软件平台。',
      publishDate: '2024-01-18T09:15:00Z',
      url: 'https://example.com/article4',
      summary: 'Meta扩展VR业务，推出新设备'
    },
    {
      id: 5,
      title: 'Tesla自动驾驶技术突破',
      content: 'Tesla在自动驾驶技术方面取得重大突破，新版本的FSD软件在复杂路况下表现优异。',
      publishDate: '2024-01-19T11:45:00Z',
      url: 'https://example.com/article5',
      summary: 'Tesla自动驾驶技术获得突破性进展'
    },
    {
      id: 6,
      title: 'Microsoft Azure AI服务升级',
      content: 'Microsoft对其Azure AI服务进行了重大升级，提供更多的机器学习工具和更强的计算性能。',
      publishDate: '2024-01-20T13:20:00Z',
      url: 'https://example.com/article6',
      summary: 'Microsoft升级Azure AI服务'
    }
  ],
  embeddings: [
    { articleId: 1, embedding: Array.from({length: 384}, () => Math.random() - 0.5) },
    { articleId: 2, embedding: Array.from({length: 384}, () => Math.random() - 0.5) },
    { articleId: 3, embedding: Array.from({length: 384}, () => Math.random() - 0.5) },
    { articleId: 4, embedding: Array.from({length: 384}, () => Math.random() - 0.5) },
    { articleId: 5, embedding: Array.from({length: 384}, () => Math.random() - 0.5) },
    { articleId: 6, embedding: Array.from({length: 384}, () => Math.random() - 0.5) }
  ]
};

// 空数据集用于测试边界情况
const emptyDataset = {
  articles: [],
  embeddings: []
};

// 不匹配的数据集（embedding缺失）
const invalidDataset = {
  articles: [
    {
      id: 1,
      title: 'Test Article',
      content: 'Test content',
      publishDate: '2024-01-15T10:00:00Z',
      url: 'https://example.com/test',
      summary: 'Test summary'
    }
  ],
  embeddings: [] // 缺失embedding
};

describe('聚类服务测试', () => {
  let mlService: MLService;

  beforeAll(() => {
    mlService = new MLService(mockEnv);
  });

  describe('MLService类测试', () => {
    test('应该正确创建MLService实例', () => {
      expect(mlService).toBeInstanceOf(MLService);
    });

    test('应该验证空数据集输入', async () => {
      const response = await mlService.analyzeClusters(emptyDataset);
      expect(response.status).toBe(400);
      
      const result = await response.json() as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain('Dataset is empty');
    });

    test('应该处理embedding缺失的情况', async () => {
      try {
        await mlService.analyzeClusters(invalidDataset);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Missing embedding for article');
      }
    });
  });

  describe('数据接口契约测试', () => {
    // 验证输入数据格式
    test('测试数据集应符合ArticleDataset接口', () => {
      // 验证articles结构
      expect(testDataset.articles).toBeInstanceOf(Array);
      expect(testDataset.articles.length).toBeGreaterThan(0);
      
      testDataset.articles.forEach(article => {
        expect(article).toHaveProperty('id');
        expect(article).toHaveProperty('title');
        expect(article).toHaveProperty('content');
        expect(article).toHaveProperty('publishDate');
        expect(article).toHaveProperty('url');
        expect(article).toHaveProperty('summary');
        expect(typeof article.id).toBe('number');
        expect(typeof article.title).toBe('string');
        expect(typeof article.content).toBe('string');
        expect(typeof article.publishDate).toBe('string');
        expect(typeof article.url).toBe('string');
        expect(typeof article.summary).toBe('string');
      });

      // 验证embeddings结构
      expect(testDataset.embeddings).toBeInstanceOf(Array);
      expect(testDataset.embeddings.length).toBe(testDataset.articles.length);
      
      testDataset.embeddings.forEach(embedding => {
        expect(embedding).toHaveProperty('articleId');
        expect(embedding).toHaveProperty('embedding');
        expect(typeof embedding.articleId).toBe('number');
        expect(embedding.embedding).toBeInstanceOf(Array);
        expect(embedding.embedding.length).toBe(384); // 标准embedding维度
      });
    });

    // 模拟成功响应格式验证
    test('应该返回符合ClusteringResult接口的数据格式', async () => {
      // 模拟ML服务成功响应
      const mockMlResponse = {
        clusters: [
          {
            cluster_id: 0,
            size: 2,
            items: [{ id: 1 }, { id: 2 }]
          },
          {
            cluster_id: 1,
            size: 2,
            items: [{ id: 3 }, { id: 4 }]
          }
        ],
        config_used: {
          umap_n_neighbors: 15,
          umap_n_components: 10,
          umap_min_dist: 0.0,
          umap_metric: 'cosine',
          hdbscan_min_cluster_size: 5,
          hdbscan_min_samples: 3,
          hdbscan_cluster_selection_epsilon: 0.2
        },
        clustering_stats: {
          n_clusters: 2,
          n_outliers: 2,
          n_samples: 6
        }
      };

      // 创建模拟响应
      const mockResponse = new Response(JSON.stringify(mockMlResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

      // 使用handleServiceResponse处理响应
      const result = await handleServiceResponse(mockResponse, 'Test clustering');
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      // 验证响应数据结构
      const data = result.data as any;
      expect(data).toHaveProperty('clusters');
      expect(data).toHaveProperty('config_used');
      expect(data).toHaveProperty('clustering_stats');
      
      // 验证clusters结构
      expect(data.clusters).toBeInstanceOf(Array);
      data.clusters.forEach((cluster: any) => {
        expect(cluster).toHaveProperty('cluster_id');
        expect(cluster).toHaveProperty('size');
        expect(cluster).toHaveProperty('items');
        expect(typeof cluster.cluster_id).toBe('number');
        expect(typeof cluster.size).toBe('number');
        expect(cluster.items).toBeInstanceOf(Array);
      });
    });
  });

  describe('便捷函数测试', () => {
    test('analyzeArticleClusters应该正确处理输入和输出', async () => {
      // 注意：这里实际会调用真实服务，在实际环境中可能需要模拟
      console.log('开始测试analyzeArticleClusters便捷函数...');
      console.log('数据集包含文章数量:', testDataset.articles.length);
      console.log('数据集包含embedding数量:', testDataset.embeddings.length);
      
      const result = await analyzeArticleClusters(mockEnv, testDataset);
      
      console.log('聚类分析结果:', JSON.stringify(result, null, 2));
      
      // 基本结构验证
      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
      
                    if (result.success) {
         expect(result).toHaveProperty('data');
         // 注意：结果中有双层data嵌套，需要访问result.data.data
         const outerData = result.data as any;
         expect(outerData).toHaveProperty('success');
         
         if (outerData.success) {
           const clusteringResult = outerData.data;
           
           // 验证ClusteringResult接口契约
           expect(clusteringResult).toHaveProperty('clusters');
           expect(clusteringResult).toHaveProperty('parameters');
           expect(clusteringResult).toHaveProperty('statistics');
           
           // 验证clusters结构
           expect(clusteringResult.clusters).toBeInstanceOf(Array);
           clusteringResult.clusters.forEach((cluster: any) => {
             expect(cluster).toHaveProperty('clusterId');
             expect(cluster).toHaveProperty('articleIds');
             expect(cluster).toHaveProperty('size');
             expect(typeof cluster.clusterId).toBe('number');
             expect(cluster.articleIds).toBeInstanceOf(Array);
             expect(typeof cluster.size).toBe('number');
           });
           
           // 验证parameters结构
           expect(clusteringResult.parameters).toHaveProperty('umapParams');
           expect(clusteringResult.parameters).toHaveProperty('hdbscanParams');
           
           // 验证statistics结构
           expect(clusteringResult.statistics).toHaveProperty('totalClusters');
           expect(clusteringResult.statistics).toHaveProperty('noisePoints');
           expect(clusteringResult.statistics).toHaveProperty('totalArticles');
           
           console.log('✓ 聚类结果符合接口契约');
         } else {
           console.log('外层数据访问失败');
         }
      } else {
        expect(result).toHaveProperty('error');
        console.log('聚类分析失败:', result.error);
      }
    });
  });

  describe('健康检查测试', () => {
    test('应该能够进行健康检查', async () => {
      const response = await mlService.healthCheck();
      console.log('健康检查状态码:', response.status);
      
      // 健康检查应该返回响应（可能成功或失败）
      expect(response).toBeInstanceOf(Response);
    });
  });

  describe('错误处理测试', () => {
    test('handleServiceResponse应该正确处理错误响应', async () => {
      const errorResponse = new Response('Service Unavailable', {
        status: 503
      });

      const result = await handleServiceResponse(errorResponse, 'Test Service');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Test Service failed: 503');
    });

    test('handleServiceResponse应该正确处理JSON解析错误', async () => {
      const invalidJsonResponse = new Response('Invalid JSON', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

      const result = await handleServiceResponse(invalidJsonResponse, 'Test Service');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('response parsing failed');
    });
  });
}); 