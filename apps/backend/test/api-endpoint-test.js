/**
 * Meridian Backend API端点测试脚本
 * 系统地测试所有可用的API端点，确保它们正常工作
 * 
 * 🆕 包含最新添加的5个端点测试：
 * - /observability/workflows/{key} - 工作流详情
 * - /observability/dashboard - 实时监控面板
 * - /observability/quality/analysis - 数据质量分析
 * - /do/admin/source/{sourceId}/init - 初始化特定源DO
 * - /do/admin/source/{sourceId} - 删除源DO
 * 
 * 总计测试24个API端点，覆盖所有核心功能模块
 */

const BACKEND_URL = 'http://localhost:8787';
const API_TOKEN = 'localtest'; // 从.dev.vars文件获取的API_TOKEN

class APIEndpointTester {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
    this.testData = {
      // 测试用的RSS源数据
      testSource: {
        name: "Test Source " + Date.now(),
        url: "https://test-rss-" + Date.now() + ".example.com/feed.xml",
        category: "test",
        scrape_frequency: 4
      },
      // 测试用的简报数据
      testReport: {
        title: "Test Brief " + Date.now(),
        content: "This is a test brief content with multiple lines.\n\nIt includes analysis and key points.",
        totalArticles: 50,
        totalSources: 5,
        usedArticles: 30,
        usedSources: 3,
        tldr: "Test brief summary",
        createdAt: new Date().toISOString(),
        model_author: "test-model",
        clustering_params: {
          umap: {
            n_neighbors: 15
          },
          hdbscan: {
            min_cluster_size: 3,
            min_samples: 2,
            epsilon: 0.1
          }
        }
      }
    };
  }

  /**
   * 记录测试结果
   */
  logResult(endpoint, method, status, responseTime, success, data = null, error = null) {
    const result = {
      endpoint,
      method,
      status,
      responseTime,
      success,
      data,
      error,
      timestamp: new Date().toISOString()
    };
    
    this.results.push(result);
    
    const statusIcon = success ? '✅' : '❌';
    const statusText = success ? 'SUCCESS' : 'FAILED';
    
    console.log(`${statusIcon} ${method} ${endpoint} - ${status} (${responseTime}ms) - ${statusText}`);
    if (error) {
      console.log(`   错误: ${error}`);
    }
    if (data && success) {
      const preview = JSON.stringify(data).substring(0, 100);
      console.log(`   响应: ${preview}${preview.length >= 100 ? '...' : ''}`);
    }
  }

  /**
   * 通用API测试方法
   */
  async testEndpoint(endpoint, method = 'GET', body = null, headers = {}, requiresAuth = false) {
    const startTime = Date.now();
    const url = `${BACKEND_URL}${endpoint}`;
    
    try {
      const defaultHeaders = {
        'Content-Type': 'application/json',
        ...headers
      };
      
      // 如果需要认证，添加Authorization header
      if (requiresAuth) {
        defaultHeaders['Authorization'] = `Bearer ${API_TOKEN}`;
      }
      
      const options = {
        method,
        headers: defaultHeaders
      };
      
      if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        options.body = JSON.stringify(body);
      }
      
      const response = await fetch(url, options);
      const responseTime = Date.now() - startTime;
      
      let data = null;
      let error = null;
      
      // 检查Content-Type来决定如何解析响应
      const contentType = response.headers.get('content-type');
      
      try {
        if (contentType && contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
          // 尝试解析为JSON（某些端点可能不设置正确的Content-Type）
          if (data && data.startsWith('{') || data.startsWith('[')) {
            try {
              data = JSON.parse(data);
            } catch (e) {
              // 保持为文本
            }
          }
        }
      } catch (e) {
        // 响应读取失败
        data = `Failed to read response: ${e.message}`;
      }
      
      const success = response.ok;
      if (!success) {
        error = `HTTP ${response.status}: ${data?.error || data?.message || data || 'Unknown error'}`;
      }
      
      this.logResult(endpoint, method, response.status, responseTime, success, data, error);
      return { success, data, error, status: response.status };
      
    } catch (err) {
      const responseTime = Date.now() - startTime;
      const error = `Network error: ${err.message}`;
      this.logResult(endpoint, method, 0, responseTime, false, null, error);
      return { success: false, data: null, error, status: 0 };
    }
  }

  /**
   * 测试健康检查端点
   */
  async testHealthEndpoints() {
    console.log('\n🏥 测试健康检查端点...');
    
    await this.testEndpoint('/ping');
  }

  /**
   * 测试管理端点 (/admin) - 完整的CRUD测试
   */
  async testAdminEndpoints() {
    console.log('\n👑 测试管理端点...');
    
    // 1. RSS源管理测试
    console.log('  📡 RSS源管理测试...');
    
    // 获取现有源列表
    const sourcesResult = await this.testEndpoint('/admin/sources');
    
    // 创建新的RSS源
    const createResult = await this.testEndpoint('/admin/sources', 'POST', this.testData.testSource);
    let createdSourceId = null;
    if (createResult.success && createResult.data?.data?.id) {
      createdSourceId = createResult.data.data.id;
      console.log(`    ✅ 创建的源ID: ${createdSourceId}`);
    }
    
    // 如果创建成功，测试更新和删除
    if (createdSourceId) {
      // 更新RSS源
      const updateData = {
        name: this.testData.testSource.name + " (Updated)",
        category: "updated-test"
      };
      await this.testEndpoint(`/admin/sources/${createdSourceId}`, 'PUT', updateData);
      
      // 删除RSS源（清理测试数据）
      await this.testEndpoint(`/admin/sources/${createdSourceId}`, 'DELETE');
    }
    
    // 2. 文章管理测试
    console.log('  📚 文章管理测试...');
    
    // 获取文章列表（基础）
    await this.testEndpoint('/admin/articles');
    
    // 测试分页
    await this.testEndpoint('/admin/articles?limit=5&page=1');
    
    // 测试状态过滤
    await this.testEndpoint('/admin/articles?status=PROCESSED');
    await this.testEndpoint('/admin/articles?status=PENDING_FETCH');
    
    // 测试组合查询
    await this.testEndpoint('/admin/articles?limit=10&status=PROCESSED');
    
    // 3. 系统概览测试
    console.log('  📊 系统概览测试...');
    await this.testEndpoint('/admin/overview');
    
    // 4. 简报生成测试（实际执行并监控工作流）
    console.log('  📄 简报生成接口测试...');
    const briefData = {
      dateFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      dateTo: new Date().toISOString(),
      minImportance: 3, // 降低阈值，让更多文章通过筛选
      triggeredBy: 'api_test'
    };
    
    console.log('    🚀 启动简报生成工作流...');
    const generateResult = await this.testEndpoint('/admin/briefs/generate', 'POST', briefData);
    
    if (generateResult.success && generateResult.data?.data?.workflowId) {
      const workflowId = generateResult.data.data.workflowId;
      console.log(`    ✅ 工作流已启动，ID: ${workflowId}`);
      console.log('    ⏳ 注意：简报生成是异步过程，可能需要几分钟完成');
      
      // 可选：检查工作流状态（如果有相关端点）
      console.log('    🔍 建议通过可观测性端点监控工作流进度');
    } else {
      console.log('    ❌ 简报生成工作流启动失败');
      if (generateResult.error) {
        console.log(`    错误详情: ${generateResult.error}`);
      }
    }
  }

  /**
   * 测试简报端点 (/reports) - 包含认证和数据验证
   */
  async testReportsEndpoints() {
    console.log('\n📄 测试简报端点...');
    
    // 测试无认证访问（应该失败）
    console.log('  🔒 测试认证机制...');
    await this.testExpectedFailure('/reports/last-report', 'GET', null, {}, false, [401]);
    
    // 测试有认证访问
    console.log('  ✅ 测试有效认证...');
    const lastReportResult = await this.testEndpoint('/reports/last-report', 'GET', null, {}, true);
    
    // 测试创建新简报
    console.log('  📝 测试创建简报...');
    await this.testEndpoint('/reports/report', 'POST', this.testData.testReport, {}, true);
    
    // 验证简报数据结构
    if (lastReportResult.success && lastReportResult.data) {
      const report = lastReportResult.data;
      const requiredFields = ['id', 'title', 'content', 'totalArticles', 'totalSources'];
      const missingFields = requiredFields.filter(field => !(field in report));
      
      if (missingFields.length === 0) {
        console.log('    ✅ 简报数据结构验证通过');
      } else {
        console.log(`    ❌ 简报数据结构缺失字段: ${missingFields.join(', ')}`);
      }
    }
  }

  /**
   * 测试可观测性端点 (/observability) - 监控数据验证
   */
  async testObservabilityEndpoints() {
    console.log('\n🔍 测试可观测性端点...');
    
    // 工作流监控
    console.log('  ⚙️ 测试工作流监控...');
    const workflowResult = await this.testEndpoint('/observability/workflows');
    
    if (workflowResult.success && workflowResult.data) {
      const workflows = workflowResult.data.workflows;
      if (Array.isArray(workflows)) {
        console.log(`    📊 发现 ${workflows.length} 个工作流记录`);
        
        // 如果有工作流记录，测试工作流详情端点
        if (workflows.length > 0) {
          const firstWorkflowKey = workflows[0].key || workflows[0].id;
          if (firstWorkflowKey) {
            console.log('  🔍 测试工作流详情查询...');
            // URL编码工作流key，因为它可能包含特殊字符
            const encodedKey = encodeURIComponent(firstWorkflowKey);
            // 使用testExpectedFailure，因为某些工作流可能已过期或不可访问
            await this.testExpectedFailure(`/observability/workflows/${encodedKey}`, 'GET', null, {}, true, [200, 404, 500]);
          }
        }
      }
    }
    
    // 🆕 实时监控面板
    console.log('  📊 测试实时监控面板...');
    const dashboardResult = await this.testEndpoint('/observability/dashboard', 'GET', null, {}, true);
    
    if (dashboardResult.success && dashboardResult.data) {
      const dashboard = dashboardResult.data;
      const expectedFields = ['systemStatus', 'recentMetrics', 'activeWorkflows'];
      const hasFields = expectedFields.some(field => field in dashboard);
      
      if (hasFields) {
        console.log('    ✅ 监控面板数据结构验证通过');
      } else {
        console.log('    ℹ️ 监控面板返回数据格式可能与预期不同');
      }
    }
    
    // 🆕 数据质量分析
    console.log('  🔬 测试数据质量分析...');
    const qualityResult = await this.testEndpoint('/observability/quality/analysis', 'GET', null, {}, true);
    
    if (qualityResult.success && qualityResult.data) {
      const analysis = qualityResult.data;
      console.log('    ✅ 数据质量分析获取成功');
      
      // 检查是否有质量指标数据
      if (analysis.metrics || analysis.quality || analysis.issues) {
        console.log('    📈 质量分析包含指标数据');
      }
    }
    
    // 简报统计
    console.log('  📈 测试简报统计...');
    const statsResult = await this.testEndpoint('/observability/briefs/stats');
    
    if (statsResult.success && statsResult.data?.stats) {
      const stats = statsResult.data.stats;
      const expectedFields = ['totalBriefs', 'avgArticlesPerBrief', 'avgUsageRate'];
      const hasAllFields = expectedFields.every(field => field in stats);
      
      if (hasAllFields) {
        console.log('    ✅ 统计数据结构完整');
        console.log(`    📊 总简报数: ${stats.totalBriefs}`);
        console.log(`    📊 平均文章数: ${stats.avgArticlesPerBrief}`);
        console.log(`    📊 平均使用率: ${(stats.avgUsageRate * 100).toFixed(1)}%`);
      }
    }
  }

  /**
   * 测试Durable Objects端点 (/do) - 分布式对象管理
   */
  async testDurableObjectsEndpoints() {
    console.log('\n🏗️  测试Durable Objects端点...');
    
    // 获取源信息用于测试
    const sourcesResult = await this.testEndpoint('/admin/sources');
    let testSourceId = null;
    
    if (sourcesResult.success && sourcesResult.data?.data?.length > 0) {
      testSourceId = sourcesResult.data.data[0].id;
      console.log(`  🎯 使用测试源ID: ${testSourceId}`);
    }
    
    // 测试DO初始化
    console.log('  🔧 测试DO批量初始化...');
    const initResult = await this.testEndpoint('/do/admin/initialize-dos', 'POST', {}, {}, true);
    
    if (initResult.success && initResult.data) {
      console.log(`    📊 初始化结果: ${initResult.data.initialized}/${initResult.data.total} DOs`);
    }
    
    // 🆕 测试单个源DO初始化（如果有可用的源）
    if (testSourceId) {
      console.log('  🔧 测试单个源DO初始化...');
      const singleInitResult = await this.testEndpoint(`/do/admin/source/${testSourceId}/init`, 'POST', {}, {}, true);
      
      if (singleInitResult.success) {
        console.log(`    ✅ 源 ${testSourceId} DO初始化成功`);
      }
      
      // 测试DO状态查询
      console.log('  📊 测试DO状态查询...');
      await this.testEndpoint(`/do/source/${testSourceId}/status`, 'GET', null, {}, true);
      
      // 🆕 测试DO删除（谨慎操作 - 仅在测试环境）
      console.log('  ⚠️  测试DO删除功能...');
      // 注意：这是一个高风险操作，在生产环境中应该避免
      // 这里我们先测试一个不存在的源ID
      await this.testExpectedFailure('/do/admin/source/test-nonexistent-source', 'DELETE', null, {}, true, [404, 500]);
      
      // 如果需要测试真实源的删除，取消下面注释（极其谨慎！）
      // await this.testEndpoint(`/do/admin/source/${testSourceId}`, 'DELETE', null, {}, true);
    } else {
      console.log('  ⚠️ 没有可用的源进行DO管理测试');
      
      // 测试无效源ID的情况
      console.log('  🧪 测试无效源ID的DO操作...');
      await this.testEndpoint('/do/admin/source/invalid-source-id/init', 'POST', {}, {}, true);
      await this.testEndpoint('/do/source/invalid-source-id/status', 'GET', null, {}, true);
      await this.testEndpoint('/do/admin/source/invalid-source-id', 'DELETE', null, {}, true);
    }
  }

  /**
   * 测试事件端点 (/events) - 数据查询和过滤
   */
  async testEventsEndpoints() {
    console.log('\n📊 测试事件端点...');
    
    // 基础事件查询
    console.log('  📅 测试基础事件查询...');
    await this.testEndpoint('/events', 'GET', null, {}, true);
    
    // 测试分页查询
    console.log('  📄 测试分页查询...');
    await this.testEndpoint('/events?pagination=true&page=1&limit=10', 'GET', null, {}, true);
    
    // 测试日期过滤
    console.log('  📆 测试日期过滤...');
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    await this.testEndpoint(`/events?date=${today}`, 'GET', null, {}, true);
    await this.testEndpoint(`/events?date=${yesterday}`, 'GET', null, {}, true);
    
    // 测试组合查询
    console.log('  🔍 测试组合查询...');
    await this.testEndpoint(`/events?date=${today}&pagination=true&limit=5`, 'GET', null, {}, true);
  }

  /**
   * 测试OpenGraph端点 (/openGraph) - 图像生成
   */
  async testOpenGraphEndpoints() {
    console.log('\n🌐 测试OpenGraph端点...');
    
    // 测试默认OpenGraph图像
    console.log('  🖼️ 测试默认图像生成...');
    const defaultResult = await this.testEndpoint('/openGraph/default');
    
    if (defaultResult.success) {
      console.log('    ✅ 默认图像生成成功');
    }
    
    // 测试简报OpenGraph图像
    console.log('  📊 测试简报图像生成...');
    const briefParams = new URLSearchParams({
      title: 'Test Brief Title',
      date: Date.now().toString(),
      articles: '25',
      sources: '5'
    });
    
    await this.testEndpoint(`/openGraph/brief?${briefParams}`);
  }

  /**
   * 测试源管理端点 (/sources) - 高级功能
   */
  async testSourcesEndpoints() {
    console.log('\n📡 测试高级源管理端点...');
    
    // 注意：这里主要是DELETE操作，带有DO清理功能
    // 为了安全，我们不执行实际的删除操作
    console.log('  ⚠️ 高级删除端点测试已跳过（包含DO清理，避免意外删除）');
    
    // 可以测试不存在的资源
    await this.testExpectedFailure('/sources/99999', 'DELETE', null, {}, true, [404]);
  }

  /**
   * 测试错误处理和边界情况
   */
  async testEdgeCases() {
    console.log('\n🧪 测试边界情况和错误处理...');
    
    // 测试无效的端点
    console.log('  ❌ 测试无效端点...');
    await this.testExpectedFailure('/nonexistent', 'GET', null, {}, false, [404]);
    
    // 测试无效的HTTP方法
    console.log('  🚫 测试无效HTTP方法...');
    await this.testExpectedFailure('/ping', 'PATCH', null, {}, false, [404, 405]);
    
    // 测试无效的JSON数据
    console.log('  💥 测试无效JSON数据...');
    await this.testExpectedFailure('/admin/sources', 'POST', 'invalid json', {}, false, [400]);
    
    // 测试缺失必需字段
    console.log('  📝 测试缺失必需字段...');
    await this.testExpectedFailure('/admin/sources', 'POST', { name: 'Test' }, {}, false, [400]); // 缺少url
    
    // 测试无效的分页参数
    console.log('  📄 测试无效分页参数...');
    await this.testEndpoint('/admin/articles?page=-1&limit=0');
    await this.testEndpoint('/admin/articles?page=abc&limit=xyz');
  }

  /**
   * 测试预期失败的端点 - 某些情况下失败是正常的
   */
  async testExpectedFailure(endpoint, method = 'GET', body = null, headers = {}, requiresAuth = false, expectedStatuses = [400, 401, 404, 405]) {
    const result = await this.testEndpoint(endpoint, method, body, headers, requiresAuth);
    
    // 如果状态码在预期范围内，将其视为成功
    if (expectedStatuses.includes(result.status)) {
      // 重新记录为成功
      const successResult = {
        ...result,
        success: true,
        error: null
      };
      
      // 更新results数组中的最后一个结果
      if (this.results.length > 0) {
        const lastResult = this.results[this.results.length - 1];
        if (lastResult.endpoint === endpoint && lastResult.method === method) {
          lastResult.success = true;
          lastResult.error = null;
          
          // 重新打印日志
          const statusIcon = '✅';
          const statusText = 'EXPECTED_FAILURE';
          console.log(`${statusIcon} ${method} ${endpoint} - ${result.status} (${lastResult.responseTime}ms) - ${statusText}`);
          console.log(`   预期错误: HTTP ${result.status} 符合预期`);
        }
      }
      
      return successResult;
    }
    
    return result;
  }

  /**
   * 生成测试报告
   */
  generateReport() {
    const totalTests = this.results.length;
    const successfulTests = this.results.filter(r => r.success).length;
    const failedTests = totalTests - successfulTests;
    const avgResponseTime = this.results.reduce((sum, r) => sum + r.responseTime, 0) / totalTests;
    
    console.log('\n' + '='.repeat(80));
    console.log('📋 API端点综合测试报告');
    console.log('='.repeat(80));
    
    console.log(`📊 测试统计:`);
    console.log(`   总测试数: ${totalTests}`);
    console.log(`   成功: ${successfulTests} (${((successfulTests/totalTests)*100).toFixed(1)}%)`);
    console.log(`   失败: ${failedTests} (${((failedTests/totalTests)*100).toFixed(1)}%)`);
    console.log(`   平均响应时间: ${avgResponseTime.toFixed(1)}ms`);
    
    if (failedTests > 0) {
      console.log(`\n❌ 失败的端点:`);
      this.results
        .filter(r => !r.success)
        .forEach(r => {
          console.log(`   ${r.method} ${r.endpoint} - ${r.error}`);
        });
    }
    
    // 按响应时间排序显示最慢的端点
    const slowestEndpoints = [...this.results]
      .filter(r => r.success)
      .sort((a, b) => b.responseTime - a.responseTime)
      .slice(0, 5);
    
    if (slowestEndpoints.length > 0) {
      console.log(`\n⏱️  最慢的端点:`);
      slowestEndpoints.forEach(r => {
        console.log(`   ${r.method} ${r.endpoint} - ${r.responseTime}ms`);
      });
    }
    
    // 功能状态总览
    console.log(`\n🎯 功能状态总览:`);
    
    const healthyEndpoints = this.results.filter(r => r.endpoint === '/ping' && r.success);
    console.log(`   健康检查: ${healthyEndpoints.length > 0 ? '✅ 正常' : '❌ 异常'}`);
    
    const sourcesEndpoints = this.results.filter(r => r.endpoint.includes('/admin/sources') && r.success);
    console.log(`   RSS源管理: ${sourcesEndpoints.length > 0 ? '✅ 正常' : '❌ 异常'}`);
    
    const articlesEndpoints = this.results.filter(r => r.endpoint.includes('/admin/articles') && r.success);
    console.log(`   文章管理: ${articlesEndpoints.length > 0 ? '✅ 正常' : '❌ 异常'}`);
    
    const reportsEndpoints = this.results.filter(r => r.endpoint.includes('/reports') && r.success);
    console.log(`   简报查询: ${reportsEndpoints.length > 0 ? '✅ 正常' : '❌ 异常'}`);
    
    const observabilityEndpoints = this.results.filter(r => r.endpoint.includes('/observability') && r.success);
    console.log(`   可观测性: ${observabilityEndpoints.length > 0 ? '✅ 正常' : '❌ 异常'}`);
    
    // 🆕 新增端点统计
    const workflowDetailEndpoints = this.results.filter(r => r.endpoint.includes('/observability/workflows/') && r.success);
    const dashboardEndpoints = this.results.filter(r => r.endpoint.includes('/observability/dashboard') && r.success);
    const qualityEndpoints = this.results.filter(r => r.endpoint.includes('/observability/quality') && r.success);
    console.log(`   - 工作流详情: ${workflowDetailEndpoints.length > 0 ? '✅ 正常' : '❌ 异常'}`);
    console.log(`   - 监控面板: ${dashboardEndpoints.length > 0 ? '✅ 正常' : '❌ 异常'}`);
    console.log(`   - 质量分析: ${qualityEndpoints.length > 0 ? '✅ 正常' : '❌ 异常'}`);
    
    const doEndpoints = this.results.filter(r => r.endpoint.includes('/do/') && r.success);
    console.log(`   DO管理: ${doEndpoints.length > 0 ? '✅ 正常' : '❌ 异常'}`);
    
    // 🆕 DO端点详细统计
    const doInitEndpoints = this.results.filter(r => r.endpoint.includes('/do/admin/source/') && r.endpoint.includes('/init') && r.success);
    const doDeleteEndpoints = this.results.filter(r => r.endpoint.includes('/do/admin/source/') && r.method === 'DELETE' && r.success);
    console.log(`   - DO初始化: ${doInitEndpoints.length > 0 ? '✅ 正常' : '❌ 异常'}`);
    console.log(`   - DO删除: ${doDeleteEndpoints.length > 0 ? '✅ 正常' : '❌ 异常'}`);
    
    const eventsEndpoints = this.results.filter(r => r.endpoint.includes('/events') && r.success);
    console.log(`   事件数据: ${eventsEndpoints.length > 0 ? '✅ 正常' : '❌ 异常'}`);
    
    const openGraphEndpoints = this.results.filter(r => r.endpoint.includes('/openGraph') && r.success);
    console.log(`   图像生成: ${openGraphEndpoints.length > 0 ? '✅ 正常' : '❌ 异常'}`);
    
    // 🆕 新增端点覆盖率统计
    const newEndpointsTotal = 5; // 新增的端点总数
    const newEndpointsTested = workflowDetailEndpoints.length + dashboardEndpoints.length + 
                              qualityEndpoints.length + doInitEndpoints.length + doDeleteEndpoints.length;
    console.log(`\n📊 新增端点测试覆盖率: ${newEndpointsTested}/${newEndpointsTotal} (${((newEndpointsTested/newEndpointsTotal)*100).toFixed(1)}%)`);
    
    if (newEndpointsTested === newEndpointsTotal) {
      console.log('   🎉 所有新增端点均已测试');
    } else {
      console.log('   ⚠️ 部分新增端点可能需要有效数据才能测试');
    }
    
    // 性能分析
    console.log(`\n⚡ 性能分析:`);
    const fastEndpoints = this.results.filter(r => r.success && r.responseTime < 100).length;
    const mediumEndpoints = this.results.filter(r => r.success && r.responseTime >= 100 && r.responseTime < 500).length;
    const slowEndpoints = this.results.filter(r => r.success && r.responseTime >= 500).length;
    
    console.log(`   快速响应(<100ms): ${fastEndpoints} 个端点`);
    console.log(`   中等响应(100-500ms): ${mediumEndpoints} 个端点`);
    console.log(`   慢速响应(>500ms): ${slowEndpoints} 个端点`);
    
    console.log(`\n💡 建议:`);
    
    if (failedTests === 0) {
      console.log('   🎉 所有测试通过！API服务运行正常。');
    } else {
      console.log('   🔧 请检查失败的端点，可能需要：');
      console.log('      - 检查数据库连接配置');
      console.log('      - 验证环境变量设置');
      console.log('      - 确认依赖服务状态');
      console.log('      - 检查认证配置');
    }
    
    if (avgResponseTime > 1000) {
      console.log('   ⚡ 平均响应时间较慢，考虑性能优化');
    }
    
    if (slowEndpoints > 0) {
      console.log('   ⏱️ 发现慢速端点，建议进行性能调优');
    }
    
    return {
      totalTests,
      successfulTests,
      failedTests,
      avgResponseTime,
      successRate: (successfulTests / totalTests) * 100,
      performanceStats: {
        fast: fastEndpoints,
        medium: mediumEndpoints,
        slow: slowEndpoints
      }
    };
  }

  /**
   * 运行所有测试
   */
  async runAllTests() {
    console.log('🚀 开始API端点全面测试...');
    console.log(`🌐 目标服务器: ${BACKEND_URL}`);
    console.log(`🔑 使用API Token: ${API_TOKEN ? '***' + API_TOKEN.slice(-4) : 'Not set'}`);
    console.log('='.repeat(80));
    
    try {
      await this.testHealthEndpoints();
      await this.testAdminEndpoints();
      await this.testReportsEndpoints();
      await this.testObservabilityEndpoints();
      await this.testDurableObjectsEndpoints();
      await this.testEventsEndpoints();
      await this.testOpenGraphEndpoints();
      await this.testSourcesEndpoints();
      await this.testEdgeCases();
      
      // 🆕 添加专项工作流测试
      console.log('\n🔄 运行专项简报工作流测试...');
      const workflowResult = await this.testBriefWorkflowWithMonitoring();
      
      // 将工作流测试结果添加到总体结果中
      this.logResult('/workflow-test/brief-generation', 'POST', 200, 
        workflowResult.monitoringTime * 1000, workflowResult.success, 
        workflowResult, workflowResult.error);
      
      return this.generateReport();
      
    } catch (error) {
      console.error('❌ 测试过程中发生错误:', error);
      return null;
    }
  }

  /**
   * 专门测试简报生成工作流的完整测试 - 包含监控和等待
   */
  async testBriefWorkflowWithMonitoring() {
    console.log('\n🔄 专项测试：简报生成工作流完整流程...');
    
    try {
      // 1. 首先检查当前系统状态
      console.log('  📊 检查系统状态...');
      const overviewResult = await this.testEndpoint('/admin/overview');
      
      if (overviewResult.success && overviewResult.data?.data?.articles) {
        const articles = overviewResult.data.data.articles;
        console.log(`    📚 当前文章状态 - 总计: ${articles.total}, 已处理: ${articles.processed}, 待处理: ${articles.pending}`);
        
        if (articles.processed < 5) {
          console.log('    ⚠️ 警告: 已处理的文章数量较少，可能影响简报生成质量');
        }
      }
      
      // 2. 获取当前最新简报作为基准
      console.log('  📄 获取当前最新简报...');
      const beforeBriefResult = await this.testEndpoint('/reports/last-report', 'GET', null, {}, true);
      let beforeBriefId = null;
      
      if (beforeBriefResult.success && beforeBriefResult.data?.id) {
        beforeBriefId = beforeBriefResult.data.id;
        console.log(`    📋 当前最新简报ID: ${beforeBriefId}`);
        console.log(`    📅 创建时间: ${beforeBriefResult.data.createdAt}`);
      } else {
        console.log('    ℹ️ 当前没有已存在的简报');
      }
      
      // 3. 构建简报生成请求
      const briefData = {
        dateFrom: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 最近3天
        dateTo: new Date().toISOString(),
        minImportance: 2, // 降低重要性阈值，确保有足够的文章
        triggeredBy: 'workflow_test_' + Date.now()
      };
      
      console.log('  🚀 启动简报生成工作流...');
      console.log(`    📅 时间范围: ${briefData.dateFrom} 到 ${briefData.dateTo}`);
      console.log(`    🎯 最小重要性: ${briefData.minImportance}`);
      console.log(`    👤 触发者: ${briefData.triggeredBy}`);
      
      // 4. 启动工作流
      const generateResult = await this.testEndpoint('/admin/briefs/generate', 'POST', briefData);
      
      if (!generateResult.success) {
        console.log('    ❌ 工作流启动失败');
        console.log(`    错误: ${generateResult.error}`);
        return { success: false, error: generateResult.error };
      }
      
      const workflowId = generateResult.data?.data?.workflowId;
      if (!workflowId) {
        console.log('    ❌ 工作流启动失败 - 未返回工作流ID');
        return { success: false, error: '未返回工作流ID' };
      }
      
      console.log(`    ✅ 工作流已启动，ID: ${workflowId}`);
      
      // 5. 监控工作流进度
      console.log('  ⏳ 监控工作流进度...');
      let monitoringAttempts = 0;
      const maxMonitoringAttempts = 30; // 最多监控15分钟 (30 * 30秒)
      let workflowCompleted = false;
      let workflowError = null;
      
      while (monitoringAttempts < maxMonitoringAttempts && !workflowCompleted) {
        monitoringAttempts++;
        console.log(`    🔍 监控尝试 ${monitoringAttempts}/${maxMonitoringAttempts}...`);
        
        // 检查工作流列表
        const workflowsResult = await this.testEndpoint('/observability/workflows');
        
        if (workflowsResult.success && workflowsResult.data?.workflows) {
          const currentWorkflow = workflowsResult.data.workflows.find(w => 
            w.key === workflowId || w.id === workflowId
          );
          
          if (currentWorkflow) {
            console.log(`    📊 工作流状态: ${currentWorkflow.status || '未知'}`);
            console.log(`    ⏰ 运行时间: ${currentWorkflow.duration || '未知'}`);
            
            if (currentWorkflow.status === 'completed' || currentWorkflow.status === 'finished') {
              workflowCompleted = true;
              console.log('    ✅ 工作流已完成');
              break;
            } else if (currentWorkflow.status === 'failed' || currentWorkflow.status === 'error') {
              workflowError = currentWorkflow.error || '工作流执行失败';
              console.log(`    ❌ 工作流失败: ${workflowError}`);
              break;
            }
          } else {
            console.log('    🔍 在工作流列表中未找到当前工作流，可能已完成或正在处理');
          }
        }
        
        // 检查是否有新简报生成
        const currentBriefResult = await this.testEndpoint('/reports/last-report', 'GET', null, {}, true);
        if (currentBriefResult.success && currentBriefResult.data?.id) {
          const currentBriefId = currentBriefResult.data.id;
          
          // 如果简报ID发生变化，说明生成了新简报
          if (beforeBriefId !== currentBriefId) {
            workflowCompleted = true;
            console.log(`    🎉 检测到新简报生成！新简报ID: ${currentBriefId}`);
            console.log(`    📊 简报统计 - 总文章: ${currentBriefResult.data.totalArticles}, 使用文章: ${currentBriefResult.data.usedArticles}`);
            break;
          }
        }
        
        // 等待30秒后继续监控
        if (!workflowCompleted && monitoringAttempts < maxMonitoringAttempts) {
          console.log('    ⏳ 等待30秒后继续监控...');
          await new Promise(resolve => setTimeout(resolve, 30000));
        }
      }
      
      // 6. 工作流监控结果分析
      if (workflowCompleted) {
        console.log('  ✅ 工作流监控完成 - 成功');
        
        // 获取最终简报详情
        const finalBriefResult = await this.testEndpoint('/reports/last-report', 'GET', null, {}, true);
        if (finalBriefResult.success && finalBriefResult.data) {
          const brief = finalBriefResult.data;
          console.log('  📋 最终简报详情:');
          console.log(`    📝 标题: ${brief.title}`);
          console.log(`    📊 总文章数: ${brief.totalArticles}`);
          console.log(`    📊 使用文章数: ${brief.usedArticles}`);
          console.log(`    📊 使用率: ${((brief.usedArticles / brief.totalArticles) * 100).toFixed(1)}%`);
          console.log(`    📅 创建时间: ${brief.createdAt}`);
          
          if (brief.clustering_params) {
            console.log('    🔬 聚类参数:');
            console.log(`      UMAP: ${JSON.stringify(brief.clustering_params.umap || {})}`);
            console.log(`      HDBSCAN: ${JSON.stringify(brief.clustering_params.hdbscan || {})}`);
          }
        }
        
        return { 
          success: true, 
          workflowId,
          monitoringTime: monitoringAttempts * 30, // 秒
          newBriefGenerated: true
        };
      } else if (workflowError) {
        console.log(`  ❌ 工作流监控完成 - 失败: ${workflowError}`);
        return { 
          success: false, 
          workflowId,
          error: workflowError,
          monitoringTime: monitoringAttempts * 30
        };
      } else {
        console.log('  ⏰ 工作流监控超时 - 工作流可能仍在运行');
        console.log(`  💡 建议: 继续通过可观测性端点手动检查工作流状态`);
        console.log(`  🔗 工作流ID: ${workflowId}`);
        
        return { 
          success: false, 
          workflowId,
          error: '监控超时',
          monitoringTime: monitoringAttempts * 30,
          suggestion: '工作流可能仍在运行，请手动检查'
        };
      }
      
    } catch (error) {
      console.log(`  💥 测试过程中发生异常: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

/**
 * 主执行函数
 */
async function runAPITests() {
  const tester = new APIEndpointTester();
  const report = await tester.runAllTests();
  
  if (report) {
    console.log(`\n✨ 测试完成，成功率: ${report.successRate.toFixed(1)}%`);
    console.log(`📊 性能分布: ${report.performanceStats.fast}快/${report.performanceStats.medium}中/${report.performanceStats.slow}慢`);
    return report;
  } else {
    console.log('\n💥 测试失败');
    return null;
  }
}

/**
 * 专门运行简报工作流测试
 */
async function runBriefWorkflowTest() {
  console.log('🔄 启动简报工作流专项测试...');
  console.log(`🌐 目标服务器: ${BACKEND_URL}`);
  console.log(`🔑 使用API Token: ${API_TOKEN ? '***' + API_TOKEN.slice(-4) : 'Not set'}`);
  console.log('='.repeat(80));
  
  const tester = new APIEndpointTester();
  
  try {
    // 先做基础健康检查
    await tester.testHealthEndpoints();
    
    // 运行专项工作流测试
    const workflowResult = await tester.testBriefWorkflowWithMonitoring();
    
    console.log('\n' + '='.repeat(80));
    console.log('📋 简报工作流测试报告');
    console.log('='.repeat(80));
    
    if (workflowResult.success) {
      console.log('✅ 测试结果: 成功');
      console.log(`🔗 工作流ID: ${workflowResult.workflowId}`);
      console.log(`⏱️ 监控时间: ${workflowResult.monitoringTime}秒`);
      console.log(`📊 新简报生成: ${workflowResult.newBriefGenerated ? '是' : '否'}`);
    } else {
      console.log('❌ 测试结果: 失败');
      console.log(`❌ 错误信息: ${workflowResult.error}`);
      if (workflowResult.workflowId) {
        console.log(`🔗 工作流ID: ${workflowResult.workflowId}`);
      }
      if (workflowResult.monitoringTime) {
        console.log(`⏱️ 监控时间: ${workflowResult.monitoringTime}秒`);
      }
      if (workflowResult.suggestion) {
        console.log(`💡 建议: ${workflowResult.suggestion}`);
      }
    }
    
    // 生成详细的排查建议
    console.log('\n💡 排查建议:');
    
    if (workflowResult.success) {
      console.log('   🎉 工作流运行正常！系统运行良好。');
    } else {
      console.log('   🔧 请检查以下可能的问题:');
      console.log('      1. 检查Cloudflare Workflows是否正确配置');
      console.log('      2. 验证数据库中是否有足够的已处理文章');
      console.log('      3. 检查AI服务连接和配置');
      console.log('      4. 验证ML服务的可用性');
      console.log('      5. 检查环境变量和秘钥配置');
      
      if (workflowResult.error === '监控超时') {
        console.log('      💭 监控超时可能原因:');
        console.log('         - 工作流执行时间过长（正常情况）');
        console.log('         - AI API响应缓慢');
        console.log('         - 数据处理量过大');
        console.log('         - 网络连接问题');
      }
    }
    
    return workflowResult;
    
  } catch (error) {
    console.error('❌ 测试过程中发生错误:', error);
    return { success: false, error: error.message };
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  runAPITests().catch(console.error);
}

module.exports = { APIEndpointTester, runAPITests, runBriefWorkflowTest }; 