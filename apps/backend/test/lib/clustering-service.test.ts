/**
 * 聚类服务生产环境集成测试
 * 基于auto-brief-generation.ts工作流的真实使用场景
 * 测试clustering-service.ts中的ClusteringService和相关功能
 */

import { describe, test, expect, beforeAll, vi, beforeEach } from 'vitest';
import { 
  ClusteringService, 
  createClusteringService, 
  MLService,
  handleServiceResponse,
  type ArticleDataset, 
  type ClusteringResult, 
  type ClusteringServiceResponse 
} from '../../src/lib/clustering-service';
import type { AIWorkerEnv } from '../../src/lib/ai-services';

// ============================================================================
// 生产环境模拟配置
// ============================================================================

// 模拟真实的生产环境配置
const productionEnv: AIWorkerEnv = {
  AI_WORKER: {
    fetch: vi.fn()
  },
  MERIDIAN_ML_SERVICE_URL: 'https://meridian-ml.pathsoflight.org',
  MERIDIAN_ML_SERVICE_API_KEY: 'test-api-key'
};

// Mock global fetch function
const mockFetch = vi.fn();

// ============================================================================
// 生产环境真实数据集模拟
// ============================================================================

// 模拟auto-brief-generation.ts中的真实数据结构
const productionDataset: ArticleDataset = {
  articles: [
    {
      id: 1001,
      title: 'OpenAI发布GPT-4 Turbo模型，性能提升显著',
      content: 'OpenAI发布新版GPT-4 Turbo模型，在多项基准测试中表现优异。该模型在理解复杂指令和生成高质量内容方面有显著提升，同时降低了API调用成本。新模型支持更长的上下文窗口，能够处理更复杂的任务。',
      publishDate: '2024-01-15T10:00:00Z',
      url: 'https://openai.com/research/gpt-4-turbo',
      summary: 'OpenAI发布新版GPT-4 Turbo模型，在多项基准测试中表现优异'
    },
    {
      id: 1002,
      title: 'Google推出Gemini Pro模型，挑战ChatGPT',
      content: 'Google发布Gemini Pro，在多模态任务中展现强大能力。该模型能够同时处理文本、图像和音频输入，在推理和创意任务中表现出色。Gemini Pro在编程和数学问题解决方面也有突出表现。',
      publishDate: '2024-01-16T14:30:00Z',
      url: 'https://ai.google.dev/gemini-api',
      summary: 'Google发布Gemini Pro，在多模态任务中展现强大能力'
    },
    {
      id: 1003,
      title: 'Meta发布Llama 3模型，开源AI新突破',
      content: 'Meta发布开源Llama 3模型，在代码生成任务中表现出色。该模型采用全新的架构设计，在保持开源特性的同时，性能可与闭源模型相媲美。Llama 3在多语言支持和安全性方面也有显著改进。',
      publishDate: '2024-01-17T09:45:00Z',
      url: 'https://llama.meta.com/llama3',
      summary: 'Meta发布开源Llama 3模型，在代码生成任务中表现出色'
    },
    {
      id: 1004,
      title: 'Anthropic发布Claude 3.5 Sonnet，推理能力增强',
      content: 'Anthropic发布Claude 3.5 Sonnet，在复杂推理任务中表现优异。该模型在逻辑推理、数学计算和创意写作方面有显著提升。Claude 3.5 Sonnet还增强了对话的连贯性和上下文理解能力。',
      publishDate: '2024-01-18T16:20:00Z',
      url: 'https://www.anthropic.com/claude',
      summary: 'Anthropic发布Claude 3.5 Sonnet，在复杂推理任务中表现优异'
    },
    {
      id: 1005,
      title: '苹果发布新款MacBook Pro，搭载M4芯片',
      content: '苹果发布新MacBook Pro，搭载M4芯片，性能大幅提升。新芯片采用3nm工艺，CPU和GPU性能较上代提升30%以上。新MacBook Pro还配备了更亮的显示屏和更长的电池续航时间。',
      publishDate: '2024-01-19T11:00:00Z',
      url: 'https://www.apple.com/macbook-pro',
      summary: '苹果发布新MacBook Pro，搭载M4芯片，性能大幅提升'
    },
    {
      id: 1006,
      title: 'Tesla发布FSD v12版本，自动驾驶技术突破',
      content: 'Tesla发布FSD v12版本，采用端到端神经网络架构。新版本在城市道路驾驶中的表现有显著提升，减少了人工干预的需要。FSD v12还改进了对复杂交通场景的理解和处理能力。',
      publishDate: '2024-01-20T13:15:00Z',
      url: 'https://www.tesla.com/autopilot',
      summary: 'Tesla发布FSD v12版本，采用端到端神经网络架构'
    },
    {
      id: 1007,
      title: 'Microsoft Azure AI服务全面升级',
      content: 'Microsoft升级Azure AI服务，新增多项企业级功能。新版本提供更强大的自然语言处理能力，支持更多编程语言和框架。Azure AI还增强了安全性和合规性功能，满足企业级应用需求。',
      publishDate: '2024-01-21T08:30:00Z',
      url: 'https://azure.microsoft.com/en-us/products/ai-services',
      summary: 'Microsoft升级Azure AI服务，新增多项企业级功能'
    },
    {
      id: 1008,
      title: 'NVIDIA发布H200 GPU，AI训练性能翻倍',
      content: 'NVIDIA发布H200 GPU，专为大模型训练优化。新GPU采用HBM3e内存技术，内存带宽较H100提升2.4倍。H200在大模型训练和推理方面都有显著性能提升，能效比也有改善。',
      publishDate: '2024-01-22T15:45:00Z',
      url: 'https://www.nvidia.com/en-us/data-center/h200',
      summary: 'NVIDIA发布H200 GPU，专为大模型训练优化'
    },
    {
      id: 1009,
      title: 'AMD发布MI300X加速器，挑战NVIDIA',
      content: 'AMD发布MI300X AI加速器，在某些任务中性能超越H100。新加速器采用先进的封装技术，集成了CPU和GPU功能。MI300X在内存容量和带宽方面有显著优势，适合大模型训练。',
      publishDate: '2024-01-23T12:00:00Z',
      url: 'https://www.amd.com/en/products/accelerators/instinct/mi300',
      summary: 'AMD发布MI300X AI加速器，在某些任务中性能超越H100'
    },
    {
      id: 1010,
      title: 'Intel发布Gaudi 3 AI芯片，进军AI市场',
      content: 'Intel发布Gaudi 3 AI芯片，专注于AI推理和训练。新芯片在性能功耗比方面有显著优势，特别适合边缘AI应用。Gaudi 3还提供了丰富的软件生态系统，支持主流AI框架。',
      publishDate: '2024-01-24T10:30:00Z',
      url: 'https://www.intel.com/content/www/us/en/products/details/processors/ai-accelerators/gaudi3.html',
      summary: 'Intel发布Gaudi 3 AI芯片，专注于AI推理和训练'
    }
  ],
  embeddings: [
    // 生成真实的384维embedding向量，模拟相似文章的向量聚集
    { articleId: 1001, embedding: generateProductionEmbedding([0.8, 0.7, 0.9, -0.2], 'ai_model') },
    { articleId: 1002, embedding: generateProductionEmbedding([0.7, 0.8, 0.8, -0.1], 'ai_model') },
    { articleId: 1003, embedding: generateProductionEmbedding([0.6, 0.7, 0.9, -0.3], 'ai_model') },
    { articleId: 1004, embedding: generateProductionEmbedding([0.8, 0.6, 0.8, -0.2], 'ai_model') },
    { articleId: 1005, embedding: generateProductionEmbedding([-0.1, 0.8, -0.2, 0.7], 'hardware') },
    { articleId: 1006, embedding: generateProductionEmbedding([0.2, -0.1, 0.6, 0.8], 'automotive') },
    { articleId: 1007, embedding: generateProductionEmbedding([0.5, 0.6, 0.7, -0.1], 'cloud_service') },
    { articleId: 1008, embedding: generateProductionEmbedding([-0.2, 0.9, -0.1, 0.8], 'hardware') },
    { articleId: 1009, embedding: generateProductionEmbedding([-0.1, 0.8, -0.2, 0.7], 'hardware') },
    { articleId: 1010, embedding: generateProductionEmbedding([0.1, 0.7, 0.1, 0.6], 'hardware') }
  ]
};

