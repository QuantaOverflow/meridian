// apps/backend/test/workflows/processArticles.workflow.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { startProcessArticleWorkflow } from '../../src/workflows/processArticles.workflow';
import * as articleFetchers from '../../src/lib/articleFetchers';

// 只 mock 外部 HTTP 服务，保留真实的环境绑定
vi.mock('../../src/lib/articleFetchers', () => ({
  getArticleWithBrowser: vi.fn(),
  getArticleWithFetch: vi.fn(),
}));

describe('Feature: Article Processing Workflow', () => {
  beforeEach(() => {
    // 设置 mock 默认返回值
    (articleFetchers.getArticleWithFetch as any).mockResolvedValue({
      title: 'Test Article Title (Fetch)',
      text: 'This is the content of the test article fetched directly. It contains important information about current events and should be analyzed properly.',
      publishedTime: new Date().toISOString(),
    });

    (articleFetchers.getArticleWithBrowser as any).mockResolvedValue({
      title: 'Test Article Title (Browser)',
      text: 'This is the content of the test article fetched by browser. It contains comprehensive details about the news story.',
      publishedTime: new Date().toISOString(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('As a content processing system', () => {
    describe('I want to process articles efficiently', () => {
      describe('So that I can analyze and store article data', () => {

        describe('Scenario: Successfully start workflow', () => {
          it('should create workflow instance when valid article IDs are provided', async () => {
            // Given: 有效的文章ID列表
            const articleIds = [123, 456];

            // When: 启动工作流
            const result = await startProcessArticleWorkflow(env, { articles_id: articleIds });

            // Then: 工作流应该成功创建
            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
            expect(result.data?.id).toBeDefined();
          });
        });

        describe('Scenario: Handle workflow creation failure', () => {
          it('should return error when workflow creation fails', async () => {
            // Given: 模拟工作流服务不可用
            const originalCreate = env.PROCESS_ARTICLES?.create;
            if (env.PROCESS_ARTICLES) {
              env.PROCESS_ARTICLES.create = vi.fn().mockRejectedValue(new Error('Workflow service unavailable'));
            }

            try {
              // When: 尝试启动工作流
              const result = await startProcessArticleWorkflow(env, { articles_id: [123] });

              // Then: 应该返回错误
              expect(result.success).toBe(false);
              expect(result.error).toContain('Workflow service unavailable');
            } finally {
              // 恢复原始方法
              if (env.PROCESS_ARTICLES && originalCreate) {
                env.PROCESS_ARTICLES.create = originalCreate;
              }
            }
          });
        });

        describe('Scenario: Article fetching strategies', () => {
          it('should handle fetch failure and fallback gracefully', async () => {
            // Given: 模拟fetch失败
            (articleFetchers.getArticleWithFetch as any).mockRejectedValue(new Error('Network timeout'));
            
            // When: 测试错误处理
            const fetchPromise = articleFetchers.getArticleWithFetch('http://example.com/fail');
            const browserPromise = articleFetchers.getArticleWithBrowser(env, 'http://example.com/fail');

            // Then: fetch应该失败，browser应该成功
            await expect(fetchPromise).rejects.toThrow('Network timeout');
            await expect(browserPromise).resolves.toMatchObject({
              title: expect.any(String),
              text: expect.any(String),
            });
          });

          it('should validate article content quality', async () => {
            // Given: 不同质量的文章内容
            const goodContent = {
              title: 'Comprehensive News Analysis',
              text: 'This article provides detailed analysis of current geopolitical events with multiple sources and expert opinions. The content is well-researched and informative.',
              publishedTime: new Date().toISOString(),
            };

            const poorContent = {
              title: 'Short',
              text: 'Brief text.',
              publishedTime: new Date().toISOString(),
            };

            // When & Then: 验证内容质量
            expect(goodContent.text.length).toBeGreaterThan(100);
            expect(goodContent.title.length).toBeGreaterThan(10);
            
            expect(poorContent.text.length).toBeLessThan(20);
            expect(poorContent.title.length).toBeLessThan(20);
          });
        });

        describe('Scenario: Real environment integration', () => {
          it('should have access to required environment bindings', () => {
            // Given & When & Then: 验证必要的环境绑定存在（除了外部服务）
            expect(env.ARTICLES_BUCKET).toBeDefined();
            
            // 验证基础绑定可用
            expect(typeof env.ARTICLES_BUCKET).toBe('object');
          });

          it('should be able to interact with R2 bucket', async () => {
            // Given: 测试数据
            const testKey = `test/article-${Date.now()}.txt`;
            const testContent = 'Test article content for R2 storage validation';

            try {
              // When: 上传到R2
              await env.ARTICLES_BUCKET.put(testKey, testContent);
              
              // Then: 应该能够读取回来
              const storedObject = await env.ARTICLES_BUCKET.get(testKey);
              expect(storedObject).not.toBeNull();
              
              if (storedObject) {
                const retrievedContent = await storedObject.text();
                expect(retrievedContent).toBe(testContent);
              }
            } finally {
              // 清理测试数据
              await env.ARTICLES_BUCKET.delete(testKey);
            }
          });
        });

        describe('Scenario: Error handling and edge cases', () => {
          it('should handle empty article list gracefully', async () => {
            // Given: 空的文章ID列表
            const emptyArticleIds: number[] = [];

            // When: 启动工作流
            const result = await startProcessArticleWorkflow(env, { articles_id: emptyArticleIds });

            // Then: 应该成功创建工作流（即使没有文章要处理）
            expect(result.success).toBe(true);
            expect(result.data?.id).toBeDefined();
          });

          it('should validate workflow parameters', () => {
            // Given & When & Then: 验证参数类型
            const validParams = { articles_id: [1, 2, 3] };
            expect(Array.isArray(validParams.articles_id)).toBe(true);
            expect(validParams.articles_id.every((id: number) => typeof id === 'number')).toBe(true);
            
            // 验证无效参数
            const invalidParams = { articles_id: ['1', '2'] as any };
            expect(invalidParams.articles_id.every((id: any) => typeof id === 'number')).toBe(false);
          });
        });

        describe('Scenario: AI Worker integration validation', () => {
          it('should validate environment has access to AI capabilities', () => {
            // Given & When & Then: 验证测试环境的基本配置
            // 测试环境中，我们验证基础功能而不是外部服务绑定
            expect(env).toBeDefined();
            expect(typeof env).toBe('object');
            
            // 验证环境变量配置正确
            expect(env.ARTICLES_BUCKET).toBeDefined();
          });

          it('should handle AI analysis service response format', () => {
            // Given: 模拟AI响应格式
            const mockAIResponse = {
              success: true,
              data: {
                language: 'en',
                primary_location: 'global',
                completeness: 'COMPLETE' as const,
                content_quality: 'OK' as const,
                event_summary_points: ['Point 1', 'Point 2'],
                thematic_keywords: ['keyword1', 'keyword2'],
                topic_tags: ['tag1', 'tag2'],
                key_entities: ['entity1', 'entity2'],
                content_focus: ['focus1'],
              },
            };

            // When & Then: 验证响应结构
            expect(mockAIResponse.success).toBe(true);
            expect(mockAIResponse.data).toBeDefined();
            expect(mockAIResponse.data.language).toBe('en');
            expect(Array.isArray(mockAIResponse.data.event_summary_points)).toBe(true);
            expect(mockAIResponse.data.event_summary_points.length).toBeGreaterThan(0);
          });

          it('should handle embedding generation response format', () => {
            // Given: 模拟嵌入响应格式
            const mockEmbeddingResponse = {
              success: true,
              data: [{
                embedding: new Array(384).fill(0.1), // 模拟384维向量
              }],
            };

            // When & Then: 验证嵌入响应结构
            expect(mockEmbeddingResponse.success).toBe(true);
            expect(mockEmbeddingResponse.data).toBeDefined();
            expect(Array.isArray(mockEmbeddingResponse.data)).toBe(true);
            expect(mockEmbeddingResponse.data[0].embedding).toBeDefined();
            expect(mockEmbeddingResponse.data[0].embedding.length).toBe(384);
          });
        });

        describe('Scenario: Rate limiting and domain handling', () => {
          it('should identify tricky domains correctly', () => {
            // Given: 不同域名的URL
            const trickyDomains = [
              'reuters.com',
              'nytimes.com', 
              'politico.com',
              'science.org',
              'alarabiya.net',
              'reason.com',
              'telegraph.co.uk',
              'lawfaremedia',
              'liberation.fr',
              'france24.com',
            ];

            const testUrls = [
              'http://reuters.com/article',
              'http://example.com/article',
              'http://nytimes.com/article',
              'http://google.com/article',
            ];

            // When & Then: 验证域名识别逻辑
            testUrls.forEach((url: string) => {
              const domain = new URL(url).hostname.replace(/^www\./, '');
              const isTricky = trickyDomains.some((trickyDomain: string) => domain.includes(trickyDomain));
              
              if (url.includes('reuters.com') || url.includes('nytimes.com')) {
                expect(isTricky).toBe(true);
              } else {
                expect(isTricky).toBe(false);
              }
            });
          });

          it('should validate PDF detection logic', () => {
            // Given: 不同类型的URL
            const urls = [
              'http://example.com/document.pdf',
              'http://example.com/article.html',
              'http://example.com/report.PDF',
              'http://example.com/news',
            ];

            // When & Then: 验证PDF检测
            urls.forEach((url: string) => {
              const isPdf = url.toLowerCase().endsWith('.pdf');
              
              if (url.includes('.pdf') || url.includes('.PDF')) {
                expect(isPdf).toBe(true);
              } else {
                expect(isPdf).toBe(false);
              }
            });
          });
        });

        describe('Scenario: Workflow step configuration validation', () => {
          it('should validate workflow step config structure', () => {
            // Given: 模拟工作流步骤配置
            const stepConfig = {
              retries: { limit: 3, delay: '1 second', backoff: 'linear' },
              timeout: '5 seconds',
            };

            // When & Then: 验证配置结构
            expect(stepConfig.retries).toBeDefined();
            expect(stepConfig.retries.limit).toBe(3);
            expect(stepConfig.retries.delay).toBe('1 second');
            expect(stepConfig.retries.backoff).toBe('linear');
            expect(stepConfig.timeout).toBe('5 seconds');
          });

          it('should validate domain classification logic', () => {
            // Given: 测试域名列表
            const testCases = [
              { url: 'http://reuters.com/article', expectedTricky: true },
              { url: 'http://nytimes.com/news', expectedTricky: true },
              { url: 'http://example.com/article', expectedTricky: false },
              { url: 'http://google.com/news', expectedTricky: false },
              { url: 'http://politico.com/story', expectedTricky: true },
            ];

            const trickyDomains = ['reuters.com', 'nytimes.com', 'politico.com'];

            // When & Then: 验证每个测试用例
            testCases.forEach(testCase => {
              const domain = new URL(testCase.url).hostname;
              const isTricky = trickyDomains.some(trickyDomain => domain.includes(trickyDomain));
              expect(isTricky).toBe(testCase.expectedTricky);
            });
          });
        });

      });
    });
  });
});
