// ============================================================================
// 调被评对象：ai-worker 的 /meridian/article/analyze 端点，对一篇文章打质量分。
//
// 为什么打活的、不读历史分：
//   1) processArticles.workflow.ts 调 analyzeArticle 时不传 traceId，所以历史
//      article_analysis LLM 调用【没有】落到 R2 llm-calls/（loggedChat 缺 trace_id 即跳过写入）。
//   2) eval 要验的是「当前这版 articleAnalysis prompt 这把尺」，必须用当前 prompt 现打分，
//      读历史 DB 里持久化的 content_quality 会把旧 prompt 的分混进来。
//
// 注意：真实 DashScope 计费。每篇文章一次 qwen-plus/turbo 调用。
// ============================================================================

const AI_WORKER_URL = process.env.AI_WORKER_URL || 'https://meridian-ai-worker.swj299792458.workers.dev';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ScoreResult {
  content_quality?: string;
  completeness?: string;
  error?: string;
  raw?: any;
}

// 调端点给单篇文章打分，只取 eval 关心的两维度
export async function scoreArticle(
  title: string,
  content: string,
  url?: string
): Promise<ScoreResult> {
  const body = { title, content, url };

  const maxAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(`${AI_WORKER_URL}/meridian/article/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`analyze failed: ${resp.status} ${txt.slice(0, 200)}`);
      }
      const data = (await resp.json()) as {
        success?: boolean;
        data?: { content_quality?: string; completeness?: string };
        error?: string;
      };
      if (!data.success || !data.data) {
        return { error: data.error || 'analyze returned no data', raw: data };
      }
      return {
        content_quality: data.data.content_quality,
        completeness: data.data.completeness,
        raw: data.data,
      };
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) await sleep(1500 * attempt);
    }
  }
  return { error: lastErr instanceof Error ? lastErr.message : String(lastErr) };
}