// 生成真实的384维embedding向量，模拟主题相关性
function generateProductionEmbedding(basePattern: number[], theme: string): number[] {
  const embedding = new Array(384);
  const patternLength = basePattern.length;
  
  // 基于主题的向量相似性模拟
  const themeBoost = {
    'ai_model': [0.1, 0.1, 0.2, -0.1],
    'hardware': [-0.1, 0.2, -0.1, 0.1],
    'automotive': [0.05, -0.05, 0.1, 0.15],
    'cloud_service': [0.1, 0.1, 0.1, -0.05]
  };
  
  const boost = themeBoost[theme as keyof typeof themeBoost] || [0, 0, 0, 0];
  
  for (let i = 0; i < 384; i++) {
    const baseValue = basePattern[i % patternLength];
    const themeValue = boost[i % boost.length];
    const noise = (Math.random() - 0.5) * 0.1; // 减少噪声，增加主题相关性
    embedding[i] = baseValue + themeValue + noise;
  }
  
  return embedding;
}

// ============================================================================
// 生产环境聚类参数计算 - 来自auto-brief-generation.ts
// ============================================================================

// 完全复制auto-brief-generation.ts中的动态参数计算逻辑
function calculateProductionClusteringOptions(articleCount: number) {
  return {
    umapParams: {
      n_neighbors: Math.min(15, Math.max(3, Math.floor(articleCount / 3))),
      n_components: Math.min(10, Math.max(2, Math.floor(articleCount / 5))),
      min_dist: 0.1,
      metric: 'cosine'
    },
    hdbscanParams: {
      min_cluster_size: Math.max(2, Math.floor(articleCount / 10)),
      min_samples: 1,
      epsilon: 0.5
    }
  };
}

