/**
 * 数据流可观测性库
 * 专门用于监控数据处理流程中的关键指标
 */

import type { Env } from '../../index';

export interface DataFlowMetric {
  stage: string;
  timestamp: number;
  data: Record<string, any>;
  metadata?: {
    duration?: number;
    articleCount?: number;
    clusterCount?: number;
    storyCount?: number;
    qualityScore?: number;
    errorCount?: number;
  };
}

export interface ProcessingStage {
  stageName: string;
  startTime: number;
  endTime?: number;
  status: 'started' | 'completed' | 'failed';
  inputData?: any;
  outputData?: any;
  metadata?: Record<string, any>;
}

export class DataFlowObserver {
  private workflowId: string;
  private env: Env;
  private metrics: DataFlowMetric[] = [];
  private stages: ProcessingStage[] = [];
  private startTime: number;

  constructor(workflowId: string, env: Env) {
    this.workflowId = workflowId;
    this.env = env;
    this.startTime = Date.now();
  }

  /**
   * 记录处理阶段开始
   */
  startStage(stageName: string, inputData?: any): void {
    const stage: ProcessingStage = {
      stageName,
      startTime: Date.now(),
      status: 'started',
      inputData
    };
    
    this.stages.push(stage);
    
    console.log(`🟡 [数据流] 开始阶段: ${stageName}`);
    if (inputData) {
      console.log(`📊 输入数据:`, this.sanitizeLogData(inputData));
    }
  }

  /**
   * 记录处理阶段完成
   */
  completeStage(stageName: string, outputData?: any, metadata?: Record<string, any>): void {
    const stage = this.stages.find(s => s.stageName === stageName && s.status === 'started');
    if (stage) {
      stage.endTime = Date.now();
      stage.status = 'completed';
      stage.outputData = outputData;
      stage.metadata = metadata;

      const duration = stage.endTime - stage.startTime;
      console.log(`🟢 [数据流] 完成阶段: ${stageName} (耗时: ${duration}ms)`);
      
      if (outputData) {
        console.log(`📈 输出数据:`, this.sanitizeLogData(outputData));
      }
      
      if (metadata) {
        console.log(`📋 元数据:`, metadata);
      }

      // 记录关键指标
      this.recordMetric(stageName, {
        duration,
        ...outputData,
        ...metadata
      });
    }
  }

  /**
   * 记录处理阶段失败
   */
  failStage(stageName: string, error: Error, metadata?: Record<string, any>): void {
    const stage = this.stages.find(s => s.stageName === stageName && s.status === 'started');
    if (stage) {
      stage.endTime = Date.now();
      stage.status = 'failed';
      stage.metadata = {
        error: error.message,
        stack: error.stack,
        ...metadata
      };

      const duration = stage.endTime - stage.startTime;
      console.log(`🔴 [数据流] 失败阶段: ${stageName} (耗时: ${duration}ms)`);
      console.error(`❌ 错误信息:`, error.message);

      this.recordMetric(`${stageName}_failed`, {
        duration,
        error: error.message,
        ...metadata
      });
    }
  }

  /**
   * 记录数据流指标
   */
  recordMetric(stage: string, data: Record<string, any>): void {
    const metric: DataFlowMetric = {
      stage,
      timestamp: Date.now(),
      data,
      metadata: this.extractMetadata(data)
    };

    this.metrics.push(metric);
  }

  /**
   * 记录文章处理指标
   */
  recordArticleMetrics(articleCount: number, withEmbedding: number, withContent: number): void {
    const coverageRate = articleCount > 0 ? (withEmbedding / articleCount * 100).toFixed(1) : '0';
    const contentRate = articleCount > 0 ? (withContent / articleCount * 100).toFixed(1) : '0';

    console.log(`📰 文章处理指标:`);
    console.log(`   总数: ${articleCount}`);
    console.log(`   有嵌入向量: ${withEmbedding} (${coverageRate}%)`);
    console.log(`   有内容: ${withContent} (${contentRate}%)`);

    this.recordMetric('article_processing', {
      articleCount,
      withEmbedding,
      withContent,
      embeddingCoverage: parseFloat(coverageRate),
      contentCoverage: parseFloat(contentRate)
    });
  }

