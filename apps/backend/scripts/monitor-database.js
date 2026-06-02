#!/usr/bin/env node

/**
 * Meridian Backend 数据库监控脚本
 * 
 * 功能：
 * 1. 实时监控数据库中articles表的状态变化
 * 2. 显示文章处理的各个阶段进度
 * 3. 追踪processArticles.workflow.ts的执行情况
 * 
 * 使用方法：
 * node apps/backend/scripts/monitor-database.js
 * 
 * 环境要求：
 * - 本地PostgreSQL数据库可访问
 * - 设置了DATABASE_URL环境变量
 */

const { execSync } = require('child_process');

// 配置
const CONFIG = {
  DB_CONNECTION: process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/shiwenjie',
  REFRESH_INTERVAL: 3000, // 3秒刷新一次
  SHOW_RECENT_HOURS: 24, // 显示最近24小时的数据
};

class DatabaseMonitor {
  constructor() {
    this.startTime = Date.now();
    this.lastStats = null;
    this.changes = [];
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

  async getDetailedStats() {
    const queries = {
      // 基础统计
      totalSources: 'SELECT COUNT(*) FROM sources',
      totalArticles: 'SELECT COUNT(*) FROM articles',
      
      // 文章状态统计
      pendingFetch: "SELECT COUNT(*) FROM articles WHERE status = 'PENDING_FETCH'",
      contentFetched: "SELECT COUNT(*) FROM articles WHERE status = 'CONTENT_FETCHED'",
      processed: "SELECT COUNT(*) FROM articles WHERE status = 'PROCESSED'",
      skippedPdf: "SELECT COUNT(*) FROM articles WHERE status = 'SKIPPED_PDF'",
      
      // 各种失败状态
      fetchFailed: "SELECT COUNT(*) FROM articles WHERE status = 'FETCH_FAILED'",
      renderFailed: "SELECT COUNT(*) FROM articles WHERE status = 'RENDER_FAILED'",
      aiAnalysisFailed: "SELECT COUNT(*) FROM articles WHERE status = 'AI_ANALYSIS_FAILED'",
      embeddingFailed: "SELECT COUNT(*) FROM articles WHERE status = 'EMBEDDING_FAILED'",
      r2UploadFailed: "SELECT COUNT(*) FROM articles WHERE status = 'R2_UPLOAD_FAILED'",
      skippedTooOld: "SELECT COUNT(*) FROM articles WHERE status = 'SKIPPED_TOO_OLD'",
      
      // 时间相关统计
      recentArticles: `SELECT COUNT(*) FROM articles WHERE created_at > NOW() - INTERVAL '${CONFIG.SHOW_RECENT_HOURS} hours'`,
      processedRecently: `SELECT COUNT(*) FROM articles WHERE processed_at > NOW() - INTERVAL '1 hour'`,
      
      // 使用浏览器抓取的文章
      usedBrowser: "SELECT COUNT(*) FROM articles WHERE used_browser = true",
      
      // 有内容文件的文章
      hasContentFile: "SELECT COUNT(*) FROM articles WHERE content_file_key IS NOT NULL",
      
      // 有嵌入向量的文章  
      hasEmbedding: "SELECT COUNT(*) FROM articles WHERE embedding IS NOT NULL",
    };

    const stats = {};
    for (const [key, query] of Object.entries(queries)) {
      const result = await this.queryDatabase(query);
      if (result.success) {
        stats[key] = parseInt(result.result) || 0;
      } else {
        stats[key] = -1;
      }
    }

    return stats;
  }

  async getRecentActivity() {
    // 获取最近的文章处理活动
    const query = `
      SELECT 
        id,
        title,
        status,
        created_at,
        processed_at,
        used_browser,
        fail_reason
      FROM articles 
      WHERE created_at > NOW() - INTERVAL '${CONFIG.SHOW_RECENT_HOURS} hours'
      ORDER BY created_at DESC 
      LIMIT 10
    `;

    const result = await this.queryDatabase(query);
    if (!result.success) {
      return [];
    }

    // 解析结果
    const lines = result.result.split('\n').filter(line => line.trim());
    return lines.map(line => {
      const parts = line.split('|').map(part => part.trim());
      if (parts.length >= 7) {
        return {
          id: parts[0],
          title: parts[1].substring(0, 50) + (parts[1].length > 50 ? '...' : ''),
          status: parts[2],
          created_at: parts[3],
          processed_at: parts[4] === '' ? null : parts[4],
          used_browser: parts[5] === 't',
          fail_reason: parts[6] === '' ? null : parts[6]
        };
      }
      return null;
    }).filter(Boolean);
  }

  async getSources() {
    const query = `
      SELECT 
        s.id,
        s.name,
        s.category,
        s.last_checked,
        s.do_initialized_at,
        COUNT(a.id) as article_count,
        COUNT(CASE WHEN a.status = 'PROCESSED' THEN 1 END) as processed_count
      FROM sources s
      LEFT JOIN articles a ON s.id = a.source_id
      GROUP BY s.id, s.name, s.category, s.last_checked, s.do_initialized_at
      ORDER BY s.id
    `;

    const result = await this.queryDatabase(query);
    if (!result.success) {
      return [];
    }

    const lines = result.result.split('\n').filter(line => line.trim());
    return lines.map(line => {
      const parts = line.split('|').map(part => part.trim());
      if (parts.length >= 7) {
        return {
          id: parts[0],
          name: parts[1],
          category: parts[2],
          lastChecked: parts[3] === '' ? null : parts[3],
          doInitialized: parts[4] === '' ? null : parts[4],
          articleCount: parseInt(parts[5]) || 0,
          processedCount: parseInt(parts[6]) || 0
        };
      }
      return null;
    }).filter(Boolean);
  }

  formatTime(dateString) {
    if (!dateString) return '未设置';
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMinutes = Math.floor((now - date) / (1000 * 60));
      
      if (diffMinutes < 1) return '刚刚';
      if (diffMinutes < 60) return `${diffMinutes}分钟前`;
      if (diffMinutes < 60 * 24) return `${Math.floor(diffMinutes / 60)}小时前`;
      return `${Math.floor(diffMinutes / (60 * 24))}天前`;
    } catch (error) {
      return '时间格式错误';
    }
  }

