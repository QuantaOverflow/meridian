// claim 类型：事实陈述 vs 分析推断
export type ClaimType = 'factual' | 'analytical';

// 从 brief 抽出的一条原子陈述
export interface Claim {
  id: number;
  text: string;
  type: ClaimType;
}

// factual claim 的裁决（强制取证）
export type FaithVerdict = 'supported' | 'unsupported' | 'contradicted';

export interface FactualJudgement {
  claim: Claim;
  verdict: FaithVerdict;
  evidence_quote: string;
  evidence_verified: boolean; // evidence_quote 是否真能在 source 找到（程序校验）
  reason: string;
}

// analytical claim 的裁决（一致性，不要求字面 grounding）
export type AnalyticalVerdict = 'consistent' | 'contradicts_facts';

export interface AnalyticalJudgement {
  claim: Claim;
  verdict: AnalyticalVerdict;
  reason: string;
}

// 一份 brief 的忠实性评估结果
export interface FaithfulnessReport {
  workflow_id: string;
  judge_model: string;
  checked_at: string;
  source_layer: 'brief_vs_intel_input';

  total_claims: number;
  factual_claims: number;
  analytical_claims: number;

  // === 事实通道（headline）===
  supported: number;
  unsupported: number;
  contradicted: number;
  // 只在 factual claim 上算：事实陈述里有多少能落到源
  factual_faithfulness: number; // supported / factual_claims
  gate_pass: boolean; // contradicted === 0

  // === 分析通道（次级信号）===
  analytical_consistent: number;
  analytical_contradicting: number; // 分析建立在与源矛盾的前提上——也危险

  // 需要人看的：未 supported 的 factual + contradicts_facts 的 analytical
  flagged_factual: FactualJudgement[];
  flagged_analytical: AnalyticalJudgement[];

  // 完整明细
  factual_judgements: FactualJudgement[];
  analytical_judgements: AnalyticalJudgement[];
}
