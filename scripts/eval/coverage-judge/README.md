# 覆盖对账判官 meta-eval（洞3 `reconcileCoverage` 的 κ 验证）

验「简报覆盖对账」LLM 判官这把尺本身：它逐条判候选 story 在成品简报里的去向
`{headline | noteworthy | dropped}`，消费口径 `selected_for_intel=true 且 disposition=dropped`
= **合成层漏报**。error-analysis 路2 的头号结论"合成漏报占缺陷 68%"就建在它身上——
**没 κ 验之前不能信、更不能据此修**（铁律见 `docs/eval-playbook.md` §2）。

## 母集团
到达合成层的 story = `brief_stories.selected_for_intel=true` 且 `intel_report_r2_key` 非空
（选中但分析静默失败 = 无报告 = 不在判官对账范围，正确排除）。取自 error-analysis 路2 的
8 条真实 brief（`admin-brief-*`），共 ~112 story-disposition 组。

## 三尺三角测量（避 self-preference）
| 尺 | 家族 | 强/弱 |
|----|------|-------|
| `judge`（被验对象）| qwen-long（与简报生成同家族→自偏风险，正是要验的）| 三分类 |
| `codex`（第二标注）| GPT（异家族）| 三分类 |
| `det`（对齐器）| 无 LLM，专有名词加权词汇重叠 | dropped/covered 强，headline/noteworthy 弱 |

**共同标注 + 分歧人裁**：三者一致→暂定 gold（抽查）；分歧→人以仁慈独裁者身份裁定写回 `gold.jsonl`。

## 流程
```bash
pnpm install --ignore-workspace          # 本地 node_modules

# ⚠️ 网络：本机 fetch 打 *.workers.dev 偶发 `fetch failed`/timeout（曾让判官收到空响应→兜底全 dropped→
#    污染中间数据；后加"0行重试"修复）。真正的防护 = run-judge 内的重试+并发克制，不是换代理。
#    （注意：undici fetch 裸 export HTTPS_PROXY 无效，须配 NODE_USE_ENV_PROXY=1 才真走代理；
#     实测走代理 vs TUN 直连稳定性几乎无差，别指望换代理能治本。见 memory network-deploy-cf。）

# 1) 重建判官输入 + 跑决定论对齐尺（DB + R2；缓存到 .r2cache/，重跑只补失败项）
DATABASE_URL=postgres://... pnpm worklist
#   → worklist/<wf>.json（判官输入 fixture）+ worklist.jsonl（每 story 一行 + det 票）

# 2) 跑被验判官（qwen-long temp0，RUNS=3 取多数 + 记翻转率）
AI_WORKER_URL=... RUNS=3 pnpm judge      # → judge-labels.jsonl

# 3) codex（GPT）第二标注 → codex-labels.jsonl（见下"codex 标注"）

# 4) 三尺合并 → 暂定 gold + 分歧清单
pnpm colabel                             # → colabel.jsonl / provisional-gold.jsonl / disagreements.md

# 5) 人裁 disagreements.md，把裁定 + provisional-gold 合并成 gold.jsonl

# 6) 验尺：κ + per-class + 决策级 dropped precision/recall
pnpm meta                                # gate: 三分类 κ≥0.6 且 dropped precision≥0.8 → exit 0
```

## 关键指标
- **三分类 κ**（headline/noteworthy/dropped）：≥0.6 尺才可信。
- **决策级二分类（covered vs dropped）**：`dropped precision` = 判官喊 dropped 里真为 dropped 的占比。
  判官兜底默认 dropped（漏判/乱答都算 dropped）→ 偏向多报漏报 → **precision 是头号看点**：
  会不会把其实覆盖了的 story 误判 dropped，从而虚增"合成漏报"计数。

## codex 标注（第二标注器）
让 codex（GPT）用与判官**同一 rubric** 独立标注每条 story，输出 `codex-labels.jsonl`
（每行 `{"id":"<wf>#S<n>","codex_disposition":"dropped"}`）。rubric 见
`services/meridian-ai-worker/src/prompts/briefGeneration.ts` 的 `getBriefCoverageReconciliationPrompt`。
异家族独立标注是为对抗 qwen 判官的 self-preference（生成+裁判同家族偏松）。

## 忠实点（对齐生产）
- 顺序：`analysisData` 顺 = intel step 顺 = R2 key idx 昇序 → S1..Sn 与生产一致。
- 标签：`executiveSummary.replace(/\s+/g,' ').trim().slice(0,160)`（与 `reconcileCoverage` 完全一致）。
- 判定兜底：漏判/非法 disposition → dropped（与 runtime 完全一致）。

## 结果（2026-07-03 首验）
gold=112（77 三尺一致 + 16 grounded + 2 人裁 + 17 headline↔noteworthy 多数）。**PASS**：
- 三分类 Cohen's κ = **0.965**；决策级(covered/dropped) κ = **0.968**
- **dropped precision = 1.000**（判官喊的 18 条 dropped 全真 → 不虚增合成漏报）
- dropped recall = 0.947（19 真漏报抓 18，漏 1=Lebanon 边界例，判官偏 over-covered）
- 错配仅 2/112，均为判官「偏松/over-covered」方向，与 qwen 同家族 self-preference 一致 → 漏报读数偏保守而非偏高。
报告见 `eval-reports/coverage-meta-*.json`。**结论：判官逻辑可信，可据 dropped 说合成漏报——但先修下条的可靠性缺陷。**

## 坑
- **判官可靠性缺陷（本轮实测，头号）**：`reconcileCoverage` 兜底「漏判/坏响应→dropped」会把**一次间歇 API 空响应**
  变成「整篇 story 全判 dropped」的假漏报。生产无重试、无 RUNS，单次坏响应即一整篇假合成漏报（本轮 8 简报里
  1 篇因此从 4 漏报虚增到 15）。本 harness `run-judge` 已用「0 行响应即重试」区分 call 失败 vs 真判决，
  并 RUNS=3 取多数（翻转 14%→1%）；**生产端建议同样加固（重试+至少校验返回行数）后再信聚合 dropped 数**。
- **根 `.gitignore:34` 裸 `coverage`** 会连坐名为 `coverage` 的目录 → 本 harness 故命名 `coverage-judge/` 规避
  （`coverage-judge` ≠ `coverage` 不被匹配）。价值 eval 必须进 git（memory `commit-philosophy-eval`）。
- 母集团忠实性两坑（已修）：R2 取报告经代理不稳会静默丢 story（→缓存+重试+并发+硬失败中止）；最老 run 用旧
  schema（仅 `overview`）会得空 label（→复现 index.ts:463 兜底链 `executiveSummary||overview||summary||'发展概述'`）。
- 判官只覆盖合成层（intel→brief）。选择层漏报（15 上限砍掉/无 intel 报告）不在本尺范围。
