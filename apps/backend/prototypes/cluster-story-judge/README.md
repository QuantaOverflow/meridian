# 「一簇 → 一个 story」判官原型（用完即弃）

**问题**：聚类换成不降维凝聚后，一簇 ≈ 一件事（F2 簇纯度 0.804），但还剩两个残渣——18% 的簇是「只有题材没有事」的题材袋，交付簇里还有约 20% 的文章不属于主事件。这两件事能不能由写 story 的那次 LLM 调用顺手做掉？**而且只喂已有的结构化字段、不传正文，够不够判？**

判官被问三件事：

```json
{ "verdict": "EVENT | NO_EVENT | UNSURE", "event": "...", "excluded_ids": [...], "reason": "..." }
```

分三档而不是二档，是因为本仓库踩过两个坑：

- 让 LLM 拒绝整簇 = 簇级硬门的 LLM 版，全有全无。零 LLM 的硬门就这么把 8 篇 NASA 望远镜簇、11 篇阿富汗驱逐簇整个抹掉过 → 必须能区分 NO_EVENT 与「拿不准」，也必须区分「模型说没故事」与「调用失败」
- 篇级排除安全（每篇一个是非题），让它划分整簇是已证伪的（91 篇 12 轮只 1 轮把 id 分对）→ 所以只问「哪几篇不属于」，不问「这簇该切几块」

## 跑

先起 ai-worker（Workers AI binding 在本地 `wrangler dev` 直接可用，不用 `--remote`）：

```bash
cd services/meridian-ai-worker && pnpm wrangler dev --port 8787
```

然后：

```bash
cd apps/backend/prototypes/cluster-story-judge
pnpm run go                    # F2 / t=0.10 / 两个字段档 / 各 12 个簇 = 24 次调用
pnpm run go -- F1 0.08 rich 4  # 自定义：窗口 阈值 字段档 每类抽几个
pnpm run review                # 读缓存逐簇看判官说了什么，不再打 LLM
```

模型与生产 `storyline_plan` 同档：Workers AI `@cf/zai-org/glm-4.7-flash`、temperature 0、跳缓存。

## 两个字段档

| 档 | 喂什么 |
|---|---|
| `titles` | 只有 `[id] 标题` |
| `rich` | 标题 + `primary_location` + `event_summary_points`（前 4 条）+ `key_entities`（前 6 个） |

字段都来自 `fixture-F{1,2}-text-fields.jsonl`（文章分析阶段已经产出，生产里现成可用）。

## 抽样

从金标推出每个簇的真相，抽两类各 6 个：

- **题材袋**：簇里没有任何一个金标事件占到 ≥2 篇 → 期望判官说 `NO_EVENT`
- **含杂质的真事件簇**：纯度 0.5–0.95 → 期望判官说 `EVENT` 且把杂质篇放进 `excluded_ids`

## 读结果时注意

金标按「同一个 happening」判，产品要的是「够写简报一段」，两者在小簇上会分歧（尼日利亚绑架 3 篇、孟买司机学马拉地语 3 篇——金标说不是一件事，产品口径可能觉得是）。**判官在这类簇上说 EVENT 未必是错**，看 `pnpm run review` 里的理由再定，别只看聚合数字。

## 结论落在哪

`judge.ts` 是纯函数（prompt 构造 / 解析 / 与金标比对），验完可整块搬进 ai-worker。`run.ts` / `review.ts` 是驾驶台，不进生产。
