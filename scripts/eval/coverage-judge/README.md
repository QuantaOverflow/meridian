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

## regen-ab：合成漏报修复的离线 A/B 复测（2026-07-07）

19 条确证漏报的 open-code 归因（`../error-analysis/synthesis-omission-opencode.md`）→
改 `getBriefGenerationPrompt`（覆盖契约/如实告知重要性排序/noteworthy 兜底）后，用本尺+忠实度尺双向复测：

```bash
# 前置：本地 ai-worker（生产链路含 RARR）
cd services/meridian-ai-worker && pnpm wrangler dev --port 8787

# baseline 臂 = 旧 prompt（git stash 掉 prompt 改动，wrangler 热重载）；treatment 臂 = 新 prompt
AI_WORKER_URL=http://localhost:8787 ARM=baseline  pnpm regen-ab
AI_WORKER_URL=http://localhost:8787 ARM=treatment pnpm regen-ab
# 可选：RUNS=3(判官多数决) GEN_RUNS=1(每期生成份数) ONLY=<wf>(单期调试)
```

要点：原 8 期生产简报生成于 bc3f8a9(RARR+输入修复)之前，**不能当对照**——两臂都在 HEAD
重放生成，唯一变量=prompt。coverage 尺复用 fixture 的 storyList（story 集与序不变），
faithfulness 尺打 `/meridian/faithfulness-check`（源=同一渲染的 per-story 报告，两臂恒定）。
产出 `eval-reports/ab/<arm>/`。辅助开关：`SKIP_EXISTING=1` 断点续跑、`FAITH_ONLY=1` 只重跑门。

**结果（2026-07-07/08 三臂）**：dropped 13.4%(baseline)→6.2%(仅 prompt)→**0.0%(两遍法补录,
REPAIR=1)**，gold 19 条全救回；忠实度 twopass contradicted 7≈基线 6、unsupported 1.1% 全场最低。
注：twopass 批草稿全自覆盖、补录 0 次触发（尾部保险），插入路径已离线实测。明细与诚实注记见
`../error-analysis/synthesis-omission-opencode.md`。
两坑：AI Gateway 缓存相同生成请求（GEN_RUNS>1 测方差需绕）；最老 run 旧 schema 源渲染要
legacy 兜底（已修，否则 faithfulness 全 claim 假 unsupported）。

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
