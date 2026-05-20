# Story Validation Eval Framework v1 — 设计文档

> 创建日期：2026-05-20
> 目标 reader：本人 + 未来回来 review 的我
> 状态：v1 已设计，待实现

---

## 1. 背景与动机

Meridian 简报生成链路里，**story validation** 这一步把 HDBSCAN cluster 喂给
LLM 判定，输出 "valid stories" 列表，决定下游 intelligence 分析跑哪些主题。
近期两轮 prompt 修改的效果都靠肉眼 review 19 个故事标题判断 —— 不 scalable，
也无法量化任何代码改动的真实影响。

具体证据（brief #7，2026-05-20）：26 个候选 → 19 valid（LLM 通过）。人工
review 后只有 ~11 真实独立故事 + 3 合理合并 + **5 个被 LLM 强行用主题词
黏合的拼盘**。

需要一个**可重复运行、有客观指标**的 eval 框架来：
1. 量化每次 prompt/代码改动对 story 质量的影响
2. 暴露 LLM judge 与人工判断的偏差（防止盲调 judge prompt）
3. 让 "我修了 prompt，质量好了" 这句话有数据支撑

## 2. 范围（v1）

**In-scope**：story validation 这一步的输出质量评估。
**Out-of-scope**（留给 v2/v3）：
- 聚类质量评估
- intelligence/brief 层评估
- Web UI
- CI 集成
- 评估结果持久化到 DB

## 3. 架构

```
meridian/
├── apps/backend/src/workflows/auto-brief-generation.ts   # 1 行改：observability 写完整 stories[]
└── scripts/eval/story-validation/
    ├── score.ts          # 主入口
    ├── judge.ts          # LLM-as-judge prompt + qwen 调用
    ├── heuristics.ts     # 规则检查
    ├── calibration.json  # 19 个人工标签（来自 brief #7）
    ├── report.ts         # markdown 报告生成
    └── types.ts          # 共享类型
└── eval-reports/         # 输出目录，gitignored
```

### 3.1 Prerequisite 改动

`auto-brief-generation.ts:726-729` 的 `logStep('story_validation', 'completed', ...)` payload
从只含计数扩展为含完整 `stories[]` 和 `rejectedClusters[]`：

```ts
await observability.logStep('story_validation', 'completed', {
  validStoriesCount: validatedStories.stories.length,
  rejectedClustersCount: validatedStories.rejectedClusters.length,
  stories: validatedStories.stories,            // ← 新增
  rejectedClusters: validatedStories.rejectedClusters,  // ← 新增
});
```

Eval 脚本从 `observability/workflow_<id>_*.json` 这条 R2 路径读 —— 具体走
`GET http://localhost:8787/observability/workflows/:key`（已存在的 backend
endpoint），脚本本身不需要任何 R2 SDK 访问。

### 3.2 Eval 脚本用法

```bash
# 基本评估
pnpm tsx scripts/eval/story-validation/score.ts \
  --workflow admin-brief-1779253365414

# 同时与 calibration set 算 precision/recall
pnpm tsx scripts/eval/story-validation/score.ts \
  --workflow admin-brief-1779253365414 \
  --calibrate

# 输出：eval-reports/<workflowId>.md
```

## 4. 评分逻辑（hybrid）

### 4.1 Heuristic 层（先跑、毫秒返回）

对每个 valid story 检 4 条规则，命中即记一个 flag：

| Flag | 触发条件 | 含义 |
|---|---|---|
| `padded_title` | 标题含 ` and ` / `+` / `; ` 连接不同命名实体 | LLM 把多事件强黏到一起 |
| `low_support` | `articleIds.length < 3` | 证据不足，本来就是噪声温床 |
| `split_overlap` | 同 articleId 出现在多个 story | cluster 被强行拆开导致语义重叠 |
| `geo_stuffing` | 标题命中 2+ 不同 region/domain token（见下方静态列表） | umbrella 模式只是换了个 label |

> region/domain token 静态列表（v1）：`["Middle East", "Latin America",
> "Caribbean", "East Asia", "Europe", "US", "Africa", "Israel", "Gaza",
> "Ukraine", "Russia", "China", "Spain", "Australia", "Cybersecurity",
> "AI", "Sports", "Politics", "Legal"]`。Case-insensitive substring 匹配，
> 命中 ≥2 个不同 token 即触发。后续可扩或迁移到 LLM-NER。

实现：纯字符串/集合操作，无外部依赖。

### 4.2 LLM-as-judge 层

对每个 valid story 单独调一次 qwen-plus，输入：
- story 标题
- importance / articleIds.length
- 所有命中文章的 `title` + `event_summary_points`（从 articles 表/数据集查）

