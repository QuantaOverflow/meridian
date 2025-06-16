// services/meridian-ai-worker/tests/workflow.integration.test.ts
/**
 * Meridian AI Worker 端到端集成测试
 * 
 * 本测试使用真实的外部服务调用，测试从模拟文章数据到最终简报生成的完整工作流。
 * 数据结构严格遵循 intelligence-pipeline.test.ts 契约。
 * 
 * 工作流步骤：
 * 1. 模拟文章数据集 (ArticleDataset)
 * 2. 聚类分析 → ClusteringResult 
 * 3. 故事验证 → ValidatedStories
 * 4. 情报分析 → IntelligenceReports
 * 5. 简报生成 → FinalBrief
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Hono } from 'hono';

// ============================================================================
// 测试环境配置
// ============================================================================

// 加载 .dev.vars 文件的环境变量
function loadDevEnvironmentVariables() {
  try {
    const devVarsPath = path.join(process.cwd(), '.dev.vars');
    if (fs.existsSync(devVarsPath)) {
      const envContent = fs.readFileSync(devVarsPath, 'utf8');
      const envVars = envContent.split('\n').filter(line => 
        line.trim() && !line.startsWith('#') && line.includes('=')
      );
      
      envVars.forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim();
          process.env[key.trim()] = value;
        }
      });
      
      console.log('✅ 已加载 .dev.vars 环境变量');
    }
  } catch (error) {
    console.warn('⚠️  无法加载 .dev.vars 文件:', error);
  }
}

// 检查是否为集成测试模式
const INTEGRATION_TEST_MODE = process.env.INTEGRATION_TEST_MODE === 'true';

console.log('🧪 Workflow Integration Test Suite');
console.log(`📋 Test mode: ${INTEGRATION_TEST_MODE ? 'INTEGRATION (with real AI Gateway)' : 'UNIT (mocked)'}`);

// Mock环境变量配置（参考 briefGeneration.test.ts 模式）
const mockEnv = {
  GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY || 'mock-api-key',
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || 'mock-account-id',
  CLOUDFLARE_GATEWAY_ID: process.env.CLOUDFLARE_GATEWAY_ID || 'mock-gateway-id',
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || 'mock-api-token',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'mock-openai-key',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'mock-anthropic-key',
  AI_GATEWAY_URL: process.env.AI_GATEWAY_URL || 'https://gateway.ai.cloudflare.com/v1/mock-account/meridian/google-ai-studio',
  ENVIRONMENT: 'development',
  INTEGRATION_TEST_MODE: INTEGRATION_TEST_MODE.toString(),
  NODE_ENV: 'test',
};

// ============================================================================
// HTTP 客户端配置
// ============================================================================

// AI Worker 服务的基础 URL
const AI_WORKER_BASE_URL = process.env.AI_WORKER_BASE_URL || 'http://localhost:8786';

// 创建HTTP客户端接口
interface HttpClient {
  request(path: string, options: RequestInit): Promise<Response>;
}

// 真实HTTP客户端（集成测试）
class RealHttpClient implements HttpClient {
  async request(path: string, options: RequestInit): Promise<Response> {
    const url = `${AI_WORKER_BASE_URL}${path}`;
    console.log(`🌐 发送请求到: ${url}`);
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      console.error(`❌ 请求失败: ${response.status} ${response.statusText}`);
      console.error(`📍 URL: ${url}`);
      const errorText = await response.text();
      console.error(`💥 错误详情: ${errorText}`);
    }
    
    return response;
  }
}

// Mock HTTP客户端（单元测试）
class MockHttpClient implements HttpClient {
  private app: Hono;
  
  constructor() {
    this.app = this.createMockHonoApp();
  }
  
  private createMockHonoApp() {
    const testApp = new Hono();
    
    // 添加中间件来注入环境变量
    testApp.use('*', async (c, next) => {
      c.env = mockEnv as any;
      await next();
    });

    // 动态导入和注册路由
    return testApp;
  }
  
  async request(path: string, options: RequestInit): Promise<Response> {
    // 在beforeEach中会重新加载真实路由
    return await this.app.request(path, options);
  }
  
  async loadRealRoutes() {
    const appModule = await import('../src/index');
    const realApp = appModule.default;
    this.app.route('/', realApp);
  }
}

// ============================================================================
// 数据定义
// ============================================================================

interface ArticleDataset {
  articles: Array<{
    id: number;
    title: string;
    content: string;
    publishDate: string;
    url: string;
    summary: string;
  }>;
  embeddings: Array<{
    articleId: number;
    embedding: number[];
  }>;
}

interface MinimalArticleInfo {
  id: number;
  title: string;
  url: string;
  event_summary_points?: string[];
}

interface ClusteringResult {
  clusters: Array<{
    clusterId: number;
    articleIds: number[];
    size: number;
  }>;
  parameters: {
    umapParams: {
      n_neighbors: number;
      n_components: number;
      min_dist: number;
      metric: string;
    };
    hdbscanParams: {
      min_cluster_size: number;
      min_samples: number;
      epsilon: number;
    };
  };
  statistics: {
    totalClusters: number;
    noisePoints: number;
    totalArticles: number;
  };
}

// ============================================================================
// 数据转换工具函数
// ============================================================================

/**
 * 将 ArticleDataset 转换为 MinimalArticleInfo 数组
 * 用于故事验证端点
 */