// ============================================================================
// 生产环境ML服务响应模拟
// ============================================================================

const productionMLResponse = {
  clusters: [
    {
      cluster_id: 0,
      size: 4,
      items: [
        { id: 1001, metadata: { id: 1001 } },
        { id: 1002, metadata: { id: 1002 } },
        { id: 1003, metadata: { id: 1003 } },
        { id: 1004, metadata: { id: 1004 } }
      ]
    },
    {
      cluster_id: 1,
      size: 4,
      items: [
        { id: 1005, metadata: { id: 1005 } },
        { id: 1008, metadata: { id: 1008 } },
        { id: 1009, metadata: { id: 1009 } },
        { id: 1010, metadata: { id: 1010 } }
      ]
    },
    {
      cluster_id: 2,
      size: 2,
      items: [
        { id: 1006, metadata: { id: 1006 } },
        { id: 1007, metadata: { id: 1007 } }
      ]
    }
  ],
  config_used: {
    umap_n_neighbors: 3,
    umap_n_components: 2,
    umap_min_dist: 0.1,
    umap_metric: 'cosine',
    hdbscan_min_cluster_size: 1,
    hdbscan_min_samples: 1,
    hdbscan_cluster_selection_epsilon: 0.5
  },
  clustering_stats: {
    n_clusters: 3,
    n_outliers: 0,
    n_samples: 10
  }
};

// ============================================================================
// 测试套件
// ============================================================================

