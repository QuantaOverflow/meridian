# 归因记录格式（洞2 · attributions.jsonl 的 schema）

`assemble-trace.ts` 只**取证**（拼病历袋），不判断。归因判断（"缺陷→层→性质"）是 error-analysis 那一步，由人 open-code。
以前这一步 100% 靠脑子、无结构化存储 → 上一轮 40 条判决蒸发，只剩聚合数。本文件定一个**便宜、可累加**的落盘格式把判决固化。

- 载体：`attributions.jsonl`，一行一条缺陷（JSON object）。
- 定位：不做 DB 表（避免过度设计）；JSONL 便于 append、diff、跨轮累加。
- 输入侧 = `traces/trace-<wf>.md`（病历袋）+ DB `reports.content`（简报正文）+ R2 情报报告。

## 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✓ | 稳定缺陷 id，格式 `<workflow_id>::c<cluster_id>::<n>`（run 级缺陷用 `::run::<n>`）。累加去重的主键。 |
| `workflow_id` | string | ✓ | 病历袋主键，对应 `brief_runs.workflow_id`。 |
| `cluster_id` | number \| null | ✓ | 缺陷锚定的簇；跨 story / run 级缺陷填 `null`。 |
| `layer` | enum | ✓ | 根因所在**管线层**，见下表。判"根因层"不是"表现层"。 |
| `defect_type` | enum | ✓ | 缺陷**性质**，见下表。 |
| `severity` | `minor` \| `major` | ✓ | major = 影响简报可信度/漏掉决策级事件；minor = 边角瑕疵。区分程序关心的"细微真错 vs 硬伤"。 |
| `evidence_quote` | string | ✓ | 支撑该判决的**原文引用**（简报/情报报告/簇成员），可缩略但须可回溯。 |
| `note` | string | ✓ | open-code 推理。**必须写清跨层溯源**（如"过了 selection+analysis，合成层 drop"），这是层归因的证据。 |
| `coded_at` | string (YYYY-MM-DD) | ✓ | 判决日期，跨轮累加的溯源。 |

## 受控词表

### `layer`（对齐 assemble-trace 的 ①–⑤ 记号）
- `scrape` — ① 抓取/解析（正文缺失、stub、乱码）
- `quality_gate` — ② 文章质量门（误降级 OK 新闻 / 放行垃圾）
- `clustering` — ③ 聚类（异题混入、同事件拆多簇）
- `selection` — 情报门/选择（15 上限截断、重要性误排）
- `analysis` — ④ 情报分析（静默失败：selected 却无 intel_report）
- `synthesis` — ⑤ 简报合成（漏报/失真/编造/重复）

### `defect_type`（核心三类=漏报/失真/编造，其余为跨层补充）
- `omission` — 漏报：该进没进（合成删掉已分析的 story / 选择上限截断）
- `distortion` — 失真：内容被改写走样、以偏概全
- `fabrication` — 编造：简报出现源里没有的事实（RARR 只覆盖这一类）
- `duplication` — 重复：同一 story 被渲染成多个条目、虚增覆盖（合成层）
- `misclustering` — 聚类污染：异题文章混入簇
- `over_segmentation` — 同一事件被切成多簇
- `silent_failure` — 分析步静默失败：`selected_for_intel=true` 但 `intel_report_r2_key=null`
- `mis_ranking` — 重要性/选择排序错误（如灾难 < 体育）

> 词表可增，但**先复用**再新增；新增值必须在本文件登记。

## 陷阱：别把工具假象当缺陷

1. **⑤ 简报对齐（洞1 工具侧已修）**——旧版子串启发式会把已丢弃的 story 误配到别的段落（cluster 19「building」→ France/Louvre），
   **掩盖漏报**。现改为专有名词加权词汇重叠打分（`assemble-trace.ts` `alignStory`）：锚行会显示 `锚 [term…] score=N`，
   无专有名词命中则标 `⚠️ 未进简报（疑似合成层漏报）`——这**正是漏报信号**，配合 DB `selected_for_intel` 区分：
   `selected=true` 却未进简报 = 合成层漏报；`selected=false` = 选择层没选。
   **残余告诫**：仍是词汇匹配（非语义），弱分匹配（score<3、锚词全是泛词如 world/group）需人工复核；决断前读 `reports.content` 全文。
2. **`[R2 取报告失败]` 是 wrangler 取数 flakiness（部分并发超时），不一定是分析静默失败。**
   静默失败的判据是 DB 里 `selected_for_intel=true 且 intel_report_r2_key=null`（病历袋会标 ⚠️ 缺失），
   不是 R2 pipe 失败。别把取数失败记成 `silent_failure`。

## 累加规则
- 一次 open-code 一轮 = append 若干行；`id` 冲突则视为复核，保留后写的。
- 每条尽量单一根因；一个表现有多层根因时拆多条，`note` 交叉引用。
