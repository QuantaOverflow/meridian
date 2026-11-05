# ADR 0019：简报邮件——只寄站主，经 Email Service，寄一次

- 状态：已采纳，2026-11-06（lights-off 夜里实现，待用户读 PR）
- 日期：2026-11-06
- 相关：`apps/backend/src/lib/brief-email.ts`（取数、渲染、发送）、`apps/backend/src/routers/admin.ts`（补发路由）、
  `apps/backend/src/workflows/auto-brief-generation.ts`（step `notify:brief_email`）、`apps/backend/test/lib/brief-email.spec.ts`；spec 在 `.scratch/brief-email/spec.md`（仅本地）

## 背景

站主每天要打开网站才读得到简报，已经不去开了。简报每天北京时间 21:00 照出。站主要它进邮箱。

## 决定

- **只寄站主，不做订阅**（用户定）：收件人是可选 secret `BRIEF_EMAIL_TO`（逗号分隔），不是 var——仓库公开、地址私人。没有订阅表、订阅页、退订。
- **经 Cloudflare Email Service 的 `send_email` binding `EMAIL`**，不要 API key。发件人是 var `BRIEF_EMAIL_FROM`（`brief@pathsoflight.org`，显示名 `Meridian`）。
- **什么时候寄**：「保存简报」之后的 step `notify:brief_email`。发不发只看这一期有没有 `published_at`——只有 cron 跑出的期写它（`save-brief-report.ts`），
  手动调试期在这里是 `not_found`，所以不另判 `triggeredBy`，与读者看不看得到同一口径。
- **寄一次，不重试**：step `retries.limit = 0`。寄出后 step 才失败时重试会寄第二封；漏一封可以用补发路由补，重复的收不回来。
  失败记 error 日志（带 `report_id`）与 `brief_email` 的 step 指标，不让工作流失败，外面再包一层 try 兜平台级的 step 失败。
- **补发路由 `POST /admin/briefs/:id/email`**（`API_TOKEN` 门后）：200 `sent` / `skipped`，404 没发布或不存在，502 带 Email Service 给的原因。
  也是 staging 上不等 cron 就能验邮件的入口。
- **没配收件人 = skipped（warn），不是失败**：自托管的人不开邮件时照旧跑。配了收件人却缺 binding 或发件人，是配错了，按 failed 报。
- **内容取 `reports.content`，不取 `brief_blocks`**：读者页就是解析 `reports.content` 渲染的（同一套 `## 板块` / `<u>**块标题**</u>` 记号），
  而对不上故事的块读者页上有、`brief_blocks` 里没有（ADR 0014）。markdown 用读者页同一个库 markdown-it，选项相同，只是关掉 `html`。
  结构解析在 backend 另写了一份（约 40 行），没和前端的 `briefContent.ts` 合并：合并要把它搬进共享包、动前端，不在这次授权里。
- **HTML 只有行内样式**：Gmail 不认 `<style>` 块与外链样式表。字体字号放在外层 div 上由正文继承，不逐段重复——Gmail 超过约 102KB 会截断。
- **主题里的日期按北京时间**（`Meridian · November 6, 2026 — <标题>`）。读者站上的日期是按 UTC 显示的，凌晨 0–8 点（北京）之间出的期两边会差一天；cron 在北京 21:00，平时一致。

## 没验证的

- 真实邮件在 Gmail / 手机上的样子：靠用户读 staging 寄出的那封。
- 一整期（30 多块）的 HTML 有多大、会不会被 Gmail 截断：测试只用了 3 块。
- workflow 里那一行调用本身没有测试（整条 workflow 跑不了 LLM 链路之外的一段）；测试钉住的是它调的同一个函数「cron 期寄、手动期不寄」，调用处在 staging 运行上验。
