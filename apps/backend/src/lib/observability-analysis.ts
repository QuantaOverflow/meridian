/**
 * 可观测性分析工具
 * 专门用于分析故事重要性评估和筛选过程的透明度
 */

import type { Env } from '../index';
import { WorkflowMetrics, StorySelectionMetrics } from './observability';

export interface ImportanceEvaluationReport {
  workflowId: string;
  totalStories: number;
  selectionEfficiency: {
    selectionRate: number;
    avgImportanceGap: number;
    borderlineDecisions: number;
    confidenceLevel: number;
  };
  qualityAnalysis: {
    avgCoherence: number;
    avgRelevance: number;
    avgConfidence: number;
    qualityVariance: number;
  };
  decisionTransparency: {
    reasoningProvided: number;
    factorsExplained: number;
    decisionClarity: number;
  };
  optimizationRecommendations: string[];
}

export interface ThresholdOptimizationSuggestion {
  currentThreshold: number;
  suggestedThreshold: number;
  reasoning: string;
  expectedImpact: {
    additionalStories: number;
    qualityTradeoff: number;
  };
}

export class ObservabilityAnalyzer {
  constructor(private env: Env) {}

  /**
   * 分析工作流的重要性评估透明度
   */
  async analyzeImportanceEvaluation(workflowMetrics: WorkflowMetrics[]): Promise<ImportanceEvaluationReport> {
    const importanceSteps = workflowMetrics.filter(m => 
      m.stepName === 'importance_evaluation_detail' || 
      m.stepName === 'story_selection'
    );

    let totalStories = 0;
    let selectionData: any = {};
    let qualityMetrics: any = {};

    // 聚合重要性评估数据
    for (const step of importanceSteps) {
      if (step.stepName === 'importance_evaluation_detail' && step.data) {
        const analysis = step.data.importanceAnalysis;
        if (analysis) {
          totalStories += analysis.stories?.length || 0;
          if (analysis.qualityProfile) {
            qualityMetrics = {
              avgCoherence: (qualityMetrics.avgCoherence || 0) + analysis.qualityProfile.avgCoherence,
              avgRelevance: (qualityMetrics.avgRelevance || 0) + analysis.qualityProfile.avgRelevance,
              avgConfidence: (qualityMetrics.avgConfidence || 0) + analysis.qualityProfile.avgConfidence,
              count: (qualityMetrics.count || 0) + 1
            };
          }
        }
      }

      if (step.stepName === 'story_selection' && step.data) {
        const selection = step.data as StorySelectionMetrics;
        selectionData = {
          selectionRate: selection.selectedStories / selection.candidateStories,
          thresholdAnalysis: selection.thresholdAnalysis,
          selectionConfidence: selection.selectionConfidence
        };
      }
    }

    // 计算决策透明度指标
    const decisionTransparency = this.calculateDecisionTransparency(importanceSteps);

    // 生成优化建议
    const recommendations = this.generateOptimizationRecommendations(selectionData, qualityMetrics);

    return {
      workflowId: workflowMetrics[0]?.workflowId || 'unknown',
      totalStories,
      selectionEfficiency: {
        selectionRate: selectionData.selectionRate || 0,
        avgImportanceGap: selectionData.thresholdAnalysis?.avgMarginForSelected || 0,
        borderlineDecisions: selectionData.thresholdAnalysis?.borderlineCases || 0,
        confidenceLevel: this.calculateOverallConfidence(selectionData.selectionConfidence)
      },
      qualityAnalysis: {
        avgCoherence: qualityMetrics.count > 0 ? qualityMetrics.avgCoherence / qualityMetrics.count : 0,
        avgRelevance: qualityMetrics.count > 0 ? qualityMetrics.avgRelevance / qualityMetrics.count : 0,
        avgConfidence: qualityMetrics.count > 0 ? qualityMetrics.avgConfidence / qualityMetrics.count : 0,
        qualityVariance: this.calculateQualityVariance(qualityMetrics)
      },
      decisionTransparency,
      optimizationRecommendations: recommendations
    };
  }

  /**
   * 分析阈值优化机会
   */
  analyzeThresholdOptimization(selectionMetrics: StorySelectionMetrics): ThresholdOptimizationSuggestion | null {
    if (!selectionMetrics.thresholdAnalysis) {
      return null;
    }

    const { thresholdAnalysis } = selectionMetrics;
    const currentThreshold = selectionMetrics.importanceThreshold;

    // 分析边界情况
    if (thresholdAnalysis.borderlineCases > 0) {
      const avgRejectedMargin = thresholdAnalysis.avgMarginForRejected;
      
      if (avgRejectedMargin < 0.5) {
        // 有很多接近阈值的拒绝案例，可能阈值设置过高
        return {
          currentThreshold,
          suggestedThreshold: currentThreshold - 0.5,
          reasoning: `有${thresholdAnalysis.borderlineCases}个边界情况，平均仅低于阈值${avgRejectedMargin.toFixed(2)}，建议降低阈值以包含更多高质量故事`,
          expectedImpact: {
            additionalStories: thresholdAnalysis.borderlineCases,
            qualityTradeoff: -0.1 // 预期质量轻微下降
          }
        };
      }
    }

    // 分析选择效率
    const selectionRate = selectionMetrics.selectedStories / selectionMetrics.candidateStories;
    if (selectionRate < 0.3 && thresholdAnalysis.avgMarginForSelected > 2) {
      // 选择率过低且选中的故事重要性远超阈值
      return {
        currentThreshold,
        suggestedThreshold: currentThreshold - 1,
        reasoning: `当前选择率仅${(selectionRate * 100).toFixed(1)}%，但选中故事平均超出阈值${thresholdAnalysis.avgMarginForSelected.toFixed(2)}，说明阈值过于保守`,
        expectedImpact: {
          additionalStories: Math.floor(selectionMetrics.candidateStories * 0.2),
          qualityTradeoff: -0.2
        }
      };
    }

    return null;
  }

