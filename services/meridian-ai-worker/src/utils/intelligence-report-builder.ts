import { IntelligenceReport, Story } from '../types/intelligence-types';

/**
 * 情报报告构建器。
 *
 * **2026-09-09 拆掉了整形层。** 之前这里有一串 `buildXxx` / `extractXxx` / `mapXxx`，
 * 职责是把模型的自由 JSON 映射成固定形状。那一层是静默丢内容的源头：
 *
 * - `buildContradictions` 只认 `{issue, conflictingClaims}`，而模型簇 0 给
 *   `{field, conflictingInformation}`、簇 3 给纯字符串——两种都认不出，一律兜底成
 *   `{issue:"Contradiction", conflictingClaims:[]}`。**内容丢光，不报错不留日志。**
 * - `extractFactualBasis` 在模型没产该字段时拿 `timeline.description` 顶替，于是写作层
 *   读到两份逐字相同的内容，第二份还被渲染成「关键发展」。
 * - `toStringList` 那段注释记着的 `[object Object]` 事故是同一类：模型给对象、模板串插值。
 *
 * 现在报告是「薄 JSON 外壳 + markdown 正文」：代码只寻址 `executiveSummary` 和 `status`，
 * `body` 原样透传给渲染层，形状对不上的可能性归零。
 */
export class IntelligenceReportBuilder {

  static buildFromAnalysis(story: Story, analysis: any): IntelligenceReport {
    // 分析失败或为空直接抛，不构造占位报告——占位会把"这篇没分析成"伪装成"分析出来是空的"
    if (!analysis || analysis.status === 'incomplete') {
      throw new Error(`AI analysis failed or incomplete for story: ${story.title}`);
    }

    const executiveSummary = analysis.executiveSummary || analysis.availableInfo || '';
    const body = typeof analysis.body === 'string' ? analysis.body : '';

    // 两个字段任一为空都说明模型没按新形状产出（换模型/prompt 漂移）。不静默兜底：
    // 空 body 会让写作层拿到一份只有摘要的报告，读起来像"这件事本来就没什么可写"。
    if (!executiveSummary.trim()) {
      throw new Error(`报告缺 executiveSummary（模型未按形状产出）: ${story.title}`);
    }
    if (!body.trim()) {
      throw new Error(`报告缺 body（模型未按形状产出）: ${story.title}`);
    }

    return {
      storyId: this.generateStoryId(story.title),
      status: "COMPLETE",
      executiveSummary,
      body,
    };
  }

  private static generateStoryId(title: string): string {
    return `story-${title.toLowerCase().replace(/\s+/g, "-")}`;
  }
}