describe('ClusteringService - 生产环境集成测试', () => {
  
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock global fetch
    global.fetch = mockFetch;
  });

  describe('核心服务实例化', () => {
    test('应该正确创建ClusteringService实例', () => {
      const service = new ClusteringService(productionEnv);
      expect(service).toBeInstanceOf(ClusteringService);
    });

    test('应该通过createClusteringService工厂函数创建服务', () => {
      const service = createClusteringService(productionEnv);
      expect(service).toBeInstanceOf(ClusteringService);
    });

    test('应该正确创建MLService实例以保持向后兼容', () => {
      const service = new MLService(productionEnv);
      expect(service).toBeInstanceOf(MLService);
    });
  });

  describe('生产环境数据接口契约', () => {
    test('应该验证ArticleDataset接口结构', () => {
      expect(productionDataset).toHaveProperty('articles');
      expect(productionDataset).toHaveProperty('embeddings');
      expect(Array.isArray(productionDataset.articles)).toBe(true);
      expect(Array.isArray(productionDataset.embeddings)).toBe(true);
    });

    test('应该验证文章数据结构符合接口要求', () => {
      const article = productionDataset.articles[0];
      expect(article).toHaveProperty('id');
      expect(article).toHaveProperty('title');
      expect(article).toHaveProperty('content');
      expect(article).toHaveProperty('publishDate');
      expect(article).toHaveProperty('url');
      expect(article).toHaveProperty('summary');
      expect(typeof article.id).toBe('number');
      expect(typeof article.title).toBe('string');
      expect(typeof article.content).toBe('string');
    });

    test('应该验证embedding数据结构符合接口要求', () => {
      const embedding = productionDataset.embeddings[0];
      expect(embedding).toHaveProperty('articleId');
      expect(embedding).toHaveProperty('embedding');
      expect(typeof embedding.articleId).toBe('number');
      expect(Array.isArray(embedding.embedding)).toBe(true);
      expect(embedding.embedding.length).toBe(384);
    });

    test('应该验证文章和embedding的对应关系', () => {
      const articleIds = new Set(productionDataset.articles.map(a => a.id));
      const embeddingIds = new Set(productionDataset.embeddings.map(e => e.articleId));
      
      expect(articleIds.size).toBe(embeddingIds.size);
      for (const articleId of articleIds) {
        expect(embeddingIds.has(articleId)).toBe(true);
      }
    });
  });

  describe('聚类分析功能', () => {
    test('应该成功执行聚类分析', async () => {
      const service = new ClusteringService(productionEnv);
      
      // Mock ML service response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => productionMLResponse
      });

      const options = calculateProductionClusteringOptions(productionDataset.articles.length);
      const result = await service.analyzeClusters(productionDataset, options);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.clusters).toHaveLength(3);
      expect(result.data!.statistics.totalClusters).toBe(3);
    });

    test('应该验证聚类结果的数据结构', async () => {
      const service = new ClusteringService(productionEnv);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => productionMLResponse
      });

      const result = await service.analyzeClusters(productionDataset);

      expect(result.success).toBe(true);
      const data = result.data!;
      
      // 验证聚类结果结构
      expect(data).toHaveProperty('clusters');
      expect(data).toHaveProperty('parameters');
      expect(data).toHaveProperty('statistics');
      
      // 验证聚类数据
      expect(Array.isArray(data.clusters)).toBe(true);
      const cluster = data.clusters[0];
      expect(cluster).toHaveProperty('clusterId');
      expect(cluster).toHaveProperty('articleIds');
      expect(cluster).toHaveProperty('size');
      expect(Array.isArray(cluster.articleIds)).toBe(true);
    });

    test('应该验证聚类质量指标', async () => {
      const service = new ClusteringService(productionEnv);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => productionMLResponse
      });

      const result = await service.analyzeClusters(productionDataset);

      expect(result.success).toBe(true);
      const data = result.data!;
      
      // 验证聚类覆盖率
      const totalArticlesInClusters = data.clusters.reduce((sum, cluster) => sum + cluster.size, 0);
      const coverageRate = totalArticlesInClusters / data.statistics.totalArticles;
      expect(coverageRate).toBeGreaterThan(0.8); // 至少80%的文章应该被聚类
      
      // 验证聚类分布合理性
      const clusterSizes = data.clusters.map(c => c.size);
      const maxClusterSize = Math.max(...clusterSizes);
      const minClusterSize = Math.min(...clusterSizes);
      expect(maxClusterSize / minClusterSize).toBeLessThan(5); // 聚类大小差异不应过大
    });
  });

  describe('性能优化验证', () => {
    test('应该验证content字段被正确过滤以减少网络负载', async () => {
      const service = new ClusteringService(productionEnv);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => productionMLResponse
      });

      await service.analyzeClusters(productionDataset);

      // 验证fetch调用
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [request] = mockFetch.mock.calls[0];
      
      // 验证请求对象
      expect(request).toBeInstanceOf(Request);
      expect(request.method).toBe('POST');
      expect(request.url).toContain('/ai-worker/clustering');
      expect(request.url).toContain('return_embeddings=false');
      expect(request.url).toContain('return_reduced_embeddings=false');
      
      // 验证请求体中的数据已被优化
      const requestBody = JSON.parse(await request.text());
      expect(requestBody).toHaveProperty('items');
      expect(Array.isArray(requestBody.items)).toBe(true);
      
      // 验证每个item都包含必要字段但不包含完整content
      const item = requestBody.items[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('url');
      expect(item).toHaveProperty('embedding');
      expect(item).toHaveProperty('summary');
      // content字段应该被过滤掉
      expect(item).not.toHaveProperty('content');
    });

    test('应该验证embedding向量的主题相关性', () => {
      // 验证AI模型相关文章的embedding相似性
      const aiModelEmbeddings = [
        productionDataset.embeddings[0].embedding, // OpenAI
        productionDataset.embeddings[1].embedding, // Google
        productionDataset.embeddings[2].embedding, // Meta
        productionDataset.embeddings[3].embedding  // Anthropic
      ];
      
      // 计算AI模型文章之间的平均相似性
      let aiModelSimilarity = 0;
      let comparisons = 0;
      for (let i = 0; i < aiModelEmbeddings.length; i++) {
        for (let j = i + 1; j < aiModelEmbeddings.length; j++) {
          aiModelSimilarity += calculateCosineSimilarity(aiModelEmbeddings[i], aiModelEmbeddings[j]);
          comparisons++;
        }
      }
      aiModelSimilarity /= comparisons;
      
      // 验证硬件相关文章的embedding相似性
      const hardwareEmbeddings = [
        productionDataset.embeddings[4].embedding, // Apple
        productionDataset.embeddings[7].embedding, // NVIDIA
        productionDataset.embeddings[8].embedding, // AMD
        productionDataset.embeddings[9].embedding  // Intel
      ];
      
      let hardwareSimilarity = 0;
      comparisons = 0;
      for (let i = 0; i < hardwareEmbeddings.length; i++) {
        for (let j = i + 1; j < hardwareEmbeddings.length; j++) {
          hardwareSimilarity += calculateCosineSimilarity(hardwareEmbeddings[i], hardwareEmbeddings[j]);
          comparisons++;
        }
      }
      hardwareSimilarity /= comparisons;
      
      // 同主题文章的相似性应该较高
      expect(aiModelSimilarity).toBeGreaterThan(0.3);
      expect(hardwareSimilarity).toBeGreaterThan(0.3);
    });
  });

  describe('MLService兼容性测试', () => {
    test('应该支持MLService的analyzeClusters方法', async () => {
      const mlService = new MLService(productionEnv);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => productionMLResponse
      });

      const response = await mlService.analyzeClusters(productionDataset);
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
    });

    test('应该支持MLService的autoCluster方法', async () => {
      const mlService = new MLService(productionEnv);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true })
      });

      const response = await mlService.autoCluster({ test: 'data' });
      
      expect(response.ok).toBe(true);
    });

    test('应该支持MLService的generateEmbeddings方法', async () => {
      const mlService = new MLService(productionEnv);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] })
      });

      const response = await mlService.generateEmbeddings(['test text']);
      
      expect(response.ok).toBe(true);
    });
  });

  describe('错误处理和边界条件', () => {
    test('应该处理空数据集', async () => {
      const service = new ClusteringService(productionEnv);
      const emptyDataset: ArticleDataset = {
        articles: [],
        embeddings: []
      };

      const result = await service.analyzeClusters(emptyDataset);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Dataset is empty');
    });

    test('应该处理文章和embedding数量不匹配', async () => {
      const service = new ClusteringService(productionEnv);
      const mismatchedDataset: ArticleDataset = {
        articles: productionDataset.articles.slice(0, 5),
        embeddings: productionDataset.embeddings.slice(0, 3)
      };

      const result = await service.analyzeClusters(mismatchedDataset);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Mismatch between articles and embeddings count');
    });

    test('应该处理缺失embedding的文章', async () => {
      const service = new ClusteringService(productionEnv);
      const invalidDataset: ArticleDataset = {
        articles: [
          { id: 1, title: 'Test', content: 'Test', publishDate: '2024-01-01', url: 'http://test.com', summary: 'Test' }
        ],
        embeddings: [
          { articleId: 2, embedding: new Array(384).fill(0) } // 不匹配的ID
        ]
      };

      const result = await service.analyzeClusters(invalidDataset);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Missing embedding for article 1');
    });

    test('应该处理ML服务网络错误', async () => {
      const service = new ClusteringService(productionEnv);
      
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.analyzeClusters(productionDataset);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    test('应该处理ML服务HTTP错误', async () => {
      const service = new ClusteringService(productionEnv);
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      });

      const result = await service.analyzeClusters(productionDataset);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ML service failed: 500');
    });

    test('应该处理ML服务JSON解析错误', async () => {
      const service = new ClusteringService(productionEnv);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => { throw new Error('Invalid JSON'); }
      });

      const result = await service.analyzeClusters(productionDataset);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });
  });

  describe('健康检查功能', () => {
    test('应该支持健康检查成功场景', async () => {
      const service = new ClusteringService(productionEnv);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' })
      });

      const result = await service.healthCheck();

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('应该处理健康检查失败场景', async () => {
      const service = new ClusteringService(productionEnv);
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable'
      });

      const result = await service.healthCheck();

      expect(result.success).toBe(false);
      expect(result.error).toContain('ML service health check failed');
    });
  });

  describe('完整工作流集成场景', () => {
    test('应该模拟auto-brief-generation.ts中的完整聚类流程', async () => {
      const service = createClusteringService(productionEnv);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => productionMLResponse
      });

      // 模拟工作流中的LightweightArticleDataset到ArticleDataset转换
      const workflowDataset = {
        articles: productionDataset.articles.map(article => ({
          id: article.id,
          title: article.title,
          content: article.summary, // 工作流中使用summary作为content
          publishDate: article.publishDate,
          url: article.url,
          summary: article.summary
        })),
        embeddings: productionDataset.embeddings
      };

      // 使用工作流中的动态参数计算
      const clusteringOptions = calculateProductionClusteringOptions(workflowDataset.articles.length);
      
      const result = await service.analyzeClusters(workflowDataset, clusteringOptions);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      // 验证聚类结果符合工作流期望
      const data = result.data!;
      expect(data.clusters.length).toBeGreaterThan(0);
      expect(data.statistics.totalArticles).toBe(workflowDataset.articles.length);
      
      // 验证参数配置正确应用（来自mock响应）
      expect(data.parameters.umapParams.n_neighbors).toBe(3); // 来自productionMLResponse.config_used
      expect(data.parameters.umapParams.n_components).toBe(2);
      expect(data.parameters.hdbscanParams.min_cluster_size).toBe(1);
    });

    test('应该验证可观测性数据收集', async () => {
      const service = new ClusteringService(productionEnv);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => productionMLResponse
      });

      const startTime = Date.now();
      const result = await service.analyzeClusters(productionDataset);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      
      // 验证性能指标可以被收集
      const executionTime = endTime - startTime;
      expect(executionTime).toBeGreaterThanOrEqual(0);
      expect(executionTime).toBeLessThan(10000); // 应该在10秒内完成
      
      // 验证聚类质量指标
      const data = result.data!;
      const clusteringQuality = {
        clustersFound: data.clusters.length,
        averageClusterSize: data.clusters.reduce((sum, c) => sum + c.size, 0) / data.clusters.length,
        coverageRate: (data.statistics.totalArticles - data.statistics.noisePoints) / data.statistics.totalArticles
      };
      
      expect(clusteringQuality.clustersFound).toBeGreaterThan(0);
      expect(clusteringQuality.averageClusterSize).toBeGreaterThan(1);
      expect(clusteringQuality.coverageRate).toBeGreaterThan(0.5);
    });
  });

  describe('handleServiceResponse工具函数', () => {
    test('应该正确处理成功响应', async () => {
      const mockResponse = new Response(JSON.stringify({ data: 'test' }), {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' }
      });

      const result = await handleServiceResponse(mockResponse, 'test context');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: 'test' });
      expect(result.error).toBeUndefined();
    });

    test('应该正确处理失败响应', async () => {
      const mockResponse = new Response('Bad Request', {
        status: 400,
        statusText: 'Bad Request'
      });

      const result = await handleServiceResponse(mockResponse, 'test context');

      expect(result.success).toBe(false);
      expect(result.error).toBe('test context failed: 400 - Bad Request');
    });

    test('应该处理JSON解析错误', async () => {
      const mockResponse = new Response('invalid json', {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' }
      });

      const result = await handleServiceResponse(mockResponse);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unexpected token');
    });
  });
});

// ============================================================================
// 辅助函数
// ============================================================================

function calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  norm1 = Math.sqrt(norm1);
  norm2 = Math.sqrt(norm2);

  if (norm1 === 0 || norm2 === 0) {
    return 0;
  }

  return dotProduct / (norm1 * norm2);
} 