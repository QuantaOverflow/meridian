import { $articles, $sources, and, eq, gte, inArray, isNotNull, isNull, lte } from '@meridian/database';
import { looksLikeExtractionFailure } from './extraction-quality';

// ============================================================================
// 一期的输入：时间窗、取正文、质量门、同源去重、embeddings 读回。
// 纯逻辑 + 显式传入的 bucket，不读 env；由简报 workflow 的
// 「补算:查缺失清单」「准备文章数据集」两个 step 与 embeddings 读回调用。
// ============================================================================

export type RunWindow = {
  articleIds: number[];
  dateFrom?: string | Date;
  dateTo?: string | Date;
  timeRangeDays?: number;
  /** 取数上限；调用方未传时 workflow 已回落到 CRON_BRIEF_PARAMS.ARTICLE_LIMIT */
  limit: number;
};

/**
 * 本期候选文章的 WHERE 条件（补算清单与数据集两处查询共用），embedding 状态由参数区分。
 * 调用方须 innerJoin $sources（条件里用到 $sources.category）。
 */
export function runWindowWhere(w: RunWindow, embedding: 'missing' | 'present'): ReturnType<typeof and> {
  const timeConditions = [];
  if (w.articleIds.length === 0) {
    if (w.dateFrom) timeConditions.push(gte($articles.publishDate, new Date(w.dateFrom)));
    if (w.dateTo) timeConditions.push(lte($articles.publishDate, new Date(w.dateTo)));
    if (!w.dateFrom && !w.dateTo && w.timeRangeDays && w.timeRangeDays > 0) {
      timeConditions.push(gte($articles.publishDate, new Date(Date.now() - w.timeRangeDays * 24 * 60 * 60 * 1000)));
    }
  }
  return and(
    embedding === 'missing' ? isNull($articles.embedding) : isNotNull($articles.embedding),
    eq($articles.status, 'PROCESSED'),
    isNotNull($articles.contentFileKey),
    // 自动选样时只取新闻源,排除技术类(如 HN)单篇噪音——与聚类 prune 互补的上游过滤。
    // 显式传 article_ids 时不强加(调用方/eval 自行决定样本)。
    ...(w.articleIds.length > 0
      ? [inArray($articles.id, w.articleIds)]
      : [eq($sources.category, 'news'), ...timeConditions])
  );
}

/**
 * 正文取用结果。OK 之外都是失败。
 * 以前 getArticleContents 把「取不到」「取到空」「抛异常」一律糊成空字符串返回，调用方无法分辨，
 * 而同一件事在初始数据质量门那边是显式分因上报的——按严格那版统一口径，失败不再吞。
 */
export type BodyStatus = 'OK' | 'MISSING_CONTENT_KEY' | 'R2_CONTENT_MISSING' | 'EMPTY_R2_CONTENT' | 'R2_FETCH_ERROR';

/** 取一篇正文。两处取正文（getArticleContents 与数据集构建）都用它；不打日志，由调用方按 status 记 */
export async function fetchBody(
  bucket: R2Bucket,
  key: string | null
): Promise<{ status: BodyStatus; content: string; error?: unknown }> {
  if (!key) return { status: 'MISSING_CONTENT_KEY', content: '' };
  try {
    const obj = await bucket.get(key);
    if (!obj) return { status: 'R2_CONTENT_MISSING', content: '' };
    const content = await obj.text();
    if (!content.trim()) return { status: 'EMPTY_R2_CONTENT', content: '' };
    return { status: 'OK', content };
  } catch (error) {
    return { status: 'R2_FETCH_ERROR', content: '', error };
  }
}

/** 质量门：纯函数 */
export function checkQuality(
  content: string,
  a: { title: string; content_quality: string | null; completeness: string | null }
): { isValid: true } | { isValid: false; reason: string } {
  if (!content || content.trim().length === 0) {
    return { isValid: false, reason: 'EMPTY_CONTENT' };
  }

  // 检查内容长度 - 至少应该超过标题长度的2倍
  if (content.length < (a.title.length * 2)) {
    return { isValid: false, reason: 'INSUFFICIENT_LENGTH' };
  }

  // 检查内容是否只是标题重复
  if (content.trim() === a.title.trim()) {
    return { isValid: false, reason: 'TITLE_ONLY' };
  }

  // 抓取/解析失败签名兜底:抽到的是拦截页/视频stub/登录墙/限流页(非真正文)。
  // processArticles 已在抓取后前置拦截,这里兜历史数据 + 任何残留。
  const extractionFail = looksLikeExtractionFailure(content);
  if (extractionFail.fail) {
    return { isValid: false, reason: `EXTRACTION_JUNK_${extractionFail.reason}` };
  }

  // 检查内容质量标记
  if (a.content_quality === 'LOW_QUALITY' || a.content_quality === 'JUNK') {
    return { isValid: false, reason: 'MARKED_LOW_QUALITY' };
  }

  // 检查完整性标记
  if (a.completeness === 'PARTIAL_USELESS') {
    return { isValid: false, reason: 'MARKED_INCOMPLETE' };
  }

  return { isValid: true };
}