  /**
   * 记录聚类分析指标
   */
  recordClusteringMetrics(totalClusters: number, validClusters: number, avgClusterSize: number, qualityScore?: number): void {
    const clusterEfficiency = totalClusters > 0 ? (validClusters / totalClusters * 100).toFixed(1) : '0';

    console.log(`🎯 聚类分析指标:`);
    console.log(`   总聚类数: ${totalClusters}`);
    console.log(`   有效聚类: ${validClusters} (${clusterEfficiency}%)`);
    console.log(`   平均聚类大小: ${avgClusterSize.toFixed(1)}`);
    if (qualityScore !== undefined) {
      console.log(`   质量评分: ${qualityScore.toFixed(3)}`);
    }

    this.recordMetric('clustering_analysis', {
      totalClusters,
      validClusters,
      avgClusterSize,
      clusterEfficiency: parseFloat(clusterEfficiency),
      qualityScore
    });
  }

  /**
   * 记录故事选择指标
   */
  recordStorySelectionMetrics(candidateStories: number, selectedStories: number, avgImportance: number): void {
    const selectionRate = candidateStories > 0 ? (selectedStories / candidateStories * 100).toFixed(1) : '0';

    console.log(`📖 故事选择指标:`);
    console.log(`   候选故事: ${candidateStories}`);
    console.log(`   选择故事: ${selectedStories} (${selectionRate}%)`);
    console.log(`   平均重要性: ${avgImportance.toFixed(2)}`);

    this.recordMetric('story_selection', {
      candidateStories,
      selectedStories,
      selectionRate: parseFloat(selectionRate),
      avgImportance
    });
  }

  /**
   * 记录AI分析指标
   */
  recordAIAnalysisMetrics(analysisCount: number, successCount: number, avgResponseTime: number, totalTokens?: number): void {
    const successRate = analysisCount > 0 ? (successCount / analysisCount * 100).toFixed(1) : '0';

    console.log(`🤖 AI分析指标:`);
    console.log(`   分析次数: ${analysisCount}`);
    console.log(`   成功次数: ${successCount} (${successRate}%)`);
    console.log(`   平均响应时间: ${avgResponseTime.toFixed(0)}ms`);
    if (totalTokens) {
      console.log(`   总Token数: ${totalTokens}`);
    }

    this.recordMetric('ai_analysis', {
      analysisCount,
      successCount,
      successRate: parseFloat(successRate),
      avgResponseTime,
      totalTokens
    });
  }

  /**
   * 记录简报生成指标
   */
  recordBriefGenerationMetrics(articleUsed: number, totalArticles: number, storyCount: number, contentLength: number): void {
    const usageRate = totalArticles > 0 ? (articleUsed / totalArticles * 100).toFixed(1) : '0';

    console.log(`📋 简报生成指标:`);
    console.log(`   使用文章: ${articleUsed}/${totalArticles} (${usageRate}%)`);
    console.log(`   故事数量: ${storyCount}`);
    console.log(`   内容长度: ${contentLength} 字符`);

    this.recordMetric('brief_generation', {
      articleUsed,
      totalArticles,
      usageRate: parseFloat(usageRate),
      storyCount,
      contentLength
    });
  }

  /**
   * 获取处理阶段摘要
   */
  getStageSummary(): { completed: number; failed: number; totalDuration: number } {
    const completed = this.stages.filter(s => s.status === 'completed').length;
    const failed = this.stages.filter(s => s.status === 'failed').length;
    const totalDuration = this.stages
      .filter(s => s.endTime)
      .reduce((sum, s) => sum + (s.endTime! - s.startTime), 0);

    return { completed, failed, totalDuration };
  }

