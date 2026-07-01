// Intel-grounding eval 类型 —— 与 faithfulness 同构（被评对象换成"情报报告 vs 输入文章"）。
// 复用 faithfulness 的 verdict 体系：judge 判 intel report 的每条 claim 在源文章里 supported/unsupported/contradicted。

export type ClaimType = 'factual' | 'analytical';

// 从情报报告抽出的一条原子陈述
export interface Claim {
  id: number;
  text: string;
  type: ClaimType;
  // 该 claim 出自报告的哪个字段（executiveSummary / timeline / contradictions ...），仅作审计溯源
  field?: string;
}

// factual claim 的裁决（强制取证）
export type FaithVerdict = 'supported' | 'unsupported' | 'contradicted';

export interface FactualJudgement {
  claim: Claim;
  verdict: FaithVerdict;
  evidence_quote: string;
  evidence_verified: boolean;
  reason: string;
}

// analytical claim 的裁决（一致性，不要求字面 grounding）
export type AnalyticalVerdict = 'consistent' | 'contradicts_facts';

export interface AnalyticalJudgement {
  claim: Claim;
  verdict: AnalyticalVerdict;
  reason: string;
}

// 一份情报报告的 grounding 评估结果
export interface IntelGroundingReport {
  workflow_id: string;
  story_ref: string; // intel call 的 key 或 storyId，定位是哪个 story 的报告
  judge_model: string;
  checked_at: string;
  source_layer: 'intel_report_vs_input_articles';

  total_claims: number;
  factual_claims: number;
  analytical_claims: number;

  // === 事实通道（headline）===
  supported: number;
  unsupported: number;
  contradicted: number;
  factual_groundedness: number; // supported / factual_claims
  gate_pass: boolean; // 报告没有编造（无 contradicted、无建立在虚构前提上的分析）

  // === 分析通道 ===
  analytical_consistent: number;
  analytical_contradicting: number;

  flagged_factual: FactualJudgement[];
  flagged_analytical: AnalyticalJudgement[];

  factual_judgements: FactualJudgement[];
  analytical_judgements: AnalyticalJudgement[];
}
