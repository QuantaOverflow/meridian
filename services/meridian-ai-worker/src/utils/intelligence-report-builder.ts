import { 
  IntelligenceReport, 
  Story, 
  Article,
  TimelineEvent,
  Entity,
  Contradiction
} from '../types/intelligence-types';

/**
 * 情报报告构建器工具类 - 生产环境版本
 */
export class IntelligenceReportBuilder {
  
  /**
   * 基于AI分析结果构建完整报告
   */
  static buildFromAnalysis(story: Story, articles: Article[], analysis: any): IntelligenceReport {
    const storyId = this.generateStoryId(story.title);
    
    // 如果AI分析失败或为空，直接抛出错误
    if (!analysis || analysis.status === 'incomplete') {
      throw new Error(`AI analysis failed or incomplete for story: ${story.title}`);
    }

    return {
      storyId,
      status: analysis.status === 'incomplete' ? "INCOMPLETE" : "COMPLETE",
      executiveSummary: analysis.executiveSummary || analysis.availableInfo || `Executive summary for ${story.title}`,
      storyStatus: this.mapStoryStatus(analysis.storyStatus),
      timeline: this.buildTimeline(analysis),
      significance: {
        level: this.mapSignificanceLevel(analysis.significance?.assessment || analysis.significance),
        reasoning: analysis.significance?.reasoning || analysis.reason || "Moderate impact on regional affairs",
      },
      entities: this.buildEntities(analysis),
      sources: [{
        sourceName: "AI Analysis Source",
        articleIds: story.articleIds,
        reliabilityLevel: this.mapReliabilityLevel(analysis.signalStrength?.assessment),
        bias: analysis.signalStrength?.reasoning || "Minimal bias detected",
      }],
      factualBasis: this.extractFactualBasis(analysis),
      informationGaps: this.extractInformationGaps(analysis),
      contradictions: this.buildContradictions(analysis),
    };
  }

  /**
   * 转换为旧格式 - 向后兼容
   */
  static convertToLegacyFormat(report: IntelligenceReport): any {
    return {
      title: report.executiveSummary,
      executiveSummary: report.executiveSummary,
      storyStatus: report.storyStatus,
      significance: {
        assessment: report.significance.level,
        reasoning: report.significance.reasoning,
      },
      key_developments: report.factualBasis,
      stakeholders: report.entities.map(e => e.name),
      implications: report.informationGaps,
      outlook: report.storyStatus,
    };
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  private static generateStoryId(title: string): string {
    return `story-${title.toLowerCase().replace(/\s+/g, "-")}`;
  }

  private static createDefaultTimeline(): TimelineEvent[] {
    return [{
      date: new Date().toISOString(),
      description: "Initial event",
      importance: "HIGH",
    }];
  }

  private static mapStoryStatus(status: string): "DEVELOPING" | "ESCALATING" | "DE_ESCALATING" | "CONCLUDING" | "STATIC" {
    const statusMap: Record<string, any> = {
      'developing': 'DEVELOPING',
      'escalating': 'ESCALATING',
      'de-escalating': 'DE_ESCALATING',
      'concluding': 'CONCLUDING',
      'static': 'STATIC',
    };
    
    return statusMap[status?.toLowerCase()] || 'DEVELOPING';
  }

  private static mapSignificanceLevel(level: string): "CRITICAL" | "HIGH" | "MODERATE" | "LOW" {
    const levelMap: Record<string, any> = {
      'critical': 'CRITICAL',
      'high': 'HIGH', 
      'moderate': 'MODERATE',
      'medium': 'MODERATE',
      'low': 'LOW',
    };
    
    return levelMap[level?.toLowerCase()] || 'MODERATE';
  }

  private static mapReliabilityLevel(level: string): "VERY_HIGH" | "HIGH" | "MODERATE" | "LOW" | "VERY_LOW" {
    const levelMap: Record<string, any> = {
      'very high': 'VERY_HIGH',
      'high': 'HIGH',
      'moderate': 'MODERATE', 
      'medium': 'MODERATE',
      'low': 'LOW',
      'very low': 'VERY_LOW',
    };
    
    return levelMap[level?.toLowerCase()] || 'MODERATE';
  }

  private static buildTimeline(analysis: any): TimelineEvent[] {
    if (Array.isArray(analysis.timeline)) {
      return analysis.timeline.map((event: any) => ({
        // 不拿 new Date() 兜底：生成时刻会被下游简报生成器当成事件"权威时间戳"，
        // 把所有事件盖成同一个当天日期（run 52 环1审计头号缺陷）。LLM 没给就留空，
        // 下游按"无权威日期"处理，从 description 文本取真实日期，而非编造。
        date: event.date || "",
        description: event.description || "Timeline event",
        importance: this.mapTimelineImportance(event.importance),
      }));
    }
    
    return this.createDefaultTimeline();
  }

  private static mapTimelineImportance(importance: string): "HIGH" | "MEDIUM" | "LOW" {
    const importanceMap: Record<string, any> = {
      'high': 'HIGH',
      'medium': 'MEDIUM',
      'moderate': 'MEDIUM',
      'low': 'LOW',
    };
    
    return importanceMap[importance?.toLowerCase()] || 'MEDIUM';
  }

  private static buildEntities(analysis: any): Entity[] {
    // 模型实际把 keyEntities 直接输出成数组（prompt 写的是 keyEntities.list，但输出常扁平化）；兼容三种形态
    const list = Array.isArray(analysis.keyEntities)
      ? analysis.keyEntities
      : Array.isArray(analysis.keyEntities?.list)
        ? analysis.keyEntities.list
        : Array.isArray(analysis.entities)
          ? analysis.entities
          : null;
    if (list) {
      return list.map((entity: any) => ({
        name: entity.name || "Unknown Entity",
        type: entity.type || "Unknown",
        role: entity.role || entity.description || "Unknown Role",
        positions: Array.isArray(entity.positions) ? entity.positions : [],
      }));
    }

    // 真没有就返回空，绝不注入 "Entity 1" 占位符污染下游 brief
    return [];
  }

  private static extractFactualBasis(analysis: any): string[] {
    if (Array.isArray(analysis.factualBasis)) {
      return analysis.factualBasis;
    }
    // prompt 不产 factualBasis，但 timeline 就是按时序的事实发展——用它作为关键发展
    if (Array.isArray(analysis.timeline)) {
      return analysis.timeline
        .map((e: any) => (typeof e === 'string' ? e : e?.description))
        .filter((s: any): s is string => typeof s === 'string' && s.trim().length > 0);
    }
    // 真没有就返回空，绝不注入 "Fact 1/Fact 2" 占位符
    return [];
  }

  private static extractInformationGaps(analysis: any): string[] {
    if (Array.isArray(analysis.informationGaps)) {
      return analysis.informationGaps;
    }
    
    if (Array.isArray(analysis.gaps)) {
      return analysis.gaps;
    }
    
    return ["Gap 1"];
  }

  private static buildContradictions(analysis: any): Contradiction[] {
    if (Array.isArray(analysis.contradictions)) {
      return analysis.contradictions.map((contradiction: any) => ({
        issue: contradiction.issue || "Contradiction",
        conflictingClaims: Array.isArray(contradiction.conflictingClaims) 
          ? contradiction.conflictingClaims 
          : [],
      }));
    }
    
    return [];
  }
} 