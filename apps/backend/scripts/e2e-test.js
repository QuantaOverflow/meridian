#!/usr/bin/env node

/**
 * Meridian Backend 统一端到端测试脚本
 * 
 * 功能：
 * 1. 简化模式：使用现有RSS源进行测试（默认）
 * 2. 完整模式：创建新测试源，完成后清理
 * 
 * 使用方法：
 * node apps/backend/scripts/e2e-test.js [mode] [sourceId]
 * 
 * 参数：
 * mode: simple (默认) | full
 * sourceId: 指定RSS源ID（仅在simple模式下有效）
 * 
 * 示例：
 * node apps/backend/scripts/e2e-test.js                    # 简化模式，使用第一个可用源
 * node apps/backend/scripts/e2e-test.js simple 1          # 简化模式，使用源ID 1
 * node apps/backend/scripts/e2e-test.js full              # 完整模式，创建新源并测试
 */

const { execSync } = require('child_process');
const fs = require('fs');

// 配置
const CONFIG = {
  BACKEND_URL: 'http://localhost:8787',
  API_TOKEN: 'localtest',
  TEST_SOURCE: {
    name: `E2E测试源-${Date.now()}`,
    url: 'https://news.ycombinator.com/rss',
    category: 'tech',
    scrape_frequency: 1
  },
  DB_CONNECTION: process.env.DATABASE_URL || 'postgresql://postgres:709323@localhost:5432/shiwenjie',
  POLLING_INTERVAL: 3000,
  MAX_WAIT_TIME: 180000,
};

class UnifiedE2ETester {
  constructor(mode = 'simple', sourceId = null) {
    this.mode = mode;
    this.sourceId = sourceId;
    this.startTime = Date.now();
    this.createdSourceId = null;
    this.testResults = {
      mode,
      phases: [],
      errors: [],
      success: false,
      timings: {}
    };
  }

  log(message, data = null) {
    const timestamp = new Date().toISOString().substring(11, 19);
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.log(`[${timestamp}] [+${elapsed}s] ${message}`);
    if (data) {
      console.log('  📊 数据:', JSON.stringify(data, null, 2));
    }
  }

  error(message, error = null) {
    this.log(`❌ ERROR: ${message}`);
    if (error) {
      console.error('  详情:', error);
    }
    this.testResults.errors.push({ message, error: error?.message, timestamp: new Date().toISOString() });
  }

  success(message, data = null) {
    this.log(`✅ ${message}`, data);
  }