/**
 * 同源模板页指纹：正文折叠空白、小写后取 sha1。**多行正文先去掉第一行**
 * （常是 "Updated: 19/09/2026 - 7:00 GMT+2" 这类每篇都不同的时间戳）。
 *
 * 治的是 Euronews 日播栏目那种：Morning / Midday / Evening 三篇都是视频页，抓到的
 * "正文" 只有 575 字符的栏目宣传语、除首行时间戳外一字不差 → 必然聚成一簇 → 下游
 * 当真事写进简报（2026-09-19 实测）。`looksLikeExtractionFailure` 的六条签名一条都
 * 不命中（不是 YouTube 提示词、不算极短、文案是正经英文句子），属于它已知会漏的那 7%。
 *
 * 分组键必须带 sourceId：通讯社转载会让**不同媒体**正文高度相似（当天 Pakistan 那条
 * 就是 SCMP + AP 两版），那是合法的多源佐证，这条规则不该碰它。
 *
 * **单行正文用全文、不去首行**：整篇只有一行时「去掉第一行」会把正文删光，同一家的
 * 所有单行文章共用一个空指纹、彼此互判重复。2026-09-19 那天 458 篇里 414 篇是单行，
 * 无条件去首行 + 不挡空串 = 丢 407 篇。改成按行数分支后这 414 篇照常参与比对，
 * 当天读数：命中 2 组、丢 3 篇（Euronews bulletin ×3、The Independent 同一篇被抓两次
 * ×2），误杀方向为零。仍保留空串返回 null 的兜底——正文为空本就不该进去重。
 */
export async function bodyFingerprint(content: string): Promise<string | null> {
  const lines = content.split('\n');
  const body = lines.length > 1 ? lines.slice(1).join('\n') : content;
  const normalized = body.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return null;
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 同源模板页去重：同一个 dedupKey（`${sourceId}:${bodyFingerprint}`）下只留 id 最小的一篇。
 * 2026-09-19 全天 458 篇上实测：命中 1 组 3 篇（Euronews bulletin），丢弃 2 篇，
 * 误杀方向为零（只有这 1 组命中，所以谈不上统计意义上的精度）。
 *
 * 输入输出都是 {article, embedding, dedupKey} 成对条目：以前是三个按下标对应的平行数组，
 * 只删一个会让 embedding 错位**且不报错**。kept / dropped 都保持输入顺序；null 键不参与去重。
 */
export function dropSameSourceDuplicates<T extends { id: number }, E>(
  items: Array<{ article: T; embedding: E; dedupKey: string | null }>
): { kept: typeof items; dropped: typeof items } {
  const keeperByKey = new Map<string, number>();
  const dropIdx = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const key = items[i].dedupKey;
    if (!key) continue;
    const keeper = keeperByKey.get(key);
    if (keeper === undefined) {
      keeperByKey.set(key, i);
      continue;
    }
    // 保留 id 最小的那篇：结果不依赖 R2 并行返回的先后
    if (items[keeper].article.id <= items[i].article.id) {
      dropIdx.add(i);
    } else {
      dropIdx.add(keeper);
      keeperByKey.set(key, i);
    }
  }
  return {
    kept: items.filter((_, i) => !dropIdx.has(i)),
    dropped: items.filter((_, i) => dropIdx.has(i)),
  };
}

/**
 * 读回「准备文章数据集」卸到 R2 的 embeddings（未走 step 输出以避开 1MB 限制）。
 * 对象不存在 → throw：以前静默成 []，聚类拿到空向量，最后报误导性的 Dataset is empty。
 */
export async function loadRunEmbeddings(
  bucket: R2Bucket,
  key: string
): Promise<Array<{ articleId: number; embedding: number[] }>> {
  const obj = await bucket.get(key);
  if (!obj) {
    throw new Error(`本期 embeddings 的 R2 对象不存在: ${key}`);
  }
  return JSON.parse(await obj.text());
}
