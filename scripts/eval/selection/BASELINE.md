# Selection Layer NDCG Baseline

## 当前基线

| 指标 | 值 |
|------|----|
| NDCG@10 宏平均 | **0.958** |
| 覆盖度权重 W | 1.0 |
| importance rubric | 新 CoT 4-维 rubric (`4ebd969`) |
| gold 来源 | 5 run，2026-06-03 ~ 2026-06-04 |
| gold 类型 | silver 派生（人工快标），绝对值略乐观 |

## 历史对照

| 排序键 | NDCG@10 |
|--------|---------|
| 纯旧 importance（W=0） | 0.872 |
| 旧 importance + 覆盖度 | 0.890 |
| **新 CoT rubric + 覆盖度（当前）** | **0.958** |

rubric 是大头 (+0.068)，覆盖度是小补 (+0.018)。

## 注意事项

- **单点存疑**：UK-Rwanda 遣返协议终止，gold rel=2，新 rubric 打 imp=2（d=1001）。
  全 47 条 rel≥2 里仅此 1 条，n=1 无统计意义，**不要动 rubric**。
- W=1.0 处于最优平台（W ∈ [0.25, 1.0] NDCG 完全相同），无需校准 `COVERAGE_WEIGHT`。
- 0.958 由 `rescore.ts` 实时重打分算得（非 CSV 冻结分），每次跑约 117 次 LLM 调用。

## 回归闸使用

```
tsx rescore.ts --baseline 0.958 --tolerance 0.02
```

NDCG < 0.938（baseline − tolerance）时非零退出，表示 importance prompt 出现回归。
守的是 `services/meridian-ai-worker/src/prompts/storyValidation.ts`，改它必须过此闸。
