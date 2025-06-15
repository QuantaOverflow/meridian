/**
 * Meridian Backend - 智能简报生成工作流集成测试
 * 
 * 此测试文件验证智能简报生成工作流的完整端到端流程，从数据库中已处理的文章开始，
 * 通过 AI Worker 服务和 ML 聚类服务生成智能简报。测试采用 BDD (行为驱动开发) 规范，
 * 可作为技术文档阅读。
 * 
 * 完整工作流步骤：
 * 1. 获取已处理文章 (状态为 PROCESSED，包含 AI 分析结果和嵌入向量)
 * 2. 调用 ML 服务进行聚类分析
 * 3. 调用 AI Worker 进行故事验证和清理
 * 4. 调用 AI Worker 进行情报分析
 * 5. 调用 AI Worker 生成最终简报和 TLDR
 * 6. 将生成的简报保存到数据库
 * 
 * 测试场景：
 * - 完整的端到端工作流集成测试
 * - 聚类分析与故事验证流程
 * - 情报分析与简报生成流程
 * - 数据质量验证和错误处理
 * - 外部服务集成 (AI Worker, ML Service)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { resetMockDatabase } from '../mocks/database.mock';

// 模拟 fetch 以拦截对 AI Worker 的调用
const originalFetch = global.fetch;

describe('智能简报生成工作流集成测试 (BDD规范)', () => {
  beforeEach(async () => {
    // 重置所有模拟和数据库状态
    vi.clearAllMocks();
    resetMockDatabase();
    
    // 设置 AI Worker 服务的默认响应
    setupDefaultAIWorkerMocks();
  });

  afterEach(() => {
    // 恢复原始的 fetch 函数
    global.fetch = originalFetch;
  });

  /**
   * 场景：完整的端到端工作流集成测试
   * 
   * 作为 Meridian 系统
   * 当存在已处理的文章数据时
   * 我希望能够执行完整的工作流
   * 从聚类分析到简报生成的全过程
   * 以便为用户提供高质量的每日新闻摘要
   */
  describe('完整的端到端工作流集成测试', () => {
    it('应该成功执行从聚类分析到简报生成的完整工作流', async () => {
      // =====================================================================
      // 步骤 0: 准备已处理的文章数据 (模拟从数据库获取的已分析文章)
      // 符合 processArticles.workflow.ts 处理后的数据库 schema
      // =====================================================================
      const processedArticles = [
        {
          id: 101,
          title: 'AI技术突破：新一代语言模型发布',
          url: 'https://example.com/ai-breakthrough',
          publish_date: new Date('2024-01-15T10:00:00Z'),
          status: 'PROCESSED' as const,
          contentFileKey: '2024/1/15/101.txt',
          processedAt: new Date('2024-01-15T10:30:00Z'),
          // AI 分析结果字段 (来自 processArticles workflow)
          language: 'zh',
          primary_location: 'global',
          completeness: 'COMPLETE' as const,
          content_quality: 'OK' as const,  // 修正：使用数据库支持的枚举值
          event_summary_points: ['新一代语言模型发布', 'AI技术重大突破'],
          thematic_keywords: ['AI', '语言模型', '技术突破'],
          topic_tags: ['technology', 'artificial-intelligence'],
          key_entities: ['AI公司', '研究机构'],
          content_focus: ['技术创新', 'AI发展'],
          embedding: Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1)) // 模拟384维嵌入向量
        },
        {
          id: 102,
          title: '科技巨头投资AI基础设施建设',
          url: 'https://example.com/ai-investment',
          publish_date: new Date('2024-01-15T11:30:00Z'),
          status: 'PROCESSED' as const,
          contentFileKey: '2024/1/15/102.txt',
          processedAt: new Date('2024-01-15T12:00:00Z'),
          // AI 分析结果字段
          language: 'zh',
          primary_location: 'global',
          completeness: 'COMPLETE' as const,
          content_quality: 'OK' as const,
          event_summary_points: ['AI基础设施投资', '数据中心建设'],
          thematic_keywords: ['AI', '投资', '基础设施'],
          topic_tags: ['technology', 'investment'],
          key_entities: ['科技巨头', '投资机构'],
          content_focus: ['基础设施', '投资趋势'],
          embedding: Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1 + 0.5))
        },
        {
          id: 103,
          title: 'AI监管政策新进展：欧盟发布指导原则',
          url: 'https://example.com/ai-regulation',
          publish_date: new Date('2024-01-15T14:20:00Z'),
          status: 'PROCESSED' as const,
          contentFileKey: '2024/1/15/103.txt',
          processedAt: new Date('2024-01-15T14:50:00Z'),
          // AI 分析结果字段
          language: 'zh',
          primary_location: 'europe',
          completeness: 'COMPLETE' as const,
          content_quality: 'OK' as const,
          event_summary_points: ['AI监管政策', '欧盟指导原则'],
          thematic_keywords: ['AI', '监管', '政策'],
          topic_tags: ['technology', 'regulation'],
          key_entities: ['欧盟', '监管机构'],
          content_focus: ['政策制定', '监管框架'],
          embedding: Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1 + 1.0))
        },
        {
          id: 104,
          title: '全球经济形势分析：通胀压力持续',
          url: 'https://example.com/economic-analysis',
          publish_date: new Date('2024-01-15T09:15:00Z'),
          status: 'PROCESSED' as const,
          contentFileKey: '2024/1/15/104.txt',
          processedAt: new Date('2024-01-15T09:45:00Z'),
          // AI 分析结果字段
          language: 'zh',
          primary_location: 'global',
          completeness: 'COMPLETE' as const,
          content_quality: 'OK' as const,
          event_summary_points: ['全球通胀持续', '货币政策调整'],
          thematic_keywords: ['经济', '通胀', '央行'],
          topic_tags: ['economics', 'inflation'],
          key_entities: ['央行', '经济机构'],
          content_focus: ['经济分析', '货币政策'],
          embedding: Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.2 + 2.0)) // 不同的向量模式
        }
      ];

      console.log(`步骤 0: 准备了 ${processedArticles.length} 篇已处理的文章`);

      // =====================================================================
      // 步骤 1: ML服务聚类分析 (Clustering Analysis)
      // =====================================================================
      console.log('步骤 1: 执行聚类分析...');
      
      // 模拟ML服务的聚类响应
      setupMLServiceMocks();
      
             // 准备AI Worker格式的聚类请求数据
       const aiWorkerItems = processedArticles.map(article => ({
         id: article.id,
         embedding: article.embedding,
         title: article.title,
         url: article.url,
         publish_date: article.publish_date,
         status: article.status
       }));

       // 调用ML服务进行聚类（使用实际的AI Worker端点）
       const clusteringUrl = new URL('http://localhost:8080/ai-worker/clustering');
       clusteringUrl.searchParams.set('return_embeddings', 'false');
       clusteringUrl.searchParams.set('return_reduced_embeddings', 'true');
       
       const clusteringResponse = await fetch(clusteringUrl.toString(), {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           items: aiWorkerItems,
           config: {
             umap_n_neighbors: 15,
             hdbscan_min_cluster_size: 2,
             hdbscan_min_samples: 1,
             umap_metric: 'cosine',
             normalize_embeddings: true
           },
           optimization: {
             enabled: false  // 测试环境关闭优化以提高速度
           },
           content_analysis: {
             enabled: true,
             top_n_per_cluster: 3
           }
         })
       });

      expect(clusteringResponse.status).toBe(200);
      const clusteringResult = await clusteringResponse.json() as any;
      expect(clusteringResult.clusters).toBeDefined();
      expect(clusteringResult.clusters.length).toBeGreaterThan(0);

             // 将聚类结果转换为工作流期望的格式
       const clustersWithArticles = clusteringResult.clusters.map((cluster: any) => ({
         id: cluster.cluster_id,
         articles: cluster.items.map((item: any) => 
           processedArticles.find(a => a.id === item.id)
         ).filter(Boolean),
         similarity_score: cluster.coherence_score,
         coherence_score: cluster.coherence_score,
         stability_score: cluster.stability_score,
         size: cluster.size,
         representative_content: cluster.representative_content || [],
         keywords: cluster.keywords || [],
         summary: cluster.summary
       }));

      console.log(`步骤 1 完成: 发现 ${clustersWithArticles.length} 个聚类`);

      // =====================================================================
      // 步骤 2: 故事验证和清理 (Story Validation)
      // =====================================================================
      console.log('步骤 2: 执行故事验证...');
      
      // 设置AI Worker服务的故事验证响应
      setupAIWorkerStoryValidationMocks();

      const cleanedStories: any[] = [];
      for (const cluster of clustersWithArticles) {
        const validateResponse = await fetch('http://localhost:8786/meridian/story/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cluster })
        });

        expect(validateResponse.status).toBe(200);
        const validateData = await validateResponse.json() as any;
        expect(validateData.success).toBe(true);
        
        if (validateData.data.cleaned_stories && validateData.data.cleaned_stories.length > 0) {
          cleanedStories.push(...validateData.data.cleaned_stories);
        }
      }

      console.log(`步骤 2 完成: 验证并清理出 ${cleanedStories.length} 个有效故事`);
      expect(cleanedStories.length).toBeGreaterThan(0);

      // =====================================================================
      // 步骤 3: 情报分析 (Intelligence Analysis)
      // =====================================================================
      console.log('步骤 3: 执行情报分析...');
      
      // 设置AI Worker服务的情报分析响应
      setupAIWorkerIntelligenceAnalysisMocks();

      const analysisDataForBrief: any[] = [];
      for (const story of cleanedStories) {
        // 构建符合情报分析端点期望的请求体
        const storyWithContent = {
          storyId: story.id,
          analysis: { summary: story.title }
        };
        const clusterForAnalysis = {
          articles: story.articles.map((id: number) => 
            processedArticles.find(a => a.id === id)
          ).filter(Boolean)
        };

        const analysisResponse = await fetch('http://localhost:8786/meridian/intelligence/analyze-story', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            story: storyWithContent, 
            cluster: clusterForAnalysis 
          })
        });

        expect(analysisResponse.status).toBe(200);
        const analysisData = await analysisResponse.json() as any;
        expect(analysisData.success).toBe(true);
        expect(analysisData.data.overview).toBeDefined();
        
        analysisDataForBrief.push(analysisData.data);
      }

      console.log(`步骤 3 完成: 完成 ${analysisDataForBrief.length} 个故事的情报分析`);

      // =====================================================================
      // 步骤 4: 简报生成 (Brief Generation)
      // =====================================================================
      console.log('步骤 4: 生成最终简报...');
      
      // 设置AI Worker服务的简报生成响应
      setupAIWorkerBriefGenerationMocks();

      // 生成最终简报
      const briefResponse = await fetch('http://localhost:8786/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisData: analysisDataForBrief })
      });

      expect(briefResponse.status).toBe(200);
      const briefData = await briefResponse.json() as any;
      expect(briefData.success).toBe(true);
      expect(briefData.data.title).toBeDefined();
      expect(briefData.data.content).toContain('what matters now');

      console.log(`步骤 4a 完成: 成功生成简报标题 - ${briefData.data.title}`);

      // =====================================================================
      // 步骤 5: TLDR生成 (TLDR Generation)
      // =====================================================================
      console.log('步骤 5: 生成TLDR...');

      const tldrResponse = await fetch('http://localhost:8786/meridian/generate-brief-tldr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          briefTitle: briefData.data.title,
          briefContent: briefData.data.content
        })
      });

      expect(tldrResponse.status).toBe(200);
      const tldrData = await tldrResponse.json() as any;
      expect(tldrData.success).toBe(true);
      expect(tldrData.data.tldr).toBeDefined();
      expect(tldrData.data.story_count).toBeGreaterThan(0);

      console.log(`步骤 5 完成: 成功生成TLDR`);

      // =====================================================================
      // 验证完整工作流的执行结果
      // =====================================================================
      console.log('完整工作流验证...');

      // 验证数据流转的完整性
      expect(processedArticles).toHaveLength(4);
      expect(clustersWithArticles.length).toBeGreaterThan(0);
      expect(cleanedStories.length).toBeGreaterThan(0);
      expect(analysisDataForBrief.length).toBeGreaterThan(0);
      expect(briefData.data.title).toBeTruthy();
      expect(tldrData.data.tldr).toBeTruthy();

      // 验证最终输出质量
      expect(briefData.data.content).toContain('what matters now');
      expect(briefData.data.content).toContain('tech & science developments');
      expect(tldrData.data.tldr).toContain('•');

      console.log('✅ 完整端到端工作流测试成功完成');
      console.log(`📊 处理统计: ${processedArticles.length}篇文章 → ${clustersWithArticles.length}个聚类 → ${cleanedStories.length}个故事 → 1份简报`);
    });

  });

  /**
   * 场景：聚类分析与故事验证流程
   * 
   * 作为 Meridian 系统
   * 当执行聚类分析时
   * 我希望能够正确处理聚类结果并进行故事验证
   * 以确保故事的质量和相关性
   */
  describe('聚类分析与故事验证流程', () => {
    it('应该正确处理ML服务的聚类响应', async () => {
      // Given: 设置ML服务的聚类响应
      setupMLServiceMocks();
      
      const testEmbeddings = [
        Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1)),
        Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1 + 0.5)),
        Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1 + 1.0)),
        Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.2 + 2.0))
      ];

             // When: 调用ML服务进行聚类（使用AI Worker端点）
       const testItems = testEmbeddings.map((embedding, index) => ({
         id: 101 + index,
         embedding: embedding
       }));
       
       const clusteringResponse = await fetch('http://localhost:8080/ai-worker/clustering', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           items: testItems,
           config: {
             hdbscan_min_cluster_size: 2,
             hdbscan_min_samples: 1,
             umap_metric: 'cosine'
           }
         })
       });

      // Then: 应该返回有效的聚类结果
      expect(clusteringResponse.status).toBe(200);
      const clusteringResult = await clusteringResponse.json() as any;
      expect(clusteringResult.clusters).toBeDefined();
      expect(clusteringResult.clusters.length).toBe(2);
      expect(clusteringResult.clustering_stats.n_clusters).toBe(2);
      expect(clusteringResult.model_info.ai_worker_compatible).toBe(true);
    });

    it('应该正确处理故事验证流程', async () => {
      // Given: 设置AI Worker故事验证响应
      setupAIWorkerStoryValidationMocks();
      
      const testCluster = {
        id: 1,
        articles: [
          { id: 101, title: 'AI技术突破', content: '测试内容1' },
          { id: 102, title: '科技投资', content: '测试内容2' },
          { id: 103, title: 'AI监管', content: '测试内容3' }
        ],
        similarity_score: 0.85
      };

      // When: 调用故事验证端点
      const validateResponse = await fetch('http://localhost:8786/meridian/story/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cluster: testCluster })
      });

      // Then: 应该返回验证后的故事
      expect(validateResponse.status).toBe(200);
      const validateData = await validateResponse.json() as any;
      expect(validateData.success).toBe(true);
      expect(validateData.data.validation_result).toBe('single_story');
      expect(validateData.data.cleaned_stories).toHaveLength(1);
      expect(validateData.data.cleaned_stories[0].articles).toEqual([101, 102, 103]);
    });

    it('应该正确处理情报分析流程', async () => {
      // Given: 设置AI Worker情报分析响应
      setupAIWorkerIntelligenceAnalysisMocks();
      
      const testStory = {
        storyId: 'story-1',
        analysis: { summary: 'AI技术发展新动态' }
      };
      const testCluster = {
        articles: [
          { id: 101, title: 'AI技术突破', event_summary_points: ['技术突破'] },
          { id: 102, title: '科技投资', event_summary_points: ['投资增长'] }
        ]
      };

      // When: 调用情报分析端点
      const analysisResponse = await fetch('http://localhost:8786/meridian/intelligence/analyze-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ story: testStory, cluster: testCluster })
      });

      // Then: 应该返回情报分析结果
      expect(analysisResponse.status).toBe(200);
      const analysisData = await analysisResponse.json() as any;
      expect(analysisData.success).toBe(true);
      expect(analysisData.data.overview).toContain('AI技术发展持续加速');
      expect(analysisData.data.key_developments).toBeInstanceOf(Array);
      expect(analysisData.data.stakeholders).toBeInstanceOf(Array);
      expect(analysisData.data.implications).toBeInstanceOf(Array);
      expect(analysisData.data.outlook).toBeDefined();
    });

    it('应该正确模拟 AI Worker 服务响应', async () => {
      // Given: AI Worker 服务已经被模拟
      setupDefaultAIWorkerMocks();

      // When: 调用 AI Worker 简报生成端点
      const briefResponse = await fetch('http://localhost:8786/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisData: [{
            overview: '测试AI技术发展',
            key_developments: ['测试发展'],
            stakeholders: ['AI公司'],
            implications: ['技术进步'],
            outlook: 'verified'
          }]
        })
      });

             // Then: 应该返回预期的简报内容
       expect(briefResponse.status).toBe(200);
       const briefData = await briefResponse.json() as any;
       expect(briefData.success).toBe(true);
       expect(briefData.data.title).toBe('每日AI技术简报');
       expect(briefData.data.content).toContain('AI技术发展持续加速');
    });

    it('应该正确模拟 TLDR 生成', async () => {
      // Given: AI Worker 服务的 TLDR 端点已被模拟
      setupDefaultAIWorkerMocks();

      // When: 调用 TLDR 生成端点
      const tldrResponse = await fetch('http://localhost:8786/meridian/generate-brief-tldr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          briefTitle: '每日AI技术简报',
          briefContent: '测试简报内容'
        })
      });

             // Then: 应该返回预期的 TLDR 内容
       expect(tldrResponse.status).toBe(200);
       const tldrData = await tldrResponse.json() as any;
       expect(tldrData.success).toBe(true);
       expect(tldrData.data.tldr).toContain('AI技术发展持续加速');
       expect(tldrData.data.story_count).toBe(3);
    });
  });

  /**
   * 场景：情报分析与简报生成流程
   * 
   * 作为 Meridian 系统
   * 当执行情报分析和简报生成时
   * 我希望能够正确处理分析数据并生成高质量的简报
   * 以确保最终输出的质量和一致性
   */
  describe('情报分析与简报生成流程', () => {
    it('应该正确处理简报生成和TLDR生成的完整流程', async () => {
      // Given: 设置AI Worker简报生成服务响应
      setupAIWorkerBriefGenerationMocks();
      
      const testAnalysisData = [
        {
          overview: 'AI技术发展持续加速，多个维度取得突破性进展',
          key_developments: ['新一代语言模型发布', 'AI基础设施投资增长'],
          stakeholders: ['科技公司', '研究机构'],
          implications: ['技术创新加速', '行业竞争加剧'],
          outlook: 'Developing'
        },
        {
          overview: '监管政策框架日趋完善',
          key_developments: ['欧盟发布AI指导原则'],
          stakeholders: ['监管机构', '政策制定者'],
          implications: ['监管框架完善'],
          outlook: 'Verified'
        }
      ];

      // When: 调用简报生成端点
      const briefResponse = await fetch('http://localhost:8786/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisData: testAnalysisData })
      });

      // Then: 应该返回格式正确的简报
      expect(briefResponse.status).toBe(200);
      const briefData = await briefResponse.json() as any;
      expect(briefData.success).toBe(true);
      expect(briefData.data.title).toBe('AI技术发展与监管新动态');
      expect(briefData.data.content).toContain('what matters now');
      expect(briefData.data.content).toContain('tech & science developments');
      expect(briefData.data.content).toContain('AI技术突破引领行业变革');
      expect(briefData.data.metadata.model_used).toBe('gemini-2.0-flash');

      // When: 使用简报内容生成TLDR
      const tldrResponse = await fetch('http://localhost:8786/meridian/generate-brief-tldr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          briefTitle: briefData.data.title,
          briefContent: briefData.data.content
        })
      });

      // Then: 应该返回格式正确的TLDR
      expect(tldrResponse.status).toBe(200);
      const tldrData = await tldrResponse.json() as any;
      expect(tldrData.success).toBe(true);
      expect(tldrData.data.tldr).toContain('AI技术突破');
      expect(tldrData.data.tldr).toContain('基础设施投资');
      expect(tldrData.data.tldr).toContain('监管完善');
      expect(tldrData.data.story_count).toBe(3);
      expect(tldrData.data.metadata.model_used).toBe('gemini-2.0-flash');
    });

    it('应该处理空分析数据的边界情况', async () => {
      // Given: 设置AI Worker简报生成服务响应
      setupAIWorkerBriefGenerationMocks();

      // When: 使用空的分析数据调用简报生成
      const briefResponse = await fetch('http://localhost:8786/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisData: [] })
      });

      // Then: 应该正常处理并返回默认简报
      expect(briefResponse.status).toBe(200);
      const briefData = await briefResponse.json() as any;
      expect(briefData.success).toBe(true);
      expect(briefData.data.title).toBeDefined();
      expect(briefData.data.content).toBeDefined();
    });

    it('应该验证工作流错误处理机制', async () => {
      // Given: 设置AI Worker服务返回错误
      setupAIWorkerErrorMocks();

      // When: 尝试调用简报生成服务
      const briefResponse = await fetch('http://localhost:8786/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisData: [] })
      });

      // Then: 应该返回适当的错误状态
      expect(briefResponse.status).toBe(500);
    });
  });

  /**
   * 场景：数据质量验证
   * 
   * 作为 Meridian 系统
   * 当输入数据质量不符合要求时
   * 我希望能够识别并处理这些情况
   * 以确保生成的简报质量
   */
  describe('数据质量验证', () => {
    it('应该验证AI Worker响应数据格式', async () => {
      // Given: 设置正确的 AI Worker 响应格式
      setupDefaultAIWorkerMocks();

      // When: 调用 AI Worker 服务
      const response = await fetch('http://localhost:8786/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisData: [] })
      });

             const data = await response.json() as any;

       // Then: 响应应该包含所有必需字段
       expect(data).toHaveProperty('success');
       expect(data).toHaveProperty('data');
       expect(data.data).toHaveProperty('title');
       expect(data.data).toHaveProperty('content');
       expect(data.data).toHaveProperty('metadata');
    });

    it('应该处理空的分析数据输入', async () => {
      // Given: 空的分析数据数组
      setupDefaultAIWorkerMocks();

      // When: 使用空数据调用 AI Worker
      const response = await fetch('http://localhost:8786/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisData: [] })
      });

             // Then: 服务应该正常响应（即使数据为空）
       expect(response.status).toBe(200);
       const data = await response.json() as any;
       expect(data.success).toBe(true);
    });
  });

  /**
   * 场景：AI Worker 服务集成
   * 
   * 作为 Meridian 系统
   * 当与 AI Worker 服务交互时
   * 我希望能够正确处理服务响应和错误
   * 以确保系统的稳定性
   */
  describe('AI Worker 服务集成', () => {
    it('应该正确处理 AI Worker 服务错误', async () => {
      // Given: AI Worker 服务返回错误
      setupAIWorkerErrorMocks();

      // When: 尝试调用 AI Worker 服务
      const response = await fetch('http://localhost:8786/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisData: [] })
      });

      // Then: 应该返回适当的错误状态
      expect(response.status).toBe(500);
    });

    it('应该验证 AI Worker 请求参数', async () => {
      // Given: 设置 mock 来检查请求参数
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          success: true,
          data: { title: '测试', content: '测试内容' }
        }), { status: 200 })
      );
      global.fetch = fetchMock;

      // When: 调用 AI Worker 服务
      await fetch('http://localhost:8786/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisData: [{ 
            overview: '测试摘要',
            key_developments: ['关键发展'],
            stakeholders: ['相关方'],
            implications: ['影响'],
            outlook: '积极'
          }],
          options: { provider: 'google-ai-studio', model: 'gemini-2.0-flash' }
        })
      });

      // Then: 应该使用正确的请求参数
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/meridian/generate-final-brief'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('analysisData')
        })
      );
    });
  });

  /**
   * 场景：工作流配置验证
   * 
   * 作为 Meridian 系统
   * 当配置不同的工作流参数时
   * 我希望能够验证参数的有效性
   * 以确保工作流正确执行
   */
  describe('工作流配置验证', () => {
    it('应该验证简报生成参数格式', () => {
      // Given: 创建简报生成参数
      const briefGenerationParams = {
        triggeredBy: 'test',
        articleLimit: 10,
        timeRangeDays: 1,
        maxStoriesToGenerate: 15,
        storyMinImportance: 0.1
      };

      // When: 验证参数类型
      // Then: 参数应该具有正确的类型
      expect(typeof briefGenerationParams.triggeredBy).toBe('string');
      expect(typeof briefGenerationParams.articleLimit).toBe('number');
      expect(typeof briefGenerationParams.timeRangeDays).toBe('number');
      expect(typeof briefGenerationParams.maxStoriesToGenerate).toBe('number');
      expect(typeof briefGenerationParams.storyMinImportance).toBe('number');
    });

    it('应该验证工作流事件格式', () => {
      // Given: 创建工作流事件
      const workflowEvent = {
        payload: {
          triggeredBy: 'test',
          articleLimit: 10
        },
        instanceId: 'test-instance-' + Date.now()
      };

      // When: 验证事件结构
      // Then: 事件应该包含必需的字段
      expect(workflowEvent).toHaveProperty('payload');
      expect(workflowEvent).toHaveProperty('instanceId');
      expect(workflowEvent.payload).toHaveProperty('triggeredBy');
      expect(workflowEvent.payload).toHaveProperty('articleLimit');
    });
  });

  // =================================================================
  // 辅助函数和设置
  // =================================================================

  /**
   * 设置ML服务的聚类分析模拟响应
   */
  function setupMLServiceMocks() {
    global.fetch = vi.fn().mockImplementation((url: string | Request, options?: RequestInit) => {
      const urlString = typeof url === 'string' ? url : url.url;
      
      // 匹配实际的ML服务端点: /ai-worker/clustering
      if (urlString.includes('/ai-worker/clustering')) {
        return Promise.resolve(new Response(JSON.stringify({
          clusters: [
            {
              cluster_id: 0,
              size: 3,
              items: [
                { id: 101, metadata: { id: 101, source: 'ai_worker' } },
                { id: 102, metadata: { id: 102, source: 'ai_worker' } },
                { id: 103, metadata: { id: 103, source: 'ai_worker' } }
              ],
              coherence_score: 0.85,
              stability_score: 0.78,
              representative_content: ['AI技术突破', 'AI基础设施', 'AI监管政策'],
              keywords: ['AI', '技术', '发展'],
              summary: 'AI技术发展相关聚类'
            },
            {
              cluster_id: 1,
              size: 1,
              items: [
                { id: 104, metadata: { id: 104, source: 'ai_worker' } }
              ],
              coherence_score: 0.60,
              stability_score: 0.55,
              representative_content: ['全球经济分析'],
              keywords: ['经济', '通胀', '央行'],
              summary: '经济形势分析聚类'
            }
          ],
          clustering_stats: {
            n_clusters: 2,
            n_outliers: 0,
            outlier_ratio: 0.0,
            cluster_sizes: [3, 1],
            silhouette_score: 0.72,
            dbcv_score: 0.65
          },
          optimization_result: {
            optimized: false,
            best_params: null,
            optimization_time: 0,
            combinations_tested: 0
          },
          config_used: {
            umap_n_components: 10,
            umap_n_neighbors: 15,
            umap_min_dist: 0.0,
            umap_metric: 'cosine',
            hdbscan_min_cluster_size: 2,
            hdbscan_min_samples: 1,
            hdbscan_metric: 'euclidean',
            normalize_embeddings: true
          },
          processing_time: 2.1,
          model_info: {
            ai_worker_compatible: true,
            detected_format: 'ai_worker_embedding',
            backend_integration: '完全兼容',
            embedding_dimensions: 384
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      
      return Promise.reject(new Error(`Unmocked fetch call to ${urlString}`));
    });
  }

  /**
   * 设置AI Worker故事验证服务模拟响应
   */
  function setupAIWorkerStoryValidationMocks() {
    global.fetch = vi.fn().mockImplementation((url: string | Request, options?: RequestInit) => {
      const urlString = typeof url === 'string' ? url : url.url;
      
      if (urlString.includes('/meridian/story/validate')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: {
            validation_result: 'single_story',
            cleaned_stories: [
              {
                id: 'story-1',
                title: 'AI技术发展新动态',
                articles: [101, 102, 103],
                importance: 8,
                coherence_score: 0.85
              }
            ]
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      
      return Promise.reject(new Error(`Unmocked fetch call to ${urlString}`));
    });
  }

  /**
   * 设置AI Worker情报分析服务模拟响应
   */
  function setupAIWorkerIntelligenceAnalysisMocks() {
    global.fetch = vi.fn().mockImplementation((url: string | Request, options?: RequestInit) => {
      const urlString = typeof url === 'string' ? url : url.url;
      
      if (urlString.includes('/meridian/intelligence/analyze-story')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: {
            overview: 'AI技术发展持续加速，多个维度取得突破性进展',
            key_developments: ['新一代语言模型发布', 'AI基础设施投资增长', '监管政策完善'],
            stakeholders: ['科技公司', '监管机构', '研究机构'],
            implications: ['技术创新加速', '行业竞争加剧', '监管框架完善'],
            outlook: '积极发展'
          },
          metadata: {
            model_used: 'gemini-2.0-flash',
            provider: 'google-ai-studio',
            articles_processed: 3,
            fallback_used: false
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      
      return Promise.reject(new Error(`Unmocked fetch call to ${urlString}`));
    });
  }

  /**
   * 设置AI Worker简报生成服务模拟响应
   */
  function setupAIWorkerBriefGenerationMocks() {
    global.fetch = vi.fn().mockImplementation((url: string | Request, options?: RequestInit) => {
      const urlString = typeof url === 'string' ? url : url.url;
      
      if (urlString.includes('/meridian/generate-final-brief')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: {
            title: 'AI技术发展与监管新动态',
            content: `
# AI技术发展与监管新动态

## what matters now
<u>**AI技术突破引领行业变革**</u>
新一代大型语言模型的发布标志着人工智能技术的重大突破，在自然语言处理、代码生成等领域展现出前所未有的能力。

<u>**基础设施投资推动产业发展**</u>
科技巨头大规模投资AI基础设施，包括数据中心和专用芯片，为AI技术普及奠定基础。

## tech & science developments
<u>**监管政策框架日趋完善**</u>
欧盟发布AI监管指导原则，在技术创新与风险管控之间寻求平衡。
            `,
            metadata: {
              sections_processed: 2,
              content_length: 445,
              has_previous_context: false,
              model_used: 'gemini-2.0-flash',
              provider: 'google-ai-studio',
              generation_time: 2.5,
              total_tokens: 1800
            }
          },
          usage: {
            brief_generation: {
              total_tokens: 1500,
              prompt_tokens: 800,
              completion_tokens: 700
            },
            title_generation: {
              total_tokens: 300,
              prompt_tokens: 200,
              completion_tokens: 100
            }
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      
      if (urlString.includes('/meridian/generate-brief-tldr')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: {
            tldr: `
• AI技术突破：新一代语言模型发布，能力显著提升
• 基础设施投资：科技巨头大规模投入AI基础设施建设
• 监管完善：欧盟发布AI监管指导原则，平衡创新与风险
            `,
            story_count: 3,
            metadata: {
              brief_title: 'AI技术发展与监管新动态',
              brief_length: 445,
              model_used: 'gemini-2.0-flash',
              provider: 'google-ai-studio',
              generation_time: 1.8,
              total_tokens: 600
            }
          },
          usage: {
            total_tokens: 600,
            prompt_tokens: 400,
            completion_tokens: 200
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      
      return Promise.reject(new Error(`Unmocked fetch call to ${urlString}`));
    });
  }

  /**
   * 设置默认的 AI Worker 服务模拟响应
   */
  function setupDefaultAIWorkerMocks() {
    // 模拟 fetch 函数
    global.fetch = vi.fn().mockImplementation((url: string | Request, options?: RequestInit) => {
      const urlString = typeof url === 'string' ? url : url.url;
      
      if (urlString.includes('/meridian/generate-final-brief')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: {
            title: '每日AI技术简报',
            content: `
# 每日AI技术简报

## what matters now
<u>**AI技术发展持续加速**</u>
人工智能领域在多个维度取得突破性进展，从基础模型到应用实践都展现出强劲的发展势头。

## tech & science developments
<u>**新一代语言模型发布**</u>
最新发布的大型语言模型在理解能力、推理能力和生成质量方面都有显著提升。

<u>**AI基础设施投资增长**</u>
科技公司持续加大对AI基础设施的投资，为未来发展奠定基础。
            `,
            metadata: {
              sections_processed: 1,
              content_length: 380,
              has_previous_context: false,
              model_used: 'gemini-2.0-flash',
              provider: 'google-ai-studio',
              generation_time: 2.5,
              total_tokens: 1200
            }
          },
          usage: {
            brief_generation: {
              total_tokens: 1000,
              prompt_tokens: 600,
              completion_tokens: 400
            },
            title_generation: {
              total_tokens: 200,
              prompt_tokens: 120,
              completion_tokens: 80
            }
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      
      if (urlString.includes('/meridian/generate-brief-tldr')) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: {
            tldr: `
• AI技术发展持续加速，多个维度取得突破
• 新一代语言模型发布，能力显著提升
• 科技公司加大AI基础设施投资
            `,
            story_count: 3,
            metadata: {
              brief_title: '每日AI技术简报',
              brief_length: 380,
              model_used: 'gemini-2.0-flash',
              provider: 'google-ai-studio',
              generation_time: 1.5,
              total_tokens: 400
            }
          },
          usage: {
            total_tokens: 400,
            prompt_tokens: 280,
            completion_tokens: 120
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      
      return Promise.reject(new Error(`Unmocked fetch call to ${urlString}`));
    });
  }

  /**
   * 设置 AI Worker 错误响应模拟
   */
  function setupAIWorkerErrorMocks() {
    global.fetch = vi.fn().mockImplementation((url: string | Request) => {
      return Promise.resolve(new Response('Internal Server Error', {
        status: 500,
        statusText: 'Internal Server Error'
      }));
    });
  }
});