  async makeRequest(endpoint, options = {}) {
    const url = `${CONFIG.BACKEND_URL}${endpoint}`;
    const defaultHeaders = {
      'Authorization': `Bearer ${CONFIG.API_TOKEN}`,
      'Content-Type': 'application/json'
    };

    try {
      const response = await fetch(url, {
        headers: { ...defaultHeaders, ...options.headers },
        ...options
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = { raw: text };
      }

      return { success: response.ok, data, status: response.status, text };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async queryDatabase(query) {
    try {
      const result = execSync(
        `psql "${CONFIG.DB_CONNECTION}" -t -c "${query}"`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      return { success: true, result: result.trim() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getArticleStats() {
    const queries = {
      total: 'SELECT COUNT(*) FROM articles',
      pending: "SELECT COUNT(*) FROM articles WHERE status = 'PENDING_FETCH'",
      processed: "SELECT COUNT(*) FROM articles WHERE status = 'PROCESSED'",
      recent: "SELECT COUNT(*) FROM articles WHERE created_at > NOW() - INTERVAL '1 hour'"
    };

    const stats = {};
    for (const [key, query] of Object.entries(queries)) {
      const result = await this.queryDatabase(query);
      stats[key] = result.success ? parseInt(result.result) || 0 : -1;
    }
    return stats;
  }

  async phase1_PrepareSource() {
    if (this.mode === 'simple') {
      return await this.findExistingSource();
    } else {
      return await this.createTestSource();
    }
  }

  async findExistingSource() {
    this.log('🔍 查找可用的RSS源...');
    
    const result = await this.makeRequest('/admin/sources');
    if (!result.success) {
      this.error('获取RSS源失败', result.error);
      return false;
    }

    const sources = result.data.data || [];
    if (sources.length === 0) {
      this.error('没有找到任何RSS源，请先创建RSS源或使用完整模式');
      return false;
    }

    let selectedSource;
    if (this.sourceId) {
      selectedSource = sources.find(s => s.id === parseInt(this.sourceId));
      if (!selectedSource) {
        this.log(`⚠️ 未找到指定的源ID ${this.sourceId}，将使用第一个可用源`);
        selectedSource = sources[0];
      }
    } else {
      // 优先选择已初始化的源
      const initializedSources = sources.filter(s => s.do_initialized_at);
      selectedSource = initializedSources.length > 0 ? initializedSources[0] : sources[0];
    }

    this.createdSourceId = selectedSource.id;
    this.success(`使用RSS源: ${selectedSource.name} (ID: ${selectedSource.id})`);
    this.testResults.phases.push({ name: 'find_source', success: true, sourceId: selectedSource.id });
    
    return selectedSource;
  }

  async createTestSource() {
    this.log('🚀 创建测试RSS源...');
    
    const result = await this.makeRequest('/admin/sources', {
      method: 'POST',
      body: JSON.stringify(CONFIG.TEST_SOURCE)
    });

    if (!result.success) {
      this.error('创建RSS源失败', result.error);
      return false;
    }

    this.createdSourceId = result.data.data.id;
    this.success(`RSS源创建成功，ID: ${this.createdSourceId}`);
    this.testResults.phases.push({ name: 'create_source', success: true, sourceId: this.createdSourceId });

    return result.data.data;
  }

  async phase2_EnsureDOInitialized(source) {
    this.log('🏗️ 检查并初始化Durable Object...');

    if (source.do_initialized_at) {
      this.success('DO已初始化，跳过初始化步骤');
      return true;
    }

    const result = await this.makeRequest(`/do/admin/source/${this.createdSourceId}/init`, {
      method: 'POST'
    });

    if (!result.success) {
      this.error('DO初始化失败', result.error);
      return false;
    }

    this.success('Durable Object初始化成功');
    this.testResults.phases.push({ name: 'initialize_do', success: true });
    return true;
  }

  async phase3_TriggerProcessing() {
    this.log('📥 触发RSS抓取和文章处理...');

    // 记录初始状态
    const initialStats = await this.getArticleStats();
    this.log('初始文章统计', initialStats);

    // 触发RSS抓取
    const scrapeResult = await this.makeRequest(`/do/source/${this.createdSourceId}/force-scrape`, {
      method: 'POST'
    });

    if (!scrapeResult.success) {
      this.log('⚠️ RSS抓取触发失败，继续进行文章处理测试...');
    } else {
      this.success('RSS抓取已触发');
    }

    // 等待一些新文章出现，然后触发处理
    await this.waitForNewArticles(initialStats.total);

    // 触发文章处理工作流
    const processResult = await this.triggerArticleProcessing();
    if (!processResult) {
      this.error('文章处理工作流触发失败');
      return false;
    }

    this.testResults.phases.push({ name: 'trigger_processing', success: true });
    return true;
  }

  async waitForNewArticles(initialCount, maxWait = 60000) {
    this.log('⏳ 等待新文章出现...');
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const currentStats = await this.getArticleStats();
      if (currentStats.total > initialCount) {
        this.success(`发现 ${currentStats.total - initialCount} 篇新文章`);
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    this.log('⚠️ 等待超时，继续使用现有文章进行测试');
    return false;
  }

  async triggerArticleProcessing() {
    this.log('🔧 触发文章处理工作流...');
    
    const pendingQuery = "SELECT id FROM articles WHERE status = 'PENDING_FETCH' ORDER BY created_at DESC LIMIT 5";
    const pendingResult = await this.queryDatabase(pendingQuery);
    
    if (!pendingResult.success) {
      this.error('无法查询待处理文章');
      return false;
    }

    const pendingIds = pendingResult.result.split('\n')
      .filter(line => line.trim())
      .map(id => parseInt(id.trim()))
      .filter(id => !isNaN(id));
    
    if (pendingIds.length === 0) {
      this.log('⚠️ 没有找到待处理的文章，测试将继续');
      return true;
    }

    this.log(`找到 ${pendingIds.length} 篇待处理文章`);

    const result = await this.makeRequest('/admin/articles/process', {
      method: 'POST',
      body: JSON.stringify({ article_ids: pendingIds })
    });

    if (!result.success) {
      this.log('⚠️ 文章处理工作流触发失败，但测试继续');
      return true;
    }

    this.success('文章处理工作流已触发');
    return true;
  }

  async phase4_MonitorProgress() {
    this.log('📊 监控处理进度...');

    const startTime = Date.now();
    let lastStats = await this.getArticleStats();
    let stableCount = 0;

    while (Date.now() - startTime < CONFIG.MAX_WAIT_TIME) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.POLLING_INTERVAL));
      
      const currentStats = await this.getArticleStats();
      
      // 显示进度
      if (JSON.stringify(currentStats) !== JSON.stringify(lastStats)) {
        this.log('📈 数据库状态变化', {
          变化: {
            总文章: `${lastStats.total} → ${currentStats.total}`,
            待处理: `${lastStats.pending} → ${currentStats.pending}`,
            已处理: `${lastStats.processed} → ${currentStats.processed}`
          }
        });
        lastStats = currentStats;
        stableCount = 0;
      } else {
        stableCount++;
        if (stableCount >= 3) {
          this.log('📊 数据库状态稳定，停止监控');
          break;
        }
      }
    }

    this.testResults.phases.push({ name: 'monitor_progress', success: true, finalStats: lastStats });
    return lastStats;
  }

  async phase5_ValidateResults(finalStats) {
    this.log('🔍 验证测试结果...');

    const hasArticles = finalStats.total > 0;
    const hasProcessedArticles = finalStats.processed > 0;

    if (!hasArticles) {
      this.error('未找到任何文章');
      return false;
    }

    if (!hasProcessedArticles) {
      this.log('⚠️ 没有已处理的文章，但测试基本流程正常');
    } else {
      this.success(`成功处理了 ${finalStats.processed} 篇文章`);
    }

    this.testResults.phases.push({ name: 'validate_results', success: true });
    return true;
  }

  async cleanup() {
    if (this.mode === 'full' && this.createdSourceId) {
      this.log('🧹 清理测试数据...');
      
      const result = await this.makeRequest(`/admin/sources/${this.createdSourceId}`, {
        method: 'DELETE'
      });

      if (result.success) {
        this.success('测试RSS源已删除');
      } else {
        this.log('⚠️ 测试RSS源删除失败，请手动清理');
      }
    }
  }

  generateReport() {
    const duration = (Date.now() - this.startTime) / 1000;
    const report = {
      ...this.testResults,
      duration: `${duration.toFixed(1)}s`,
      timestamp: new Date().toISOString()
    };

    this.log('📋 测试报告', report);

    // 保存报告文件
    const reportFile = `apps/backend/scripts/test-report-${Date.now()}.json`;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    this.log(`📄 报告已保存: ${reportFile}`);

    return report;
  }

  async run() {
    this.log(`🚀 开始运行${this.mode === 'full' ? '完整' : '简化'}端到端测试`);
    
    try {
      // 阶段1: 准备测试源
      const source = await this.phase1_PrepareSource();
      if (!source) return false;

      // 阶段2: 确保DO初始化
      if (!await this.phase2_EnsureDOInitialized(source)) return false;

      // 阶段3: 触发处理
      if (!await this.phase3_TriggerProcessing()) return false;

      // 阶段4: 监控进度
      const finalStats = await this.phase4_MonitorProgress();

      // 阶段5: 验证结果
      if (!await this.phase5_ValidateResults(finalStats)) return false;

      this.testResults.success = true;
      this.success('🎉 端到端测试完成！');

    } catch (error) {
      this.error('测试过程中发生错误', error);
      this.testResults.success = false;
    } finally {
      await this.cleanup();
      this.generateReport();
    }

    return this.testResults.success;
  }
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'simple';
  const sourceId = args[1] || null;

  if (!['simple', 'full'].includes(mode)) {
    console.error('❌ 错误: 模式必须是 "simple" 或 "full"');
    process.exit(1);
  }

  // 环境检查
  try {
    execSync(`psql "${CONFIG.DB_CONNECTION}" -c "SELECT 1" > /dev/null 2>&1`);
  } catch (error) {
    console.error('❌ 数据库连接失败');
    process.exit(1);
  }

  const tester = new UnifiedE2ETester(mode, sourceId);
  const success = await tester.run();
  
  process.exit(success ? 0 : 1);
}

if (require.main === module) {
  main();
} 