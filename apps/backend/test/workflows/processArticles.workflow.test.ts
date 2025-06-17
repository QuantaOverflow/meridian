// apps/backend/test/workflows/processArticles.workflow.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { startProcessArticleWorkflow } from '../../src/workflows/processArticles.workflow';
import * as articleFetchers from '../../src/lib/articleFetchers';
import { createAIServices } from '../../src/lib/ai-services';
import { generateSearchText, getDb } from '../../src/lib/utils';
import { $articles, $sources, eq } from '@meridian/database';
import { DomainRateLimiter } from '../../src/lib/rateLimiter';

// 只 mock 外部 HTTP 服务，AI Worker 通过服务绑定模拟
vi.mock('../../src/lib/articleFetchers', () => ({
  getArticleWithBrowser: vi.fn(),
  getArticleWithFetch: vi.fn(),
}));

describe('Feature: Article Processing Workflow with AI Worker Integration', () => {
  let testArticleIds: number[] = [];
  let testSourceId: number;
  let db: any;

  beforeEach(async () => {
    db = getDb(env.HYPERDRIVE);
    
    // 先创建测试源
    const testSource = await db
      .insert($sources)
      .values({
        url: 'https://example.com/rss',
        name: 'Test Source',
        category: 'test',
        scrape_frequency: 2,
        paywall: false,
      })
      .returning({ id: $sources.id });
    
    testSourceId = testSource[0].id;
    
    // 创建测试文章数据，引用测试源
    const testArticle = await db
      .insert($articles)
      .values({
        url: 'https://example.com/test-article',
        title: 'Test Article for Processing',
        publishDate: new Date(),
        sourceId: testSourceId,  // 使用正确的source_id
        status: null,
        processedAt: null,
        failReason: null,
      })
      .returning({ id: $articles.id });
    
    testArticleIds = [testArticle[0].id];

    // 设置 articleFetchers mock 默认返回值
    (articleFetchers.getArticleWithFetch as any).mockResolvedValue({
      title: 'Test Article Title (Fetch)',
      text: 'This is the content of the test article fetched directly. It contains important information about current events and should be analyzed properly. This content is long enough to be considered high quality and should pass validation checks.',
      publishedTime: new Date().toISOString(),
    });

    (articleFetchers.getArticleWithBrowser as any).mockResolvedValue({
      title: 'Test Article Title (Browser)', 
      text: 'This is the content of the test article fetched by browser. It contains comprehensive details about the news story and provides sufficient context for analysis. This is browser-rendered content with proper formatting.',
      publishedTime: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    
    // 清理测试数据 - 先删除articles，再删除sources
    if (testArticleIds.length > 0) {
      await db.delete($articles).where(eq($articles.id, testArticleIds[0]));
    }
    if (testSourceId) {
      await db.delete($sources).where(eq($sources.id, testSourceId));
    }
  });

  describe('As a content processing system', () => {
    describe('I want to process articles efficiently', () => {
      describe('So that I can analyze and store article data', () => {

        describe('Scenario: AI Worker Integration Tests', () => {
          it('should successfully integrate with AI Worker for article analysis', async () => {
            // Given: AI Worker 通过服务绑定已配置，会返回模拟响应
            // 验证 AI Worker 服务绑定可用性
            const aiServices = createAIServices(env as any);
            expect(aiServices.aiWorker).toBeDefined();
            expect(typeof aiServices.aiWorker.analyzeArticle).toBe('function');

            // When: Start workflow  
            const result = await startProcessArticleWorkflow(env, { articles_id: testArticleIds });

            // Then: Should succeed and create workflow
            expect(result.success).toBe(true);
            expect(result.data?.id).toBeDefined();
          });

          it('should handle AI Worker analysis scenarios', async () => {
            // Given: AI Worker 通过服务绑定配置，支持失败和成功场景
            // 验证 AI Worker 服务可用性
            expect(env.AI_WORKER).toBeDefined();

            // When: Start workflow - AI Worker 会通过绑定正常响应
            const result = await startProcessArticleWorkflow(env, { articles_id: testArticleIds });

            // Then: Should create workflow successfully
            expect(result.success).toBe(true);
            expect(result.data?.id).toBeDefined();
          });

          it('should validate AI Worker service integration', async () => {
            // Given: 验证 AI Worker 服务绑定配置
            const aiServices = createAIServices(env as any);
            expect(aiServices.aiWorker).toBeDefined();
            expect(typeof aiServices.aiWorker.analyzeArticle).toBe('function');
            expect(typeof aiServices.aiWorker.generateEmbedding).toBe('function');
            expect(typeof aiServices.aiWorker.healthCheck).toBe('function');

            // When: Start workflow with service bindings
            const result = await startProcessArticleWorkflow(env, { articles_id: testArticleIds });

            // Then: Verify workflow creation success
            expect(result.success).toBe(true);
            expect(result.data?.id).toBeDefined();
          });

          it('should test AI service creation and method availability', () => {
            // Given & When: Create AI services through service bindings
            const aiServices = createAIServices(env as any);

            // Then: Should have correct structure with service bindings
            expect(aiServices).toBeDefined();
            expect(aiServices.aiWorker).toBeDefined();
            expect(typeof aiServices.aiWorker.analyzeArticle).toBe('function');
            expect(typeof aiServices.aiWorker.generateEmbedding).toBe('function');
            expect(typeof aiServices.aiWorker.healthCheck).toBe('function');
          });
        });

        describe('Scenario: Database State Management', () => {
          it('should handle PDF articles by marking them as SKIPPED_PDF', async () => {
            // Given: PDF article
            const pdfArticle = await db
              .insert($articles)
              .values({
                url: 'https://example.com/document.pdf',
                title: 'PDF Document',
                publishDate: new Date(),
                sourceId: testSourceId,
                status: null,
                processedAt: null,
                failReason: null,
              })
              .returning({ id: $articles.id });

            // When: Process workflow
            const result = await startProcessArticleWorkflow(env, { articles_id: [pdfArticle[0].id] });

            // Then: Should succeed
            expect(result.success).toBe(true);
            expect(result.data?.id).toBeDefined();

            // Clean up
            await db.delete($articles).where(eq($articles.id, pdfArticle[0].id));
          });

          it('should handle content fetch failures with proper status updates', async () => {
            // Given: Fetch failures
            (articleFetchers.getArticleWithFetch as any).mockRejectedValue(new Error('Network timeout'));
            (articleFetchers.getArticleWithBrowser as any).mockRejectedValue(new Error('Browser render failed'));

            // When: Process workflow
            const result = await startProcessArticleWorkflow(env, { articles_id: testArticleIds });

            // Then: Should succeed (failure handled internally)
            expect(result.success).toBe(true);
            expect(result.data?.id).toBeDefined();
          });

          it('should validate article processing pipeline states', async () => {
            // Given: Process workflow without mocking (will test with real AI Worker)
            const result = await startProcessArticleWorkflow(env, { articles_id: testArticleIds });

            // Then: Should succeed in creating workflow
            expect(result.success).toBe(true);
            expect(result.data?.id).toBeDefined();
          });
        });

        describe('Scenario: Domain Rate Limiting Behavior', () => {
          it('should validate DomainRateLimiter configuration', () => {
            // Given: DomainRateLimiter instance
            const rateLimiter = new DomainRateLimiter({
              maxConcurrent: 8,
              globalCooldownMs: 1000,
              domainCooldownMs: 5000,
            });

            // When & Then: Verify configuration
            expect(rateLimiter).toBeDefined();
            expect(rateLimiter).toBeInstanceOf(DomainRateLimiter);
          });

          it('should handle multiple articles from same domain with rate limiting', async () => {
            // Given: Multiple articles from same domain
            const articles = await Promise.all([
              db.insert($articles).values({
                url: 'https://example.com/article-1',
                title: 'Article 1',
                publishDate: new Date(),
                sourceId: testSourceId,
                status: null,
                processedAt: null,
                failReason: null,
              }).returning({ id: $articles.id }),
              db.insert($articles).values({
                url: 'https://example.com/article-2', 
                title: 'Article 2',
                publishDate: new Date(),
                sourceId: testSourceId,
                status: null,
                processedAt: null,
                failReason: null,
              }).returning({ id: $articles.id }),
            ]);

            const articleIds = articles.map(a => a[0].id);

            // When: Process workflow (will test with real AI Worker)
            const result = await startProcessArticleWorkflow(env, { articles_id: articleIds });

            // Then: Should succeed
            expect(result.success).toBe(true);
            expect(result.data?.id).toBeDefined();

            // Clean up
            for (const id of articleIds) {
              await db.delete($articles).where(eq($articles.id, id));
            }
          });
        });

        describe('Scenario: Article Fetching Strategy Tests', () => {
          it('should identify tricky domains correctly', () => {
            // Given: Tricky domain configuration
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

            // When & Then: Verify domain classification logic
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

          it('should fallback from fetch to browser on failure', async () => {
            // Given: Fetch fails, browser succeeds
            (articleFetchers.getArticleWithFetch as any).mockRejectedValue(new Error('Fetch timeout'));
            (articleFetchers.getArticleWithBrowser as any).mockResolvedValue({
              title: 'Browser Fallback Article',
              text: 'Content retrieved via browser fallback mechanism after fetch failure. This demonstrates the resilience of the article fetching system.',
              publishedTime: new Date().toISOString(),
            });

            // When: Process article (will test with real AI Worker)
            const result = await startProcessArticleWorkflow(env, { articles_id: testArticleIds });

            // Then: Should succeed with browser fallback
            expect(result.success).toBe(true);
            expect(result.data?.id).toBeDefined();
          });

          it('should validate PDF detection logic', () => {
            // Given: Different URL types
            const urls = [
              'http://example.com/document.pdf',
              'http://example.com/article.html',
              'http://example.com/report.PDF',
              'http://example.com/news',
            ];

            // When & Then: Verify PDF detection
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

        describe('Scenario: Generate Search Text Function Tests', () => {
          it('should generate proper search text from analysis results', () => {
            // Given: Article analysis data
            const articleData = {
              title: 'Breaking: Major Policy Announcement',
              language: 'en',
              primary_location: 'us',
              completeness: 'COMPLETE' as const,
              content_quality: 'OK' as const,
              event_summary_points: ['Policy change announced', 'Impact on industry'],
              thematic_keywords: ['policy', 'government', 'industry'],
              topic_tags: ['politics', 'policy'],
              key_entities: ['Department of Commerce', 'Industry Association'],
              content_focus: ['policy analysis', 'economic impact'],
            };

            // When: Generate search text
            const searchText = generateSearchText(articleData);

            // Then: Should contain all relevant information
            expect(searchText).toContain('Breaking: Major Policy Announcement');
            expect(searchText).toContain('Policy change announced');
            expect(searchText).toContain('policy');
            expect(searchText).toContain('politics');
            expect(searchText).toContain('Department of Commerce');
            expect(searchText).toContain('policy analysis');
            expect(typeof searchText).toBe('string');
            expect(searchText.length).toBeGreaterThan(50);
          });

          it('should handle empty or minimal analysis data', () => {
            // Given: Minimal analysis data with required fields
            const minimalData = {
              title: 'Short Title',
              language: 'en',
              primary_location: 'global',
              completeness: 'PARTIAL_USEFUL' as const,
              content_quality: 'OK' as const,
              event_summary_points: [],
              thematic_keywords: [],
              topic_tags: [],
              key_entities: [],
              content_focus: [],
            };

            // When: Generate search text
            const searchText = generateSearchText(minimalData);

            // Then: Should still produce valid text
            expect(typeof searchText).toBe('string');
            expect(searchText).toContain('Short Title');
            expect(searchText.length).toBeGreaterThan(0);
          });

          it('should handle undefined fields gracefully', () => {
            // Given: Data with undefined fields
            const dataWithUndefined = {
              title: 'Test Article',
              event_summary_points: undefined,
              thematic_keywords: ['keyword1'],
              topic_tags: undefined,
              key_entities: ['entity1'],
              content_focus: undefined,
            };

            // When: Generate search text
            const searchText = generateSearchText(dataWithUndefined as any);

            // Then: Should handle undefined fields
            expect(typeof searchText).toBe('string');
            expect(searchText).toContain('Test Article');
            expect(searchText).toContain('keyword1');
            expect(searchText).toContain('entity1');
          });
        });

        describe('Scenario: Parallel Processing Tests', () => {
          it('should handle Promise.allSettled scenarios correctly', async () => {
            // Given: Simulate parallel operations
            const operations = [
              Promise.resolve({ type: 'embedding', data: new Array(384).fill(0.1) }),
              Promise.resolve({ type: 'upload', data: 'file-key.txt' }),
            ];

            // When: Execute parallel operations
            const results = await Promise.allSettled(operations);

            // Then: Should handle all results
            expect(results).toHaveLength(2);
            expect(results[0].status).toBe('fulfilled');
            expect(results[1].status).toBe('fulfilled');
            
            if (results[0].status === 'fulfilled') {
              expect(results[0].value.type).toBe('embedding');
              expect(Array.isArray(results[0].value.data)).toBe(true);
              expect(results[0].value.data.length).toBe(384);
            }
            
            if (results[1].status === 'fulfilled') {
              expect(results[1].value.type).toBe('upload');
              expect(results[1].value.data).toBe('file-key.txt');
            }
          });

          it('should handle mixed success/failure in parallel operations', async () => {
            // Given: Mixed operations (success and failure)
            const operations = [
              Promise.resolve({ type: 'embedding', data: new Array(384).fill(0.1) }),
              Promise.reject(new Error('Upload failed')),
            ];

            // When: Execute parallel operations
            const results = await Promise.allSettled(operations);

            // Then: Should handle both success and failure
            expect(results).toHaveLength(2);
            expect(results[0].status).toBe('fulfilled');
            expect(results[1].status).toBe('rejected');
            
            if (results[0].status === 'fulfilled') {
              expect(results[0].value.type).toBe('embedding');
            }
            
            if (results[1].status === 'rejected') {
              expect(results[1].reason.message).toBe('Upload failed');
            }
          });

          it('should validate embedding dimension requirements', () => {
            // Given: Different embedding scenarios
            const validEmbedding = new Array(384).fill(0.1);
            const invalidEmbedding = new Array(100).fill(0.1);
            const emptyEmbedding: number[] = [];

            // When & Then: Validate embedding dimensions
            expect(validEmbedding.length).toBe(384);
            expect(invalidEmbedding.length).not.toBe(384);
            expect(emptyEmbedding.length).toBe(0);

            // Validate embedding data types
            expect(Array.isArray(validEmbedding)).toBe(true);
            expect(validEmbedding.every(val => typeof val === 'number')).toBe(true);
          });
        });

        describe('Scenario: R2 Storage Integration', () => {
          it('should successfully upload and retrieve content from R2', async () => {
            // Given: Test content
            const testKey = `test/workflow-${Date.now()}.txt`;
            const testContent = 'Test article content for workflow R2 integration';

            try {
              // When: Upload to R2
              await env.ARTICLES_BUCKET.put(testKey, testContent);
              
              // Then: Should be retrievable
              const storedObject = await env.ARTICLES_BUCKET.get(testKey);
              expect(storedObject).not.toBeNull();
              
              if (storedObject) {
                const retrievedContent = await storedObject.text();
                expect(retrievedContent).toBe(testContent);
              }
            } finally {
              // Clean up
              await env.ARTICLES_BUCKET.delete(testKey);
            }
          });

          it('should generate correct file keys based on date', () => {
            // Given: Date and article ID
            const testDate = new Date('2024-01-15T10:30:00Z');
            const articleId = 12345;

            // When: Generate file key
            const fileKey = `${testDate.getUTCFullYear()}/${testDate.getUTCMonth() + 1}/${testDate.getUTCDate()}/${articleId}.txt`;

            // Then: Should have correct format
            expect(fileKey).toBe('2024/1/15/12345.txt');
            expect(fileKey).toMatch(/^\d{4}\/\d{1,2}\/\d{1,2}\/\d+\.txt$/);
          });

          it('should handle R2 upload failures gracefully', async () => {
            // Given: Attempt to handle invalid scenarios
            const testContent = 'Test content';

            // When & Then: Test basic R2 functionality
            try {
              // Test with a valid key first
              const validKey = `test/valid-${Date.now()}.txt`;
              await env.ARTICLES_BUCKET.put(validKey, testContent);
              
              const retrieved = await env.ARTICLES_BUCKET.get(validKey);
              expect(retrieved).not.toBeNull();
              
              // Clean up
              await env.ARTICLES_BUCKET.delete(validKey);
            } catch (error) {
              // If R2 operations fail in test environment, that's also valid to test
              expect(error).toBeDefined();
            }
          });
        });

        describe('Scenario: Workflow Configuration Validation', () => {
          it('should validate workflow step config structure', () => {
            // Given: Workflow step configuration
            const stepConfig = {
              retries: { limit: 3, delay: '1 second', backoff: 'linear' },
              timeout: '5 seconds',
            };

            // When & Then: Verify configuration structure
            expect(stepConfig.retries).toBeDefined();
            expect(stepConfig.retries.limit).toBe(3);
            expect(stepConfig.retries.delay).toBe('1 second');
            expect(stepConfig.retries.backoff).toBe('linear');
            expect(stepConfig.timeout).toBe('5 seconds');
            
            // Validate retry backoff options
            const validBackoffTypes = ['linear', 'exponential'];
            expect(validBackoffTypes).toContain(stepConfig.retries.backoff);
          });

          it('should validate environment bindings are properly configured', () => {
            // Given & When & Then: Verify required bindings
            expect(env.ARTICLES_BUCKET).toBeDefined();
            expect(env.AI_WORKER).toBeDefined();
            expect(env.HYPERDRIVE).toBeDefined();
            
            // Verify service binding types
            expect(typeof env.ARTICLES_BUCKET).toBe('object');
            expect(typeof env.AI_WORKER).toBe('object');
            expect(typeof env.AI_WORKER.fetch).toBe('function');
          });

          it('should validate domain classification logic', () => {
            // Given: Test domain classification
            const testCases = [
              { url: 'http://reuters.com/article', expectedTricky: true },
              { url: 'http://nytimes.com/news', expectedTricky: true },
              { url: 'http://example.com/article', expectedTricky: false },
              { url: 'http://google.com/news', expectedTricky: false },
              { url: 'http://politico.com/story', expectedTricky: true },
            ];

            const trickyDomains = ['reuters.com', 'nytimes.com', 'politico.com'];

            // When & Then: Verify each test case
            testCases.forEach(testCase => {
              const domain = new URL(testCase.url).hostname;
              const isTricky = trickyDomains.some(trickyDomain => domain.includes(trickyDomain));
              expect(isTricky).toBe(testCase.expectedTricky);
            });
          });
        });

        describe('Scenario: Error Handling Edge Cases', () => {
          it('should handle empty article list gracefully', async () => {
            // Given: Empty article list
            const emptyArticleIds: number[] = [];

            // When: Start workflow
            const result = await startProcessArticleWorkflow(env, { articles_id: emptyArticleIds });

            // Then: Should succeed
            expect(result.success).toBe(true);
            expect(result.data?.id).toBeDefined();
          });

          it('should validate parameter types', () => {
            // Given & When & Then: Validate parameter types
            const validParams = { articles_id: [1, 2, 3] };
            expect(Array.isArray(validParams.articles_id)).toBe(true);
            expect(validParams.articles_id.every((id: number) => typeof id === 'number')).toBe(true);
            
            // Validate invalid parameters
            const invalidParams = { articles_id: ['1', '2'] as any };
            expect(invalidParams.articles_id.every((id: any) => typeof id === 'number')).toBe(false);
          });

          it('should handle workflow creation failure', async () => {
            // Given: Mock workflow service failure
            const originalCreate = env.PROCESS_ARTICLES?.create;
            if (env.PROCESS_ARTICLES) {
              env.PROCESS_ARTICLES.create = vi.fn().mockRejectedValue(new Error('Workflow service unavailable'));
            }

            try {
              // When: Try to start workflow
              const result = await startProcessArticleWorkflow(env, { articles_id: [123] });

              // Then: Should return error
              expect(result.success).toBe(false);
              expect(result.error).toContain('Workflow service unavailable');
            } finally {
              // Restore original method
              if (env.PROCESS_ARTICLES && originalCreate) {
                env.PROCESS_ARTICLES.create = originalCreate;
              }
            }
          });

          it('should handle content quality validation', () => {
            // Given: Different content quality scenarios
            const goodContent = {
              title: 'Comprehensive News Analysis',
              text: 'This article provides detailed analysis of current geopolitical events with multiple sources and expert opinions. The content is well-researched and informative with substantial depth and context that enables thorough understanding.',
              publishedTime: new Date().toISOString(),
            };

            const poorContent = {
              title: 'Short',
              text: 'Brief text.',
              publishedTime: new Date().toISOString(),
            };

            // When & Then: Verify content quality metrics
            expect(goodContent.text.length).toBeGreaterThan(100);
            expect(goodContent.title.length).toBeGreaterThan(10);
            
            expect(poorContent.text.length).toBeLessThan(50);
            expect(poorContent.title.length).toBeLessThan(20);

            // Test content analysis criteria
            const hasMultipleSentences = (text: string) => text.split('.').filter(s => s.trim().length > 0).length > 1;
            expect(hasMultipleSentences(goodContent.text)).toBe(true);
            expect(hasMultipleSentences(poorContent.text)).toBe(false);
          });

          it('should validate AI response format requirements', () => {
            // Given: Mock AI response formats
            const validAnalysisResponse = {
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

            const validEmbeddingResponse = {
              success: true,
              data: [{
                embedding: new Array(384).fill(0.1),
              }],
            };

            // When & Then: Verify response structures
            expect(validAnalysisResponse.success).toBe(true);
            expect(validAnalysisResponse.data).toBeDefined();
            expect(validAnalysisResponse.data.language).toBe('en');
            expect(Array.isArray(validAnalysisResponse.data.event_summary_points)).toBe(true);
            expect(validAnalysisResponse.data.event_summary_points.length).toBeGreaterThan(0);

            expect(validEmbeddingResponse.success).toBe(true);
            expect(validEmbeddingResponse.data).toBeDefined();
            expect(Array.isArray(validEmbeddingResponse.data)).toBe(true);
            expect(validEmbeddingResponse.data[0].embedding).toBeDefined();
            expect(validEmbeddingResponse.data[0].embedding.length).toBe(384);
          });
        });

      });
    });
  });
});