  /**
   * 生成可观测性健康度报告
   */
  generateObservabilityHealthReport(workflowMetrics: WorkflowMetrics[]): any {
    const coverageAnalysis = {
      totalSteps: workflowMetrics.length,
      importanceEvaluationSteps: workflowMetrics.filter(m => m.stepName.includes('importance')).length,
      errorSteps: workflowMetrics.filter(m => m.status === 'failed').length,
      dataQualitySteps: workflowMetrics.filter(m => m.stepName.includes('quality')).length
    };

    const transparencyScore = this.calculateTransparencyScore(workflowMetrics);

    return {
      coverage: coverageAnalysis,
      transparencyScore,
      healthStatus: transparencyScore > 0.8 ? 'excellent' : 
                   transparencyScore > 0.6 ? 'good' : 
                   transparencyScore > 0.4 ? 'fair' : 'poor',
      recommendations: this.generateHealthRecommendations(coverageAnalysis, transparencyScore)
    };
  }

  private calculateDecisionTransparency(steps: WorkflowMetrics[]): any {
    let reasoningProvided = 0;
    let factorsExplained = 0;
    let totalDecisions = 0;

    for (const step of steps) {
      if (step.stepName === 'importance_evaluation_detail' && step.data?.importanceAnalysis?.stories) {
        const stories = step.data.importanceAnalysis.stories;
        totalDecisions += stories.length;
        
        for (const story of stories) {
          if (story.reasoningExplanation && story.reasoningExplanation !== '未提供') {
            reasoningProvided++;
          }
          if (story.importanceFactors && Object.keys(story.importanceFactors).length > 0) {
            factorsExplained++;
          }
        }
      }
    }

    return {
      reasoningProvided: totalDecisions > 0 ? reasoningProvided / totalDecisions : 0,
      factorsExplained: totalDecisions > 0 ? factorsExplained / totalDecisions : 0,
      decisionClarity: totalDecisions > 0 ? (reasoningProvided + factorsExplained) / (2 * totalDecisions) : 0
    };
  }

  private generateOptimizationRecommendations(selectionData: any, qualityMetrics: any): string[] {
    const recommendations: string[] = [];

    if (selectionData.selectionRate < 0.3) {
      recommendations.push('考虑降低重要性阈值以提高故事选择率');
    }

    if (selectionData.thresholdAnalysis?.borderlineCases > 2) {
      recommendations.push('有较多边界情况，建议细化重要性评估标准');
    }

    if (qualityMetrics.avgConfidence < 0.7) {
      recommendations.push('AI评估置信度较低，建议优化提示词或调整模型参数');
    }

    if (qualityMetrics.avgCoherence < 0.6) {
      recommendations.push('故事连贯性偏低，建议改进聚类算法或文章预处理');
    }

    return recommendations;
  }

  private calculateOverallConfidence(selectionConfidence: any): number {
    if (!selectionConfidence) return 0;
    
    const { highConfidence, borderlineCases, avgSelectionMargin } = selectionConfidence;
    const total = highConfidence + borderlineCases;
    
    if (total === 0) return 0;
    
    // 高置信度选择比例 + 平均选择边际的影响
    return (highConfidence / total) * 0.7 + Math.min(avgSelectionMargin / 3, 0.3);
  }

  private calculateQualityVariance(qualityMetrics: any): number {
    // 简化的质量方差计算
    if (!qualityMetrics.count || qualityMetrics.count === 0) return 0;
    
    const avgQuality = (qualityMetrics.avgCoherence + qualityMetrics.avgRelevance + qualityMetrics.avgConfidence) / 3;
    return Math.abs(1 - avgQuality); // 距离完美质量的差距
  }

  private calculateTransparencyScore(workflowMetrics: WorkflowMetrics[]): number {
    const importanceSteps = workflowMetrics.filter(m => m.stepName.includes('importance')).length;
    const totalSteps = workflowMetrics.length;
    const errorDocumentation = workflowMetrics.filter(m => m.status === 'failed' && m.error).length;
    const totalErrors = workflowMetrics.filter(m => m.status === 'failed').length;

    // 透明度评分：重要性监控覆盖 + 错误文档化率
    const coverageScore = importanceSteps / Math.max(totalSteps * 0.3, 1); // 期望30%的步骤与重要性相关
    const errorDocRate = totalErrors > 0 ? errorDocumentation / totalErrors : 1;

    return Math.min((coverageScore * 0.7 + errorDocRate * 0.3), 1);
  }

  private generateHealthRecommendations(coverage: any, transparencyScore: number): string[] {
    const recommendations: string[] = [];

    if (coverage.importanceEvaluationSteps < 3) {
      recommendations.push('增加更多重要性评估相关的监控点');
    }

    if (coverage.errorSteps > coverage.totalSteps * 0.1) {
      recommendations.push('错误率较高，需要优化工作流稳定性');
    }

    if (transparencyScore < 0.6) {
      recommendations.push('提升监控覆盖度和错误文档化水平');
    }

    if (coverage.dataQualitySteps < 2) {
      recommendations.push('增加数据质量检查和监控');
    }

    return recommendations;
  }
}

export function createObservabilityAnalyzer(env: Env): ObservabilityAnalyzer {
  return new ObservabilityAnalyzer(env);
} 