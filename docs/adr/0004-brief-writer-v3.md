# ADR 0004：写作层 v3（一个簇的报告 → 一块正文）与关系级事实错的检测上限

- 状态：已采纳，已上线（2026-09-15 部署，2026-09-21 并入 brief-block-v6，见 commit `961aeca`；详见 `docs/ROADMAP.md`）
- 日期：2026-09-12
- 原型与调研笔记只在作者本地（不入 git），下面引用的路径以本 ADR 的结论为准
- 相关：ADR 0003（一簇即一条）、`apps/backend/prototypes/brief-writer-v3/`、`apps/backend/prototypes/local-grounding/`、
  `docs/engineering-notes/relation-level-factual-errors.md`、`faithfulness-advances-2025-2026.md`、`llm-observability-integration-patterns.md`

## 背景

旧写作链（`BriefGenerationService.writeBriefBlock`）每块 7 次 LLM 调用：声明判断 → 写 → 找漏两步 → 重写 → RARR 两步。
成品里出现过：复读 80 遍漏进正文、流水线措辞漏进正文、专名写错、全小写吃坏人名。报告层同期改成 report-v3
（`apps/backend/prototypes/srl-extractive/fixtures/report-v3/`：带出处的事实、当事方、分歧、全部原句）。

## 决定：现行流程（`services/meridian-ai-worker/src/services/brief-writer-v3.ts`，端点 `POST /meridian/write-block-v3`）

```
1 要点    骨架事实（≥2 篇报道），按出处文章最早的完整发布时间排序            代码
2 原话    原句里的逐字引语 + 具名说话人（不取自残句）                       代码
3 渲染    要点 + 人物（名字+身份）+ 原话 + 分歧；不给报告概述、不给立场句    代码
4 关系表  原文明说的先后 / 回应 / 数字更新 / 说法冲突 / 将来，每条带出处      LLM
5 写      照关系表写：更新只写最新值，冲突写两个具体版本，将来用将来时        LLM
6 接地    名字/数字不在材料里、引语不逐字 → 点名修 1 次 → 删句 / 去引号       代码（+ 偶尔 1 次 LLM）
7 长度    只在超硬上限时删尾句（头条 2,400 / 要闻 1,100 / 简讯一句 ≤200）      代码
```
写作模型 `@cf/zai-org/glm-4.7-flash`，每块 2 次调用、头条约 16 秒。三层长度：头条 1,200–2,000、要闻 500–900、简讯一句。正常大小写。

## 实测读数（4 簇 fixture，盲审由 Claude subagent 逐句对照原句）

| | 头条调用 | 覆盖（头条/要闻） | 关系错 / 10 句 |
|---|---|---|---|
| Goal 1（证据链 + 补漏 loop + 长度重写） | 9.5 | 87% / 71% | — |
| Goal 2（写前定要点、原话通道，去 loop） | 1 | 89% / 77% | 2.03 |
| Goal 3（加关系表，现行） | 2 | 89% / 71% | 1.37（时序错 9→3；错接 8→7 没动） |

同一批 16 块两次独立盲审给出 21 / 20 处，判官读数稳定；但两次逐句重合只有约六成，比例别当精确值。

## 证伪清单（别再走）

- **补漏 loop（找漏 → 检索 → 重写）**：覆盖只 +4–6 点，每块多 4–6 次调用，把新材料贴文末、补边角事实；去掉后覆盖反而更高
- **RARR 默认开**：分段写那轮 78 条修改只落地 10 条；核对依据是报告不是原文；prompt 纠错精度天生低（调研：GPT-4 28.5%）。代码保留，默认关
- **为长度让模型重写**：「压到 X 字符」实测多次原样返回；长度改为 prompt 目标 + 超上限才删尾句
- **「措辞修正」躲概述片段重合**：按词面挑参照事实，把简讯换成另一件事。概述、立场不进材料即可
- **换更大的写作模型**：llama-3.3-70b 关系错 1.29/10 句（≈glm），成本 5×；gpt-oss-120b 2.85/10 句，成本 11×。模型变大只换错法
- **每句只依据 1–2 条要点写**：头条缩到 530 字符、覆盖跌破门；照此做法不可用（方向本身未证伪，长度问题没解决）

## 检测：用 Workers AI 能做到的上限（只标记，不自动改稿）

| 检测器 | 召回 | 精度 | 成本 |
|---|---|---|---|
| 代码：逐句对齐到要点、在其出处里查数字/专名/说话人（`local-grounding/fact-*.ts`） | ~45–49% | ~36–47% | 0 |
| gpt-oss-120b 逐句判官，带检索证据 + 同类错误示例（`local-grounding/judge/`） | 82% | 42% | ~$8–16/月 |
| gpt-oss-120b 整簇长上下文判官（`local-grounding/agent-loop/`） | 26% | 68% | 同量级 |
| 按组成部分（引语/数字/时间/同姓人名）全文找证据（`local-grounding/components/`） | 证据命中 78% | 代码直接判 22–24% | 0 |

- 误报 / 漏报的共同根因：给判官的证据没覆盖关键原句；按「与成稿相似」检索会捞回支持错误说法的材料
- Claude 盲审准，是因为强模型把整簇原文读进上下文一遍判（两轮 80 条只调 30 次工具），不是检索或循环；Workers AI 模型复制不了
- 结论：关系错是小模型融合多条事实时产生的，**便宜模型的写作与检测都已接近上限**。要放心发布，需要发布前的强判官（离线 Claude）或人工把关

## 配套

- 观测：`services/observe.ts` 的 `traced()` + `x-observe: inline`，新组件每步包一行即可（见 `docs/OBSERVABILITY_GUIDE.md` 第 5 节）
- 验收：`apps/backend/prototypes/brief-writer-v3/verify.ts`（`--replay` 可重判落盘不重新生成）
- 开发期判官用 Claude subagent 或 codex，不花 Workers AI 的钱
- **证据链与证伪清单的可查索引**：`docs/knowledge/INDEX.md`（按「你要做什么」分组；本 ADR 的
  证伪条目在那里各有一个节点，带不变量、失效条件与读数出处）。开新 spike 前先查那份索引

## 未做

- backend workflow 接线（等报告层 v3 上生产）
- 线上检测器接入与「发布前离线 Claude 审稿」的产品决定
- 错误来源归因（报告层 vs 写作层）未统计