输出严格 JSON：
```json
{
  "verdict": "REAL" | "BORDERLINE" | "FAKE",
  "coherence": 1-5,
  "title_fit": 1-5,
  "reason": "短句解释"
}
```

调用参数：`temperature=0`, `max_tokens=300`, 走 ai-worker 现有 dashscope provider。

### 4.3 终裁决合并

```
if heuristic flags >= 2:
    verdict = downgrade(judge.verdict, max="BORDERLINE")
else:
    verdict = judge.verdict
```

理由：heuristic 命中 2 条以上说明结构性问题严重，不允许 judge 给 REAL。

## 5. Calibration & 指标

### 5.1 Calibration set

`calibration.json`：

```json
{
  "source": "brief #7 / admin-brief-1779253365414 / 2026-05-20",
  "labels": [
    {"title": "Middle East — Israel-Gaza conflict: ICC arrest claims, Gaza flotilla interception, US sanctions, and East Jerusalem demolitions", "expected": "BORDERLINE", "note": "4 events under one tight umbrella, debatable"},
    {"title": "Latin America — Bolivia anti-government protests and Mexico ex-officials surrender over cartel ties", "expected": "FAKE", "note": "two unrelated events"},
    ...
  ]
}
```

19 条记录，由 2026-05-20 上午人工 review 产生。

### 5.2 指标

当 `--calibrate` 时，把 eval 结果与 calibration set join（按 title 精确匹配；
找不到则跳过并 warning），计算：

| 指标 | 定义 |
|---|---|
| Precision | 判 REAL 中真 REAL 的比例 |
| Recall | 真 REAL 中被判 REAL 的比例 |
| F1 | 调和平均 |
| 3×3 混淆矩阵 | ground truth (REAL/BORDERLINE/FAKE) × judge verdict |

报告里会显式标 **"low-N warning, n=19"** 提醒指标统计弱。

### 5.3 跨版本对比

每份报告头部记录：

```yaml
workflow_id: admin-brief-1779253365414
prompt_hash: a3f12b89  # sha1(prompts/storyValidation.ts).slice(0,8)
judge_model: qwen-plus
eval_timestamp: 2026-05-20T13:30:00Z
```

后续多份报告可以手工 diff 或维护 `eval-reports/_summary.tsv`
（`prompt_hash, quality_rate, calibration_f1, timestamp`）追势。

## 6. 输出报告样式

```markdown
# Eval Report — admin-brief-1779253365414

## Run metadata
- prompt_hash: a3f12b89
- judge_model: qwen-plus
- eval_timestamp: 2026-05-20T13:30:00Z

## Aggregate
- candidates: 26
- llm passed: 19
- after eval: 11 REAL / 3 BORDERLINE / 5 FAKE
- quality rate (REAL/total passed): 58%

## Per-story
| # | title | judge | heuristics | final |
|---|---|---|---|---|
| 1 | Middle East ... | BORDERLINE | geo_stuffing | BORDERLINE |
| 2 | Latin America — Bolivia ... and Mexico ... | FAKE | padded_title, geo_stuffing | FAKE |
| ... |

## Calibration (n=19, low-N warning)
- precision: 0.83
- recall: 0.91
- F1: 0.87
- Confusion matrix:
       judge→  REAL  BORDERLINE  FAKE
       REAL    10    1           0
       BORD    1     2           0
       FAKE    1     0           4
```

## 7. 风险

| 风险 | 缓解 |
|---|---|
| LLM judge 自身偏见 | Calibration metrics 暴露；F1 < 0.7 时报告 warning，强制先调 judge prompt |
| Calibration set 太小 (n=19) | 报告显式 low-N warning；后续扩到 50+ 再做严格 trend 判断 |
| Title 精确匹配在 prompt 改动后失效（同一故事标题会变） | v1 接受；v2 用 articleIds 集合匹配做模糊对齐 |
| Judge prompt 自身也是一个变量 | 报告记录 `judge_model + judge_prompt_hash`，judge 变动时所有历史数据需要重新跑 |

## 8. YAGNI 砍掉

- Web UI / dashboard
- CI 集成（手动跑）
- 评估结果落 DB（写文件即可）
- 评 intelligence / brief 层（v2）
- 自动正则修正 cluster（不在 eval 职责内）
- 多 judge 投票（先跑通单 judge 再考虑）

## 9. 后续 v2 候选

- Calibration set 扩到 50+（再标 brief #6 等历史 brief）
- Eval 也对 brief 输出做 LLM-as-judge（事实准确、信息密度、TLDR 一致性）
- `eval-reports/_summary.tsv` 自动维护，画 trend 图
- 多 judge 投票（qwen-plus + claude-haiku）
- 把 heuristic 规则迁移到 storyValidation prompt 里做前置过滤
