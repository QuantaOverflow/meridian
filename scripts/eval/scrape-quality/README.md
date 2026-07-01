# Scrape-quality eval（抓取/解析正确率）

验证**抓取到的"正文"是真文章，还是抓取/解析失败的产物**——管线最上游那一环（`①原始网页 ─[CF Browser Rendering + Mozilla Readability]→ ②正文`）。此前整条链唯一无 harness 的环节。

**机械 eval，不需 LLM-judge / κ**：判定是确定性代码（签名 + URL 规则），金标是人工开放编码的类别。

## 这条线在评什么

判 `apps/backend/src/lib/core/extraction-quality.ts` 的两个生产函数：
- `looksLikeExtractionFailure(text)` — 内容签名：反爬拦截页 / 视频播放器 stub / 登录墙 / 限流页 / 站点 boilerplate / 极短 nav stub。
- `looksLikeNonArticleUrl(url)` — 结构性非新闻页：github 代码页 / 商店 / 活动流 / 社媒视频。

这两个函数在 `processArticles.workflow.ts` 里于**喂 LLM 分析前**拦掉 junk（记 `status=FETCH_FAILED, failReason=EXTRACTION_JUNK:<type>`、不进聚类），并在 `auto-brief-generation.ts` 的 `validateContentQuality` 兜底。

> score.ts **直接 import 生产函数**（非副本）——所以这条 eval 真在测线上代码，改了 prod 不同步会被 score 抓到。

## 数据

- `gold/gold.jsonl` — 73 条开放编码金标。分层抽样（JUNK/LOW/OK 过采）自生产 R2 真实正文，人工读正文标类别（blind 于 pipeline 的 content_quality）。字段：`{id, url, pipeline_q, pipeline_comp, gold_cat, is_extraction_failure}`。
- `gold/content.jsonl` — `{id, text}`，73 篇提取正文（金标语料，自包含可复跑）。
- `rubric.md` — 分类规范（A REAL_ARTICLE / B EXTRACTION_FAILURE 子类 / C LOW_NEWS_VALUE）。

## 跑法

```bash
pnpm install   # 若无 node_modules
pnpm score     # 对金标算 precision/recall + 混淆 + 接受闸
```

接受闸：**precision = 1.0（不误杀真文章）且 recall ≥ 0.85**。

## 当前结果（n=73）

- 检测器 **precision 1.00 / recall 0.93**（28/30，0 误报）。FN 3=长尾（单句截断 stub、产品页/github blob）。
- 生产 FP 扩验（独立 40 篇随机 OK）：**0 误伤**。
- pipeline 对比：**JUNK 精度 100%**（门判 junk 可信）；**LOW_QUALITY 61% 是被误降级的真新闻**（→ articleAnalysis 的 LOW 判据问题，属 `article-quality` eval 线，另修）；现机械门 `validateContentQuality`(len<2×标题) 只逮 6/30。

## 局限

- 金标 n=73、**分层过采**（≈41% 失败 ≠ 总体流行率；总体 fetch-fail 11% + gate-JUNK ~6%）——用于**检测器标定**，非流行率估计。
- 标签为**单遍开放编码（silver）**；类别较客观（拦截页 vs 真文章），但严格金标需二标/人核。**已知坑**：只读头部会误标（真文章开头挂导航杂质 → 曾误标 129395，读全文修正）——标注须读全文。
- 只治**抓取失败/非新闻**；"真文本低新闻值"(LOW_NEWS_VALUE) 与 fetch 根本失败(11%) 是另外的事。
