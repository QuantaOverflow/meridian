# 系统级 error-analysis（trace 组装器）

从**简报缺陷反追归因**的地基工具。管线各阶段观测性都做了但没串起来（见 memory `eval-program-landscape`），数据全在 DB + R2、主键 = workflow_id。`assemble-trace.ts` 把一条 brief 的 ①→⑤ 全链（"病历袋"）JOIN + 取 R2 拼成可读 markdown，供人 open-code。**纯只读，不判断**。

## 组装的链（主键 workflow_id）
```
⑤ 简报    reports.content              (brief_runs.report_id → reports)
④ 情报报告 R2 intel_report_r2_key       (缺失=分析静默失败,会高亮 ⚠️)
③ 簇→文章 brief_stories.article_ids     (cluster_id + article_ids)
②① 文章   articles                      (url/质量/completeness/content_file_key)
漏判侧    cluster_rejections + selected_for_intel=false
```

## 跑法
```bash
pnpm install --ignore-workspace          # 首次:装 tsx + postgres 到本地 node_modules
export DATABASE_URL='postgresql://...'    # Neon 连接串(见 packages/database / Neon 控制台)
pnpm trace <workflow_id>                   # 输出到 stdout
pnpm trace <workflow_id> --out <dir>       # 写 trace-<wf>.md
pnpm trace <workflow_id> --bodies          # 附带每篇文章正文(慢,走 wrangler r2)
```
- **依赖**：`DATABASE_URL`（Neon）+ wrangler 已登录 CF 账号（取 R2 里的情报报告/正文，`--remote` 打生产桶 `meridian-articles-prod`）。
- 简报正文在 DB（`reports.content`），只有情报报告/文章正文走 R2。

## 归因落盘（取证之后）
`assemble-trace` 只取证不判断。判决（缺陷→层→性质）open-code 后落 `attributions.jsonl`，格式见 `attributions.schema.md`。
以前判决只在脑子里 → 上一轮 40 条蒸发，只剩聚合。现在一行一缺陷、可 append 累加。
**open-code 合成层缺陷前先读 `reports.content` 全文核对**——病历袋的 `⑤ 简报段落（锚"X"）` 是子串启发式，常错配（见 schema 文档"陷阱"节 + 洞1）。

## 背景
2026-07 路 2 error-analysis（8 简报/40 缺陷）结论：缺陷 68% 在合成层（漏报/失真为主，编造仅 7.5%），聚类 12.5%、选择 12.5%（15 上限）、分析 7.5%（静默失败）。详见 memory `error-analysis-path2-attribution`（如已写）。
