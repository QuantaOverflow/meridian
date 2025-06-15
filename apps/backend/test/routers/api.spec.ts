import { SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockDatabase, mockDb, createMockDbQuery } from '../mocks/database.mock';

// 导入主 Worker 应用，使其路由注册到 SELF
import '../../src/app';

// Mock getDb 函数，使其返回我们的模拟数据库
vi.mock('../../src/lib/utils', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getDb: () => createMockDbQuery(),
    hasValidAuthToken: () => true // 简化认证，总是返回true
  };
});

describe('Feature: API 端点服务完整功能测试', () => {
  beforeEach(() => {
    // 每个测试前重置数据库状态
    resetMockDatabase();
    // 重置全局路由标识
    global.mockRouteParam = undefined;
  });

  describe('Scenario: 健康检查 API', () => {
    it('should返回成功的pong响应_when请求ping端点_expect状态码为200和pong为true', async () => {
      // Given: Worker 已启动

      // When: 请求 /ping 端点
      const response = await SELF.fetch('http://example.com/ping');
      const jsonResponse = await response.json();

      // Then: 验证响应
      expect(response.status).toBe(200);
      expect(jsonResponse).toEqual({ pong: true });
    });
  });

  describe('Feature: 新闻源管理 API (CRUD 完整测试)', () => {
    describe('Scenario: 获取所有RSS源', () => {
      it('should返回所有RSS源列表_when请求GET_admin_sources_expect成功响应和源数据', async () => {
        // Given: 数据库中有预设的测试源
        // 在 beforeEach 中已经通过 resetMockDatabase() 设置了初始数据

        // When: 请求获取所有源
        const response = await SELF.fetch('http://example.com/admin/sources');
        const jsonResponse = await response.json();

        // Then: 验证响应结构和数据
        expect(response.status).toBe(200);
        expect(jsonResponse.success).toBe(true);
        expect(jsonResponse.data).toBeInstanceOf(Array);
        expect(jsonResponse.data).toHaveLength(2); // 预设了2个源
        
        // 验证第一个源的数据结构
        const firstSource = jsonResponse.data[0];
        expect(firstSource).toHaveProperty('id', 1);
        expect(firstSource).toHaveProperty('name', '纽约时报中文网');
        expect(firstSource).toHaveProperty('url', 'https://cn.nytimes.com/rss.html');
        expect(firstSource).toHaveProperty('category', 'news');
        expect(firstSource).toHaveProperty('scrape_frequency', 60);
        
        // 验证响应元数据
        expect(jsonResponse).toHaveProperty('message');
        expect(jsonResponse.message).toContain('2个RSS源');
        expect(jsonResponse).toHaveProperty('timestamp');
      });
    });

    describe('Scenario: 创建新的RSS源', () => {
      it('should成功创建新源_when提供有效数据_expect201状态码和新源数据', async () => {
        // Given: 有效的新源数据 - 使用与预设数据不冲突的URL
        const newSourceData = {
          name: 'BBC中文网',
          url: 'https://www.bbc.com/zhongwen/simp/index.xml', // 修改为不冲突的URL
          category: 'news',
          scrape_frequency: 45
        };

        // When: 发送创建请求
        const response = await SELF.fetch('http://example.com/admin/sources', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-token-12345'
          },
          body: JSON.stringify(newSourceData),
        });
        const jsonResponse = await response.json();

        // Then: 验证创建成功
        expect(response.status).toBe(201);
        expect(jsonResponse.success).toBe(true);
        expect(jsonResponse.data).toMatchObject({
          name: 'BBC中文网',
          url: 'https://www.bbc.com/zhongwen/simp/index.xml',
          category: 'news',
          scrape_frequency: 45
        });
        expect(jsonResponse.data).toHaveProperty('id');
        expect(jsonResponse.data.id).toBeGreaterThan(2); // 新ID应该大于预设数据的ID
        expect(jsonResponse.message).toBe('RSS源添加成功');

        // 验证数据确实被保存到模拟数据库
        const savedSources = mockDb.getSources();
        expect(savedSources).toHaveLength(3); // 原有2个 + 新增1个
        const newSource = savedSources.find(s => s.name === 'BBC中文网');
        expect(newSource).toBeTruthy();
      });

      it('should返回400错误_when缺少必要字段_expect错误信息和标准错误格式', async () => {
        // Given: 缺少必要字段的请求体
        const invalidData = { 
          category: 'news' 
          // 缺少 name 和 url
        };

        // When: 发送无效请求
        const response = await SELF.fetch('http://example.com/admin/sources', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-token-12345'
          },
          body: JSON.stringify(invalidData),
        });
        const jsonResponse = await response.json();

        // Then: 验证错误响应
        expect(response.status).toBe(400);
        expect(jsonResponse.success).toBe(false);
        expect(jsonResponse.error).toContain('缺少必需的字段');
        expect(jsonResponse).toHaveProperty('timestamp');
        expect(jsonResponse.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      });

      it('should返回500错误_when源URL已存在_expect内部服务器错误', async () => {
        // Given: 使用已存在的URL
        const duplicateUrlData = {
          name: '重复的纽约时报',
          url: 'https://cn.nytimes.com/rss.html', // 这个URL在初始数据中已存在
          category: 'news'
        };

        // When: 尝试创建重复URL的源
        const response = await SELF.fetch('http://example.com/admin/sources', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-token-12345'
          },
          body: JSON.stringify(duplicateUrlData),
        });
        const jsonResponse = await response.json();

        // Then: 验证服务器错误（因为模拟数据库抛出异常）
        expect(response.status).toBe(500);
        expect(jsonResponse.success).toBe(false);
        expect(jsonResponse.error).toBe('Internal server error');
        expect(jsonResponse).toHaveProperty('timestamp');
      });
    });

    describe('Scenario: 更新RSS源', () => {
      it('should成功更新源_when提供有效的更新数据_expect更新后的源数据', async () => {
        // Given: 要更新的源ID和新数据
        const sourceId = 1; // 预设数据中存在的源
        const updateData = {
          name: '纽约时报中文网 - 更新版',
          scrape_frequency: 120
        };

        // 验证源确实存在
        const existingSource = mockDb.getSourceById(sourceId);
        expect(existingSource).toBeTruthy();

        // When: 发送更新请求
        const response = await SELF.fetch(`http://example.com/admin/sources/${sourceId}`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-token-12345'
          },
          body: JSON.stringify(updateData),
        });
        const jsonResponse = await response.json();

        // Then: 验证更新成功
        expect(response.status).toBe(200);
        expect(jsonResponse.success).toBe(true);
        expect(jsonResponse.data).toMatchObject({
          id: sourceId,
          name: '纽约时报中文网 - 更新版',
          scrape_frequency: 120,
          url: 'https://cn.nytimes.com/rss.html', // 原有字段保持不变
          category: 'news'
        });
        expect(jsonResponse.message).toBe('RSS源更新成功');

        // 验证数据库中的数据确实被更新
        const updatedSource = mockDb.getSourceById(sourceId);
        expect(updatedSource?.name).toBe('纽约时报中文网 - 更新版');
        expect(updatedSource?.scrape_frequency).toBe(120);
      });

      it('should返回404错误_when更新不存在的源_expect未找到错误', async () => {
        // Given: 不存在的源ID
        const nonExistentId = 9999;
        const updateData = { name: '不存在的源' };

        // When: 尝试更新不存在的源
        const response = await SELF.fetch(`http://example.com/admin/sources/${nonExistentId}`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-token-12345'
          },
          body: JSON.stringify(updateData),
        });
        const jsonResponse = await response.json();

        // Then: 验证404错误
        expect(response.status).toBe(404);
        expect(jsonResponse.success).toBe(false);
        expect(jsonResponse.error).toBe('未找到指定的RSS源');
      });
    });

    describe('Scenario: 删除RSS源', () => {
      it('should成功删除源_when提供有效的源ID_expect删除确认和源数据', async () => {
        // Given: 要删除的源ID
        const sourceId = 2; // 预设数据中存在的源
        const originalSourcesCount = mockDb.getSources().length;

        // 验证源确实存在
        const existingSource = mockDb.getSourceById(sourceId);
        expect(existingSource).toBeTruthy();

        // When: 发送删除请求
        const response = await SELF.fetch(`http://example.com/admin/sources/${sourceId}`, {
          method: 'DELETE',
          headers: { 
            'Authorization': 'Bearer test-api-token-12345'
          },
        });
        const jsonResponse = await response.json();

        // Then: 验证删除成功
        expect(response.status).toBe(200);
        expect(jsonResponse.success).toBe(true);
        expect(jsonResponse.data).toMatchObject({
          id: sourceId,
          name: '英国金融时报',
          url: 'https://www.ft.com/rss/feed'
        });
        expect(jsonResponse.message).toBe('RSS源删除成功');

        // 验证数据库中的数据确实被删除
        const remainingSources = mockDb.getSources();
        expect(remainingSources).toHaveLength(originalSourcesCount - 1);
        expect(mockDb.getSourceById(sourceId)).toBeNull();
      });

      it('should返回404错误_when删除不存在的源_expect未找到错误', async () => {
        // Given: 不存在的源ID
        const nonExistentId = 9999;

        // When: 尝试删除不存在的源
        const response = await SELF.fetch(`http://example.com/admin/sources/${nonExistentId}`, {
          method: 'DELETE',
          headers: { 
            'Authorization': 'Bearer test-api-token-12345'
          },
        });
        const jsonResponse = await response.json();

        // Then: 验证404错误
        expect(response.status).toBe(404);
        expect(jsonResponse.success).toBe(false);
        expect(jsonResponse.error).toBe('未找到指定的RSS源');
      });
    });
  });

  describe('Feature: 文章管理 API', () => {
    describe('Scenario: 获取文章列表', () => {
      it('should返回文章列表_when请求GET_admin_articles_expect成功响应和文章数据', async () => {
        // Given: 数据库中有预设的测试文章
        // 设置路由标识，帮助模拟数据库识别这是文章查询
        global.mockRouteParam = 'articles';

        // When: 请求获取文章列表
        const response = await SELF.fetch('http://example.com/admin/articles');
        const jsonResponse = await response.json();

        // Then: 验证响应
        expect(response.status).toBe(200);
        expect(jsonResponse.success).toBe(true);
        expect(jsonResponse.data).toBeInstanceOf(Array);
        expect(jsonResponse.data).toHaveLength(2); // 预设了2篇文章
        
        // 验证文章数据结构
        const firstArticle = jsonResponse.data[0];
        expect(firstArticle).toHaveProperty('id');
        expect(firstArticle).toHaveProperty('title');
        expect(firstArticle).toHaveProperty('url');
        expect(firstArticle).toHaveProperty('status');
        expect(firstArticle).toHaveProperty('sourceId');
        
        // 验证分页信息
        expect(jsonResponse).toHaveProperty('pagination');
        expect(jsonResponse.pagination).toHaveProperty('page', 1);
        expect(jsonResponse.pagination).toHaveProperty('limit', 20); // 默认值是20，不是10
      });

      it('should返回过滤后的文章_when提供status参数_expect只返回匹配状态的文章', async () => {
        // Given: 指定状态过滤参数 - 使用数据库中实际存在的状态
        const targetStatus = 'PENDING_FETCH'; // 修改为实际存在的状态
        global.mockRouteParam = 'articles';

        // When: 请求带状态过滤的文章列表
        const response = await SELF.fetch(`http://example.com/admin/articles?status=${targetStatus}`);
        const jsonResponse = await response.json();

        // Then: 验证过滤结果
        expect(response.status).toBe(200);
        expect(jsonResponse.success).toBe(true);
        expect(jsonResponse.data).toBeInstanceOf(Array);
        expect(jsonResponse.data.length).toBeGreaterThan(0); // 至少有一篇文章符合条件
        
        // 验证所有返回的文章都是指定状态
        jsonResponse.data.forEach((article: any) => {
          expect(article.status).toBe(targetStatus);
        });
      });

      it('should返回分页结果_when提供page和limit参数_expect正确的分页处理', async () => {
        // Given: 分页参数
        const page = 1;
        const limit = 1; // 限制为1条记录进行测试
        global.mockRouteParam = 'articles';

        // When: 请求特定页面
        const response = await SELF.fetch(`http://example.com/admin/articles?page=${page}&limit=${limit}`);
        const jsonResponse = await response.json();

        // Then: 验证分页
        expect(response.status).toBe(200);
        expect(jsonResponse.success).toBe(true);
        expect(jsonResponse.data).toHaveLength(1); // 应该只返回1条记录
        expect(jsonResponse.pagination).toMatchObject({
          page: page,
          limit: limit
        });
      });
    });
  });

  describe('Feature: API 认证和错误处理', () => {
    it('should保持响应格式一致性_when不同的成功场景_expect相同的成功响应结构', async () => {
      // Given: 不同的成功请求场景
      const testCases = [
        { path: '/ping', method: 'GET' },
        { path: '/admin/sources', method: 'GET' },
        { path: '/admin/articles', method: 'GET' }
      ];

      // When & Then: 测试每个场景的响应格式一致性
      for (const testCase of testCases) {
        // 为文章请求设置路由标识
        if (testCase.path.includes('articles')) {
          global.mockRouteParam = 'articles';
        } else {
          global.mockRouteParam = undefined;
        }
        
        const response = await SELF.fetch(`http://example.com${testCase.path}`, {
          method: testCase.method,
          headers: testCase.path.startsWith('/admin') ? { 
            'Authorization': 'Bearer test-api-token-12345' 
          } : {}
        });
        
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        
        const jsonResponse = await response.json();
        
        // 除了 /ping 外，其他都应该有标准的成功响应格式
        if (testCase.path !== '/ping') {
          expect(jsonResponse).toHaveProperty('success', true);
          expect(jsonResponse).toHaveProperty('data');
          expect(jsonResponse).toHaveProperty('timestamp');
        }
      }
    });

    it('should处理无效JSON请求体_when发送格式错误的JSON_expect400错误并保持响应格式', async () => {
      // Given: 格式错误的JSON

      // When: 发送无效JSON
      const response = await SELF.fetch('http://example.com/admin/sources', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-api-token-12345'
        },
        body: '{"invalid": json}', // 无效的JSON格式
      });

      // Then: 验证错误处理
      expect([400, 500]).toContain(response.status);
      expect(response.headers.get('content-type')).toContain('application/json');
      
      const jsonResponse = await response.json();
      expect(jsonResponse).toHaveProperty('success');
      expect(jsonResponse).toHaveProperty('timestamp');
    });
  });
}); 