  /**
   * 生成数据流报告
   */
  generateDataFlowReport(): any {
    const summary = this.getStageSummary();
    const totalExecutionTime = Date.now() - this.startTime;

    // 分析关键指标
    const articleMetrics = this.metrics.find(m => m.stage === 'article_processing');
    const clusteringMetrics = this.metrics.find(m => m.stage === 'clustering_analysis');
    const storyMetrics = this.metrics.find(m => m.stage === 'story_selection');
    const aiMetrics = this.metrics.find(m => m.stage === 'ai_analysis');
    const briefMetrics = this.metrics.find(m => m.stage === 'brief_generation');

    const report = {
      workflowId: this.workflowId,
      timestamp: new Date().toISOString(),
      execution: {
        totalTime: totalExecutionTime,
        completedStages: summary.completed,
        failedStages: summary.failed,
        processingTime: summary.totalDuration
      },
      dataFlow: {
        articles: articleMetrics?.data,
        clustering: clusteringMetrics?.data,
        stories: storyMetrics?.data,
        aiAnalysis: aiMetrics?.data,
        briefGeneration: briefMetrics?.data
      },
      stages: this.stages.map(stage => ({
        name: stage.stageName,
        status: stage.status,
        duration: stage.endTime ? stage.endTime - stage.startTime : null,
        hasInput: !!stage.inputData,
        hasOutput: !!stage.outputData
      })),
      recommendations: this.generateRecommendations()
    };

    return report;
  }

  /**
   * 保存监控数据到存储
   */
  async saveObservabilityData(): Promise<void> {
    try {
      const report = this.generateDataFlowReport();
      const key = `observability/dataflow_${this.workflowId}_${Date.now()}.json`;
      
      await this.env.ARTICLES_BUCKET.put(key, JSON.stringify(report, null, 2));
      
      console.log(`💾 数据流监控数据已保存: ${key}`);
    } catch (error) {
      console.error('❌ 保存监控数据失败:', error);
    }
  }

  // 私有辅助方法
  private extractMetadata(data: Record<string, any>): DataFlowMetric['metadata'] {
    return {
      duration: data.duration,
      articleCount: data.articleCount || data.totalArticles || data.articleUsed,
      clusterCount: data.totalClusters || data.validClusters,
      storyCount: data.candidateStories || data.selectedStories || data.storyCount,
      qualityScore: data.qualityScore || data.avgImportance,
      errorCount: data.error ? 1 : 0
    };
  }

  private sanitizeLogData(data: any): any {
    // 简化日志输出，避免过于冗长
    if (Array.isArray(data)) {
      return `Array(${data.length})`;
    }
    if (typeof data === 'object' && data !== null) {
      const keys = Object.keys(data);
      if (keys.length > 5) {
        return `Object{${keys.slice(0, 5).join(', ')}...} (${keys.length} 个属性)`;
      }
      return data;
    }
    return data;
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    
    // 分析文章覆盖率
    const articleMetrics = this.metrics.find(m => m.stage === 'article_processing');
    if (articleMetrics && articleMetrics.data.embeddingCoverage < 80) {
      recommendations.push('嵌入向量覆盖率偏低，建议检查AI处理流程');
    }

    // 分析聚类效率
    const clusteringMetrics = this.metrics.find(m => m.stage === 'clustering_analysis');
    if (clusteringMetrics && clusteringMetrics.data.clusterEfficiency < 50) {
      recommendations.push('聚类效率偏低，建议调整聚类参数');
    }

    // 分析AI成功率
    const aiMetrics = this.metrics.find(m => m.stage === 'ai_analysis');
    if (aiMetrics && aiMetrics.data.successRate < 90) {
      recommendations.push('AI分析成功率偏低，建议检查API配置和网络连接');
    }

    // 分析执行时间
    const summary = this.getStageSummary();
    if (summary.totalDuration > 120000) { // 超过2分钟
      recommendations.push('处理时间较长，建议优化处理算法或增加并行处理');
    }

    return recommendations;
  }
}

/**
 * 创建数据流观察者实例
 */
export function createDataFlowObserver(workflowId: string, env: Env): DataFlowObserver {
  return new DataFlowObserver(workflowId, env);
} 