  detectChanges(currentStats) {
    if (!this.lastStats) {
      this.lastStats = currentStats;
      return;
    }

    const timestamp = new Date().toISOString().substring(11, 19);
    
    Object.keys(currentStats).forEach(key => {
      const oldValue = this.lastStats[key];
      const newValue = currentStats[key];
      
      if (oldValue !== newValue && oldValue !== -1 && newValue !== -1) {
        const change = {
          timestamp,
          metric: key,
          from: oldValue,
          to: newValue,
          delta: newValue - oldValue
        };
        
        this.changes.push(change);
        
        // 只保留最近的50个变化
        if (this.changes.length > 50) {
          this.changes = this.changes.slice(-50);
        }
      }
    });

    this.lastStats = currentStats;
  }

  clearScreen() {
    process.stdout.write('\x1b[2J\x1b[0f');
  }

  async displayStatus() {
    this.clearScreen();
    
    const now = new Date();
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
    
    console.log('📊 Meridian Backend 数据库监控');
    console.log('='.repeat(80));
    console.log(`时间: ${now.toLocaleString()} | 运行时间: ${elapsed}秒`);
    console.log(`数据库: ${CONFIG.DB_CONNECTION.replace(/:[^@]*@/, ':***@')}`);
    console.log('='.repeat(80));

    try {
      const [stats, sources, recentActivity] = await Promise.all([
        this.getDetailedStats(),
        this.getSources(),
        this.getRecentActivity()
      ]);

      this.detectChanges(stats);

      // 显示总体统计
      console.log('\n📈 总体统计:');
      console.log(`  RSS源数量: ${stats.totalSources}`);
      console.log(`  文章总数: ${stats.totalArticles}`);
      console.log(`  最近${CONFIG.SHOW_RECENT_HOURS}小时新增: ${stats.recentArticles}`);
      console.log(`  最近1小时处理: ${stats.processedRecently}`);

      // 显示处理状态
      console.log('\n🔄 文章处理状态:');
      const totalInProcess = stats.pendingFetch + stats.contentFetched;
      const totalFailed = stats.fetchFailed + stats.renderFailed + stats.aiAnalysisFailed + 
                          stats.embeddingFailed + stats.r2UploadFailed;
      
      console.log(`  ⏳ 待处理: ${stats.pendingFetch} (抓取中)`);
      console.log(`  📄 已抓取: ${stats.contentFetched} (分析中)`);
      console.log(`  ✅ 已完成: ${stats.processed}`);
      console.log(`  📋 已跳过: ${stats.skippedPdf + stats.skippedTooOld} (${stats.skippedPdf} PDF + ${stats.skippedTooOld} 过期)`);
      console.log(`  ❌ 失败总数: ${totalFailed}`);

      if (totalFailed > 0) {
        console.log('    失败详情:');
        if (stats.fetchFailed > 0) console.log(`      抓取失败: ${stats.fetchFailed}`);
        if (stats.renderFailed > 0) console.log(`      渲染失败: ${stats.renderFailed}`);
        if (stats.aiAnalysisFailed > 0) console.log(`      AI分析失败: ${stats.aiAnalysisFailed}`);
        if (stats.embeddingFailed > 0) console.log(`      嵌入生成失败: ${stats.embeddingFailed}`);
        if (stats.r2UploadFailed > 0) console.log(`      R2上传失败: ${stats.r2UploadFailed}`);
      }

      // 显示技术指标
      console.log('\n🔧 技术指标:');
      console.log(`  使用浏览器抓取: ${stats.usedBrowser}`);
      console.log(`  有内容文件: ${stats.hasContentFile}`);
      console.log(`  有嵌入向量: ${stats.hasEmbedding}`);

      // 显示进度条
      if (stats.totalArticles > 0) {
        const processedPercent = ((stats.processed / stats.totalArticles) * 100).toFixed(1);
        const failedPercent = ((totalFailed / stats.totalArticles) * 100).toFixed(1);
        const processingPercent = ((totalInProcess / stats.totalArticles) * 100).toFixed(1);
        
        console.log('\n📊 处理进度:');
        console.log(`  已完成: ${processedPercent}% | 处理中: ${processingPercent}% | 失败: ${failedPercent}%`);
        
        // 简单的进度条
        const barLength = 40;
        const processedBar = Math.floor((stats.processed / stats.totalArticles) * barLength);
        const processingBar = Math.floor((totalInProcess / stats.totalArticles) * barLength);
        const failedBar = Math.floor((totalFailed / stats.totalArticles) * barLength);
        
        let bar = '  [';
        bar += '█'.repeat(processedBar);
        bar += '▓'.repeat(processingBar);
        bar += '░'.repeat(failedBar);
        bar += ' '.repeat(Math.max(0, barLength - processedBar - processingBar - failedBar));
        bar += ']';
        
        console.log(bar);
        console.log('  说明: █已完成 ▓处理中 ░失败');
      }

      // 显示RSS源状态
      console.log('\n📡 RSS源状态:');
      sources.forEach(source => {
        const status = source.doInitialized ? '✅' : '❌';
        const lastCheck = this.formatTime(source.lastChecked);
        console.log(`  ${status} ${source.name} (${source.category}) - ${source.processedCount}/${source.articleCount} 已处理 - 最后检查: ${lastCheck}`);
      });

      // 显示最近变化
      if (this.changes.length > 0) {
        console.log('\n🔄 最近变化:');
        this.changes.slice(-10).forEach(change => {
          const symbol = change.delta > 0 ? '📈' : '📉';
          console.log(`  ${change.timestamp} ${symbol} ${change.metric}: ${change.from} → ${change.to} (${change.delta > 0 ? '+' : ''}${change.delta})`);
        });
      }

      // 显示最近活动
      if (recentActivity.length > 0) {
        console.log(`\n📰 最近文章活动 (最近${CONFIG.SHOW_RECENT_HOURS}小时):`);
        recentActivity.forEach(article => {
          const statusSymbol = {
            'PROCESSED': '✅',
            'PENDING_FETCH': '⏳',
            'CONTENT_FETCHED': '📄',
            'FETCH_FAILED': '❌',
            'AI_ANALYSIS_FAILED': '🤖❌',
            'EMBEDDING_FAILED': '🔢❌',
            'R2_UPLOAD_FAILED': '☁️❌'
          }[article.status] || '❓';
          
          const browserIcon = article.used_browser ? '🌐' : '📡';
          const timeInfo = `创建: ${this.formatTime(article.created_at)}${article.processed_at ? ` | 完成: ${this.formatTime(article.processed_at)}` : ''}`;
          
          console.log(`  ${statusSymbol} ${browserIcon} [${article.id}] ${article.title}`);
          console.log(`    ${timeInfo}`);
          if (article.fail_reason) {
            console.log(`    失败原因: ${article.fail_reason}`);
          }
        });
      }

      console.log('\n按 Ctrl+C 退出监控');

    } catch (error) {
      console.error('❌ 获取数据库状态失败:', error.message);
    }
  }

  async start() {
    console.log('🔍 启动数据库监控...');
    
    // 检查数据库连接
    try {
      await this.queryDatabase('SELECT 1');
      console.log('✅ 数据库连接正常');
    } catch (error) {
      console.error('❌ 数据库连接失败:', error.message);
      process.exit(1);
    }

    // 开始监控循环
    const monitorLoop = async () => {
      await this.displayStatus();
      setTimeout(monitorLoop, CONFIG.REFRESH_INTERVAL);
    };

    await monitorLoop();
  }
}

// 处理优雅退出
process.on('SIGINT', () => {
  console.log('\n\n👋 监控已停止');
  process.exit(0);
});

// 主入口
if (require.main === module) {
  const monitor = new DatabaseMonitor();
  monitor.start().catch(error => {
    console.error('监控启动失败:', error);
    process.exit(1);
  });
} 