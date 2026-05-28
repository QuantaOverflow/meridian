// 从 brief 抽出的一条原子事实陈述
export interface Claim {
  id: number;
  text: string;
}

// 单条 claim 的裁决
export type FaithVerdict = 'supported' | 'unsupported' | 'contradicted';

export interface ClaimJudgement {
  claim: Claim;
  verdict: FaithVerdict;
  // judge 给出的源文引用原句；supported 时必须非空且能在 source 里找到
  evidence_quote: string;
  // evidence_quote 是否真的在 source 中找到（程序校验，judge 说了不算）
  evidence_verified: boolean;
  reason: string;
}

// 一份 brief 的忠实性评估结果
export interface FaithfulnessReport {
  workflow_id: string;
  judge_model: string;
  checked_at: string;
  // 源材料是什么（v1：brief 合成步骤的 LLM 输入，即 intel reports）
  source_layer: 'brief_vs_intel_input';

  total_claims: number;
  supported: number;
  unsupported: number;
  contradicted: number;

  // 连续信号：看趋势用
  faithfulness_score: number; // supported / total_claims
  // 二元闸门：是否有矛盾（编造与源相反的事实），任何 >0 都该 FAIL
  gate_pass: boolean; // contradicted === 0

  // 需要人看的：所有非 supported 的 claim
  flagged: ClaimJudgement[];
  // 完整明细（调试/校准用）
  judgements: ClaimJudgement[];
}