function convertArticleDatasetToMinimalArticleInfo(dataset: ArticleDataset): MinimalArticleInfo[] {
  if (!dataset || !dataset.articles) {
    return [];
  }

  return dataset.articles.map(article => ({
    id: article.id,
    title: article.title,
    url: article.url,
    // 如果 article.summary 存在且不是空字符串，则将其放入数组
    event_summary_points: (article.summary && article.summary.trim() !== '') ? [article.summary] : undefined,
  }));
}

describe('End-to-End Workflow Integration Test', () => {
  let httpClient: HttpClient;
  let sampleArticleDataset: ArticleDataset;
  let mockClusteringResult: ClusteringResult;

  beforeAll(() => {
    // 加载 .dev.vars 环境变量
    loadDevEnvironmentVariables();
    
    // 设置测试模式环境变量
    Object.entries(mockEnv).forEach(([key, value]) => {
      process.env[key] = value;
    });
    
    console.log('🔧 测试环境已配置');
    
    if (INTEGRATION_TEST_MODE) {
      console.log(`🔗 使用真实 AI Worker 服务: ${AI_WORKER_BASE_URL}`);
      console.log(`🔑 API Keys 配置:`);
      console.log(`   - GOOGLE_AI_API_KEY: ${process.env.GOOGLE_AI_API_KEY ? '✅ 已配置' : '❌ 未配置'}`);
      console.log(`   - OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✅ 已配置' : '❌ 未配置'}`);
      console.log(`   - CLOUDFLARE_ACCOUNT_ID: ${process.env.CLOUDFLARE_ACCOUNT_ID ? '✅ 已配置' : '❌ 未配置'}`);
      console.log(`   - CLOUDFLARE_GATEWAY_ID: ${process.env.CLOUDFLARE_GATEWAY_ID ? '✅ 已配置' : '❌ 未配置'}`);
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    // 创建HTTP客户端
    if (INTEGRATION_TEST_MODE) {
      httpClient = new RealHttpClient();
    } else {
      const mockClient = new MockHttpClient();
      await mockClient.loadRealRoutes();
      httpClient = mockClient;
    }

    // 准备符合 intelligence-pipeline.test.ts 契约的模拟数据 - 使用更具故事性的连贯事件
    sampleArticleDataset = {
      articles: [
        // 突发事件：乌克兰冲突最新发展（更真实的事件序列）
        {
          id: 101,
          title: '乌克兰东部前线激战持续，俄军发动新一轮攻势',
          content: '据乌克兰军方消息，俄罗斯军队在顿涅茨克地区发动了新一轮大规模攻势，试图突破乌军防线。战斗主要集中在巴赫穆特和阿夫迪夫卡附近，双方都投入了大量装甲部队。乌军方面表示，俄军使用了包括坦克、装甲车和火炮在内的重型武器，战况异常激烈。国际观察员称，这是自去年10月以来最大规模的地面攻势。',
          publishDate: '2024-01-15T06:00:00Z',
          url: 'https://example.com/ukraine-frontline-battle',
          summary: '乌克兰东部前线爆发激烈战斗，俄军发动大规模地面攻势'
        },
        {
          id: 102,
          title: '北约紧急会议商讨对乌援助升级，考虑提供远程打击武器',
          content: '针对乌克兰战场最新态势，北约秘书长斯托尔滕贝格召集紧急会议，各成员国外长讨论进一步军事援助方案。多个消息源透露，会议重点讨论了向乌克兰提供射程更远的精确制导武器，包括ATACMS导弹和"风暴阴影"巡航导弹。德国和法国表示支持升级援助，但美国对此仍持谨慎态度，担心可能导致冲突进一步升级。',
          publishDate: '2024-01-15T10:30:00Z',
          url: 'https://example.com/nato-emergency-meeting',
          summary: 'NATO紧急会议讨论向乌克兰提供远程武器，援助升级引发关注'
        },
        {
          id: 103,
          title: '俄罗斯警告西方不要"越过红线"，威胁报复措施',
          content: '俄罗斯外交部发言人扎哈罗娃在新闻发布会上警告西方国家，不要向乌克兰提供能够打击俄领土的远程武器，称这将是"越过红线"的行为。俄方表示，如果西方继续升级军事援助，俄罗斯将采取"相应的报复措施"。与此同时，俄总统普京签署了新的军事动员令，计划在今年春季前增加30万兵力。分析人士认为，这表明冲突可能进入新的升级阶段。',
          publishDate: '2024-01-15T14:45:00Z',
          url: 'https://example.com/russia-red-line-warning',
          summary: '俄罗斯警告西方援助升级将越过红线，威胁采取报复措施'
        },
        {
          id: 104,
          title: '乌克兰总统泽连斯基呼吁国际社会加大制裁力度',
          content: '乌克兰总统泽连斯基通过视频连线向欧洲议会发表讲话，呼吁国际社会对俄罗斯实施更严厉的制裁。他特别要求切断俄罗斯的石油和天然气出口，并冻结更多俄罗斯官员和寡头的海外资产。泽连斯基表示，只有通过全面的经济制裁和军事援助，才能迫使俄罗斯停止侵略行为。欧盟委员会主席冯德莱恩回应称，欧盟正在考虑新一轮制裁措施。',
          publishDate: '2024-01-15T16:20:00Z',
          url: 'https://example.com/zelensky-sanctions-appeal',
          summary: '泽连斯基呼吁加大对俄制裁，要求切断能源出口和冻结资产'
        },
        
        // 第二个故事：全球能源危机
        {
          id: 105,
          title: '国际油价飙升至每桶95美元，创两年来新高',
          content: '受地缘政治紧张局势影响，国际原油价格大幅上涨，布伦特原油期货价格突破每桶95美元，创下自2022年以来的最高水平。WTI原油也上涨至每桶91美元。能源分析师指出，乌克兰冲突升级和中东地区的不稳定是推动油价上涨的主要因素。沙特阿拉伯和俄罗斯等主要产油国暂未表示将增产来平抑价格。',
          publishDate: '2024-01-15T08:15:00Z',
          url: 'https://example.com/oil-price-surge',
          summary: '地缘政治紧张推动国际油价飙升至两年来新高'
        },
        {
          id: 106,
          title: '欧洲天然气库存告急，多国启动能源紧急预案',
          content: '欧洲天然气库存水平降至危险低位，多个成员国启动能源紧急预案。德国宣布重启部分燃煤电厂，法国延长核电站运行时间，意大利和西班牙开始从北非增加天然气进口。欧盟能源专员表示，如果今冬出现极端严寒天气，欧洲可能面临能源供应短缺的严重挑战。工业界警告，持续的能源危机可能导致制造业大规模停产。',
          publishDate: '2024-01-15T12:30:00Z',
          url: 'https://example.com/europe-gas-crisis',
          summary: '欧洲天然气库存告急，各国启动紧急预案应对能源危机'
        },
        {
          id: 107,
          title: '美国宣布释放战略石油储备，试图稳定全球能源市场',
          content: '为应对国际油价暴涨，美国总统拜登宣布从战略石油储备中释放5000万桶原油，这是继去年11月后的又一次大规模释放行动。白宫表示，此举旨在稳定全球能源市场，缓解消费者面临的能源价格压力。同时，美国还协调其他国际能源署成员国同时释放石油储备。然而，市场分析师认为，这种短期措施难以根本解决能源供应问题。',
          publishDate: '2024-01-15T18:00:00Z',
          url: 'https://example.com/us-oil-reserve-release',
          summary: '美国释放战略石油储备试图稳定市场，但专家质疑效果'
        }
      ],
      embeddings: [
        {
          articleId: 101,
          embedding: Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1) * 0.5 + Math.cos(i * 0.2) * 0.3)
        },
        {
          articleId: 102,
          embedding: Array.from({ length: 384 }, (_, i) => Math.cos(i * 0.1) * 0.4 + Math.sin(i * 0.15) * 0.4)
        },
        {
          articleId: 103,
          embedding: Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.2) * 0.6 + Math.cos(i * 0.1) * 0.2)
        },
        {
          articleId: 104,
          embedding: Array.from({ length: 384 }, (_, i) => Math.cos(i * 0.2) * 0.5 + Math.sin(i * 0.25) * 0.3)
        },
        {
          articleId: 105,
          embedding: Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.12) * 0.4 + Math.cos(i * 0.18) * 0.4)
        },
        {
          articleId: 106,
          embedding: Array.from({ length: 384 }, (_, i) => Math.cos(i * 0.14) * 0.5 + Math.sin(i * 0.16) * 0.3)
        },
        {
          articleId: 107,
          embedding: Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.13) * 0.6 + Math.cos(i * 0.17) * 0.2)
        }
      ]
    };

    // 模拟聚类结果 - 符合 ClusteringResult 契约
    mockClusteringResult = {
      clusters: [
        {
          clusterId: 0,
          articleIds: [101, 102, 103, 104], // AI相关文章聚类 - 增加文章数量
          size: 4
        },
        {
          clusterId: 1,
          articleIds: [105, 106, 107], // 增加一个新的聚类，满足最小尺寸要求
          size: 3
        }
      ],
      parameters: {
        umapParams: {
          n_neighbors: 15,
          n_components: 10,
          min_dist: 0.0,
          metric: "cosine"
        },
        hdbscanParams: {
          min_cluster_size: 3, // 降低最小聚类大小要求
          min_samples: 2,
          epsilon: 0.2
        }
      },
      statistics: {
        totalClusters: 2,
        noisePoints: 0,
        totalArticles: 7 // 更新总文章数
      }
    };
  });

  it('应该成功执行完整的端到端工作流：聚类验证 → 情报分析 → 简报生成', async () => {
    console.log('🚀 开始端到端工作流集成测试...');

    // =====================================================================
    // 步骤 1: 故事验证 (Story Validation)
    // 输入: ClusteringResult + articlesData → 输出: ValidatedStories
    // =====================================================================
    console.log('📝 步骤 1: 执行故事验证...');
    
    // 转换文章数据集为最小文章信息格式
    const minimalArticlesData = convertArticleDatasetToMinimalArticleInfo(sampleArticleDataset);
    console.log(`   转换了 ${minimalArticlesData.length} 个文章数据用于故事验证`);
    
    const storyValidationResponse = await httpClient.request('/meridian/story/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clusteringResult: mockClusteringResult,
        articlesData: minimalArticlesData, // 新增：传递文章数据
        useAI: INTEGRATION_TEST_MODE, // 集成测试时启用AI验证，单元测试时禁用
        options: INTEGRATION_TEST_MODE ? {
          provider: 'google-ai-studio',
          model: 'gemini-2.0-flash'
        } : { 
          provider: 'mock', 
          model: 'mock-chat'
        }
      }),
    });

    expect(storyValidationResponse.status).toBe(200);
    const validationData = await storyValidationResponse.json();
    expect(validationData.success).toBe(true);
        
    // 验证 ValidatedStories 数据契约
    expect(validationData.data).toHaveProperty('stories');
    expect(validationData.data).toHaveProperty('rejectedClusters');
    expect(Array.isArray(validationData.data.stories)).toBe(true);
    expect(Array.isArray(validationData.data.rejectedClusters)).toBe(true);

    // 验证新的元数据字段
    expect(validationData.metadata).toHaveProperty('totalArticlesProvided');
    expect(validationData.metadata.totalArticlesProvided).toBe(minimalArticlesData.length);

    const validatedStories = validationData.data;
    console.log(`✅ 故事验证完成: ${validatedStories.stories.length} 个有效故事, ${validatedStories.rejectedClusters.length} 个拒绝聚类`);
    console.log(`   提供了 ${validationData.metadata.totalArticlesProvided} 个文章数据用于AI分析`);

    // 验证故事数据结构
    if (validatedStories.stories.length > 0) {
      const story = validatedStories.stories[0];
      expect(story).toHaveProperty('title');
      expect(story).toHaveProperty('importance');
      expect(story).toHaveProperty('articleIds');
      expect(story).toHaveProperty('storyType');
      expect(story.importance).toBeGreaterThanOrEqual(1);
      expect(story.importance).toBeLessThanOrEqual(10);
      expect(['SINGLE_STORY', 'COLLECTION_OF_STORIES']).toContain(story.storyType);
      
      console.log(`   首个故事: "${story.title}" (重要性: ${story.importance}, 类型: ${story.storyType})`);
    }

    // =====================================================================
    // 步骤 2: 情报分析 (Intelligence Analysis)
    // 输入: ValidatedStories + ArticleDataset → 输出: IntelligenceReports
    // =====================================================================
    console.log('🧠 步骤 2: 执行情报分析...');
    
    const intelligenceResponse = await httpClient.request('/meridian/intelligence/analyze-stories', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(INTEGRATION_TEST_MODE && {
          'X-Test-Mode': 'integration'
        })
      },
      body: JSON.stringify({
        stories: validatedStories,
        dataset: sampleArticleDataset,
        options: INTEGRATION_TEST_MODE ? {
          provider: 'google-ai-studio',
          model: 'gemini-2.0-flash'
        } : undefined
      }),
    });

    expect(intelligenceResponse.status).toBe(200);
    const intelligenceData = await intelligenceResponse.json();
    expect(intelligenceData.success).toBe(true);
    
    // 验证 IntelligenceReports 数据契约
    expect(intelligenceData.data).toHaveProperty('reports');
    expect(intelligenceData.data).toHaveProperty('processingStatus');
    expect(Array.isArray(intelligenceData.data.reports)).toBe(true);
    
    const reports = intelligenceData.data.reports;
    const processingStatus = intelligenceData.data.processingStatus;
    
    // 验证处理状态
    expect(processingStatus).toHaveProperty('totalStories');
    expect(processingStatus).toHaveProperty('completedAnalyses');
    expect(processingStatus).toHaveProperty('failedAnalyses');
    expect(processingStatus.totalStories).toBeGreaterThan(0);

    console.log(`✅ 情报分析完成: ${reports.length} 份报告, 状态: ${processingStatus.completedAnalyses} 成功 / ${processingStatus.failedAnalyses} 失败`);

    // 验证情报报告数据结构
    if (reports.length > 0) {
      const report = reports[0];
      expect(report).toHaveProperty('storyId');
      expect(report).toHaveProperty('status');
      expect(report).toHaveProperty('executiveSummary');
      expect(report).toHaveProperty('storyStatus');
      expect(['COMPLETE', 'INCOMPLETE']).toContain(report.status);
      expect(['DEVELOPING', 'ESCALATING', 'DE_ESCALATING', 'CONCLUDING', 'STATIC']).toContain(report.storyStatus);
      
      console.log(`   首个报告: 故事 "${report.storyId}" (状态: ${report.status}, 发展: ${report.storyStatus})`);
      console.log(`   摘要: ${report.executiveSummary.substring(0, 100)}...`);
    }

    // =====================================================================
    // 步骤 3: 简报生成 (Brief Generation)
    // 输入: IntelligenceReports → 输出: FinalBrief
    // =====================================================================
    console.log('📰 步骤 3: 生成最终简报...');
    
    const briefResponse = await httpClient.request('/meridian/generate-final-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analysisData: intelligenceData.data.reports, // 简报生成期望analysisData格式
        previousContext: {
          date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 昨天的日期
          title: '前日简报标题',
          summary: '前日简报摘要：主要涵盖了技术发展和市场动态等话题',
          coveredTopics: ['技术发展', '市场动态', '政策变化']
        },
        options: INTEGRATION_TEST_MODE ? {
          provider: 'google-ai-studio',
          model: 'gemini-2.0-flash'
        } : {
          provider: 'mock',
          model: 'mock-chat'
        }
      }),
    });

    expect(briefResponse.status).toBe(200);
    const briefData = await briefResponse.json();
    expect(briefData.success).toBe(true);
        
    // 验证简报数据结构
    expect(briefData.data).toHaveProperty('title');
    expect(briefData.data).toHaveProperty('content');
    expect(typeof briefData.data.title).toBe('string');
    expect(typeof briefData.data.content).toBe('string');
    expect(briefData.data.title.length).toBeGreaterThan(0);
    expect(briefData.data.content.length).toBeGreaterThan(0);

    console.log(`✅ 简报生成完成: "${briefData.data.title}"`);
    console.log(`📊 简报内容长度: ${briefData.data.content.length} 字符`);

    // =====================================================================
    // 步骤 4: TLDR 生成 (可选)
    // =====================================================================
    console.log('📝 步骤 4: 生成简报摘要...');

    const tldrResponse = await httpClient.request('/meridian/generate-brief-tldr', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(INTEGRATION_TEST_MODE && {
          'X-Test-Mode': 'integration'
        })
      },
      body: JSON.stringify({ 
        briefTitle: briefData.data.title, 
        briefContent: briefData.data.content,
        options: INTEGRATION_TEST_MODE ? {
          provider: 'google-ai-studio',
          model: 'gemini-2.0-flash'
        } : undefined
      }),
    });

    expect(tldrResponse.status).toBe(200);
    const tldrData = await tldrResponse.json();
    expect(tldrData.success).toBe(true);
    
    // 验证 TLDR 数据结构
    expect(tldrData.data).toHaveProperty('tldr');
    expect(typeof tldrData.data.tldr).toBe('string');
    expect(tldrData.data.tldr.length).toBeGreaterThan(0);

    console.log(`✅ TLDR 生成完成`);

    // =====================================================================
    // 最终验证：完整工作流数据完整性
    // =====================================================================
    console.log('🔍 验证工作流数据完整性...');

    // 验证数据流转的连贯性
    expect(validatedStories.stories.length).toBeGreaterThan(0);
    expect(reports.length).toBeGreaterThan(0);

    // 验证处理统计的一致性
    if (INTEGRATION_TEST_MODE) {
      // 集成测试允许失败（由于配额限制或网络问题）
      expect(processingStatus.completedAnalyses + processingStatus.failedAnalyses)
        .toBe(processingStatus.totalStories);
        
      if (processingStatus.failedAnalyses > 0) {
        console.log(`⚠️  注意: ${processingStatus.failedAnalyses} 个分析失败 (配额限制或网络问题)`);
      }
    } else {
      // 单元测试期望完美结果
      expect(processingStatus.completedAnalyses).toBe(processingStatus.totalStories);
      expect(processingStatus.failedAnalyses).toBe(0);
    }

    // 验证元数据（可选）
    if (briefData.metadata) {
      expect(briefData.metadata).toHaveProperty('sections_processed');
      expect(briefData.metadata).toHaveProperty('content_length');
    }
    
    if (tldrData.metadata) {
      expect(tldrData.metadata).toHaveProperty('story_count');
    }

    console.log('🎉 端到端工作流集成测试成功完成！');
    console.log(`📈 处理统计: ${sampleArticleDataset.articles.length} 篇文章 → ${mockClusteringResult.clusters.length} 个聚类 → ${validatedStories.stories.length} 个故事 → ${reports.length} 份情报报告 → 1 份最终简报`);

    // 输出简报样例用于验证
    console.log('\n📰 生成的简报预览:');
    console.log(`标题: ${briefData.data.title}`);
    console.log(`内容长度: ${briefData.data.content.length} 字符`);
    console.log(`TLDR: ${tldrData.data.tldr.substring(0, 200)}...`);

    // 如果是集成测试，输出更多诊断信息
    if (INTEGRATION_TEST_MODE) {
      console.log('\n🔍 集成测试诊断信息:');
      console.log(`API Base URL: ${AI_WORKER_BASE_URL}`);
      console.log(`成功率: ${Math.round((processingStatus.completedAnalyses / processingStatus.totalStories) * 100)}%`);
      
      if (validatedStories.rejectedClusters.length > 0) {
        console.log(`拒绝聚类数: ${validatedStories.rejectedClusters.length}`);
      }
    }
  }, INTEGRATION_TEST_MODE ? 180000 : 30000); // 集成测试3分钟超时，单元测试30秒超时
});